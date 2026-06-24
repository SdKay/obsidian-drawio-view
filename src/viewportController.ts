import { Component } from 'obsidian';
import type { DrawioViewSettings } from './settings';

/**
 * Bridge to the committed @maxgraph view.  The controller owns the *uncommitted*
 * visual CSS transform (pan/zoom not yet folded into @maxgraph); the host gives
 * it read access to the committed view and a way to commit a new one.
 */
export interface ViewportHost {
	/** Current committed scale (1.0 = 100%). */
	getCommittedScale(): number;
	/** Current committed translate as screen-pixel offset. */
	getCommittedOffset(): { x: number; y: number };
	/** Fold a final view back into @maxgraph (one redraw). */
	commitView(zoomPct: number, displayX: number, displayY: number): void;
	/** Called whenever the visual transform changes (e.g. to refresh status). */
	onViewChange(): void;
}

interface PointerSample { x: number; y: number; }

/**
 * Owns viewport pan/zoom for the diagram.  Gestures update a CSS transform on
 * `panEl` (`--dv-tx/-ty/-scale`) for instant GPU-composited feedback; once the
 * gesture ends, the transform is folded into the @maxgraph renderer via the
 * host in one redraw.
 *
 * Input handling is unified on Pointer Events so it works for mouse, touch and
 * pen alike:
 *   - one pointer  → pan
 *   - two pointers → pinch-zoom (anchored at the midpoint) + pan
 *   - wheel        → zoom (desktop; Pointer Events do not cover the wheel)
 *
 * Modifier rules preserve desktop behaviour without regression:
 *   - wheel honours `zoomModifier` (Ctrl-to-zoom)
 *   - a mouse pointer honours `panModifier` (Ctrl-drag to pan)
 *   - touch/pen ignore `panModifier`: one finger always pans, two always pinch
 */
export class PanZoomController extends Component {
	// ── Visual transform layer (uncommitted) ──────────────────────────────────
	// transform-origin is 0 0, so: screenFinal(X) = (vTx,vTy) + vScale·screenMaxgraph(X)
	private vScale = 1;
	private vTx = 0;
	private vTy = 0;

	private applyRaf = 0;
	private commitTimer = 0;

	// Active pointers (pointerId → latest position), for pan + pinch.
	private readonly pointers = new Map<number, PointerSample>();
	private panning = false;
	private panBaseTx = 0;
	private panBaseTy = 0;
	private panStartX = 0;
	private panStartY = 0;
	// Pinch reference state, updated each frame.
	private pinchDist = 0;
	private pinchCx = 0;
	private pinchCy = 0;
	/** Whether the current/last pointer interaction actually moved (pan or pinch). */
	private gestured = false;

	constructor(
		private readonly graphEl: HTMLElement,
		private readonly panEl: HTMLElement,
		private readonly host: ViewportHost,
		private readonly getSettings: () => DrawioViewSettings,
	) {
		super();
	}

	onload(): void {
		// ── Wheel zoom (desktop) ──────────────────────────────────────────────
		this.registerDomEvent(this.graphEl, 'wheel', (e: WheelEvent) => {
			if (this.getSettings().zoomModifier === 'ctrl' && !e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			e.stopPropagation();
			this.cancelCommit();
			const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
			const rect = this.graphEl.getBoundingClientRect();
			this.zoomAt(f, e.clientX - rect.left, e.clientY - rect.top);
			this.panEl.addClass('is-panning');
			this.scheduleApply();
			this.scheduleCommit();
		}, { passive: false, capture: true });

		// ── Pointer pan + pinch ───────────────────────────────────────────────
		this.registerDomEvent(this.graphEl, 'pointerdown', (e: PointerEvent) => this.onPointerDown(e));
		this.registerDomEvent(this.graphEl, 'pointermove', (e: PointerEvent) => this.onPointerMove(e));
		this.registerDomEvent(this.graphEl, 'pointerup', (e: PointerEvent) => this.onPointerUp(e));
		this.registerDomEvent(this.graphEl, 'pointercancel', (e: PointerEvent) => this.onPointerUp(e));
	}

	onunload(): void {
		this.cancelCommit();
		if (this.applyRaf) { window.cancelAnimationFrame(this.applyRaf); this.applyRaf = 0; }
		this.pointers.clear();
	}

	// ── Public surface ────────────────────────────────────────────────────────

	/** The uncommitted visual transform (used for hit-testing & param building). */
	getVisual(): { scale: number; tx: number; ty: number } {
		return { scale: this.vScale, tx: this.vTx, ty: this.vTy };
	}

	/** True if the last pointer interaction panned/pinched (vs. a clean tap). */
	get didGesture(): boolean {
		return this.gestured;
	}

	/** Reset the visual transform to identity (page switch / reload / reset). */
	clearVisual(): void {
		this.cancelCommit();
		this.vScale = 1; this.vTx = 0; this.vTy = 0;
		this.panEl.setCssProps({ '--dv-tx': '0px', '--dv-ty': '0px', '--dv-scale': '1' });
	}

	/** Fold the visual transform into the committed view immediately. */
	flush(): void {
		this.flushView();
	}

	// ── Pointer handlers ────────────────────────────────────────────────────────

	private onPointerDown(e: PointerEvent): void {
		// Ignore non-primary mouse buttons; touch/pen report button 0.
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		this.cancelCommit();
		try { this.graphEl.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
		this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		this.gestured = false;

		if (this.pointers.size >= 2) {
			// Entering pinch — stop single-finger pan and seed pinch reference.
			this.panning = false;
			this.seedPinch();
			this.panEl.addClass('is-panning');
			return;
		}

		// Single pointer → maybe pan.  Mouse honours panModifier; touch/pen always pan.
		const isMouse = e.pointerType === 'mouse';
		const wantPan = !isMouse || this.getSettings().panModifier === 'none' || e.ctrlKey || e.metaKey;
		if (wantPan) {
			this.panning = true;
			this.panBaseTx = this.vTx;
			this.panBaseTy = this.vTy;
			this.panStartX = e.clientX;
			this.panStartY = e.clientY;
			this.graphEl.addClass('is-grabbing');
			this.panEl.addClass('is-panning');
		}
	}

	private onPointerMove(e: PointerEvent): void {
		const p = this.pointers.get(e.pointerId);
		if (!p) return;
		p.x = e.clientX;
		p.y = e.clientY;

		if (this.pointers.size >= 2) {
			this.handlePinch();
			return;
		}
		if (!this.panning) return;
		const dx = e.clientX - this.panStartX;
		const dy = e.clientY - this.panStartY;
		if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this.gestured = true;
		this.vTx = this.panBaseTx + dx;
		this.vTy = this.panBaseTy + dy;
		this.scheduleApply();
	}

	private onPointerUp(e: PointerEvent): void {
		try { this.graphEl.releasePointerCapture(e.pointerId); } catch { /* best-effort */ }
		this.pointers.delete(e.pointerId);

		if (this.pointers.size === 1) {
			// Dropped from pinch back to one finger — resume panning from it
			// to avoid a jump.
			const only = [...this.pointers.values()][0]!;
			this.panning = true;
			this.panBaseTx = this.vTx;
			this.panBaseTy = this.vTy;
			this.panStartX = only.x;
			this.panStartY = only.y;
			return;
		}
		if (this.pointers.size === 0) {
			this.panning = false;
			this.graphEl.removeClass('is-grabbing');
			this.scheduleCommit();
			this.host.onViewChange();
		}
	}

	// ── Pinch maths ───────────────────────────────────────────────────────────

	private seedPinch(): void {
		const pts = [...this.pointers.values()];
		const a = pts[0]!;
		const b = pts[1]!;
		this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
		this.pinchCx = (a.x + b.x) / 2;
		this.pinchCy = (a.y + b.y) / 2;
	}

	private handlePinch(): void {
		const pts = [...this.pointers.values()];
		const a = pts[0]!;
		const b = pts[1]!;
		const dist = Math.hypot(a.x - b.x, a.y - b.y);
		const cx = (a.x + b.x) / 2;
		const cy = (a.y + b.y) / 2;
		if (this.pinchDist > 0) {
			const rect = this.graphEl.getBoundingClientRect();
			const f = dist / this.pinchDist;
			// Scale anchored at the current midpoint…
			this.zoomAt(f, cx - rect.left, cy - rect.top);
			// …plus translation from the midpoint moving across the screen.
			this.vTx += cx - this.pinchCx;
			this.vTy += cy - this.pinchCy;
			this.gestured = true;
			this.scheduleApply();
		}
		this.pinchDist = dist;
		this.pinchCx = cx;
		this.pinchCy = cy;
	}

	/** Multiply scale by `f` about graph-relative point (px, py), keeping it fixed. */
	private zoomAt(f: number, px: number, py: number): void {
		this.vTx = f * this.vTx + px * (1 - f);
		this.vTy = f * this.vTy + py * (1 - f);
		this.vScale *= f;
	}

	// ── Commit + apply scheduling ─────────────────────────────────────────────

	private scheduleApply(): void {
		if (this.applyRaf) return;
		this.applyRaf = window.requestAnimationFrame(() => {
			this.applyRaf = 0;
			this.panEl.setCssProps({
				'--dv-tx': `${this.vTx}px`,
				'--dv-ty': `${this.vTy}px`,
				'--dv-scale': `${this.vScale}`,
			});
			this.host.onViewChange();
		});
	}

	private cancelCommit(): void {
		if (!this.commitTimer) return;
		window.clearTimeout(this.commitTimer);
		this.commitTimer = 0;
	}

	private scheduleCommit(): void {
		this.cancelCommit();
		// Pure panning (vScale === 1) needs no @maxgraph redraw — the CSS
		// translate is already crisp; only an uncommitted zoom schedules one.
		if (this.vScale === 1) { this.panEl.removeClass('is-panning'); return; }
		this.commitTimer = window.setTimeout(() => {
			this.commitTimer = 0;
			this.panEl.removeClass('is-panning');
			this.flushView();
		}, 0);
	}

	private flushView(): void {
		if (this.vScale === 1 && this.vTx === 0 && this.vTy === 0) return;
		const s0 = this.host.getCommittedScale();
		const d0 = this.host.getCommittedOffset();
		const sf = this.vScale * s0;
		const dfx = this.vTx + this.vScale * d0.x;
		const dfy = this.vTy + this.vScale * d0.y;
		this.vScale = 1; this.vTx = 0; this.vTy = 0;
		this.panEl.setCssProps({ '--dv-tx': '0px', '--dv-ty': '0px', '--dv-scale': '1' });
		this.host.commitView(sf * 100, dfx, dfy);
	}
}
