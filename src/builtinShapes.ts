import { ActorShape, ShapeRegistry, Point } from '@maxgraph/core';
import type { AbstractCanvas2D } from '@maxgraph/core';

/**
 * draw.io ships a set of shapes implemented in JavaScript (Shapes.js), not as
 * stencil XML — e.g. `shape=curlyBracket`.  @maxgraph (the mxGraph TS port)
 * only bundles core mxGraph shapes, so these render as plain rectangles.
 *
 * These classes port the draw.io `redrawPath` geometry to @maxgraph's
 * ActorShape API and register them with the (non-stencil) ShapeRegistry.
 * Ported from https://github.com/jgraph/drawio Shapes.js.
 */

/** Read a numeric style token (draw.io stores custom keys like `size=0.5`). */
function styleNum(shape: { style: unknown }, key: string, fallback: number): number {
	const v = (shape.style as Record<string, unknown> | null)?.[key];
	const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
	return Number.isFinite(n) ? n : fallback;
}

/** Read a JSON-array-valued style token, e.g. `polyCoords=[[0,0],[1,0]]`. */
function styleArray(shape: { style: unknown }, key: string): unknown[] | null {
	const v = (shape.style as Record<string, unknown> | null)?.[key];
	if (typeof v !== 'string' || !v) return null;
	try {
		const parsed = JSON.parse(v) as unknown;
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** Read a boolean-ish style token (`1`/`0`, true/false). */
function styleBool(shape: { style: unknown }, key: string, fallback: boolean): boolean {
	const v = (shape.style as Record<string, unknown> | null)?.[key];
	if (v === undefined || v === null || v === '') return fallback;
	return v === true || v === '1' || v === 1;
}

/** `shape=curlyBracket` — a curly brace `{` (rounded, matching draw.io). */
class CurlyBracketShape extends ActorShape {
	redrawPath(c: AbstractCanvas2D, _x: number, _y: number, w: number, h: number): void {
		c.setFillColor(null);
		const s = w * Math.max(0, Math.min(1, styleNum(this, 'size', 0.5)));
		// draw.io: arcSize = STYLE_ARCSIZE (default LINE_ARCSIZE = 20) / 2.
		const arcSize = styleNum(this, 'arcSize', 20) / 2;
		this.addPoints(
			c,
			[
				new Point(w, 0), new Point(s, 0), new Point(s, h / 2),
				new Point(0, h / 2), new Point(s, h / 2), new Point(s, h),
				new Point(w, h),
			],
			this.isRounded,
			arcSize,
			false,
		);
		c.end();
	}
}

/**
 * `shape=mxgraph.basic.polygon` — a fully parametric outline shape.  Unlike
 * every other shape in draw.io's "basic" library, this one has no fixed
 * stencil XML entry (verified: not present in stencils/basic.xml) — its
 * geometry is entirely self-described by the style itself:
 *   - polyCoords: fractional [x,y] vertices, scaled against (w,h)
 *   - polyCurves: optional per-segment bezier control points (fractional
 *     [x1,y1,x2,y2]); an empty array for a segment means a straight line
 *   - polyline: '1' draws an open path (no closing segment back to the
 *     first point); otherwise the path is closed
 * Because @maxgraph has no generic handler for these style keys, unresolved
 * `mxgraph.basic.polygon` cells previously fell back to a plain rectangle.
 */
class BasicPolygonShape extends ActorShape {
	redrawPath(c: AbstractCanvas2D, _x: number, _y: number, w: number, h: number): void {
		const coords = styleArray(this, 'polyCoords') as [number, number][] | null;
		if (!coords || coords.length < 2) return;
		const curves = (styleArray(this, 'polyCurves') as unknown[][] | null) ?? [];
		const isOpen = styleBool(this, 'polyline', false);

		const point = (i: number): [number, number] => {
			const p = coords[i % coords.length]!;
			return [p[0] * w, p[1] * h];
		};

		const [startX, startY] = point(0);
		c.moveTo(startX, startY);
		const segmentCount = isOpen ? coords.length - 1 : coords.length;
		for (let i = 1; i <= segmentCount; i++) {
			const [px, py] = point(i);
			const ctrl = curves[i - 1];
			if (Array.isArray(ctrl) && ctrl.length >= 4) {
				const [cx1, cy1, cx2, cy2] = ctrl as number[];
				c.curveTo(cx1! * w, cy1! * h, cx2! * w, cy2! * h, px, py);
			} else {
				c.lineTo(px, py);
			}
		}
		if (!isOpen) c.close();
	}
}

/** Register all ported draw.io built-in shapes. Idempotent. */
export function registerBuiltinShapes(): void {
	if (!ShapeRegistry.get('curlyBracket')) {
		ShapeRegistry.add('curlyBracket', CurlyBracketShape);
	}
	if (!ShapeRegistry.get('mxgraph.basic.polygon')) {
		ShapeRegistry.add('mxgraph.basic.polygon', BasicPolygonShape);
	}
}
