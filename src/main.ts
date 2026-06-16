import { MarkdownRenderChild, MarkdownSectionInformation, Plugin, TFile, normalizePath } from 'obsidian';
import { parseViewParams, type ViewOptions } from './parser';
import { DrawioViewer } from './viewer';

class DrawioCodeBlock extends MarkdownRenderChild {
	constructor(
		el: HTMLElement,
		private app_: typeof Plugin.prototype.app,
		private options: ViewOptions,
		private sourcePath: string,
		private originalSource: string,
		private sectionInfo: MarkdownSectionInformation | null,
	) {
		super(el);
	}

	onload(): void {
		const onUpdate = async (newParams: string) => {
			const file = this.app_.vault.getAbstractFileByPath(this.sourcePath);
			if (!(file instanceof TFile)) return;
			// Vault.process edits the file atomically (no races with other plugins);
			// it's the recommended API for content transforms not tied to the cursor.
			await this.app_.vault.process(file, content => this.rewrite(content, newParams));
		};

		const viewer = new DrawioViewer(this.app_, this.containerEl, this.options, onUpdate);
		this.addChild(viewer);
		viewer.load();
	}

	/** Replace this block's parameter line with `newParams`, preserving indentation. */
	private rewrite(content: string, newParams: string): string {
		if (this.sectionInfo) {
			// Precise line-based replacement using the section's known position.
			// sectionInfo.lineStart = opening fence line; lineEnd = closing fence.
			const sep = content.includes('\r\n') ? '\r\n' : '\n';
			const lines = content.split(/\r?\n/);
			const indent = lines[this.sectionInfo.lineStart]?.match(/^[ \t]*/)?.[0] ?? '';
			const before = lines.slice(0, this.sectionInfo.lineStart + 1);
			const after  = lines.slice(this.sectionInfo.lineEnd);
			return [...before, indent + newParams, ...after].join(sep);
		}
		// Fallback: replace only the first block matching the original content.
		const escContent = this.originalSource.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (!escContent) return content;
		const pattern = new RegExp(
			'([ \\t]*)(`{3,})drawio-view[^\\n]*[\\r\\n]+' +
			'[ \\t]*' + escContent + '[ \\t]*[\\r\\n]+' +
			'[ \\t]*\\2',
			'g',
		);
		let replaced = false;
		return content.replace(pattern, (whole, indent, fence) => {
			if (replaced) return whole;
			replaced = true;
			return `${indent}${fence}drawio-view\n${indent}${newParams}\n${indent}${fence}`;
		});
	}
}

export default class DrawioViewPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerMarkdownCodeBlockProcessor('drawio-view', (source, el, ctx) => {
			const options = parseViewParams(source.trim());
			if (!options.filename) {
				el.createDiv({ cls: 'drawio-view-error', text: 'No filename specified.' });
				return;
			}
			options.filename = this.resolveRelative(options.filename, ctx.sourcePath);
			const sectionInfo = ctx.getSectionInfo(el);
			ctx.addChild(new DrawioCodeBlock(el, this.app, options, ctx.sourcePath, source, sectionInfo));
		});
	}

	private resolveRelative(filename: string, sourcePath: string): string {
		const norm = normalizePath(filename);
		if (this.app.vault.getAbstractFileByPath(norm)) return norm;
		// Resolve as a vault link relative to the source note (handles bare names).
		const resolved = this.app.metadataCache.getFirstLinkpathDest(norm, sourcePath);
		if (resolved instanceof TFile) return resolved.path;
		return norm;
	}
}
