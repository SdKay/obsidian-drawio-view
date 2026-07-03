<div align="center">

<img src="./drawio-view-demo.gif" alt="Draw.io View demo" width="720" />

<p>
  <b>🔍 Zoom &nbsp;·&nbsp; 🖱️ Pan &nbsp;·&nbsp; 📄 Multi-page &nbsp;·&nbsp; 🔗 Shape links &nbsp;·&nbsp; 📦 Third-party libs &nbsp;·&nbsp; 🌙 Dark mode</b>
</p>

<p>
  <a href="https://github.com/SdKay/obsidian-drawio-view/releases/latest">
    <img src="https://img.shields.io/github/v/release/SdKay/obsidian-drawio-view?style=flat-square&color=7c3aed" alt="Latest release" />
  </a>
  <a href="https://github.com/SdKay/obsidian-drawio-view/releases">
    <img src="https://img.shields.io/github/downloads/SdKay/obsidian-drawio-view/total?style=flat-square&color=brightgreen" alt="Total downloads" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/SdKay/obsidian-drawio-view?style=flat-square" alt="License" />
  </a>
  <a href="https://obsidian.md/plugins?id=drawio-view">
    <img src="https://img.shields.io/badge/Obsidian-Community_Plugin-7c3aed?style=flat-square&logo=obsidian&logoColor=white" alt="Obsidian community plugin" />
  </a>
</p>

<p>
  <a href="README_CN.md">中文文档</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#shape-libraries">Shape Libraries</a> ·
  <a href="#controls">Controls</a> ·
  <a href="#settings">Settings</a> ·
  <a href="#installation">Installation</a>
</p>

<p>
  <img src="wechat.jpg" alt="WeChat public account" width="120" />
  <br/><sub>Follow on WeChat for more Obsidian plugins &amp; tools</sub>
</p>

</div>

Render [draw.io](https://www.drawio.com/) `.drawio` diagrams inline inside your Obsidian notes — with smooth zoom, pan, multi-page tabs, shape links, and full support for third-party shape libraries.

---

## Usage

Place your `.drawio` file anywhere in the vault, then embed it with a fenced code block:

````markdown
```drawio-view
my-diagram.drawio
```
````

You can optionally set the starting page, height, zoom, and pan offset:

````markdown
```drawio-view
my-diagram.drawio|my_page|600px|80%|(190, 34)
```
````

| Parameter | Format | Example | Description |
|-----------|--------|---------|-------------|
| Page | page name or `page-N` | `my_page` · `page-2` | Which page to display. Default: first page. |
| Height | `Npx` | `600px` | Viewer height. Default: 400 px. |
| Zoom | `N%` | `80%` | Initial zoom level. Default: auto-fit. |
| Offset | `(X, Y)` | `(190, 34)` | Initial pan position. Default: centred. |

All parameters are optional and can appear in any order.

---

## Shape Libraries

If your diagram uses extended shape libraries (AWS, Azure, GCP, Cisco, Electrical, IBM, and many more), the plugin will detect this automatically and show a **download banner** the first time you open it.

Click **Download** — the missing libraries are fetched from draw.io's official repository, saved locally, and reused for all future diagrams. The banner also has a **Settings** shortcut if you prefer to manage libraries manually.

Go to **Settings → Draw.io View → Shape Libraries** to:
- Browse and download official libraries by category
- Use **Auto-detect from vault** to find all libraries needed by your existing diagrams
- Set a **custom folder** for your own shape files

---

## Controls

| Action | Result |
|--------|--------|
| **Scroll wheel** | Zoom in / out |
| **Drag** | Pan the diagram |
| **Two-finger pinch** | Pinch-zoom (touch / mobile) |
| **Double-click** | Reset to initial view |
| **Drag bottom edge** | Resize viewer height |
| **↗** | Open file in system default editor |
| **⊙** | Save current view back into the code block |
| **Page tabs** | Switch pages (multi-page diagrams) |

**Tip:** pan and zoom to the view you want, then click ⊙. The code block updates in-place and that view is restored every time you open the note.

### Shape links

Hover any shape to see a **✎** button. Click it to attach a link to a vault note or external URL. To follow the link, click the shape (exact key depends on the *Click behavior* setting).

---

## Dark mode

The viewer automatically adapts to Obsidian's dark theme — no configuration needed.

---

## Settings

| Setting | Description |
|---------|-------------|
| **Zoom modifier key** | Plain scroll or Ctrl+scroll to zoom. |
| **Click behavior** | Whether a plain click or Ctrl+click follows a shape link. |
| **Custom library folder** | A vault folder for your own shape files. |
| **Shape Libraries** | Download official libraries; auto-detect from vault. |

---

## Installation

### Community plugin marketplace (recommended)

1. **Settings → Community plugins → Browse**
2. Search **draw.io view** → Install → Enable

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/SdKay/obsidian-drawio-view/releases/latest) and copy them to `<vault>/.obsidian/plugins/drawio-view/`.

---

## Known limitations

- Some shapes from draw.io's table or extended shape sets may not render perfectly.
- `![[file.drawio]]` wiki-embed syntax is not supported — use the code block instead.
- In Live Preview, exiting the code block editor can cause a small scroll shift (under investigation).

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=SdKay/obsidian-drawio-view&type=Date)](https://star-history.com/#SdKay/obsidian-drawio-view&Date)

---

## License

[MIT](LICENSE) © 2026 [sdking.xing](https://github.com/SdKay)
