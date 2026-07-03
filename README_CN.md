<div align="center">

<img src="./drawio-view-demo.gif" alt="Draw.io View 演示" width="720" />

<p>
  <b>🔍 缩放 &nbsp;·&nbsp; 🖱️ 平移 &nbsp;·&nbsp; 📄 多页 &nbsp;·&nbsp; 🔗 图形链接 &nbsp;·&nbsp; 📦 三方图形库 &nbsp;·&nbsp; 🌙 深色模式</b>
</p>

<p>
  <a href="https://github.com/SdKay/obsidian-drawio-view/releases/latest">
    <img src="https://img.shields.io/github/v/release/SdKay/obsidian-drawio-view?style=flat-square&color=7c3aed" alt="最新版本" />
  </a>
  <a href="https://github.com/SdKay/obsidian-drawio-view/releases">
    <img src="https://img.shields.io/github/downloads/SdKay/obsidian-drawio-view/total?style=flat-square&color=brightgreen" alt="总下载量" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/SdKay/obsidian-drawio-view?style=flat-square" alt="许可证" />
  </a>
  <a href="https://obsidian.md/plugins?id=drawio-view">
    <img src="https://img.shields.io/badge/Obsidian-社区插件-7c3aed?style=flat-square&logo=obsidian&logoColor=white" alt="Obsidian 社区插件" />
  </a>
</p>

<p>
  <a href="README.md">English</a> ·
  <a href="#使用方法">使用方法</a> ·
  <a href="#三方图形库">三方图形库</a> ·
  <a href="#操作方式">操作方式</a> ·
  <a href="#设置项">设置项</a> ·
  <a href="#安装">安装</a>
</p>

<p>
  <img src="wechat.jpg" alt="微信公众号" width="120" />
  <br/><sub>关注微信公众号，获取更多 Obsidian 插件与工具</sub>
</p>

</div>

在 Obsidian 笔记中内嵌渲染 [draw.io](https://www.drawio.com/) `.drawio` 图表。基于 [@maxgraph/core](https://github.com/maxGraph/maxGraph)（draw.io 底层 mxGraph 库的 TypeScript 继承者）构建。

---

## 使用方法

将 `.drawio` 文件放在 vault 任意位置，用围栏代码块嵌入：

````markdown
```drawio-view
my-diagram.drawio
```
````

支持用 `|` 分隔的可选参数：

````markdown
```drawio-view
my-diagram.drawio|<页面>|<高度>|<缩放>|<偏移>
```
````

### 参数说明

| 参数 | 格式 | 示例 | 说明 |
|------|------|------|------|
| 页面 | 页面名或 `page-N` | `my_page` 或 `page-2` | 显示哪一页，默认第一页 |
| 高度 | `Npx` | `600px` | 查看器高度，默认 400px |
| 缩放 | `N%` | `80%` | 初始缩放比例，默认自动适应 |
| 偏移 | `(X, Y)` | `(190, 34)` | 初始平移偏移（屏幕像素），默认居中 |

参数顺序任意，全部可省略：

````markdown
```drawio-view
skb.drawio|my_page|80%|(190, 34)
```
````

---

## 三方图形库

draw.io 图表可以使用扩展图形库（AWS、Azure、GCP、Cisco、电气符号等），这些库未内置在插件中。插件会自动处理它们。

### 工作原理

1. **首次打开** — 插件自动检测图表需要哪些图形库。本地已缓存的库在首帧前即时加载。如果某些库本地不存在，查看器顶部会显示下载提示横幅。

2. **下载横幅** — 点击 **Download** 从 draw.io 的官方 GitHub 仓库下载缺失的库。库文件保存在 vault 的插件目录中，后续所有图表复用。点击 **Settings** 手动管理，或点击 **✕** 关闭（未下载的图形将显示为矩形占位）。

3. **后续打开** — 已下载的库在毫秒内完成注册，无需网络访问。

### 支持的图形库类型

| 类型 | 示例 | 行为 |
|------|------|------|
| XML stencil 库 | AWS、Azure、GCP、Cisco、电气符号… | 自动检测，按需下载 |
| SVG 图片库 | IBM Social、IBM Infrastructure… | 首次使用时自动下载，完全透明 |
| 内置 JS 图形 | `curlyBracket` 等 | 原生移植，无需下载 |

### 在设置中管理图形库

进入 **设置 → Draw.io View → Shape Libraries**：
- 按分类（云服务、网络、软件、工程…）浏览并下载官方图形库
- 点击 **Auto-detect from vault** 扫描 vault 中所有 `.drawio` 文件，自动勾选用到的库
- 设置**自定义图形库目录**，将自己的 `.xml` stencil 文件放入该目录，插件会自动加载

---

## 操作方式

| 操作 | 效果 |
|------|------|
| **滚轮** | 以光标为中心缩放 |
| **左键拖拽** | 平移图表 |
| **双指捏合** | 触屏/移动端捏合缩放 |
| **双击** | 重置到初始视图 |
| **拖拽底边** | 调整查看器高度 |
| **↗ 按钮**（右下 HUD） | 用系统默认程序打开 `.drawio` 文件（如 draw.io 桌面版） |
| **⊙ 按钮**（右下 HUD） | 将当前页面/缩放/偏移写回代码块 |
| **页签栏**（多页图表） | 在各页之间切换 |

**⊙ 按钮**是保存默认视图最简便的方式：平移缩放到想要的位置，点击 ⊙，代码块自动更新，下次打开即恢复该视图。

### 图形链接

图形可以携带指向 vault 笔记或外部 URL 的链接。将鼠标悬停在任意图形上即可看到 **✎** 按钮。

- **点击 ✎** — 打开模糊搜索弹窗，输入关键词搜索 vault 笔记，或直接粘贴 `https://` URL。
- **跳转链接** — 根据「点击行为」设置，单击或 Ctrl+单击图形即可跳转。

---

## 深色模式

Obsidian 切换到深色主题时，查看器自动反转图表颜色——无需任何配置。

---

## 设置项

| 设置 | 说明 |
|------|------|
| **缩放修饰键** | 普通滚轮或 Ctrl+滚轮缩放图表 |
| **点击行为** | 控制点击和拖拽与图形链接的交互方式 |
| **自定义图形库目录** | vault 相对路径，存放自定义 stencil `.xml` 文件 |
| **Shape Libraries** | 下载官方三方图形库，支持从 vault 自动检测 |

---

## 安装

### 社区插件市场（推荐）

1. 在 Obsidian 中：**设置 → 社区插件 → 浏览**
2. 搜索 **draw.io view**，点击**安装**，然后**启用**

### 手动安装

1. 从[最新 Release](https://github.com/SdKay/obsidian-drawio-view/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`
2. 复制到 `<vault>/.obsidian/plugins/drawio-view/`
3. 在 Obsidian 中：**设置 → 社区插件 → 重新加载插件**，然后启用 **Draw.io View**

---

## 已知限制

- **非整数缩放时边线对角化** — 正交边在某些缩放比例下可能略显对角线状，仅影响外观。
- **draw.io 表格图形** — `shape=table`、`shape=tableRow`、`shape=partialRectangle` 渲染为矩形，标签文字保留。
- **不支持 wiki 嵌入** — `![[file.drawio]]` 语法暂不支持，请使用代码块语法。
- **编辑代码块后页面上移** — 在实时预览模式下退出代码块编辑器时，页面可能轻微上移，正在调查中。

---

## 从源码构建

```bash
git clone https://github.com/SdKay/obsidian-drawio-view.git
cd obsidian-drawio-view
npm install
npm run build   # 生成 main.js
npm run dev     # watch 模式
```

需要 Node.js 18+。

---

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=SdKay/obsidian-drawio-view&type=Date)](https://star-history.com/#SdKay/obsidian-drawio-view&Date)

---

## 许可证

[MIT](LICENSE) © 2026 [sdking.xing](https://github.com/SdKay)
