import { App, Component, TFile } from 'obsidian';
import { parseDrawioCached, type ViewOptions, type DrawioPage } from './parser';
import { GraphRenderer, type BoundingBox } from './graphRenderer';
import type { DrawioViewSettings } from './settings';
import { LinkEditorModal, patchCellLink } from './linkEditor';
import { PanZoomController, type ViewportHost } from './viewportController';

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
	private tooltipEl: HTMLElement | null = null;
	private tooltipTextEl: HTMLElement | null = null;
	private highlightEl: HTMLElement | null = null;
	/** ID of the draw.io cell currently under the cursor (has a link). */
	private hoveredCellId: string | null = null;
	private hoveredLink: string | null = null;
	/** Timer for delaying tooltip hide when mouse moves from graph to tooltip. */
	private hideTooltipTimer = 0;
	/** Inner element that @maxgraph renders into; CSS-transformed for pan/zoom. */
	private panEl: HTMLElement | null = null;
	/** Owns all viewport pan/zoom (mouse, touch, wheel) and the visual transform. */
	private controller: PanZoomController | null = null;

	/** Vault-relative path of the note that contains this code block. */
	private readonly sourcePath: string;

	constructor(
		app: App,
		container: HTMLElement,
		options: ViewOptions,
		settings: DrawioViewSettings,
		sourcePath: string,
		onUpdate?: (newParams: string) => Promise<void>,
	) {
		super();
		this.app = app;
		this.container = container;
		this.options = options;
		this.settings = settings;
		this.sourcePath = sourcePath;
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

		// Watch for external edits to the .drawio file (e.g. saved from draw.io
		// desktop) and re-render automatically.  registerEvent ensures the
		// listener is removed when this viewer unloads.
		// Debounced: draw.io may fire rapid autosave events; wait until writes
		// settle before re-rendering to avoid redundant redraws.
		let reloadTimer = 0;
		this.registerEvent(
			this.app.vault.on('modify', (changedFile) => {
				if (!(changedFile instanceof TFile) || changedFile.path !== file.path) return;
				window.clearTimeout(reloadTimer);
				reloadTimer = window.setTimeout(() => {
					reloadTimer = 0;
					void this.reloadFile(changedFile);
				}, 400);
			}),
		);
	}

	/**
	 * Reload a modified .drawio file.  Uses a soft-reload (only re-parses and
	 * re-loads the XML into the existing renderer) when the page count is
	 * unchanged, which avoids rebuilding the entire DOM and is much faster.
	 * Falls back to a full rebuild only when the structure actually changed.
	 */
	private async reloadFile(file: TFile): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			const prev = contentCache.get(file.path);
			if (content === prev) return;          // no change
			contentCache.set(file.path, content);

			const drawio = parseDrawioCached(content);

			// Soft-reload: same number of pages and renderer already exists.
			if (this.renderer && drawio.pages.length === this.pages.length) {
				this.pages = drawio.pages;
				const page = this.pages[this.currentPage];
				if (page) {
					this.controller?.clearVisual();
					const bbox = this.renderer.loadXml(page.xml);
					this.currentBbox = bbox;
					this.updateStatus();
				}
				return;
			}

			// Full rebuild needed (page count changed or no renderer yet).
			this.renderFromContent(content);
		} catch (err) {
			console.error('DrawioViewer reload:', err);
		}
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
		if (this.hideTooltipTimer) { window.clearTimeout(this.hideTooltipTimer); this.hideTooltipTimer = 0; }
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
		if (this.controller) { this.removeChild(this.controller); this.controller = null; }
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
		this.highlightEl = this.panEl.createDiv('drawio-view-highlight');

		// HUD: apply button (optional) + status text, bottom-right corner.
		// Kept as a sibling of graphEl (not inside it) so @maxgraph's internal
		// HTML-label overlay cannot interfere with its position.
		const hud = this.container.createDiv('drawio-view-hud');

		const openBtn = hud.createEl('span', {
			cls: 'drawio-view-open-btn',
			attr: { 'role': 'button', 'aria-label': 'Open in external editor', 'tabindex': '0' },
		});
		openBtn.setText('↗');
		this.registerDomEvent(openBtn, 'click', () => { this.openExternal(); });
		this.registerDomEvent(openBtn, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openExternal(); }
		});

		if (this.onUpdate) {
			const btn = hud.createEl('span', {
				cls: 'drawio-view-update-btn',
				attr: { 'role': 'button', 'aria-label': 'Apply current view to code block', 'tabindex': '0' },
			});
			btn.setText('⊙');
			this.registerDomEvent(btn, 'click', () => {
				this.applyCurrentView().catch(err => console.error('DrawioViewer update:', err));
			});
			this.registerDomEvent(btn, 'keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					this.applyCurrentView().catch(err => console.error('DrawioViewer update:', err));
				}
			});
		}

		this.statusEl = hud.createDiv('drawio-view-status');
		this.statusEl.setAttribute('aria-live', 'polite');

		if (this.pages.length > 1) {
			// `has-tabs` lifts the HUD above the tab bar (CSS).
			this.container.addClass('has-tabs');
			this.tabsEl = this.container.createDiv('drawio-view-tabs');
			this.tabsEl.setAttribute('role', 'tablist');
			this.buildTabs();
		}

		this.tooltipEl = this.container.createDiv('drawio-view-link-tooltip');
		const tooltipEditBtn = this.tooltipEl.createEl('span', {
			cls: 'drawio-view-tooltip-edit',
			attr: { role: 'button', tabindex: '0', 'aria-label': 'Edit link' },
		});
		this.tooltipTextEl = this.tooltipEl.createEl('span', { cls: 'drawio-view-tooltip-text' });
		tooltipEditBtn.setText('✎');
		this.registerDomEvent(tooltipEditBtn, 'click', (e: MouseEvent) => {
			e.stopPropagation();
			const cellId = this.hoveredCellId;
			if (!cellId) return;
			new LinkEditorModal(this.app, this.hoveredLink ?? '', (newLink) => {
				this.updateCellLink(cellId, newLink).catch(
					(err: unknown) => console.error('DrawioViewer link edit:', err),
				);
			}).open();
		});
		this.registerDomEvent(tooltipEditBtn, 'keydown', (e: KeyboardEvent) => {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			e.preventDefault();
			const cellId = this.hoveredCellId;
			if (!cellId) return;
			new LinkEditorModal(this.app, this.hoveredLink ?? '', (newLink) => {
				this.updateCellLink(cellId, newLink).catch(
					(err: unknown) => console.error('DrawioViewer link edit:', err),
				);
			}).open();
		});

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

		// Create renderer + controller once (into panEl); reuse for page switches.
		if (!this.renderer) {
			this.renderer = new GraphRenderer(panEl);
			this.renderer.onViewChange(() => this.updateStatus());
			const host: ViewportHost = {
				getCommittedScale: () => this.renderer?.getScale() ?? 1,
				getCommittedOffset: () => this.renderer?.getDisplayOffset() ?? { x: 0, y: 0 },
				commitView: (z, dx, dy) => this.renderer?.setViewFromDisplay(z, dx, dy),
				onViewChange: () => this.updateStatus(),
			};
			this.controller = new PanZoomController(graphEl, panEl, host, () => this.settings);
			this.addChild(this.controller);
			this.setupInteraction(graphEl);
		}

		// Reset the visual CSS transform when (re)loading a page.
		this.controller?.clearVisual();

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
		// Double-click → reset view.
		this.registerDomEvent(graphEl, 'dblclick', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			this.resetView();
		}, true);

		// Pan / zoom / pinch are owned by PanZoomController (created alongside the
		// renderer in renderCurrentPage).  What remains here is hover + link follow.

		// ── Hover cursor + link tooltip ───────────────────────────────────────
		let hoverRaf = 0;
		this.registerDomEvent(graphEl, 'mousemove', (e: MouseEvent) => {
			if (hoverRaf || !this.renderer) return;
			const clientX = e.clientX;
			const clientY = e.clientY;
			hoverRaf = window.requestAnimationFrame(() => {
				hoverRaf = 0;
				if (!this.renderer) return;
				const v = this.controller?.getVisual() ?? { scale: 1, tx: 0, ty: 0 };
				const rect = graphEl.getBoundingClientRect();
				const panX = (clientX - rect.left - v.tx) / v.scale;
				const panY = (clientY - rect.top  - v.ty) / v.scale;
				const shape = this.renderer.getShapeAt(panX, panY);
				graphEl.toggleClass('has-link-hover', shape?.link != null);
				// Only reposition the tooltip when entering a new cell — keeps it
				// frozen in place so the user can move the cursor to reach it.
				if (shape?.id !== this.hoveredCellId) {
					this.hoveredCellId = shape?.id ?? null;
					this.hoveredLink   = shape?.link ?? null;
					if (shape && this.highlightEl) {
						this.highlightEl.setCssProps({
							'--dv-hl-x': `${Math.round(shape.bounds.x)}px`,
							'--dv-hl-y': `${Math.round(shape.bounds.y)}px`,
							'--dv-hl-w': `${Math.round(shape.bounds.w)}px`,
							'--dv-hl-h': `${Math.round(shape.bounds.h)}px`,
						});
						this.highlightEl.addClass('is-visible');
					} else {
						this.highlightEl?.removeClass('is-visible');
					}
					if (shape && this.tooltipEl && this.tooltipTextEl) {
						window.clearTimeout(this.hideTooltipTimer);
						if (shape.link) {
							const action = this.settings.panModifier === 'none' ? 'Ctrl+click' : 'Click';
							const label = shape.link.length > 60 ? shape.link.slice(0, 57) + '…' : shape.link;
							this.tooltipTextEl.setText(`${action} to open: ${label}`);
							this.tooltipTextEl.addClass('is-visible');
						} else {
							this.tooltipTextEl.setText('');
							this.tooltipTextEl.removeClass('is-visible');
						}
						const cRect = this.container.getBoundingClientRect();
						this.tooltipEl.setCssProps({
							'--dv-tip-x': `${Math.round(clientX - cRect.left + 12)}px`,
							'--dv-tip-y': `${Math.round(clientY - cRect.top  + 16)}px`,
						});
						this.tooltipEl.addClass('is-visible');
					} else {
						this.tooltipEl?.removeClass('is-visible');
					}
				}
			});
		});
		// Delay hiding the tooltip so the user can move the mouse onto the ✎ button.
		this.registerDomEvent(graphEl, 'mouseleave', () => {
			graphEl.removeClass('has-link-hover');
			this.highlightEl?.removeClass('is-visible');
			this.hideTooltipTimer = window.setTimeout(() => {
				this.tooltipEl?.removeClass('is-visible');
			}, 400);
		});
		if (this.tooltipEl) {
			this.registerDomEvent(this.tooltipEl, 'mouseenter', () => {
				window.clearTimeout(this.hideTooltipTimer);
			});
			this.registerDomEvent(this.tooltipEl, 'mouseleave', () => {
				this.tooltipEl?.removeClass('is-visible');
			});
		}

		// Click: stop embed propagation; follow link when appropriate.
		this.registerDomEvent(graphEl, 'click', (e: MouseEvent) => {
			e.stopPropagation();
			if (this.controller?.didGesture || !this.renderer) return;
			const ctrlHeld = e.ctrlKey || e.metaKey;
			// pan-first: Ctrl+click follows link; link-first: plain click follows link.
			const shouldFollow = this.settings.panModifier === 'none' ? ctrlHeld : !ctrlHeld;
			if (!shouldFollow) return;
			const v = this.controller?.getVisual() ?? { scale: 1, tx: 0, ty: 0 };
			const rect = graphEl.getBoundingClientRect();
			const panX = (e.clientX - rect.left - v.tx) / v.scale;
			const panY = (e.clientY - rect.top  - v.ty) / v.scale;
			const link = this.renderer.getLinkAt(panX, panY);
			if (link) this.navigateLink(link);
		}, true);
	}

	private openExternal(): void {
		// openWithDefaultApp is a runtime-only method not exposed in Obsidian's types.
		(this.app as unknown as { openWithDefaultApp(p: string): Promise<void> })
			.openWithDefaultApp(this.options.filename)
			.catch((err: unknown) => console.error('DrawioViewer open:', err));
	}

	private async updateCellLink(cellId: string, link: string): Promise<void> {
		const file = this.resolveFile(this.options.filename);
		if (!file) return;
		await this.app.vault.process(file, content => patchCellLink(content, cellId, link));
	}

	private navigateLink(href: string): void {
		if (/^https?:\/\//i.test(href)) {
			window.open(href, '_blank');
			return;
		}
		// Strip [[...]] wikilink brackets if present, then let Obsidian resolve.
		const cleaned = href.replace(/^\[\[(.+)\]\]$/, '$1');
		void this.app.workspace.openLinkText(cleaned, this.sourcePath, false);
	}

	private resetView(): void {
		if (!this.renderer || !this.graphEl) return;
		// Clear the visual CSS transform — the view is set directly in @maxgraph.
		this.controller?.clearVisual();
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
		return (this.renderer?.getScale() ?? 1) * (this.controller?.getVisual().scale ?? 1);
	}

	/** Effective visible offset = vT + vScale · @maxgraph display offset. */
	private currentDisplayOffset(): { x: number; y: number } {
		const base = this.renderer?.getDisplayOffset() ?? { x: 0, y: 0 };
		const v = this.controller?.getVisual() ?? { scale: 1, tx: 0, ty: 0 };
		return { x: v.tx + v.scale * base.x, y: v.ty + v.scale * base.y };
	}
}
