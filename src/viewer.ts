import { App, Component, TFile } from 'obsidian';
import { parseDrawioCached, type ViewOptions, type DrawioPage } from './parser';
import { GraphRenderer, type BoundingBox } from './graphRenderer';
import type { DrawioViewSettings } from './settings';

// Module-level cache of .drawio file CONTENT keyed by path.  Crucial for a
// flash-free re-render: when the ⊙ button writes view params into the .md file,
// Obsidian rebuilds the code block, but the .drawio file itself is unchanged —
// so the new viewer can paint synchronously from this cache (no async vault
// read gap, which is what caused the blank-flash) and verify in the background.
const contentCache = new Map<string, string>();

export class DrawioViewer extends Component {
	private readonly app: App;
	private readonly container: HTMLElement;
	private readonly options: ViewOptions;
	/** Live plugin settings (shared reference; reflects changes without reload). */
	private readonly settings: DrawioViewSettings;
	/** Called when the user clicks "apply current view to code block". */
	private readonly onUpdate: ((newParams: string) => Promise<void>) | null;

	private pages: DrawioPage[] = [];
	private currentPage = 0;
	private currentBbox: BoundingBox = { x: 0, y: 0, width: 400, height: 300 };

	// Default view state — saved after first render, used by dblclick-reset
	private defaultZoom = 100;
	private defaultDisplayX = 0;
	private defaultDisplayY = 0;

	private renderer: GraphRenderer | null = null;
	private statusEl: HTMLElement | null = null;
	private tabsEl: HTMLElement | null = null;
	private graphEl: HTMLElement | null = null;
	/** Inner element that @maxgraph renders into; CSS-transformed for pan/zoom. */
	private panEl: HTMLElement | null = null;
	// ── Visual transform layer ────────────────────────────────────────────────
	// A CSS transform applied to panEl that represents pan/zoom adjustments NOT
	// yet committed to @maxgraph.  transform-origin is 0 0, so the mapping is:
	//   screenFinal(X) = (vTx, vTy) + vScale · screenMaxgraph(X)
	// Panning updates vTx/vTy; zooming updates vScale (and vTx/vTy to keep the
	// cursor anchored).  flushView() folds these into @maxgraph in one redraw.
	private vScale = 1;
	private vTx = 0;
	private vTy = 0;
	/** Fold the visual CSS transform into @maxgraph (one redraw) and clear it. */
	private flushView: () => void = () => {};
	/** Pending debounced commit timer id (0 = none). Cancelled by any new gesture. */
	private commitTimer = 0;

	constructor(
		app: App,
		container: HTMLElement,
		options: ViewOptions,
		settings: DrawioViewSettings,
		onUpdate?: (newParams: string) => Promise<void>,
	) {
		super();
		this.app = app;
		this.container = container;
		this.options = options;
		this.settings = settings;
		this.onUpdate = onUpdate ?? null;
	}

	onload(): void {
		const file = this.resolveFile(this.options.filename);
		if (!file) {
			this.container.createDiv({ cls: 'drawio-view-error', text: `File not found: ${this.options.filename}` });
			return;
		}

		// Synchronous first paint from cache → no blank flash on re-render.
		const cached = contentCache.get(file.path);
		if (cached !== undefined) {
			this.renderFromContent(cached);
		}

		// Verify against the real file in the background; re-render only if the
		// .drawio actually changed (or if there was no cache to paint from).
		void this.verifyAndRender(file, cached);
	}

	/** Read the file fresh and re-render if its content differs from the cache. */
	private async verifyAndRender(file: TFile, cached: string | undefined): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			if (content === cached) return;            // unchanged → nothing to do
			contentCache.set(file.path, content);
			this.renderFromContent(content);
		} catch (err) {
			console.error('DrawioViewer:', err);
		}
	}

	onunload(): void {
		if (this.commitTimer) {
			const w = activeWindow as unknown as { cancelIdleCallback?: (id: number) => void };
			if (typeof w.cancelIdleCallback === 'function') w.cancelIdleCallback(this.commitTimer);
			else window.clearTimeout(this.commitTimer);
			this.commitTimer = 0;
		}
		this.renderer?.destroy();
		this.renderer = null;
	}

	/** (Re)build the viewer from raw .drawio file content. */
	private renderFromContent(content: string): void {
		const drawio = parseDrawioCached(content);
		this.pages = drawio.pages;

		// Clear any previous render (e.g. background re-render after a change).
		this.renderer?.destroy();
		this.renderer = null;
		this.container.empty();
		this.graphEl = this.panEl = this.statusEl = this.tabsEl = null;

		if (this.pages.length === 0) {
			this.container.createDiv({ cls: 'drawio-view-error', text: 'No diagrams found.' });
			return;
		}
		// Resolve page: by name first, then by index.
		let targetIdx = this.options.pageIndex;
		if (this.options.pageName) {
			const named = this.pages.findIndex(p => p.name === this.options.pageName);
			if (named !== -1) targetIdx = named;
		}
		this.currentPage = Math.max(0, Math.min(targetIdx, this.pages.length - 1));
		this.buildLayout();
		this.renderCurrentPage();
	}

	private resolveFile(filename: string): TFile | null {
		// main.ts already resolved this to a vault-absolute path; a direct lookup
		// avoids iterating all files (which is slow on large vaults).
		const f = this.app.vault.getAbstractFileByPath(filename);
		if (f instanceof TFile) return f;
		// Last-resort link resolution for a bare name.
		const linked = this.app.metadataCache.getFirstLinkpathDest(filename, '');
		return linked instanceof TFile ? linked : null;
	}

	private buildLayout(): void {
		this.container.addClass('drawio-view-container');
		if (this.options.height > 0) {
			this.container.style.height = `${this.options.height}px`;
		}

		// graphEl is the fixed clipping viewport (overflow: hidden).  The inner
		// panEl is what @maxgraph renders into and what we CSS-translate for
		// panning — it can overflow graphEl, so content panned off-screen still
		// exists in the DOM and reappears when panned back.
		this.graphEl = this.container.createDiv('drawio-view-graph');
		this.panEl = this.graphEl.createDiv('drawio-view-pan');

		// Status bar is a sibling of graphEl (not inside it) so @maxgraph/core's
		// internal HTML-label overlay cannot interfere with its position.
		this.statusEl = this.container.createDiv('drawio-view-status');
		this.statusEl.setAttribute('aria-live', 'polite');

		if (this.pages.length > 1) {
			// `has-tabs` lifts the status bar / apply button above the tab bar (CSS).
			this.container.addClass('has-tabs');
			this.tabsEl = this.container.createDiv('drawio-view-tabs');
			this.tabsEl.setAttribute('role', 'tablist');
			this.buildTabs();
		}

		// "Apply view to code block" button — only shown when an update callback
		// was provided (i.e. the viewer was created from a code block, not an embed).
		if (this.onUpdate) {
			const btn = this.container.createEl('button', {
				cls: 'drawio-view-update-btn',
				attr: {
					'aria-label': 'Apply current view to code block',
					'title': 'Apply current view to code block',
					'tabindex': '0',
				},
			});
			btn.setText('⊙');
			this.registerDomEvent(btn, 'click', () => {
				this.applyCurrentView().catch(err => console.error('DrawioViewer update:', err));
			});
		}

		// Bottom-edge resize handle — drag to change the viewer height.
		this.buildResizeHandle();
	}

	private buildResizeHandle(): void {
		const handle = this.container.createDiv('drawio-view-resize-handle');
		handle.setAttribute('aria-label', 'Drag to resize height');

		let resizing = false;
		let startY = 0;
		let startH = 0;
		const MIN_H = 120;

		this.registerDomEvent(handle, 'mousedown', (e: MouseEvent) => {
			if (e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();
			resizing = true;
			startY = e.clientY;
			startH = this.container.getBoundingClientRect().height;
			this.container.addClass('is-resizing');
		}, true);

		this.registerDomEvent(activeDocument, 'mousemove', (e: MouseEvent) => {
			if (!resizing) return;
			const h = Math.max(MIN_H, Math.round(startH + (e.clientY - startY)));
			this.container.style.height = `${h}px`;
		});

		this.registerDomEvent(activeDocument, 'mouseup', () => {
			if (!resizing) return;
			resizing = false;
			this.container.removeClass('is-resizing');
			const h = Math.round(this.container.getBoundingClientRect().height);
			this.options.height = h;
			// Re-fit auto-fit views to the new height; keep explicit zoom as-is.
			if (this.options.zoom === 0 && this.renderer && this.graphEl) {
				const rect = this.graphEl.getBoundingClientRect();
				this.renderer.autoFit(rect.width || 600, rect.height || 380, this.currentBbox);
				this.updateStatus();
			}
			// Persist the new height to the code block (preserving other params).
			if (this.onUpdate) {
				this.onUpdate(this.buildParamFromOptions()).catch(err =>
					console.error('DrawioViewer resize:', err));
			}
		});
	}

	private buildTabs(): void {
		if (!this.tabsEl) return;
		this.tabsEl.empty();
		this.pages.forEach((page, i) => {
			const tab = this.tabsEl!.createEl('button', {
				cls: 'drawio-view-tab' + (i === this.currentPage ? ' is-active' : ''),
				text: page.name,
				attr: {
					role: 'tab',
					tabindex: i === this.currentPage ? '0' : '-1',
					'aria-label': page.name,
					'aria-selected': String(i === this.currentPage),
				},
			});
			this.registerDomEvent(tab, 'click', () => this.switchPage(i));
			this.registerDomEvent(tab, 'keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.switchPage(i); }
			});
		});
	}

	private switchPage(index: number): void {
		this.currentPage = index;
		this.tabsEl?.querySelectorAll<HTMLElement>('.drawio-view-tab').forEach((tab, i) => {
			const active = i === index;
			tab.toggleClass('is-active', active);
			tab.setAttribute('aria-selected', String(active));
			tab.setAttribute('tabindex', active ? '0' : '-1');
		});
		this.renderCurrentPage();
	}

	private renderCurrentPage(): void {
		const graphEl = this.graphEl;
		const panEl = this.panEl;
		if (!graphEl || !panEl) return;

		const page = this.pages[this.currentPage];
		if (!page) return;

		// Create renderer once (into panEl); reuse for page switches.
		if (!this.renderer) {
			this.renderer = new GraphRenderer(panEl);
			this.renderer.onViewChange(() => this.updateStatus());
			this.setupInteraction(graphEl);
		}

		// Reset the visual CSS transform when (re)loading a page.
		this.vScale = 1; this.vTx = 0; this.vTy = 0;
		this.clearVisualTransform();

		const bbox = this.renderer.loadXml(page.xml);
		this.currentBbox = bbox;

		if (this.options.zoom > 0 && this.options.offsetSpecified) {
			// Zoom AND explicit pan offset both given — use as-is.
			this.defaultZoom = this.options.zoom;
			this.defaultDisplayX = this.options.offsetX;
			this.defaultDisplayY = this.options.offsetY;
			this.renderer.setViewFromDisplay(this.options.zoom, this.options.offsetX, this.options.offsetY);
			this.updateStatus();
		} else {
			// Either auto-fit (zoom=0) or zoom-only (centre at given zoom).
			// Defer until the container has real pixel dimensions.
			window.requestAnimationFrame(() => {
				if (!this.renderer || !this.graphEl) return;
				const rect = this.graphEl.getBoundingClientRect();
				const cw = rect.width || this.graphEl.offsetWidth || 600;
				const ch = rect.height || this.graphEl.offsetHeight || 380;
				if (this.options.zoom > 0) {
					// Zoom specified, no offset — centre diagram at that zoom.
					this.renderer.centerAtZoom(this.options.zoom, cw, ch, bbox);
				} else {
					// No zoom — auto-fit to fill the viewport.
					this.renderer.autoFit(cw, ch, bbox);
				}
				// Save as reset target.
				this.defaultZoom = this.renderer.getScale() * 100;
				const off = this.renderer.getDisplayOffset();
				this.defaultDisplayX = off.x;
				this.defaultDisplayY = off.y;
				this.updateStatus();
			});
		}
	}

	/** Build the param string representing the current viewer state. */
	private buildParamString(): string {
		const parts: string[] = [this.options.filename];
		if (this.options.height > 0) parts.push(`${this.options.height}px`);

		// Page — use name if available, otherwise page-N (1-based)
		if (this.pages.length > 1) {
			const name = this.pages[this.currentPage]?.name;
			parts.push(name ? name : `page-${this.currentPage + 1}`);
		}

		// Zoom (rounded to nearest integer %) — includes uncommitted visual zoom.
		const zoomPct = Math.round(this.currentScale() * 100);
		parts.push(`${zoomPct}%`);

		// Pan offset (rounded to integers) — includes the live CSS offset.
		const off = this.currentDisplayOffset();
		parts.push(`(${Math.round(off.x)}, ${Math.round(off.y)})`);

		return parts.join('|');
	}

	/**
	 * Build a param string from the ORIGINAL options (page/zoom/offset as the
	 * user wrote them) plus the current height.  Used by the resize handle so
	 * that resizing only changes height and never freezes an auto-fit zoom.
	 */
	private buildParamFromOptions(): string {
		const o = this.options;
		const parts: string[] = [o.filename];
		if (o.pageName) parts.push(o.pageName);
		else if (o.pageIndex > 0) parts.push(`page-${o.pageIndex + 1}`);
		if (o.height > 0) parts.push(`${o.height}px`);
		if (o.zoom > 0) parts.push(`${o.zoom}%`);
		if (o.offsetSpecified) parts.push(`(${Math.round(o.offsetX)}, ${Math.round(o.offsetY)})`);
		return parts.join('|');
	}

	/** Write the current page/zoom/offset back into the source code block. */
	private async applyCurrentView(): Promise<void> {
		if (!this.onUpdate) return;
		// buildParamString already accounts for the uncommitted visual transform,
		// so no flush is needed — avoids an extra redraw on click.
		await this.onUpdate(this.buildParamString());
	}

	private setupInteraction(graphEl: HTMLElement): void {
		// Stop click propagation (prevents Obsidian embed from opening file).
		this.registerDomEvent(graphEl, 'click', (e: MouseEvent) => {
			e.stopPropagation();
		}, true);

		// Double-click → reset view.
		this.registerDomEvent(graphEl, 'dblclick', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			this.resetView();
		}, true);

		const panEl = this.panEl!;
		let applyRaf = 0;

		/** Schedule one CSS transform write + status update per frame. */
		const scheduleApply = () => {
			if (applyRaf) return;
			applyRaf = window.requestAnimationFrame(() => {
				applyRaf = 0;
				this.applyVisualTransform();
				this.updateStatus();
			});
		};

		// ── flushView: fold the visual CSS transform into @maxgraph ───────────
		// screenFinal(X) = (vTx,vTy) + vScale·[X·S0 + D0]
		//                = X·(vScale·S0) + (vTx + vScale·D0)
		// So committed scale Sf = vScale·S0, display offset Df = vT + vScale·D0.
		this.flushView = () => {
			if (!this.renderer) return;
			if (this.vScale === 1 && this.vTx === 0 && this.vTy === 0) return;
			const s0 = this.renderer.getScale();
			const d0 = this.renderer.getDisplayOffset();
			const sf = this.vScale * s0;
			const dfx = this.vTx + this.vScale * d0.x;
			const dfy = this.vTy + this.vScale * d0.y;
			this.vScale = 1; this.vTx = 0; this.vTy = 0;
			this.clearVisualTransform();
			this.renderer.setViewFromDisplay(sf * 100, dfx, dfy);
		};

		// ── Unified commit scheduling (idle-driven) ───────────────────────────
		// The @maxgraph commit (flushView) is expensive and, once started, runs
		// synchronously to completion — it cannot be interrupted mid-render.  So
		// the goal is to never START it while the user might still be acting.
		//
		// We use requestIdleCallback: the browser invokes it ONLY during genuine
		// idle time, when there is no pending user input.  As long as you keep
		// panning/zooming, every new gesture cancels the pending callback, so the
		// render is repeatedly postponed and interaction stays entirely on the
		// CSS/GPU layer.  The real render fires exactly once — during the first
		// idle gap after you truly stop — so it can never land inside a gesture.
		//
		// Pure panning (vScale === 1) needs no commit at all (a CSS translate is
		// already crisp); only an uncommitted zoom schedules one.
		const w = activeWindow as unknown as {
			requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
			cancelIdleCallback?: (id: number) => void;
		};
		const useRic = typeof w.requestIdleCallback === 'function';

		const cancelCommit = () => {
			if (!this.commitTimer) return;
			if (useRic) w.cancelIdleCallback!(this.commitTimer);
			else window.clearTimeout(this.commitTimer);
			this.commitTimer = 0;
		};
		const scheduleCommit = () => {
			cancelCommit();
			if (this.vScale === 1) {            // pure pan → no redraw ever
				panEl.removeClass('is-panning');
				return;
			}
			const run = () => {
				this.commitTimer = 0;
				panEl.removeClass('is-panning');
				this.flushView();
			};
			// Idle-driven: fires only during a genuine idle gap (no pending input),
			// so the synchronous render never collides with an active gesture.
			// The timeout caps how long crispness can be delayed on a busy tab.
			this.commitTimer = useRic
				? w.requestIdleCallback!(run, { timeout: 600 })
				: window.setTimeout(run, 250);
		};

		// ── Wheel zoom — CSS scale during gesture ─────────────────────────────
		this.registerDomEvent(graphEl, 'wheel', (e: WheelEvent) => {
			// When the "Ctrl + scroll" setting is active, let plain wheel events
			// fall through so the note scrolls normally; only zoom with Ctrl/Cmd.
			if (this.settings.zoomModifier === 'ctrl' && !e.ctrlKey && !e.metaKey) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			cancelCommit();                     // interrupt any pending render
			const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
			const rect = graphEl.getBoundingClientRect();
			const cx = e.clientX - rect.left;
			const cy = e.clientY - rect.top;
			// Scale about the cursor (transform-origin 0 0):
			//   vT' = f·vT + c·(1−f),  vScale' = f·vScale
			this.vTx = f * this.vTx + cx * (1 - f);
			this.vTy = f * this.vTy + cy * (1 - f);
			this.vScale *= f;
			panEl.addClass('is-panning');
			scheduleApply();
			scheduleCommit();                   // (re)arm; fires only once idle
		}, { passive: false, capture: true });

		// ── Pan — CSS translate ───────────────────────────────────────────────
		let dragging = false;
		let dragStartX = 0, dragStartY = 0;
		let dragBaseTx = 0, dragBaseTy = 0;

		this.registerDomEvent(graphEl, 'mousedown', (e: MouseEvent) => {
			if (e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();
			cancelCommit();                     // interrupt any pending render
			dragging = true;
			dragStartX = e.clientX;
			dragStartY = e.clientY;
			dragBaseTx = this.vTx;
			dragBaseTy = this.vTy;
			graphEl.addClass('is-grabbing');
			panEl.addClass('is-panning');
		}, true);

		this.registerDomEvent(activeDocument, 'mousemove', (e: MouseEvent) => {
			if (!dragging) return;
			this.vTx = dragBaseTx + (e.clientX - dragStartX);
			this.vTy = dragBaseTy + (e.clientY - dragStartY);
			scheduleApply();
		});

		this.registerDomEvent(activeDocument, 'mouseup', () => {
			if (!dragging) return;
			dragging = false;
			graphEl.removeClass('is-grabbing');
			// Re-arm the commit: commits the uncommitted zoom (if any) once idle,
			// or just drops the is-panning layer for a pure pan.
			scheduleCommit();
			this.updateStatus();
		});
	}

	private resetView(): void {
		if (!this.renderer || !this.graphEl) return;
		// Clear the visual CSS transform — the view is set directly in @maxgraph.
		this.vScale = 1; this.vTx = 0; this.vTy = 0;
		this.clearVisualTransform();
		if (this.options.zoom > 0) {
			this.renderer.setViewFromDisplay(this.defaultZoom, this.defaultDisplayX, this.defaultDisplayY);
		} else {
			const rect = this.graphEl.getBoundingClientRect();
			this.renderer.autoFit(rect.width || 600, rect.height || 380, this.currentBbox);
		}
		this.updateStatus();
	}

	private updateStatus(): void {
		if (!this.statusEl || !this.renderer) return;
		const pct = Math.round(this.currentScale() * 100);
		const off = this.currentDisplayOffset();
		this.statusEl.setText(`${pct}% (${Math.round(off.x)}, ${Math.round(off.y)})`);
	}

	/** Effective scale including the uncommitted visual zoom. */
	private currentScale(): number {
		return (this.renderer?.getScale() ?? 1) * this.vScale;
	}

	/** Effective visible offset = vT + vScale · @maxgraph display offset. */
	private currentDisplayOffset(): { x: number; y: number } {
		const base = this.renderer?.getDisplayOffset() ?? { x: 0, y: 0 };
		return { x: this.vTx + this.vScale * base.x, y: this.vTy + this.vScale * base.y };
	}

	/**
	 * Write the visual pan/zoom as CSS custom properties on the pan element.
	 * The `transform` itself lives in styles.css (`.drawio-view-pan`), reading
	 * these vars — so we never assign element.style directly.
	 */
	private applyVisualTransform(): void {
		this.panEl?.setCssProps({
			'--dv-tx': `${this.vTx}px`,
			'--dv-ty': `${this.vTy}px`,
			'--dv-scale': `${this.vScale}`,
		});
	}

	/** Reset the visual transform vars to identity. */
	private clearVisualTransform(): void {
		this.panEl?.setCssProps({ '--dv-tx': '0px', '--dv-ty': '0px', '--dv-scale': '1' });
	}
}
