import { Graph, ModelXmlSerializer, InternalEvent, type ShapeValue, type Cell } from '@maxgraph/core';

export interface BoundingBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Thin wrapper around @maxgraph/core's Graph for read-only diagram rendering.
 *
 * Coordinate conventions used in this class:
 *   - "graph coords": raw mxGraph units as stored in the .drawio file
 *   - "display offset": screen-pixel equivalent = graph-translate * scale
 *
 * The display-offset convention matches the original SVG-transform approach so
 * syntax values like `80%|(190, 34)` remain consistent.
 */
export class GraphRenderer {
	private readonly graph: Graph;

	constructor(container: HTMLElement) {
		// Pass an empty plugin list — we don't need any of the default plugins
		// (CellEditorHandler, SelectionHandler, PanningHandler, etc.) for a
		// read-only viewer.  They would register their own event listeners and
		// interfere with ours.
		this.graph = new Graph(container, undefined, []);

		this.graph.setEnabled(false);
		this.graph.setConnectable(false);
		this.graph.setTooltips(false);
		this.graph.gridEnabled = false;
		this.graph.setHtmlLabels(true);

		// draw.io stores linked shapes as <UserObject label="..." link="...">.
		// @maxgraph sets the XML Element as the cell value; the default
		// convertValueToString calls String(element) which yields "[object Element]".
		// Override to extract the 'label' attribute instead.
		this.graph.convertValueToString = (cell: Cell): string => {
			const val = cell.getValue() as unknown;
			if (val instanceof Element) return val.getAttribute('label') ?? '';
			// draw.io cell labels are plain strings; anything else has no label.
			return typeof val === 'string' ? val : '';
		};

		// We implement our own panning in the viewer, so leave the built-in
		// PanningHandler off to avoid conflicts with setEnabled(false).

		// Register base styles for draw.io's flag-style shape notation.
		// In draw.io, "swimlane;..." means shape=swimlane; @maxgraph only
		// reads state.style.shape from "shape=xxx", not from flag tokens.
		// putCellStyle registers a named base style so that when the flag is
		// parsed as baseStyleNames=['swimlane'], getCellStyle merges in
		// { shape: 'swimlane' } and getShapeConstructor finds SwimlaneShape.
		const stylesheet = this.graph.getStylesheet();

		// Register base styles for draw.io flag-style shape names
		for (const name of [
			'actor', 'arrow', 'arrowConnector', 'cloud', 'cylinder',
			'doubleEllipse', 'ellipse', 'hexagon', 'image', 'label',
			'line', 'rhombus', 'swimlane', 'triangle',
		] as ShapeValue[]) {
			stylesheet.putCellStyle(name, { shape: name });
		}

		// @maxgraph's built-in default vertex style has fillColor:#C3D9FF,
		// strokeColor:#6482B9, fontColor:#774400 — these are NOT draw.io's
		// defaults and cause unwanted blue fills and coloured borders/text on
		// cells that have no explicit colour in the diagram.
		// Reset them to draw.io's standard defaults (white fill, black strokes).
		const dvs = stylesheet.getDefaultVertexStyle();
		dvs.fillColor = '#ffffff';
		dvs.strokeColor = '#000000';
		dvs.fontColor = '#000000';

		const des = stylesheet.getDefaultEdgeStyle();
		des.strokeColor = '#000000';
		des.fontColor = '#000000';
	}

	/** Load (or replace) the diagram content from an mxGraphModel XML string. */
	loadXml(xmlString: string): BoundingBox {
		const serializer = new ModelXmlSerializer(this.graph.getDataModel());
		serializer.import(preprocessXml(xmlString));
		const b = this.graph.getGraphBounds();
		return { x: b.x, y: b.y, width: b.width, height: b.height };
	}

	/**
	 * Centre the diagram in cw×ch at a fixed zoom level (no scaling to fit).
	 * Used when the user specifies a zoom % but no explicit pan offset.
	 */
	centerAtZoom(zoomPct: number, cw: number, ch: number, bbox: BoundingBox): void {
		const scale = zoomPct / 100;
		const tx = cw / (2 * scale) - (bbox.x + bbox.width / 2);
		const ty = ch / (2 * scale) - (bbox.y + bbox.height / 2);
		this.graph.getView().scaleAndTranslate(scale, tx, ty);
	}

	/** Auto-fit the diagram to fill cw×ch pixels, centred with 20 px padding. */
	autoFit(cw: number, ch: number, bbox: BoundingBox): void {
		if (bbox.width <= 0 || bbox.height <= 0) return;
		const pad = 20;
		const scale = Math.min(
			(cw - pad * 2) / bbox.width,
			(ch - pad * 2) / bbox.height,
			2,
		);
		// screen = (graph + tx) * scale  =>  to centre: tx = cw/(2·s) - bbox_cx
		const tx = cw / (2 * scale) - (bbox.x + bbox.width / 2);
		const ty = ch / (2 * scale) - (bbox.y + bbox.height / 2);
		this.graph.getView().scaleAndTranslate(scale, tx, ty);
	}

	/**
	 * Set view from user-visible values (zoom %, screen-pixel offsets).
	 * displayX = translate.x * scale  (same units as old SVG offsetX/offsetY)
	 */
	setViewFromDisplay(zoomPct: number, displayX: number, displayY: number): void {
		const scale = zoomPct / 100;
		// Detach the container from the DOM before the @maxgraph redraw.
		// @maxgraph updates hundreds of SVG element attributes when the view
		// changes; each attribute mutation fires every MutationObserver that
		// watches the document (i.e. every other Obsidian plugin), turning a
		// ~100 ms render into 3-4 s in a loaded vault.  While the container is
		// detached those mutations happen off-tree and are invisible to observers.
		// Re-attaching fires exactly ONE childList mutation — far cheaper.
		const container = this.graph.container;
		const parent = container.parentElement;
		const next = container.nextSibling;
		if (parent) parent.removeChild(container);

		this.graph.getView().scaleAndTranslate(scale, displayX / scale, displayY / scale);

		if (parent) {
			if (next) parent.insertBefore(container, next);
			else parent.appendChild(container);
		}
	}

	/** Current scale (1.0 = 100%). */
	getScale(): number {
		return this.graph.getView().getScale();
	}

	/** Current translate expressed as screen-pixel offset. */
	getDisplayOffset(): { x: number; y: number } {
		const t = this.graph.getView().getTranslate();
		const s = this.graph.getView().getScale();
		return { x: t.x * s, y: t.y * s };
	}

	/** Raw translate in graph-coordinate units. */
	getTranslate(): { x: number; y: number } {
		const t = this.graph.getView().getTranslate();
		return { x: t.x, y: t.y };
	}

	/** Set raw translate in graph-coordinate units (triggers redraw + listeners). */
	setTranslate(tx: number, ty: number): void {
		this.graph.getView().setTranslate(tx, ty);
	}

	/**
	 * Zoom towards cursor at (mx, my) relative to the graph container.
	 * Keeps the diagram point directly under the cursor in place.
	 */
	zoomToPoint(factor: number, mx: number, my: number): void {
		const view = this.graph.getView();
		const s = view.getScale();
		const t = view.getTranslate();
		const ns = Math.max(0.05, Math.min(20, s * factor));
		// mx = (diag_x + t.x) * s  →  diag_x = mx/s - t.x
		// After: mx = (diag_x + ntx) * ns  →  ntx = mx/ns - diag_x = mx(1/ns−1/s) + t.x
		const ntx = mx * (1 / ns - 1 / s) + t.x;
		const nty = my * (1 / ns - 1 / s) + t.y;
		view.scaleAndTranslate(ns, ntx, nty);
	}

	/** Call `callback` whenever the view scale or translate changes. */
	onViewChange(callback: () => void): void {
		const view = this.graph.getView();
		view.addListener(InternalEvent.SCALE, callback);
		view.addListener(InternalEvent.TRANSLATE, callback);
		view.addListener(InternalEvent.SCALE_AND_TRANSLATE, callback);
		this.graph.addListener(InternalEvent.PAN, callback);
	}

	/**
	 * Return the draw.io link href for the shape at panEl-relative pixel
	 * coordinates (px, py), or null if there is no link.
	 * Checks both the direct cell and its immediate parent (covers clicks on
	 * labels or child cells whose link lives on the parent shape).
	 */
	getLinkAt(px: number, py: number): string | null {
		const cell = this.graph.getCellAt(px, py);
		if (!cell) return null;
		return this.extractLink(cell) ?? this.extractLink(cell.getParent());
	}

	/** Return the cell ID and link for the shape at panEl-relative coordinates, or null. */
	getCellInfoAt(px: number, py: number): { id: string; link: string } | null {
		const cell = this.graph.getCellAt(px, py);
		if (!cell) return null;
		let link = this.extractLink(cell);
		let id = link ? cell.id : null;
		if (!link) {
			const parent = cell.getParent();
			link = this.extractLink(parent ?? null);
			if (link && parent) id = parent.id;
		}
		if (!link || !id) return null;
		return { id, link };
	}

	/**
	 * Return the shape cell (id + optional link) at panEl-relative coordinates,
	 * for ANY non-layer vertex/edge — not just linked cells.
	 * Sub-cells (labels etc.) are resolved up to their parent shape cell.
	 */
	getShapeAt(px: number, py: number): { id: string; link: string | null; bounds: { x: number; y: number; w: number; h: number } } | null {
		const cell = this.graph.getCellAt(px, py);
		if (!cell) return null;
		const dm = this.graph.getDataModel();
		if (dm.isLayer(cell)) return null;
		// If the hit cell's parent is a non-layer cell, it's a sub-cell — use the parent.
		const parent = cell.getParent();
		const shapeCell = (parent && !dm.isLayer(parent)) ? parent : cell;
		const id = shapeCell.id;
		if (!id) return null;
		const state = this.graph.getView().getState(shapeCell);
		if (!state) return null;
		return { id, link: this.extractLink(shapeCell), bounds: { x: state.x, y: state.y, w: state.width, h: state.height } };
	}

	private extractLink(cell: Cell | null | undefined): string | null {
		if (!cell || this.graph.getDataModel().isLayer(cell)) return null;
		// UserObject format: cell value is an XML Element with a 'link' attribute.
		const val = cell.getValue() as unknown;
		if (val instanceof Element) {
			const link = val.getAttribute('link') ?? val.getAttribute('href');
			if (link) return link;
		}
		// Parsed style object: 'link' key survives @maxgraph's style parsing.
		const styleLink = (cell.style as Record<string, unknown>)['link'];
		if (typeof styleLink === 'string' && styleLink) return styleLink;
		return null;
	}

	destroy(): void {
		this.graph.destroy();
	}
}

/**
 * Normalise draw.io XML quirks before passing to @maxgraph/core.
 * Uses DOM parsing for structural changes (waypoint shapes) and fast string
 * replacements for style-attribute fixes.
 */
function preprocessXml(xml: string): string {
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	if (doc.querySelector('parsererror')) return applyStyleFixes(xml);

	for (const cell of Array.from(doc.querySelectorAll('mxCell'))) {
		let style = cell.getAttribute('style') ?? '';
		if (!style) continue;

		// --- style-string fixes ---
		style = applyStyleFixes(style);

		// --- shape=waypoint → small filled dot ---
		// draw.io renders waypoints as tiny dots (size=N px); @maxgraph has no
		// built-in waypoint shape and falls back to a 20×20 rectangle.
		if (style.includes('shape=waypoint')) {
			const sizeMatch = style.match(/\bsize=(\d+(?:\.\d+)?)/);
			const dotSize = sizeMatch ? parseFloat(sizeMatch[1]!) : 6;
			cell.setAttribute('style', `ellipse;fillColor=#000000;strokeColor=none;`);

			// Shrink geometry to the dot size, keeping the same centre point
			// so edge routing is unaffected.
			const geo = cell.querySelector('mxGeometry');
			if (geo) {
				const w = parseFloat(geo.getAttribute('width') ?? '20');
				const h = parseFloat(geo.getAttribute('height') ?? '20');
				const x = parseFloat(geo.getAttribute('x') ?? '0');
				const y = parseFloat(geo.getAttribute('y') ?? '0');
				geo.setAttribute('width', String(dotSize));
				geo.setAttribute('height', String(dotSize));
				geo.setAttribute('x', String(x + (w - dotSize) / 2));
				geo.setAttribute('y', String(y + (h - dotSize) / 2));
			}
			continue; // style already replaced, skip setAttribute below
		}

		cell.setAttribute('style', style);
	}

	return new XMLSerializer().serializeToString(doc);
}

/**
 * Fast string-level style fixes applied both to full XML and to individual
 * style-attribute strings.
 */
function applyStyleFixes(s: string): string {
	return s
		// draw.io "default" colour tokens → resolve to black
		.replace(/strokeColor=default/g, 'strokeColor=#000000')
		.replace(/fontColor=default/g, 'fontColor=#000000')
		// fillColor=none / strokeColor=none: draw.io treats the literal string
		// "none" as the NONE sentinel and deletes the property during style
		// merging, causing @maxgraph's default fill (#C3D9FF blue) to bleed
		// through.  Replace with an explicit transparent CSS colour so the
		// property survives the merge and renders correctly.
		.replace(/\bfillColor=none\b/g, 'fillColor=transparent')
		.replace(/\bstrokeColor=none\b/g, 'strokeColor=transparent');
}
