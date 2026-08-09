import { getLanguage } from 'obsidian';

/**
 * Minimal EN/ZH lookup for the viewer's button tooltips, driven by Obsidian's
 * own UI language setting (Settings → General → Language).
 */
const STRINGS = {
	openExternal: { en: 'Open in external editor', zh: '用系统默认程序打开' },
	autoFit: { en: 'Auto-fit to viewer', zh: '自动适配查看器大小' },
	applyView: { en: 'Apply current view to code block', zh: '将当前视图保存到代码块' },
	editLink: { en: 'Edit link', zh: '编辑链接' },
	resizeHandle: { en: 'Drag to resize height', zh: '拖动调整高度' },
} satisfies Record<string, { en: string; zh: string }>;

export function t(key: keyof typeof STRINGS): string {
	return STRINGS[key][getLanguage().startsWith('zh') ? 'zh' : 'en'];
}
