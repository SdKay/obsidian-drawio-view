import { requestUrl, normalizePath } from 'obsidian';
import type { DataAdapter, Vault } from 'obsidian';
import { StencilShape, StencilShapeRegistry } from '@maxgraph/core';
import { parseDrawioFile } from './parser';

// Module-level cache: svg vault-relative path → base64 data URI.
// Populated on first use; lives for the whole Obsidian session.
const imageDataUriCache = new Map<string, string>();

const IMG_RAW_BASE = 'https://raw.githubusercontent.com/jgraph/drawio/dev/src/main/webapp/img/lib/';

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
	// Note: electrical and P&ID use subdirectory structures in draw.io, not single files.
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
	 * Scan page XML for shape=mxgraph.<lib>.<name> patterns (stencil-based libs).
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
	 * Scan page XML for image=img/lib/<path>.svg references (image-based libs).
	 * Returns the relative paths, e.g. ['ibm/social/communities.svg'].
	 */
	detectImageRefs(pageXml: string): string[] {
		const pattern = /image=img\/lib\/([^;'">\s]+\.svg)/g;
		const found = new Set<string>();
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(pageXml)) !== null) {
			found.add(m[1]!);
		}
		return [...found];
	}

	/**
	 * Replace every image=img/lib/... reference in pageXml with a base64 data
	 * URI, downloading the SVG from GitHub if not already cached on disk.
	 * Uses a module-level cache so each unique SVG is fetched/encoded once per
	 * Obsidian session — page switches and reloads are instant (no I/O).
	 */
	async preloadImages(
		pageXml: string,
		adapter: DataAdapter,
		stencilsDir: string,
	): Promise<string> {
		const refs = this.detectImageRefs(pageXml);
		if (refs.length === 0) return pageXml;

		let result = pageXml;
		for (const ref of refs) {
			const dataUri = await this.resolveImageDataUri(ref, adapter, stencilsDir);
			if (dataUri) {
				result = result.split(`image=img/lib/${ref}`).join(`image=${dataUri}`);
			}
		}
		return result;
	}

	private async resolveImageDataUri(
		relPath: string,
		adapter: DataAdapter,
		stencilsDir: string,
	): Promise<string> {
		const cached = imageDataUriCache.get(relPath);
		if (cached !== undefined) return cached;

		// Try local cache first, then download from GitHub.
		const localPath = normalizePath(`${stencilsDir}/img/${relPath}`);
		let svgContent: string | null = null;

		if (await adapter.exists(localPath)) {
			svgContent = await adapter.read(localPath);
		} else {
			try {
				const response = await requestUrl({ url: `${IMG_RAW_BASE}${relPath}`, method: 'GET' });
				svgContent = response.text;
				// Persist so future sessions skip the network.
				const dir = localPath.substring(0, localPath.lastIndexOf('/'));
				if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
				await adapter.write(localPath, svgContent);
			} catch {
				// Network failure — don't cache, will retry on next open.
				return '';
			}
		}

		if (!svgContent) return '';
		// Use URL-encoded SVG (not base64) so the data URI contains no literal ';'.
		// @maxgraph parses style strings by splitting on ';', so a base64 data URI
		// like "data:image/svg+xml;base64,..." would be truncated at the first ';'.
		const dataUri = `data:image/svg+xml,${encodeURIComponent(svgContent)}`;
		imageDataUriCache.set(relPath, dataUri);
		return dataUri;
	}

	/**
	 * Detect, load and register all stencil libs needed by a page.
	 * Automatically downloads any lib not found locally.
	 * Returns the final set of loaded lib stems and any that failed.
	 * Used by the viewer for fully automatic lib management.
	 */
	async loadAndRegisterLibs(
		libs: string[],
		adapter: DataAdapter,
		stencilsDir: string,
		userDir: string | null,
	): Promise<{ loaded: string[]; failed: string[] }> {
		const loaded: string[] = [];
		const failed: string[] = [];
		for (const lib of libs) {
			// Skip if already registered in this session.
			if (StencilShapeRegistry.get(lib)) { loaded.push(lib); continue; }
			let content = await this.readLibFile(lib, adapter, stencilsDir, userDir);
			if (content === null) {
				// Not on disk — try downloading automatically.
				try {
					await this.downloadLib(lib, adapter, stencilsDir);
					content = await adapter.read(normalizePath(`${stencilsDir}/${lib}.xml`));
				} catch {
					console.error(`drawio-view: failed to download ${lib}.xml`);
					failed.push(lib);
					continue;
				}
			}
			this.registerXml(content);
			loaded.push(lib);
		}
		return { loaded, failed };
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

	/**
	 * Scan all .drawio files in the vault and return all referenced lib stems.
	 * Handles compressed diagrams by parsing+decompressing before scanning.
	 * Detects both stencil-based (shape=mxgraph.*) and image-based (image=img/lib/*) libs.
	 */
	async detectFromVault(vault: Vault): Promise<string[]> {
		const found = new Set<string>();
		for (const file of vault.getFiles().filter(f => f.extension === 'drawio')) {
			const content = await vault.read(file);
			const drawioFile = parseDrawioFile(content);
			for (const page of drawioFile.pages) {
				for (const lib of this.detectUsedLibs(page.xml)) found.add(lib);
				for (const ref of this.detectImageRefs(page.xml)) {
					const cat = ref.split('/')[0];
					if (cat) found.add(cat);
				}
			}
		}
		return [...found];
	}
}

export const stencilManager = new StencilManager();
