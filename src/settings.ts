import { App, PluginSettingTab, Setting } from 'obsidian';
import type DrawioViewPlugin from './main';

export type ZoomModifier = 'none' | 'ctrl';

export interface DrawioViewSettings {
	/** Whether wheel-zoom requires holding Ctrl/Cmd (avoids zooming while scrolling the note). */
	zoomModifier: ZoomModifier;
}

export const DEFAULT_SETTINGS: DrawioViewSettings = {
	zoomModifier: 'none',
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
	}
}
