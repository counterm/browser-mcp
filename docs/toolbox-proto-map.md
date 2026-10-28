# 工具箱原型 · 架构导航图

> 原型为**零构建多文件模块**：演示页 3 个文件 + 工具箱本体 `toolbox/` 12 个文件。
> 全部是普通 `<script>`，共享命名空间 `window.BATB`（不用 ES module，file:// 可直接打开）。
>
> **扩展落地版**：同一套模块已落入 [chrome-extension/toolbox/](../chrome-extension/toolbox/)，
> 由 background.js 按白名单经 `chrome.scripting` 注入页面主世界（MAIN）；
> 本目录保留为设计原型与演示页，两处模块结构保持一致，改动请两边同步。
> **⚠️ 落地版扩展（原型未含）**：`toolbox/qr.js`（二维码生成）、`toolbox/feats/capture.js`（「采集」分类）与
> `chrome-extension/capture-main.js`（页面捕获层，非 toolbox 模块——`document_start` 注入 MAIN world 包裹
> fetch/XHR 抓请求体/响应体，与 background webRequest 头记录合并，供「接口调用」工具与 `netlog` 协议共用，
> 见 [spec-net-protocol.md](spec-net-protocol.md)）——依赖扩展桥/扩展后台，原型演示页不可用。
>
> | 文件 | 行数 | 职责 |
> |---|---|---|
> | [toolbox-proto.html](toolbox-proto.html) | ~110 | **演示页壳**：模拟后台页面 HTML + 按序引入 12 个工具箱模块（97–108 行） |
> | [demo.css](demo.css) | ~59 | **演示页样式**（不属于工具箱） |
> | [demo.js](demo.js) | ~43 | **演示页脚本**（不属于工具箱） |
> | [toolbox/](toolbox/) | 12 个文件 | **工具箱本体**：Widget DOM 全挂在 `#ba-toolbox-host` 的 Shadow Root，与页面样式隔离 |

假第三方 SDK（google-analytics / example-cdn 的 `<script src>`）在 HTML 壳 92–93 行，供「SDK 盘点」检出。

## 模块加载顺序（HTML 97–108，顺序勿动）

```
core → cats → widgets → ui → picker → helpers → feats/{info,find,style,llm,build} → boot
（扩展落地版在 helpers 之后插入 qr.js，feats 末尾多一个 capture.js）
```

后加载的模块可解构引用先加载模块导出的东西；跨模块调用一律走 `B.*`（运行时取值，晚绑定安全）。

## 交付通道模型（发给 LLM 类的依据）

页面侧产物只有两种交付方式，不是「命令」：

| 通道 | 含义 | 落地方式 |
|---|---|---|
| **复制** | 结果进剪贴板，人工粘贴进 LLM 对话 | `copyText()`（widgets.js，经 `B.u.copyText`） |
| **存储** | 写入浏览器变量 / `localStorage`，LLM 经 broker 自取 | `window.__BA_*` + `localStorage`；LLM 用 `eval` / `storage` 动作读取（见 README） |

能跑起来的脚本 / 指令（Playwright、油猴、爬虫、录制步骤）归入独立的 **开发产物 build** 分类。

## 中英双语（i18n）

默认中文，面板底部「EN / 中文」一键切换，偏好存 `localStorage["ba:tbx-lang"]`（`en` / 缺省为中文）。

| 位置 | 约定 |
|---|---|
| `core.js` | `B.t(中文, 英文)` 取当前语言；`B.setLang()` / `B.toggleLang()` 切换并持久化；`B.onLang(fn)` 注册重绘回调 |
| `cats.js` | 分类补 `en:{ name, desc }`；子组补 `en:{ name }` |
| `feats/*.js` | 功能对象补 `en:{ name, desc }`；界面文案一律 `t('中文','English')`，动态值写成 `t('中文 ' + x, 'English ' + x)` |
| `ui.js` | `B.ui.applyLang()` 重绘面板（含分类计数）、列表、关于页、撤销条，并收起三级详情（详情内容由功能脚本按当时语言生成） |
| `boot.js` | `B.rebindLang()` 只重绑被重绘的头部按钮与分类按钮；**不要**在语言切换时调 `B.rebind()`，否则 FAB / Popover 会重复叠加监听 |

新增功能时中文为主语言（`t()` 第一参数），英文放第二参数且不得夹中文；代码注释保持中文。

## 一、演示页（toolbox-proto.html + demo.css + demo.js）

| 位置 | 区块 | 说明 |
|---|---|---|
| html 12–18 | `#nav` 固定导航 | 「移除 fixed 浮层」演示物 |
| html 20–26 | `.demo-bar` | 演示控制条：白名单 / 锁滚动 / 固定导航 / 主题 |
| html 28 | `<main data-reactroot>` | `data-reactroot` 标记 → 技术栈指纹可检出 |
| html 45–57 | `#orders` 表格 | 表格提取 / 爬虫生成 / 存入上下文的数据源 |
| html 59–68 | `#form-demo` 表单区 | maxlength/readonly/disabled/password/备注含敏感信息 |
| html 70–76 | `#no-copy` + `.pulse` | 禁选中禁右键、常驻动画演示物 |
| html 79–87 | `#modal`、`#fake-chat` | 滚动锁演示、fixed 客服浮窗演示物 |
| demo.js 5–12 | 页面标记 | `__APP_VERSION__`、假 React fiber/props |
| demo.js 14–41 | 演示控制逻辑 | 白名单开关直接 `display:none` 整个 host（真实门控落扩展版做） |

## 二、工具箱（docs/toolbox/，共享命名空间 window.BATB）

### 模块一览

| 模块 | 行数 | 职责 | 导出 |
|---|---|---|---|
| [core.js](toolbox/core.js) | ~252 | 命名空间、基础工具、图标、语言切换（`B.t` / `B.setLang`）、状态与 `#ba-toolbox-host` 挂载 + 宿主自愈（文档被整块重写后自动挂回）、Shadow 样式 `WCSS`、页面注入样式、功能注册器。**必须最先加载** | `B.u` `$/$$/el/esc/clamp/copyText/sq/sqa`、`B.I/B.ICONS`、`B.t/B.lang/B.setLang/B.toggleLang/B.onLang`、`B.state`、`B.host/B.shadow`、`B.style` pageStyle+STYLE、`B.register` |
| [cats.js](toolbox/cats.js) | ~15 | 分类定义：原型五分类（llm 带 copy/store 子组），扩展落地版另有 capture「采集」 | `B.CATS` |
| [widgets.js](toolbox/widgets.js) | ~38 | 结果组件 + toast（自带 DOM） | `B.w` codeBox/kv/note/btn/badge/scoreBadge/toast |
| [ui.js](toolbox/ui.js) | ~225 | FAB/面板/Popover/详情浮层（dpop）DOM、三层布局与联动、开合、列表渲染、详情生命周期、撤销栈、关于页、语言切换重绘 `applyLang()`；静态节点事件收在 `bindStatic()`（可重绑） | `B.ui`（fab/panel/pop/dpop、layout*、open/close 系列、renderList、pushUndo、bindStatic、applyLang、detailTimer…） |
| [picker.js](toolbox/picker.js) | ~94 | 选择器工具 + 元素拾取器 | `B.sel` cssPath/bestSelector/SCORE_RULES/scoreSelector/xpathOf、`B.pick`、`B.ensurePicked` |
| [helpers.js](toolbox/helpers.js) | ~61 | fetch 拦截（接口清单数据源）+ 通用实现 | `B.NET`、`B.detectStack/B.REDACT/B.redact/B.skeleton/B.maxDepth/B.flashEl` |
| [boot.js](toolbox/boot.js) | ~113 | 收尾：`FEATS_BY_ID` 索引、分类计数回填、全部事件绑定（FAB/分类/hover/拖拽吸边/位置记忆/热键/Esc 分级返回/外点收起），绑定收在 `bindUi()` 并导出 `B.rebind`（文档被重写清空监听后由 core.js 调用来重绑）与 `B.rebindLang`（仅重绑语言切换时重绘的头部/分类按钮）。**必须最后加载** | `B.rebind`、`B.rebindLang` |
| [qr.js](../chrome-extension/toolbox/qr.js) | ~250 | 〔仅扩展版〕二维码生成：qrcode-generator 1.4.4（MIT）裁剪，Byte 模式 UTF-8 + 自动版本，canvas 自绘矩阵 | `B.QR` / `B.QR.make(text)` |
| [feats/capture.js](../chrome-extension/toolbox/feats/capture.js) | ~420 | 〔仅扩展版〕「采集」分类：网址二维码 / 整页截图 / 容器截图（扩展桥逐屏 captureVisibleTab 拼接下载）/ 接口调用（读 `__BATB_NET__` + 扩展桥合并） | — |

### 功能注册表 FEATS（原型 32 项，扩展落地版 36 项，按分类一文件）

追加功能：打开对应分类文件，往 `B.register([...])` 数组插 `{id, cat, name, icon, star, desc, run}` 对象即可；llm 分类加 `grp:'copy'|'store'`，高级功能加 `adv:true`。

**feats/info.js（提示，5 项）**

| id | 功能 | 级 |
|---|---|---|
| `stack` | 技术栈指纹 | ★★★ |
| `env` | 环境判定 | ★★ |
| `health` | 页面健康度 | ★★ |
| `net` | 接口清单（轮询写 `B.ui.detailTimer`，clearDetail 统一清理） | ★★★ |
| `sdk` | 第三方 SDK 盘点 | ★ |

**feats/find.js（查找，6 项，末 3 项高级）**

| id | 功能 | 级 |
|---|---|---|
| `picker` | 元素拾取器（CSS/XPath/Playwright/Puppeteer 四标签 + 复制路径 + React/Vue 事件 handler） | ★★★ |
| `compname` | 组件名定位（fiber / Vue 实例） | ★★★ |
| `tablex` | 表格提取（JSON/CSV，默认 `#orders`） | ★★ |
| `globalsearch` | 全局数据搜索 | ★★ 高级 |
| `shadowdom` | Shadow DOM 穿透（说明卡） | ★★ 高级 |
| `zindex` | 层叠与遮挡分析 | ★ 高级 |

**feats/style.js（样式与屏蔽，9 项）**

| id | 功能 | 级 |
|---|---|---|
| `hideEl` | 隐藏元素（拾取 + 撤销栈） | ★★★ |
| `rmfixed` | 移除 fixed 浮层 | ★★★ |
| `unlockScroll` | 解除滚动锁 | ★★★ |
| `noanim` | 停用全部动画 | ★★ |
| `unlockInput` | 解除输入限制 | ★★ |
| `plainpwd` | 密码明文切换 | ★★ |
| `selrestore` | 恢复可选/右键 | ★ |
| `outline` | 元素描边 | ★ |
| `flash` | 变更闪烁（MutationObserver） | ★★ |

**feats/llm.js（发给 LLM，7 项，copy / store 子组）**

| id | grp | 功能 | 级 |
|---|---|---|---|
| `skeleton` | copy | 一键复制精简 DOM（Pug 缩进树，`B.pugDom`） | ★★★ |
| `redact` | copy | 数据脱敏 | ★★★ |
| `elqa` | copy | 选中元素问答 | ★★★ |
| `storectx` | store | 存入页面上下文（`__BA_CTX__` + `localStorage["ba:ctx"]`） | ★★★ |
| `storeel` | store | 存入选中元素（`__BA_EL__`） | ★★ |
| `marker` | store | 复制页桥标记（网页 id，扩展接入时用 JS 生成 → `chrome.storage.session` → broker `GET /mark/<id>`）；另有「MCP 提示页面」按钮，复制面向通用 MCP 工具的页面交接提示词 | ★★★ |
| `a11y` | copy | a11y 修复建议 | ★ 高级 |

**feats/build.js（开发产物，5 项）**

| id | 功能 | 级 |
|---|---|---|
| `pwcode` | 生成 Playwright 代码 | ★★★ |
| `userscript` | 生成油猴脚本骨架 | ★★★ |
| `crawler` | 爬虫代码生成（Python） | ★★ |
| `record` | 操作录制 → 步骤（演示数据） | ★★ |
| `formkit` | 表单保存与填充（按站点存 `localStorage["ba:formkit"]` 回填 + 随机假数据填充，密码字段跳过；「复制」导出 JSON、「粘贴」按导出内容填充） | ★★★ |

**feats/capture.js（采集，4 项）**〔仅扩展版，原型未含〕

| id | 功能 | 级 |
|---|---|---|
| `qr` | 网址二维码（qr.js 纯本地生成，下载 PNG / 复制链接） | ★★ |
| `fullshot` | 整页截图（扩展桥 `batb:bridge` → content.js → background `captureVisibleTab`，逐屏滚动截取拼接，自动下载 PNG；截图期间自动隐藏 fixed、取消 sticky 吸附避免每屏重复，完成后还原） | ★★★ |
| `elshot` | 容器截图（拾取元素向上找最近可滚动祖先，仅容器内部滚动逐屏截取、按可视矩形裁剪拼接；同样自动处理 fixed/sticky；无可滚动祖先退化为区域截图） | ★★★ |
| `apinet` | 接口调用（双层捕获：`capture-main.js` hook fetch/XHR 抓请求/响应体 + background webRequest 抓全量请求头含 Cookie/Authorization，按 URL+时间 consume-once 合并；列表→详情，复制调试文本 / cURL，默认脱敏可关；LLM 经 `netlog` 命令查询同一数据，见 [spec-net-protocol.md](spec-net-protocol.md)） | ★★★ |

### ui.js 内部要点（三层弹窗联动）

- 布局：`layout()`（面板锚 FAB）→ `layoutPop()`（列表浮层 + 末尾联动 `layoutDpop`）→ `layoutDpop()`（详情浮层贴 pop 左侧，空间不足翻右侧，顶边对齐）；ResizeObserver 监听 pop/dpop 尺寸变化自动重算
- 开合：`openPanel` / `closePanel`（连带收 dpop）/ `togglePanel`；`openPop`（切分类时 `closeDetail`）/ `closePop` / `scheduleClose`（240ms）/ `cancelClose`
- 详情：`clearDetail`（detailTimer / cleanups / flashObs / selHandler 统一清理）→ `openDetail`（渲染进 dpop，点其他行原位切换）→ `closeDetail`
- 撤销栈：`pushUndo` / `refreshUndo` / 单步 / 全部恢复（undoPill）
- Esc 分级返回在 boot.js：详情浮层 → 列表 Popover → 面板

## 改动热点速查

| 想改什么 | 去哪 |
|---|---|
| 演示页样式 / 场景 | demo.css、demo.js |
| 面板宽度 / 分类布局 | core.js `WCSS` 中 `.panel` / `.cats` |
| 新增 / 调整分类 | cats.js 加一项 + 新建 `feats/<id>.js` + HTML 加一个 `<script>`（boot 之前任意位置） |
| 新增 / 删除功能 | 打开 `feats/<分类>.js`，在 `B.register([...])` 数组里插/删对象；删除后无需改其他文件 |
| 新增图标 | core.js `B.ICONS` 加一条 |
| 详情浮层定位 / 三层联动 | ui.js `layoutPop` / `layoutDpop`、`openDetail`/`closeDetail` |
| 结果组件（卡片样式） | widgets.js |
| 复制 / 存储通道 | `B.u.copyText`（core.js）；存储功能写 `window.__BA_*` + `localStorage` |
| 快捷键 / Esc / 外点收起 | boot.js 末三段 |
| 位置记忆 / 拖拽 | boot.js；扩展版仍用 localStorage（按站点记忆） |
| 撤销栈 | ui.js `pushUndo`/`refreshUndo` + 各功能的 `pushUndo` 调用 |
| 白名单门控 | 演示：demo.js `d-wl`；扩展版：background.js `syncToolbox`（注入/隐藏）+ core.js 监听 `batb:gate` |
| 宿主挂载 / 自愈（宿主被摘 + 监听被清空） | core.js `mount`/`bindCore`/`onProbe`（1s 轮询：宿主脱离文档即挂回；`batb:probe` 同步自检监听，被清空则重绑 core 并调 `B.rebind`）+ boot.js `bindUi`、ui.js `bindStatic` |
| 防重复注入 | core.js 开头 `if(window.BATB) return`；扩展版各模块另有自身导出守卫 + `B.register` 按 id 去重 |
