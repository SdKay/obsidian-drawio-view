import { requestUrl, normalizePath } from 'obsidian';
import type { DataAdapter, Vault } from 'obsidian';
import { StencilShape, StencilShapeRegistry, ShapeRegistry } from '@maxgraph/core';
import { parseDrawioFile } from './parser';

// Module-level caches, live for the whole Obsidian session.
const imageDataUriCache = new Map<string, string>();  // svg path → data URI
// Registered keys: flat lib stem (e.g. "aws4") or dir subfile ("electrical/plc_ladder").
// Sub-file granularity means a huge dir-lib only parses the files actually used.
const loadedKeys = new Set<string>();

const IMG_RAW_BASE = 'https://raw.githubusercontent.com/jgraph/drawio/dev/src/main/webapp/img/lib/';

// ---------------------------------------------------------------------------
// Official library catalog
// ---------------------------------------------------------------------------

export interface LibEntry {
	name: string;
	file: string;       // filename stem (flat) or directory name (dir-based)
	category: string;
	isDir?: boolean;    // true = multiple XML files under stencils/<file>/
}

export const OFFICIAL_LIBS: LibEntry[] = [
	// Cloud
	{ name: 'Amazon Web Services (AWS4)', file: 'aws4',        category: 'Cloud' },
	{ name: 'Microsoft Azure',            file: 'azure',       category: 'Cloud' },
	{ name: 'Google Cloud Platform',      file: 'gcp2',        category: 'Cloud' },
	{ name: 'Google Cloud (v3)',          file: 'gcp3',        category: 'Cloud' },
	{ name: 'IBM',                        file: 'ibm',         category: 'Cloud' },
	{ name: 'IBM Cloud',                  file: 'ibm_cloud',   category: 'Cloud' },
	{ name: 'Kubernetes',                 file: 'kubernetes',  category: 'Cloud' },
	// Network
	{ name: 'Cisco (legacy)',             file: 'cisco',       category: 'Network', isDir: true },
	{ name: 'Cisco (2019)',               file: 'cisco19',     category: 'Network' },
	{ name: 'Network',                    file: 'networks',    category: 'Network' },
	{ name: 'Rack',                       file: 'rack',        category: 'Network', isDir: true },
	// Software / Dev
	{ name: 'Flowchart',                  file: 'flowchart',   category: 'Software' },
	{ name: 'BPMN',                       file: 'bpmn',        category: 'Software' },
	{ name: 'EIP',                        file: 'eip',         category: 'Software' },
	{ name: 'Bootstrap',                  file: 'bootstrap',   category: 'Software' },
	// General
	{ name: 'Basic',                      file: 'basic',       category: 'General' },
	{ name: 'Mockup',                     file: 'mockup',      category: 'General', isDir: true },
	{ name: 'Floorplan',                  file: 'floorplan',   category: 'General' },
	{ name: 'Signs / Wayfinding',         file: 'signs',       category: 'General', isDir: true },
	{ name: 'Lean Mapping',               file: 'lean_mapping',category: 'General' },
	{ name: 'Fluid Power',                file: 'fluid_power', category: 'General' },
	// Engineering
	{ name: 'Electrical',                 file: 'electrical',  category: 'Engineering', isDir: true },
	{ name: 'P&ID',                       file: 'pid',         category: 'Engineering', isDir: true },
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

		// The <shapes name="mxgraph.aws4"> container provides the fully-qualified
		// prefix.  Each <shape name="a1 instance"> is registered as
		// "mxgraph.aws4.a1_instance" (lower-case, spaces → underscores) which is
		// what draw.io writes into style="shape=mxgraph.aws4.a1_instance".
		const prefix = doc.querySelector('shapes')?.getAttribute('name') ?? '';

		doc.querySelectorAll('shape').forEach(shape => {
			const rawName = shape.getAttribute('name');
			if (!rawName) return;
			const normalized = rawName.toLowerCase().replace(/\s+/g, '_');
			const fullName = prefix ? `${prefix}.${normalized}` : normalized;
			if (!StencilShapeRegistry.get(fullName)) {
				StencilShapeRegistry.add(fullName, new StencilShape(shape));
			}
		});
	}

	/**
	 * Scan page XML for shape=mxgraph.<lib>.<name> patterns (stencil-based libs).
	 * Returns the set of lib file-name stems referenced (e.g. ['aws4', 'azure']).
	 */
	detectUsedLibs(pageXml: string): string[] {
		// Capture the full shape name (group 1) as well as the lib prefix
		// (group 2).  Some `mxgraph.<lib>.<name>` shapes — e.g.
		// mxgraph.basic.polygon — are draw.io built-ins with no stencil XML
		// counterpart; once natively ported (see builtinShapes.ts) they
		// resolve via @maxgraph's ShapeRegistry and must NOT be reported as
		// needing a library download.
		const pattern = /shape=(mxgraph\.([a-zA-Z0-9_]+)\.[a-zA-Z0-9_.]+)/g;
		const found = new Set<string>();
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(pageXml)) !== null) {
			const fullName = m[1]!;
			const lib = m[2]!;
			if (ShapeRegistry.get(fullName)) continue; // natively supported — no download needed
			found.add(lib);
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
	/**
	 * Replace image=img/lib/... references with base64 data URIs using ONLY
	 * locally-cached SVGs (no network).  Returns the processed XML plus the list
	 * of refs that are not available locally (so the caller can prompt to download).
	 * Session cache makes repeat calls (page switch / reload) free.
	 */
	async preloadImages(
		pageXml: string,
		adapter: DataAdapter,
		stencilsDir: string,
	): Promise<{ xml: string; missing: string[] }> {
		const refs = this.detectImageRefs(pageXml);
		if (refs.length === 0) return { xml: pageXml, missing: [] };

		let result = pageXml;
		const missing: string[] = [];
		for (const ref of refs) {
			const dataUri = await this.resolveLocalImageDataUri(ref, adapter, stencilsDir);
			if (dataUri) {
				result = result.split(`image=img/lib/${ref}`).join(`image=${dataUri}`);
			} else {
				missing.push(ref);
			}
		}
		return { xml: result, missing };
	}

	/** Resolve an SVG ref to a data URI from cache/disk only (no download). */
	private async resolveLocalImageDataUri(
		relPath: string,
		adapter: DataAdapter,
		stencilsDir: string,
	): Promise<string> {
		const cached = imageDataUriCache.get(relPath);
		if (cached !== undefined) return cached;

		const localPath = normalizePath(`${stencilsDir}/img/${relPath}`);
		if (!(await adapter.exists(localPath))) return '';
		const svgContent = await adapter.read(localPath);
		if (!svgContent) return '';
		// URL-encoded (not base64) so the data URI has no literal ';' — @maxgraph
		// splits style strings on ';' and would truncate a base64 URI.
		const dataUri = `data:image/svg+xml,${encodeURIComponent(svgContent)}`;
		imageDataUriCache.set(relPath, dataUri);
		return dataUri;
	}

	/** Download a single SVG image from GitHub into the local img cache. */
	async downloadImage(
		relPath: string,
		adapter: DataAdapter,
		stencilsDir: string,
	): Promise<void> {
		const response = await requestUrl({ url: `${IMG_RAW_BASE}${relPath}`, method: 'GET' });
		const localPath = normalizePath(`${stencilsDir}/img/${relPath}`);
		const dir = localPath.substring(0, localPath.lastIndexOf('/'));
		if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
		await adapter.write(localPath, response.text);
	}

	/**
	 * Extract the sub-file names a page uses from a directory-based lib.
	 * `shape=mxgraph.electrical.plc_ladder.contact` → 'plc_ladder'.
	 */
	private detectSubfiles(pageXml: string, lib: string): string[] {
		const re = new RegExp(`shape=mxgraph\\.${lib}\\.([a-zA-Z0-9_]+)\\.`, 'g');
		const found = new Set<string>();
		let m: RegExpExecArray | null;
		while ((m = re.exec(pageXml)) !== null) found.add(m[1]!);
		return [...found];
	}

	/**
	 * Register stencil libs that are ALREADY on disk (no network).
	 * For directory-based libs (electrical, cisco, …) only the sub-files the page
	 * actually references are read+parsed — a page using one `plc_ladder` shape
	 * parses one file, not all 24, so the first paint isn't blocked for seconds.
	 * Missing-from-disk libs are skipped (surfaced via the banner instead).
	 */
	async registerLocalLibs(
		libs: string[],
		pageXml: string,
		adapter: DataAdapter,
		stencilsDir: string,
		userDir: string | null,
	): Promise<void> {
		for (const lib of libs) {
			const entry = OFFICIAL_LIBS.find(e => e.file === lib);
			try {
				if (entry?.isDir) {
					const subfiles = this.detectSubfiles(pageXml, lib);
					await Promise.all(subfiles.map(async sf => {
						const key = `${lib}/${sf}`;
						if (loadedKeys.has(key)) return;
						const path = normalizePath(`${stencilsDir}/${lib}/${sf}.xml`);
						if (!(await adapter.exists(path))) return;
						this.registerXml(await adapter.read(path));
						loadedKeys.add(key);
					}));
				} else {
					if (loadedKeys.has(lib)) continue;
					const content = await this.readLibFile(lib, adapter, stencilsDir, userDir);
					if (content === null) continue;
					this.registerXml(content);
					loadedKeys.add(lib);
				}
			} catch {
				// Ignore — treated as missing and surfaced via the banner.
			}
		}
	}

	/** Libs that are needed, not yet in session cache, AND not present on disk. */
	async findMissingLibs(
		libs: string[],
		adapter: DataAdapter,
		stencilsDir: string,
		userDir: string | null,
	): Promise<string[]> {
		const missing: string[] = [];
		for (const lib of libs) {
			if (loadedKeys.has(lib)) continue;
			if (!(await this.isLibOnDisk(lib, adapter, stencilsDir, userDir))) {
				missing.push(lib);
			}
		}
		return missing;
	}

	private async isLibOnDisk(
		lib: string,
		adapter: DataAdapter,
		stencilsDir: string,
		userDir: string | null,
	): Promise<boolean> {
		const entry = OFFICIAL_LIBS.find(e => e.file === lib);
		if (entry?.isDir) {
			const localDir = normalizePath(`${stencilsDir}/${lib}`);
			if (!(await adapter.exists(localDir))) return false;
			const listing = await adapter.list(localDir);
			return listing.files.some(f => f.endsWith('.xml'));
		}
		if (await adapter.exists(normalizePath(`${stencilsDir}/${lib}.xml`))) return true;
		if (userDir) {
			if (await adapter.exists(normalizePath(`${userDir}/${lib}.xml`))) return true;
		}
		return false;
	}

	/**
	 * Download all XML files of a directory-based stencil lib to disk.
	 * Does NOT register them — registration happens lazily per sub-file in
	 * registerLocalLibs, so only used sub-files are ever parsed.
	 */
	private async downloadDirLib(
		dir: string,
		adapter: DataAdapter,
		stencilsDir: string,
	): Promise<void> {
		const localDir = normalizePath(`${stencilsDir}/${dir}`);
		if (await adapter.exists(localDir)) {
			const listing = await adapter.list(localDir);
			if (listing.files.some(f => f.endsWith('.xml'))) return;  // already downloaded
		}

		// Fetch the directory listing via the GitHub API, then download each file.
		const apiUrl = `https://api.github.com/repos/jgraph/drawio/contents/src/main/webapp/stencils/${dir}`;
		const resp = await requestUrl({ url: apiUrl, method: 'GET' });
		const entries = resp.json as Array<{ name: string; type: string }>;
		const xmlFiles = entries.filter(e => e.type === 'file' && e.name.endsWith('.xml'));

		if (!(await adapter.exists(localDir))) await adapter.mkdir(localDir);
		await Promise.all(xmlFiles.map(async f => {
			const content = (await requestUrl({ url: `${RAW_BASE}${dir}/${f.name}`, method: 'GET' })).text;
			await adapter.write(normalizePath(`${localDir}/${f.name}`), content);
		}));
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
		const entry = OFFICIAL_LIBS.find(e => e.file === file);
		if (entry?.isDir) {
			await this.downloadDirLib(file, adapter, stencilsDir);
			return;
		}
		if (!(await adapter.exists(stencilsDir))) await adapter.mkdir(stencilsDir);
		const response = await requestUrl({ url: `${RAW_BASE}${file}.xml`, method: 'GET' });
		await adapter.write(normalizePath(`${stencilsDir}/${file}.xml`), response.text);
	}

	/** List lib stems that are available locally (flat files and populated dirs). */
	async getLocalLibs(adapter: DataAdapter, stencilsDir: string): Promise<string[]> {
		if (!(await adapter.exists(stencilsDir))) return [];
		const listing = await adapter.list(stencilsDir);
		const flatStems = listing.files
			.map(p => (p.split('/').pop() ?? ''))
			.filter(n => n.endsWith('.xml'))
			.map(n => n.slice(0, -4));
		// A subdirectory counts as downloaded if it contains at least one XML file.
		const dirStems: string[] = [];
		for (const folder of listing.folders) {
			const name = folder.split('/').pop() ?? '';
			if (!name) continue;
			const sub = await adapter.list(normalizePath(`${stencilsDir}/${name}`));
			if (sub.files.some(f => f.endsWith('.xml'))) dirStems.push(name);
		}
		return [...flatStems, ...dirStems];
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
