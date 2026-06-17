import { App, SuggestModal, TFile } from 'obsidian';

type LinkItem = TFile | string;

/** Fuzzy vault-file picker that also accepts raw URLs. */
export class LinkEditorModal extends SuggestModal<LinkItem> {
	constructor(
		app: App,
		private readonly currentLink: string,
		private readonly onChoose: (link: string) => void,
	) {
		super(app);
		this.setPlaceholder('Search notes or enter a URL…');
	}

	onOpen(): void {
		super.onOpen();
		if (this.currentLink) {
			// Strip [[...]] so the bare path is shown and matched correctly.
			this.inputEl.value = this.currentLink.replace(/^\[\[(.+)\]\]$/, '$1');
			this.inputEl.dispatchEvent(new Event('input'));
		}
	}

	getSuggestions(query: string): LinkItem[] {
		// Strip [[...]] in case the stored link uses wikilink format.
		const q = query.replace(/^\[\[(.+)\]\]$/, '$1').toLowerCase().trim();
		const files = this.app.vault.getMarkdownFiles()
			.filter(f => !q || f.path.toLowerCase().includes(q) || f.basename.toLowerCase().includes(q))
			.slice(0, 20);
		// If the input looks like a URL, offer it as a raw-string option at the top.
		if (/^https?:\/\//i.test(query)) return [query, ...files];
		return files;
	}

	renderSuggestion(item: LinkItem, el: HTMLElement): void {
		if (typeof item === 'string') {
			el.createEl('div', { text: `URL: ${item}` });
		} else {
			el.createEl('div', { text: item.basename });
			el.createEl('small', { cls: 'drawio-link-editor-path', text: item.path });
		}
	}

	onChooseSuggestion(item: LinkItem): void {
		this.onChoose(typeof item === 'string' ? item : item.path);
	}
}

/**
 * Add or update the link on a draw.io cell identified by `cellId`.
 * Handles both UserObject-wrapped cells and plain mxCell elements.
 * Passing an empty `link` removes the link attribute from a UserObject.
 */
export function patchCellLink(xmlContent: string, cellId: string, link: string): string {
	const doc = new DOMParser().parseFromString(xmlContent, 'application/xml');
	if (doc.querySelector('parsererror')) return xmlContent;

	// Escape double quotes so they survive inside an attribute selector string.
	const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

	// Case 1: cell is already wrapped in a UserObject.
	const userObj = doc.querySelector(`UserObject[id="${esc(cellId)}"]`);
	if (userObj) {
		if (link) userObj.setAttribute('link', link);
		else userObj.removeAttribute('link');
		return new XMLSerializer().serializeToString(doc);
	}

	// Case 2: plain mxCell — wrap it in a UserObject and set the link.
	if (!link) return xmlContent;
	const mxCell = doc.querySelector(`mxCell[id="${esc(cellId)}"]`);
	if (mxCell) {
		const label = mxCell.getAttribute('value') ?? '';
		const parent = mxCell.parentNode;
		const userObject = doc.createElement('UserObject');
		userObject.setAttribute('label', label);
		userObject.setAttribute('link', link);
		userObject.setAttribute('id', cellId);
		mxCell.removeAttribute('id');
		mxCell.removeAttribute('value');
		parent?.replaceChild(userObject, mxCell);
		userObject.appendChild(mxCell);
		return new XMLSerializer().serializeToString(doc);
	}

	return xmlContent;
}
