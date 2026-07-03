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

/** Register all ported draw.io built-in shapes. Idempotent. */
export function registerBuiltinShapes(): void {
	if (!ShapeRegistry.get('curlyBracket')) {
		ShapeRegistry.add('curlyBracket', CurlyBracketShape);
	}
}
