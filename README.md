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

Render [draw.io](https://www.drawio.com/) `.drawio` diagrams inline inside Obsidian notes. Powered by [@maxgraph/core](https://github.com/maxGraph/maxGraph) — the TypeScript successor to the mxGraph library that draw.io is built on.

---

## Usage

Place your `.drawio` file anywhere in the vault, then embed it with a fenced code block:

````markdown
```drawio-view
my-diagram.drawio
```
````

Optional parameters separated by `|`:

````markdown
```drawio-view
my-diagram.drawio|<page>|<height>|<zoom>|<offset>
```
````

### Parameters

| Parameter | Format | Example | Description |
|-----------|--------|---------|-------------|
| Page | page name or `page-N` | `my_page` or `page-2` | Which page to show. Default: first page. |
| Height | `Npx` | `600px` | Viewer height. Default: 400 px. |
| Zoom | `N%` | `80%` | Initial zoom level. Default: auto-fit. |
| Offset | `(X, Y)` | `(190, 34)` | Initial pan offset (display pixels). Default: centred. |

Parameters can appear in any order and all are optional:

````markdown
```drawio-view
skb.drawio|my_page|80%|(190, 34)
```
````

---

## Shape Libraries

Draw.io diagrams can use extended shape libraries (AWS, Azure, GCP, Cisco, Electrical, and many more) that are not bundled with this plugin. The plugin handles them automatically.

### How it works

1. **First open** — the plugin detects which shape libraries the diagram needs. Locally-cached libraries load instantly before the first paint. If any libraries are missing from your device, a download banner appears at the top of the viewer.

2. **Download banner** — click **Download** to fetch the missing libraries from draw.io's official GitHub repository. Libraries are saved to your vault's plugin folder and reused across all future diagrams. Click **Settings** to manage libraries manually, or **✕** to dismiss (shapes will show as rectangles until downloaded).

3. **Subsequent opens** — already-downloaded libraries register in milliseconds with no network access.

### Supported library types

| Type | Examples | Behaviour |
|------|---------|-----------|
| XML stencil libs | AWS, Azure, GCP, Cisco, Electrical… | Auto-detected and downloaded on demand |
| SVG image libs | IBM Social, IBM Infrastructure… | Auto-downloaded on first use, fully transparent |
| Built-in shapes | `curlyBracket`, and others | Ported natively, no download needed |

### Managing libraries in Settings

Go to **Settings → Draw.io View → Shape Libraries** to:
- Browse and download official libraries organised by category (Cloud, Network, Software, Engineering…)
- Click **Auto-detect from vault** to scan all `.drawio` files and pre-tick the libraries they use
- Specify a **custom library folder** in your vault for your own stencil `.xml` files — place any compatible stencil file there and it loads automatically

---

## Controls

| Action | Result |
|--------|--------|
| **Scroll wheel** | Zoom in / out towards cursor |
| **Left-click drag** | Pan the diagram |
| **Two-finger pinch** | Pinch-zoom on touch / mobile |
| **Double-click** | Reset to initial view |
| **Drag bottom edge** | Resize the viewer height |
| **↗ button** (HUD) | Open `.drawio` file in system default editor (e.g. draw.io desktop) |
| **⊙ button** (HUD) | Save current page / zoom / offset back into the code block |
| **Tab bar** (multi-page) | Switch between diagram pages |

The **⊙ button** is the easiest way to set a default view: pan and zoom to the position you want, then click ⊙. The code block updates in-place and that view is restored on every subsequent open.

### Shape links

Shapes can carry links to vault notes or external URLs. Hover any shape to see the **✎** button.

- **Click ✎** — opens a fuzzy-search modal. Type to search vault notes by name, or paste an `https://` URL directly.
- **Follow a link** — plain click or Ctrl+click depending on the *Click behavior* setting.

---

## Dark mode

The viewer automatically inverts diagrams when Obsidian switches to a dark theme — no configuration needed.

---

## Settings

| Setting | Description |
|---------|-------------|
| **Zoom modifier key** | Whether plain scroll or Ctrl+scroll zooms the diagram. |
| **Click behavior** | Controls how clicking and dragging interact with shape links. |
| **Custom library folder** | Vault-relative path to a folder with your own stencil `.xml` files. |
| **Shape Libraries** | Download official third-party shape libraries; auto-detect from vault. |

---

## Installation

### Community plugin marketplace (recommended)

1. In Obsidian: **Settings → Community plugins → Browse**.
2. Search for **draw.io view** and click **Install**, then **Enable**.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/SdKay/obsidian-drawio-view/releases/latest).
2. Copy them to `<vault>/.obsidian/plugins/drawio-view/`.
3. In Obsidian: **Settings → Community plugins → Reload plugins**, then enable **Draw.io View**.

---

## Known limitations

- **Diagonal edges at non-integer zoom** — orthogonal edges can appear slightly diagonal at certain zoom percentages. Cosmetic only.
- **draw.io table shapes** — `shape=table`, `shape=tableRow`, and `shape=partialRectangle` render as rectangles; labels are preserved.
- **No wiki-embed** — `![[file.drawio]]` is not supported; use the code block syntax instead.
- **Scroll jump after code-block edit** — exiting the code block source editor in Live Preview mode can cause a small scroll shift. Being investigated.

---

## Building from source

```bash
git clone https://github.com/SdKay/obsidian-drawio-view.git
cd obsidian-drawio-view
npm install
npm run build   # produces main.js
npm run dev     # watch mode
```

Requires Node.js 18+.

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=SdKay/obsidian-drawio-view&type=Date)](https://star-history.com/#SdKay/obsidian-drawio-view&Date)

---

## License

[MIT](LICENSE) © 2026 [sdking.xing](https://github.com/SdKay)
