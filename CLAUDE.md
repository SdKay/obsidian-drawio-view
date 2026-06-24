# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # watch mode — rebuilds on change, inline sourcemaps
npm run build      # production build: tsc type-check + minified main.js
npm run lint       # ESLint with obsidianmd recommended rules
```

There are no automated tests. To test changes, load the plugin in Obsidian (vault at `/home/silas_xing/code/ob_dev`) and observe behavior manually.

After any code change, run `npm run dev` (or `npm run build`) to regenerate `main.js`, then reload the plugin in Obsidian.

## Architecture

The plugin registers a `drawio-view` fenced code block processor. The code block content is a `|`-separated param string: `filename.drawio|<page>|<height>|<zoom>|<offset>`. All parameters are optional except the filename.

**Data flow:**

```
.md code block  →  DrawioCodeBlock (main.ts)
                      ↓ parseViewParams()
                   DrawioViewer (viewer.ts) ──owns──▶ PanZoomController (viewportController.ts)
                      ↓ vault.read() + parseDrawioCached()   ▲ ViewportHost interface
                   GraphRenderer (graphRenderer.ts)  ─────────┘  →  @maxgraph/core Graph
```

**`src/main.ts`** — Plugin entry. `DrawioCodeBlock extends MarkdownRenderChild` owns the lifecycle. It passes an `onUpdate` callback to `DrawioViewer` that writes new view params back to the note via `vault.process()` (atomic, race-free), plus `sourcePath` so the viewer can resolve shape links relative to the host note.

**`src/parser.ts`** — Two concerns:
- `.drawio` XML parsing: handles both uncompressed (`<mxGraphModel>` child) and compressed (base64+deflateRaw encoded) `<diagram>` content. `parseDrawioCached` is a single-entry content cache.
- View param parsing: `parseViewParams()` recognises tokens by shape (`*.drawio`, `page-N`, `N%`, `(X,Y)`, `Npx`, page name).

**`src/viewer.ts`** — `DrawioViewer extends Component`. Owns lifecycle and layout, and delegates all viewport gestures to `PanZoomController`. Responsibilities:
- **Layout / HUD**: builds the graph viewport, the bottom-right HUD pill (↗ open-external, ⊙ apply-view, live `zoom% (x, y)` status), page tabs, the hover link tooltip + edit (✎) button, the shape-hover highlight box, and the bottom-edge resize handle.
- **Hover + links**: RAF-throttled `mousemove` hit-tests the shape under the cursor (via `renderer.getShapeAt`), shows the highlight + tooltip, and follows / edits the link on click. Coordinate maths reads the live transform from `controller.getVisual()`; `controller.didGesture` distinguishes a click from a drag/pinch.
- **Module-level `contentCache`** (`Map<path, content>`): enables synchronous first paint when the code block is rebuilt after the ⊙ button writes params back (the `.drawio` file didn't change, so the cache hit avoids an async read gap and blank flash).
- File-change watching: debounced 400 ms, uses soft-reload (re-parse + re-load XML into the existing renderer, *without* re-fitting) when page count is unchanged.

**`src/viewportController.ts`** — `PanZoomController extends Component`. Owns the *uncommitted* visual transform (`vScale/vTx/vTy`) and all viewport input, decoupled from the renderer via the `ViewportHost` interface (`getCommittedScale/Offset`, `commitView`, `onViewChange`).
- **Unified Pointer Events**: one pointer pans, two pinch-zoom (anchored at the midpoint) + pan, `wheel` zooms on desktop. Works for mouse, touch and pen — this is what makes pinch-zoom work on iOS/Android. CSS `touch-action: none` on the viewport stops the browser stealing gestures.
- **Two-layer pan/zoom**: gestures update CSS custom properties (`--dv-tx/-ty/-scale`) on `panEl` for instant GPU-composited feedback; after the gesture ends (`setTimeout(0)`), `flushView()` folds them into @maxgraph in one redraw. Pure pans (`vScale === 1`) skip the redraw entirely.
- **Modifier rules**: a mouse pointer honours `panModifier` (Ctrl-drag); `wheel` honours `zoomModifier` (Ctrl-zoom); touch/pen ignore both (one finger always pans, two always pinch).

**`src/graphRenderer.ts`** — Thin wrapper around `@maxgraph/core`'s `Graph`. Constructed with an empty plugin list (no editing handlers). Handles coordinate conventions: *display offset* = `translate * scale` (screen pixels).
- **DOM detach trick** in `setViewFromDisplay`: the container is temporarily removed from the DOM during the @maxgraph redraw to prevent other plugins' `MutationObserver`s from turning a ~100 ms render into 3–4 s.
- `preprocessXml()` normalises draw.io style quirks before import (`strokeColor=default`, `fillColor=none` → `transparent`, `shape=waypoint` → small dot ellipse).
- `convertValueToString` override: renders a `UserObject` cell's `label` attribute (otherwise @maxgraph stringifies the XML element as `[object Element]`).
- Hit-testing: `getLinkAt` / `getCellInfoAt` / `getShapeAt` resolve the cell (or its parent shape) under panEl-relative coordinates and extract its link and/or bounds.

**`src/linkEditor.ts`** — Shape-link editing.
- `LinkEditorModal extends SuggestModal`: fuzzy vault-file picker that also accepts a raw `https://` URL (offered at the top of the list when the query looks like a URL); pre-fills and strips `[[...]]`.
- `patchCellLink(xml, cellId, link)`: pure function that rewrites the link in the `.drawio` XML — updates an existing `UserObject`, or wraps a plain `mxCell` in a new `UserObject` (moving its `value` to `label`). Written back via `vault.process()`; the file-change watcher then soft-reloads.

**`src/settings.ts`** — Two settings: `zoomModifier: 'none' | 'ctrl'` (whether wheel-zoom needs Ctrl) and `panModifier: 'none' | 'ctrl'` (whether plain drag or Ctrl-drag pans, with the opposite gesture following links). Both are mouse-only; touch ignores them.

## Key constraints

- `obsidian` and all `@codemirror/*` / `@lezer/*` packages are `external` in esbuild — they come from the Obsidian host, not the bundle. `@maxgraph/core` and `pako` are bundled.
- The `eslint-plugin-obsidianmd` recommended config enforces Obsidian-specific rules (e.g. no direct `fetch`, use `requestUrl`). Run `npm run lint` before committing.
- `vault.process()` is preferred over `vault.read` + `vault.modify` for writing back params — it's atomic and avoids races with other plugins editing the same file.
- `activeDocument` (not `document`) must be used for global event listeners to support Obsidian popout windows.
- Use `window.setTimeout` / `window.clearTimeout` etc., not `activeWindow.*` — both are popout-safe but `window.*` is what the ESLint rule expects.
- Drive visual transforms via `element.setCssProps({ '--dv-tx': ... })` — never assign `element.style` directly (violates obsidianmd lint rule).
- File resolution: use `vault.getAbstractFileByPath()` + `metadataCache.getFirstLinkpathDest()` for lookups; always wrap user-supplied paths with `normalizePath()`. Never iterate `vault.getFiles()` to find a file.
- `minAppVersion` is `1.1.0` — the minimum required by `Vault.process()`. Do not lower it.
- Viewport input goes through Pointer Events (not separate mouse/touch handlers) so one code path serves desktop and mobile. Keep `touch-action: none` on `.drawio-view-graph` or the WebView steals pinch/drag.
- Custom interactive elements use `<span role="button">`, not `<button>` — Obsidian's theme button styles are too aggressive to override cleanly. Add a `keydown` (Enter/Space) handler for keyboard access.

## CSS rules

Past review findings that were already fixed — don't reintroduce:

- No `!important` — increase selector specificity or use CSS variables instead.
- No `::-webkit-scrollbar` or other vendor-prefixed scrollbar properties (Obsidian guidelines flag these).
- Avoid browser features classified as partially supported by the target Obsidian version (e.g. `css-scrollbar`).

Dark mode is pure CSS: `.theme-dark .drawio-view-graph { filter: invert(1) hue-rotate(180deg) }` — applied to the clipping viewport so the border/HUD/tabs are unaffected. No JS, follows the Obsidian theme class instantly.

## Releasing

Releases are tag-driven. The GitHub Actions workflow (`.github/workflows/release.yml`) triggers on any tag push, runs `npm run build`, attests `main.js` and `styles.css`, and creates a GitHub Release with `main.js`, `manifest.json`, `styles.css`.

When bumping the version, update all three files in one commit:

```
manifest.json    — "version"
package.json     — "version"
versions.json    — add entry  { "<new-ver>": "<minAppVersion>" }
```

Then tag and push:

```bash
git tag 0.0.X
git push origin 0.0.X
```

The release changelog is auto-generated from conventional commit prefixes (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`). Use these prefixes in commit messages so the changelog sections are populated correctly.
