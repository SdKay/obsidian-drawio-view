import { App, normalizePath, PluginSettingTab, Setting } from 'obsidian';
import type DrawioViewPlugin from './main';
import { OFFICIAL_LIBS, stencilManager } from './stencilManager';

export type ZoomModifier = 'none' | 'ctrl';
export type PanModifier = 'none' | 'ctrl';

export interface DrawioViewSettings {
	/** Whether wheel-zoom requires holding Ctrl/Cmd (avoids zooming while scrolling the note). */
	zoomModifier: ZoomModifier;
	/** 'none': drag=pan, Ctrl+click=follow link.  'ctrl': Ctrl+drag=pan, click=follow link. */
	panModifier: PanModifier;
	/** Vault-relative path to a folder containing custom stencil .xml files. */
	customStencilDir: string;
}

export const DEFAULT_SETTINGS: DrawioViewSettings = {
	zoomModifier: 'none',
	panModifier: 'none',
	customStencilDir: '',
};

export class DrawioViewSettingTab extends PluginSettingTab {
	private readonly plugin: DrawioViewPlugin;

	constructor(app: App, plugin: DrawioViewPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Zoom modifier key')
			.setDesc(
				'How the scroll wheel zooms a diagram. Choose "Ctrl + scroll" to avoid zooming while scrolling through the note.',
			)
			.addDropdown(dd =>
				dd
					.addOption('none', 'Scroll wheel')
					.addOption('ctrl', 'Ctrl + scroll wheel')
					.setValue(this.plugin.settings.zoomModifier)
					.onChange(async value => {
						this.plugin.settings.zoomModifier = value as ZoomModifier;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Click behavior')
			.setDesc(
				'Controls how clicking and dragging interact with links set on shapes. ' +
				'"Drag to pan" keeps current pan behavior and uses Ctrl+click to follow links. ' +
				'"Click to follow links" makes a plain click follow the link on a shape, and requires Ctrl+drag to pan.',
			)
			.addDropdown(dd =>
				dd
					.addOption('none', 'Drag to pan · Ctrl+click to follow links')
					.addOption('ctrl', 'Click to follow links · Ctrl+drag to pan')
					.setValue(this.plugin.settings.panModifier)
					.onChange(async value => {
						this.plugin.settings.panModifier = value as PanModifier;
						await this.plugin.saveSettings();
					}),
			);

		// ── Shape Libraries ───────────────────────────────────────

		new Setting(containerEl).setName('Shape libraries').setHeading();

		new Setting(containerEl)
			.setName('Custom library folder')
			.setDesc(
				'Vault-relative path to a folder containing your own stencil .xml files. ' +
				'Leave empty to disable. Example: drawio-stencils',
			)
			.addText(text =>
				text
					.setPlaceholder('Drawio-stencils')
					.setValue(this.plugin.settings.customStencilDir)
					.onChange(async value => {
						this.plugin.settings.customStencilDir = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		// Official library list ────────────────────────────────────
		const stencilsDir = normalizePath(
			`${this.plugin.app.vault.configDir}/plugins/drawio-view/stencils`,
		);
		const adapter = this.plugin.app.vault.adapter;

		const libsHeader = containerEl.createDiv({ cls: 'drawio-libs-header' });
		libsHeader.createEl('span', { text: 'Official libraries' });
		const headerControls = libsHeader.createDiv({ cls: 'drawio-libs-controls' });

		const selectAllBtn   = headerControls.createEl('button', { text: 'Select all' });
		const deselectAllBtn = headerControls.createEl('button', { text: 'Deselect all' });
		const autoDetectBtn  = headerControls.createEl('button', { text: '⚡ Auto-detect from vault' });
		const downloadBtn    = headerControls.createEl('button', { text: '⬇ Download selected' });

		const checkboxMap = new Map<string, HTMLInputElement>();

		const refreshBadges = async () => {
			const localLibs = await stencilManager.getLocalLibs(adapter, stencilsDir);
			checkboxMap.forEach((_, file) => {
				const row = containerEl.querySelector(`.drawio-lib-row[data-file="${file}"]`);
				const badge = row?.querySelector('.drawio-lib-badge');
				if (!badge) return;
				const isLocal = localLibs.includes(file);
				badge.setText(isLocal ? '✓ Downloaded' : 'Not downloaded');
				badge.toggleClass('is-downloaded', isLocal);
			});
		};

		const listEl = containerEl.createDiv({ cls: 'drawio-libs-list' });
		let currentCategory = '';
		for (const entry of OFFICIAL_LIBS) {
			if (entry.category !== currentCategory) {
				currentCategory = entry.category;
				listEl.createEl('div', { cls: 'drawio-libs-category', text: entry.category });
			}
			const row = listEl.createDiv({ cls: 'drawio-lib-row', attr: { 'data-file': entry.file } });
			const checkbox = row.createEl('input', { attr: { type: 'checkbox' } });
			checkboxMap.set(entry.file, checkbox);
			row.createEl('span', { cls: 'drawio-lib-name', text: entry.name });
			row.createEl('span', { cls: 'drawio-lib-file', text: `(${entry.file}.xml)` });
			row.createEl('span', { cls: 'drawio-lib-badge', text: 'Not downloaded' });
		}

		void refreshBadges();

		selectAllBtn.addEventListener('click',   () => checkboxMap.forEach(cb => { cb.checked = true; }));
		deselectAllBtn.addEventListener('click', () => checkboxMap.forEach(cb => { cb.checked = false; }));

		autoDetectBtn.addEventListener('click', () => {
			void (async () => {
				autoDetectBtn.setText('Detecting…');
				autoDetectBtn.disabled = true;
				try {
					const detected = await stencilManager.detectFromVault(this.plugin.app.vault);
					checkboxMap.forEach((cb, file) => { if (detected.includes(file)) cb.checked = true; });
				} finally {
					autoDetectBtn.setText('⚡ Auto-detect from vault');
					autoDetectBtn.disabled = false;
				}
			})();
		});

		downloadBtn.addEventListener('click', () => {
			void (async () => {
				const selected = [...checkboxMap.entries()].filter(([, cb]) => cb.checked).map(([f]) => f);
				if (selected.length === 0) return;
				downloadBtn.disabled = true;
				let done = 0;
				for (const file of selected) {
					try {
						await stencilManager.downloadLib(file, adapter, stencilsDir);
					} catch (err) {
						console.error(`drawio-view: failed to download ${file}.xml`, err);
					}
					done++;
					downloadBtn.setText(`Downloading ${done}/${selected.length}…`);
				}
				downloadBtn.setText('⬇ Download selected');
				downloadBtn.disabled = false;
				await refreshBadges();
			})();
		});

		new Setting(containerEl)
			.setName('Delete all downloaded libraries')
			.setDesc('Remove all stencil XML files downloaded to the plugin folder.')
			.addButton(btn =>
				btn
					.setButtonText('Delete all')
					.onClick(async () => {
						const libs = await stencilManager.getLocalLibs(adapter, stencilsDir);
						for (const lib of libs) {
							await adapter.remove(normalizePath(`${stencilsDir}/${lib}.xml`));
						}
						await refreshBadges();
					}),
			);
	}
}
