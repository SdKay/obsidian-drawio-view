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

<p>
  🧩 顺便看看我的另一个插件 <b>Rich Table</b> —— 支持合并单元格、类型化列、样式与双向链接的交互式表格：
  <a href="https://github.com/SdKay/obsidian-rich-table">GitHub</a> ·
  <a href="obsidian://show-plugin?id=rich-table">去商店中安装</a>
</p>

</div>

在 Obsidian 笔记中内嵌渲染 [draw.io](https://www.drawio.com/) `.drawio` 图表——支持流畅缩放平移、多页标签、图形链接，以及完整的三方图形库支持。

---

## 使用方法

将 `.drawio` 文件放在 vault 任意位置，用围栏代码块嵌入：

````markdown
```drawio-view
my-diagram.drawio
```
````

可选参数用 `|` 分隔，设置起始页面、高度、缩放和平移位置：

````markdown
```drawio-view
my-diagram.drawio|my_page|600px|80%|(190, 34)
```
````

| 参数 | 格式 | 示例 | 说明 |
|------|------|------|------|
| 页面 | 页面名或 `page-N` | `my_page` · `page-2` | 显示哪一页，默认第一页 |
| 高度 | `Npx` | `600px` | 查看器高度，默认 400px |
| 缩放 | `N%` | `80%` | 初始缩放比例，默认自动适应 |
| 偏移 | `(X, Y)` | `(190, 34)` | 初始平移位置，默认居中 |

所有参数均可省略，顺序任意。

---

## 三方图形库

如果你的图表用了扩展图形库（AWS、Azure、GCP、Cisco、电气符号、IBM 等），插件会自动检测，并在首次打开时顶部弹出**下载横幅**。

点击 **Download**，缺失的图形库会从 draw.io 官方仓库下载到本地，后续所有图表直接复用，无需再次下载。横幅上还有 **Settings** 快捷入口，方便手动管理。

进入**设置 → Draw.io View → Shape Libraries** 可以：
- 按分类浏览并下载官方图形库
- 点击 **Auto-detect from vault** 扫描 vault 中所有 `.drawio` 文件，一键检测所需图形库
- 设置**自定义图形库目录**，放入自己的图形文件后自动加载

---

## 操作方式

| 操作 | 效果 |
|------|------|
| **滚轮** | 缩放 |
| **拖拽** | 平移 |
| **双指捏合** | 捏合缩放（触屏/移动端） |
| **双击** | 重置到初始视图 |
| **拖拽底边** | 调整查看器高度 |
| **↗** | 用系统默认程序打开文件 |
| **⊙** | 将当前视图写回代码块 |
| **页签** | 切换页面（多页图表） |

**小技巧：** 平移缩放到想要的视图，点击 ⊙，代码块自动更新，下次打开即恢复该视图。

### 图形链接

将鼠标悬停在任意图形上，出现 **✎** 按钮。点击可以为图形添加或修改链接（vault 笔记或外部 URL）。点击图形本身可跳转链接（具体按键取决于「点击行为」设置）。

---

## 深色模式

Obsidian 切换深色主题时，查看器自动适配，无需任何配置。

---

## 设置项

| 设置 | 说明 |
|------|------|
| **缩放修饰键** | 普通滚轮或 Ctrl+滚轮缩放 |
| **点击行为** | 单击还是 Ctrl+单击跟随图形链接 |
| **自定义图形库目录** | 存放自定义图形文件的 vault 目录 |
| **Shape Libraries** | 下载官方图形库，支持从 vault 自动检测 |

---

## 安装

### 社区插件市场（推荐）

1. **设置 → 社区插件 → 浏览**
2. 搜索 **draw.io view** → 安装 → 启用

### 手动安装

从[最新 Release](https://github.com/SdKay/obsidian-drawio-view/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`，复制到 `<vault>/.obsidian/plugins/drawio-view/`。

---

## 已知限制

- draw.io 的部分表格或特殊图形可能无法完整渲染。
- 不支持 `![[file.drawio]]` 嵌入语法，请使用代码块方式。
- 在实时预览模式下退出代码块编辑器时，页面可能轻微上移（正在调查中）。

---

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=SdKay/obsidian-drawio-view&type=Date)](https://star-history.com/#SdKay/obsidian-drawio-view&Date)

---

## 许可证

[MIT](LICENSE) © 2026 [sdking.xing](https://github.com/SdKay)
