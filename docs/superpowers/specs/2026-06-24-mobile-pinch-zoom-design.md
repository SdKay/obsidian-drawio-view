# Mobile pinch-zoom + viewport interaction refactor

## Problem

Zoom is bound only to the `wheel` event (`viewer.ts`). iOS / Obsidian mobile has
no mouse wheel — pinch gestures fire `touch`/`gesture` events, never `wheel`, so
zoom is completely dead on Apple devices. Pan half-works because iOS synthesises
mouse events from single-finger touches, but it is unreliable.

A second, structural problem: `setupInteraction` (~200 lines) mixes zoom, pan,
hover-tooltip, link-follow and commit scheduling in one method, communicating
through closure variables and class fields (`vScale/vTx/vTy/flushView/commitTimer`)
scattered on the viewer. Adding a touch branch in place makes it worse.

## Scope

In: viewport interaction only — pan, wheel-zoom, pinch-zoom — extracted into a
dedicated controller using Pointer Events.

Out: mobile-specific link/tooltip interaction (hover has no touch equivalent).
Hover-tooltip, link-follow, dblclick-reset and the resize handle keep their
current behaviour. `panModifier` Ctrl semantics stay for mouse; touch ignores it.

## Architecture

New file `src/viewportController.ts` exporting `PanZoomController`.

It **owns** the visual transform (`vScale/vTx/vTy`) and the `panEl` CSS writes,
and **encapsulates** all viewport gestures + commit scheduling + flush. It does
not depend on `GraphRenderer` or viewer internals; it talks to them through a
host interface:

```ts
interface ViewportHost {
  getCommittedScale(): number;                      // renderer.getScale()
  getCommittedOffset(): { x: number; y: number };   // renderer.getDisplayOffset()
  commitView(zoomPct: number, dx: number, dy: number): void; // renderer.setViewFromDisplay()
  onViewChange(): void;                             // viewer.updateStatus()
}
```

Public surface:

```ts
class PanZoomController {
  constructor(graphEl: HTMLElement, panEl: HTMLElement, host: ViewportHost,
              getSettings: () => DrawioViewSettings);
  getVisual(): { scale: number; tx: number; ty: number };
  clearVisual(): void;          // reset transform + CSS (page switch / reload / reset)
  flush(): void;                // fold visual transform into committed view now
  get didGesture(): boolean;    // last pointer interaction panned/pinched (click guard)
  destroy(): void;              // clear timers (viewer.onunload)
}
```

## Gesture handling (Pointer Events)

- `pointerdown` on graphEl → add to `activePointers` Map (id → {x, y}),
  `setPointerCapture` so drags that leave the element keep tracking.
- `pointermove`:
  - 1 active pointer → pan: update `vTx/vTy` by the delta.
  - 2 active pointers → pinch: compute midpoint + distance; scale by
    `dist/prevDist` anchored at the midpoint (reuse existing cursor-anchored
    formula), and translate by midpoint delta.
- `pointerup` / `pointercancel` → remove from Map; when Map empties, end the
  gesture and `scheduleCommit()`.
- `wheel` stays (desktop trackpad/mouse) — best zoom feel there; Pointer Events
  do not cover wheel.

Modifier rules (no desktop regression):
- `wheel` still honours `zoomModifier` (Ctrl-to-zoom).
- Mouse-type pointer pan honours `panModifier` (Ctrl-drag) exactly as today.
- Touch/pen pointers ignore `panModifier`: single finger always pans, two
  fingers always pinch.

CSS: add `touch-action: none` to `.drawio-view-graph` so the browser does not
steal pinch/drag for native scroll/zoom.

Commit scheduling (`scheduleCommit`/`flushView` with the DOM-detach trick and
`setTimeout(0)`) moves into the controller unchanged — same performance
characteristics as today.

## Viewer changes

- Remove `vScale/vTx/vTy/flushView/commitTimer/applyVisualTransform/clearVisualTransform`.
- `setupInteraction`: pan/zoom/commit block moves into the controller. Keep
  dblclick-reset, hover-tooltip, link-follow click, tooltip enter/leave — these
  now read `controller.getVisual()` for coordinate maths and `controller.didGesture`
  to decide whether a click should follow a link.
- `renderCurrentPage` / `reloadFile` / `resetView` call `controller.clearVisual()`.
- `buildParamString` / `currentScale` / `currentDisplayOffset` combine
  `controller.getVisual()` with the renderer's committed values.
- Construct the controller where the renderer is created (in `renderCurrentPage`).
- `onunload` calls `controller.destroy()`.

## Regression test checklist (manual — no automated tests)

Desktop: wheel zoom, trackpad zoom, drag pan, hover tooltip + highlight,
Ctrl+click follow link (both panModifier modes), double-click reset, page tabs,
resize handle, apply (⊙) / open-external (↗).

Mobile (iOS): single-finger pan, two-finger pinch zoom, tap (no accidental
zoom/scroll stealing).
