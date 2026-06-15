import { MarkdownRenderChild, MarkdownSectionInformation, Plugin, TFile } from 'obsidian';
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
			const content = await this.app_.vault.read(file);

			let updated: string;

			if (this.sectionInfo) {
				// Precise line-based replacement using the section's known position.
				// sectionInfo.lineStart = opening fence line
				// sectionInfo.lineEnd   = closing fence line
				const sep = content.includes('\r\n') ? '\r\n' : '\n';
				const lines = content.split(/\r?\n/);
				const indent = lines[this.sectionInfo.lineStart]?.match(/^[ \t]*/)?.[0] ?? '';
				const before = lines.slice(0, this.sectionInfo.lineStart + 1);
				const after  = lines.slice(this.sectionInfo.lineEnd);
				updated = [...before, indent + newParams, ...after].join(sep);
			} else {
				// Fallback: find the first matching block by content.
				const escContent = this.originalSource.trim()
					.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				if (!escContent) return;
				const pattern = new RegExp(
					'([ \\t]*)(`{3,})drawio-view[^\\n]*[\\r\\n]+' +
					'[ \\t]*' + escContent + '[ \\t]*[\\r\\n]+' +
					'[ \\t]*\\2',
					'g',
				);
				let replaced = false;
				updated = content.replace(pattern, (_, indent, fence) => {
					if (replaced) return _;
					replaced = true;
					return `${indent}${fence}drawio-view\n${indent}${newParams}\n${indent}${fence}`;
				});
			}

			if (updated !== content) await this.app_.vault.modify(file, updated);
		};

		const viewer = new DrawioViewer(this.app_, this.containerEl, this.options, onUpdate);
		this.addChild(viewer);
		viewer.load();
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
		if (this.app.vault.getAbstractFileByPath(filename)) return filename;
		const resolved = this.app.metadataCache.getFirstLinkpathDest(filename, sourcePath);
		if (resolved instanceof TFile) return resolved.path;
		return filename;
	}
}
