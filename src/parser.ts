import { inflateRaw } from 'pako';

// ---------------------------------------------------------------------------
// .drawio page model
// ---------------------------------------------------------------------------

export interface DrawioPage {
	name: string;
	id: string;
	xml: string; // mxGraphModel XML string, ready for @maxgraph/core
}

export interface DrawioFile {
	pages: DrawioPage[];
}

// ---------------------------------------------------------------------------
// .drawio file parsing
// ---------------------------------------------------------------------------

// Small cache so re-rendering the same file (e.g. after writing view params
// back into the code block) doesn't re-parse the XML.  Keyed by raw content;
// holds only the most recent file to keep memory flat.
let parseCacheKey = '';
let parseCacheValue: DrawioFile | null = null;

export function parseDrawioCached(content: string): DrawioFile {
	if (parseCacheValue && parseCacheKey === content) return parseCacheValue;
	parseCacheValue = parseDrawioFile(content);
	parseCacheKey = content;
	return parseCacheValue;
}

export function parseDrawioFile(content: string): DrawioFile {
	const doc = new DOMParser().parseFromString(content, 'application/xml');
	if (doc.querySelector('parsererror')) return { pages: [] };

	const diagrams = Array.from(doc.querySelectorAll('mxfile > diagram'));
	if (diagrams.length === 0) {
		// Bare mxGraphModel (no mxfile wrapper)
		if (content.includes('<mxGraphModel')) return { pages: [{ name: 'Page', id: '', xml: content }] };
		return { pages: [] };
	}

	return {
		pages: diagrams.map(diagram => {
			const name = diagram.getAttribute('name') ?? 'Page';
			const id = diagram.getAttribute('id') ?? '';

			// Uncompressed: the <diagram> element contains a child <mxGraphModel>.
			// diagram.textContent only returns text nodes (whitespace), not child elements,
			// so we must detect and handle the two cases separately.
			const inlineModel = diagram.querySelector('mxGraphModel');
			if (inlineModel) {
				return { name, id, xml: serializeXml(inlineModel) };
			}

			// Compressed: content is a base64+deflate-encoded string.
			const inner = diagram.textContent?.trim() ?? '';
			const xml = decodeCompressed(inner);
			return { name, id, xml };
		}),
	};
}

function serializeXml(el: Element): string {
	return new XMLSerializer().serializeToString(el);
}

/** Decode base64+deflateRaw encoded diagram content into an XML string. */
function decodeCompressed(content: string): string {
	if (!content) return '<mxGraphModel/>';
	try {
		const binary = atob(content);
		const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
		return decodeURIComponent(inflateRaw(bytes, { to: 'string' }));
	} catch {
		return content; // fallback: might already be plain XML
	}
}

// ---------------------------------------------------------------------------
// View-options parsing  e.g. "file.drawio|page-2|80%|(190,34)"
// ---------------------------------------------------------------------------

export interface ViewOptions {
	filename: string;
	pageIndex: number;    // 0-based, used when pageName is ''
	pageName: string;     // if non-empty, look up page by name (overrides pageIndex)
	zoom: number;         // percentage; 0 = auto-fit
	offsetX: number;
	offsetY: number;
	offsetSpecified: boolean; // true only when (x,y) was explicitly written in syntax
	height: number;       // container height in px; 0 = use CSS default (400px)
}

const DEFAULTS: Omit<ViewOptions, 'filename'> = {
	pageIndex: 0, pageName: '', zoom: 0, offsetX: 0, offsetY: 0, offsetSpecified: false,
	height: 0,
};

export function parseViewParams(paramStr: string, filenameDefault = ''): ViewOptions {
	const opts: ViewOptions = { filename: filenameDefault, ...DEFAULTS };
	if (!paramStr.trim()) return opts;

	for (const raw of paramStr.split('|').map(s => s.trim()).filter(Boolean)) {
		if (/\.(drawio|xml)$/i.test(raw)) {
			opts.filename = raw;
		} else if (/^page[-\s]?(\d+)$/i.test(raw)) {
			// page-N / page N → 0-based index
			const m = raw.match(/(\d+)/);
			if (m) opts.pageIndex = parseInt(m[1]!) - 1;
		} else if (/^(\d+(?:\.\d+)?)%$/.test(raw)) {
			opts.zoom = parseFloat(raw);
		} else {
			const offsetM = raw.match(/^\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/);
			if (offsetM) {
				opts.offsetX = parseFloat(offsetM[1]!);
				opts.offsetY = parseFloat(offsetM[2]!);
				opts.offsetSpecified = true;
			} else if (/^\d+px$/i.test(raw)) {
				// Height: "600px"
				opts.height = parseInt(raw);
			} else {
				// Treat as page name (e.g. "my_page", "第 1 页")
				opts.pageName = raw;
			}
		}
	}
	return opts;
}
