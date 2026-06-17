import { App, PluginSettingTab, Setting } from 'obsidian';
import type DrawioViewPlugin from './main';

export type ZoomModifier = 'none' | 'ctrl';
export type PanModifier = 'none' | 'ctrl';

export interface DrawioViewSettings {
	/** Whether wheel-zoom requires holding Ctrl/Cmd (avoids zooming while scrolling the note). */
	zoomModifier: ZoomModifier;
	/** 'none': drag=pan, Ctrl+click=follow link.  'ctrl': Ctrl+drag=pan, click=follow link. */
	panModifier: PanModifier;
}

export const DEFAULT_SETTINGS: DrawioViewSettings = {
	zoomModifier: 'none',
	panModifier: 'none',
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
	}
}
