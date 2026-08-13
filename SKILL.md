---
name: obsidian-drawio-view
description: >
  Insert and manage draw.io diagrams in Obsidian vault notes using the
  drawio-view plugin. Use when the user asks to embed, view, or configure
  a .drawio diagram in a note.
---

# Draw.io View — Agent Reference

`drawio-view` is an Obsidian plugin that renders `.drawio` diagrams inline
inside fenced code blocks.

> **Obsidian-only.** The `drawio-view` block will not render in standard
> Markdown editors or GitHub previews.

---

## Block syntax

````markdown
```drawio-view
filename.drawio
```
````

All parameters are optional and can appear in any order, separated by `|`:

````markdown
```drawio-view
filename.drawio|<page>|<height>|<zoom>|<offset>
```
````

| Parameter | Format | Example | Description |
|-----------|--------|---------|-------------|
| Filename | `*.drawio` | `diagram.drawio` | Required. Vault-relative path or bare name. |
| Page | page name or `page-N` | `my_page` · `page-2` | Which page to show. Default: first page. |
| Height | `Npx` | `600px` | Viewer height in pixels. Default: 400px. |
| Zoom | `N%` | `80%` | Initial zoom level. Default: auto-fit. |
| Offset | `(X, Y)` | `(190, 34)` | Initial pan position in display pixels. Default: centred. |

### Examples

Minimal — just the filename:
````markdown
```drawio-view
architecture.drawio
```
````

Specific page, fixed height:
````markdown
```drawio-view
architecture.drawio|backend|500px
```
````

Saved view with zoom and offset (written by the ⊙ button):
````markdown
```drawio-view
architecture.drawio|backend|500px|80%|(190, 34)
```
````

---

## Inserting a diagram into a note

1. Read the target note with `Read`.
2. Identify the insertion point.
3. Use `Edit` to insert the block:

```
old_string: "## Architecture\n\n"
new_string: "## Architecture\n\n```drawio-view\narchitecture.drawio\n```\n\n"
```

The `.drawio` file must already exist in the vault. If it does not exist,
tell the user to create it in draw.io and place it in the vault first.

---

## Filename resolution

- Vault-absolute paths work directly: `diagrams/arch.drawio`
- Bare names (`arch.drawio`) are resolved via Obsidian's link cache —
  they match regardless of folder.
- Use `normalizePath` conventions: forward slashes, no leading slash.

---

## Updating parameters

To change a parameter (e.g. switch to a different page or set a fixed height),
read the file, locate the `drawio-view` block, and replace the parameter line:

```
old_string: "```drawio-view\narchitecture.drawio\n```"
new_string: "```drawio-view\narchitecture.drawio|backend|600px\n```"
```

Do **not** add a `libs:` line — the plugin manages shape libraries automatically.

---

## What the plugin handles automatically

- **Zoom / pan** — the user interacts with the viewer directly.
- **Magnifier** — a 🔍 toolbar button lets the user inspect fine detail with a
  cursor-following loupe, independent of the code block's zoom/offset params.
  Nothing an agent needs to configure.
- **Shape libraries** — if the diagram uses AWS, Azure, Cisco, or other
  extended shapes, the plugin detects this and prompts the user to download
  the required library. No agent action needed.
- **Dark mode** — automatic.
- **Multi-page tabs** — automatic when the file has multiple pages.

---

## Shape links (read / write)

Shapes in a diagram can carry links to vault notes or external URLs. These
are stored inside the `.drawio` XML, not in the code block. The plugin's
`✎` button lets users edit links interactively — agents do not need to
manipulate the XML directly.

---

## When NOT to use this skill

- If the user wants to **create or edit** the diagram content (shapes,
  connectors, text), they must use draw.io desktop. This plugin is a
  **viewer only** — it does not support editing diagram content.
- If the file is not a `.drawio` file (e.g. an SVG or PNG), use a standard
  Markdown image embed instead.
