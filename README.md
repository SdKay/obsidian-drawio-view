# drawio-view

Renders [draw.io](https://www.drawio.com/) `.drawio` diagrams inline inside Obsidian notes.
Powered by [@maxgraph/core](https://github.com/maxGraph/maxGraph) — the TypeScript successor to the mxGraph library that draw.io is built on.

---

![](drawio-view-demo.gif)

## Usage

Place your `.drawio` file anywhere in the vault, then embed it with a fenced code block:

````markdown
```drawio-view
my-diagram.drawio
```
````

The viewer supports optional parameters separated by `|`:

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
skb.drawio
```

```drawio-view
skb.drawio|my_page
```

```drawio-view
skb.drawio|page-2|600px|120%
```

```drawio-view
skb.drawio|my_page|80%|(190, 34)
```
````

---

## Controls

| Action | Result |
|--------|--------|
| **Scroll wheel** | Zoom in / out towards the cursor |
| **Left-click drag** | Pan the diagram |
| **Double-click** | Reset to the initial view (parameters or auto-fit) |
| **Drag bottom edge** | Resize the viewer height (written back automatically) |
| **⊙ button** (bottom-left) | Write the current page / zoom / offset back into the code block |
| **Tab bar** (bottom, multi-page only) | Switch between diagram pages |

The **⊙ button** is the easiest way to set default parameters: pan and zoom to the view you want, then click ⊙. The code block in your note is updated in-place with the current values, so that view is restored on the next open.

Pan and zoom are GPU-composited and committed to the renderer only when you stop interacting, so they stay smooth even with large diagrams in heavily-loaded vaults. The current zoom and offset are always shown in the bottom-right corner.

> The plugin never stores view state between sessions — every open starts from the parameters in the code block (or auto-fit if none are given).

---

## Settings

| Setting | Options | Description |
|---------|---------|-------------|
| **Zoom modifier key** | Scroll wheel / Ctrl + scroll wheel | How the scroll wheel zooms. Choose **Ctrl + scroll wheel** so plain scrolling moves through the note instead of zooming the diagram under the cursor. |

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

### Third-party shape libraries
Shapes from draw.io's extended libraries (IBM, AWS, GCP, Azure, Cisco, etc.) use custom SVG stencils not bundled with this plugin. They fall back to plain rectangles with their label text intact. Core mxGraph shapes (swimlanes, basic geometry, UML, flowchart) render correctly.

### Diagonal edges at non-integer zoom levels
Orthogonal edges can appear slightly diagonal at certain zoom percentages due to floating-point coordinate rounding. The `shape-rendering: crispEdges` CSS property mitigates most cases but does not eliminate the issue entirely. Cosmetic only.

### draw.io-specific table shapes
`shape=table`, `shape=tableRow`, and `shape=partialRectangle` render as plain rectangles; labels and layout are preserved.

### No wiki-embed support
`![[file.drawio]]` inline embed syntax is not supported. Use the code block syntax instead.

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

## Support

If this plugin saves you time, a coffee is always welcome ☕

<div align="center">

| Alipay | WeChat |
|:------:|:------:|
| <img src="alipay.jpg" width="180"/> | <img src="wechat.jpg" width="180"/> |

</div>

---

## License

[MIT](LICENSE) © 2026 [sdking.xing](https://github.com/SdKay)
