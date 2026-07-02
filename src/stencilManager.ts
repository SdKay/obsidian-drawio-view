import { requestUrl, normalizePath } from 'obsidian';
import type { DataAdapter, Vault } from 'obsidian';
import { StencilShape, StencilShapeRegistry } from '@maxgraph/core';

// ---------------------------------------------------------------------------
// Official library catalog
// ---------------------------------------------------------------------------

export interface LibEntry {
	name: string;
	file: string;
	category: string;
}

export const OFFICIAL_LIBS: LibEntry[] = [
	// Cloud
	{ name: 'Amazon Web Services (AWS4)', file: 'aws4',        category: 'Cloud' },
	{ name: 'Microsoft Azure',            file: 'azure',       category: 'Cloud' },
	{ name: 'Google Cloud Platform',      file: 'gcp2',        category: 'Cloud' },
	{ name: 'IBM',                        file: 'ibm',         category: 'Cloud' },
	// Network
	{ name: 'Cisco',                      file: 'cisco',       category: 'Network' },
	{ name: 'Network',                    file: 'network',     category: 'Network' },
	{ name: 'Rack',                       file: 'rack',        category: 'Network' },
	// Software / Dev
	{ name: 'UML',                        file: 'uml',         category: 'Software' },
	{ name: 'Flowchart',                  file: 'flowchart',   category: 'Software' },
	{ name: 'BPMN',                       file: 'bpmn',        category: 'Software' },
	{ name: 'EIP',                        file: 'eip',         category: 'Software' },
	{ name: 'Archimate 3',                file: 'archimate3',  category: 'Software' },
	{ name: 'C4',                         file: 'c4',          category: 'Software' },
	// General
	{ name: 'Mockup',                     file: 'mockup',      category: 'General' },
	{ name: 'Floorplan',                  file: 'floorplan',   category: 'General' },
	{ name: 'Infographics',               file: 'infographic', category: 'General' },
	{ name: 'Signs / Wayfinding',         file: 'signs',       category: 'General' },
	{ name: 'Lean Mapping',               file: 'lean_mapping',category: 'General' },
	{ name: 'Electrical',                 file: 'electrical',  category: 'General' },
	{ name: 'P&ID',                       file: 'pid',         category: 'General' },
];

const RAW_BASE = 'https://raw.githubusercontent.com/jgraph/drawio/dev/src/main/webapp/stencils/';

// ---------------------------------------------------------------------------
// StencilManager
// ---------------------------------------------------------------------------

class StencilManager {
	/**
	 * Parse a stencil XML string and register every <shape> element with
	 * StencilShapeRegistry.  Idempotent: skips shapes already registered.
	 */
	registerXml(xmlContent: string): void {
		const doc = new DOMParser().parseFromString(xmlContent, 'application/xml');
		if (doc.querySelector('parsererror')) return;
		doc.querySelectorAll('shapes > shape, shape').forEach(shape => {
			const name = shape.getAttribute('name');
			if (!name) return;
			if (!StencilShapeRegistry.get(name)) {
				StencilShapeRegistry.add(name, new StencilShape(shape));
			}
		});
	}

	/**
	 * Scan page XML for shape=mxgraph.<lib>.<name> patterns.
	 * Returns the set of lib file-name stems referenced (e.g. ['aws4', 'azure']).
	 */
	detectUsedLibs(pageXml: string): string[] {
		const pattern = /shape=mxgraph\.([a-zA-Z0-9_]+)\./g;
		const found = new Set<string>();
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(pageXml)) !== null) {
			found.add(m[1]!);
		}
		return [...found];
	}

	/**
	 * Load declared libs from disk and register them.
	 * Returns which libs were loaded and which are missing locally.
	 */
	async loadForViewer(
		libs: string[],
		adapter: DataAdapter,
		stencilsDir: string,
		userDir: string | null,
	): Promise<{ loaded: string[]; notDownloaded: string[] }> {
		const loaded: string[] = [];
		const notDownloaded: string[] = [];
		for (const lib of libs) {
			const content = await this.readLibFile(lib, adapter, stencilsDir, userDir);
			if (content !== null) {
				this.registerXml(content);
				loaded.push(lib);
			} else {
				notDownloaded.push(lib);
			}
		}
		return { loaded, notDownloaded };
	}

	private async readLibFile(
		lib: string,
		adapter: DataAdapter,
		stencilsDir: string,
		userDir: string | null,
	): Promise<string | null> {
		const officialPath = normalizePath(`${stencilsDir}/${lib}.xml`);
		if (await adapter.exists(officialPath)) return adapter.read(officialPath);
		if (userDir) {
			const userPath = normalizePath(`${userDir}/${lib}.xml`);
			if (await adapter.exists(userPath)) return adapter.read(userPath);
		}
		return null;
	}

	/** Download one official lib from GitHub and write to stencilsDir. */
	async downloadLib(
		file: string,
		adapter: DataAdapter,
		stencilsDir: string,
	): Promise<void> {
		const response = await requestUrl({ url: `${RAW_BASE}${file}.xml`, method: 'GET' });
		if (!(await adapter.exists(stencilsDir))) {
			await adapter.mkdir(stencilsDir);
		}
		await adapter.write(normalizePath(`${stencilsDir}/${file}.xml`), response.text);
	}

	/** List lib file stems already downloaded in stencilsDir. */
	async getLocalLibs(adapter: DataAdapter, stencilsDir: string): Promise<string[]> {
		if (!(await adapter.exists(stencilsDir))) return [];
		const listing = await adapter.list(stencilsDir);
		return listing.files
			.map(p => (p.split('/').pop() ?? ''))
			.filter(n => n.endsWith('.xml'))
			.map(n => n.slice(0, -4));
	}

	/** Scan all .drawio files in the vault and return all referenced lib stems. */
	async detectFromVault(vault: Vault): Promise<string[]> {
		const found = new Set<string>();
		for (const file of vault.getFiles().filter(f => f.extension === 'drawio')) {
			const content = await vault.read(file);
			for (const lib of this.detectUsedLibs(content)) found.add(lib);
		}
		return [...found];
	}
}

export const stencilManager = new StencilManager();
