# 工具箱原型 · 架构导航图

> 原型已从单文件拆为 4 个文件，职责如下：
>
> | 文件 | 行数 | 职责 |
> |---|---|---|
> | [toolbox-proto.html](toolbox-proto.html) | ~96 | **演示页壳**：模拟后台页面 HTML（导航/表格/表单/弹窗/客服浮窗），引另外三个文件 |
> | [demo.css](demo.css) | ~59 | **演示页样式**：双主题变量、`body.locked`、演示控制条等（不属于工具箱） |
> | [demo.js](demo.js) | ~43 | **演示页脚本**：页面标记（`__APP_VERSION__`、假 React fiber）+ 演示控制条逻辑（不属于工具箱） |
> | [toolbox.js](toolbox.js) | ~1236 | **工具箱本体**：IIFE，全部 Widget DOM 挂在 `#ba-toolbox-host` 的 Shadow Root，与页面样式隔离 |
>
> 假第三方 SDK（google-analytics / example-cdn 的 `<script src>`）在 HTML 壳 92–93 行，供「SDK 盘点」检出。

## 交付通道模型（发给 LLM 类的依据）

页面侧产物只有两种交付方式，不是「命令」：

| 通道 | 含义 | 落地方式 |
|---|---|---|
| **复制** | 结果进剪贴板，人工粘贴进 LLM 对话 | `copyText()`（toolbox.js 14–23） |
| **存储** | 写入浏览器变量 / `localStorage`，LLM 经 broker 自取 | `window.__BA_*` + `localStorage`；LLM 用 `eval` / `storage` 动作读取（见 README） |

能跑起来的脚本 / 指令（Playwright、油猴、爬虫、录制步骤）归入独立的 **开发产物 build** 分类。

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

## 二、工具箱（toolbox.js，IIFE）

### ① Shadow 样式（72–197）

- `WCSS` 模板字符串（73–185）：FAB / 面板(212px) / Popover(332px) / 详情浮层 `.dpop`（复用 `.pop`）/ 功能行 / 分组标题 / 撤销栈 / toast / 拾取器 / reduced-motion
- 187–188 注入 `<style>` 进 Shadow Root

### ② 基础设施（14–553）

| 行 | 区块 | 说明 |
|---|---|---|
| 14–23 | 基础工具 | `$`/`$$`/`sq`/`sqa`、`el`/`esc`/`clamp`/`copyText` |
| 24–62 | 图标 | `ICONS` 内联 SVG + `I(name,size)` |
| 63–71 | 状态与挂载 | `state`、`#ba-toolbox-host`（z-index 2147483646）+ `attachShadow` |
| 199–256 | DOM 构建 | `CATS` 五分类（llm 带 `groups`）→ `fab`/`panel`/`pop`（纯列表）/`dpop`（详情浮层）/`undoPill`/`toast`/引导气泡 |
| 257–290 | 布局 | `layout()`（面板锚 FAB）、`layoutPop()`（列表浮层 + 末尾联动 `layoutDpop`）、`layoutDpop()`（详情浮层贴 pop 左侧，空间不足翻右侧，顶边对齐） |
| 291–307 | 开合 | `openPanel` / `closePanel`（连带收 dpop）/ `togglePanel` |
| 308–352 | Popover | `openPop`（切分类时 `closeDetail`）/ `closePop` / `scheduleClose`（240ms）/ `renderList`（按 `groups` 渲染子组 + 高级折叠）/ `featRows` / `featRow` |
| 353–380 | 详情（第三层） | `clearDetail`（定时器/监听/观察器统一清理）、`openDetail`（渲染进 dpop，点其他行原位切换）、`closeDetail`、`#dpop-x` 关闭 |
| 382–406 | 结果组件 | `codeBox`(带复制) / `kv` / `note` / `btn` / `badge` / `scoreBadge` / `toast` |
| 407–412 | 撤销栈 | `pushUndo` / `refreshUndo` / 单步 / 全部恢复 |
| 413–464 | 选择器 | `cssPath` / `bestSelector`（id→data-testid→aria-label→name→cssPath）/ `SCORE_RULES` / `scoreSelector` / `xpathOf` |
| 465–496 | 拾取器 | `pick()`（Promise，Esc 取消）/ `ensurePicked()` |
| 497–512 | 网络拦截 | 包装 `window.fetch` 记录 method/status/耗时 → `NET` |
| 513–553 | 通用实现 | `detectStack` / `REDACT`+`redact` / `skeleton` / `maxDepth` / `flashEl` / `pageStyle`+`STYLE` |

### ③ 功能注册表 FEATS（554–1136，34 项）

**提示 info（556–650）**

| 行 | id | 功能 | 级 |
|---|---|---|---|
| 557 | `stack` | 技术栈指纹 | ★★★ |
| 567 | `env` | 环境判定 | ★★ |
| 579 | `health` | 页面健康度 | ★★ |
| 594 | `forms` | 表单字段总览 | ★★★ |
| 616 | `net` | 接口清单（轮询渲染 `detailTimer`） | ★★★ |
| 635 | `sdk` | 第三方 SDK 盘点 | ★ |

**查找 find（651–835）**

| 行 | id | 功能 | 级 |
|---|---|---|---|
| 651 | `picker` | 元素拾取器（CSS/XPath/Playwright/Puppeteer 四标签） | ★★★ |
| 679 | `selrank` | Selector 稳定性评分 | ★★★ |
| 690 | `textsearch` | 按文本搜索（命中跳转 + 闪烁） | ★★★ |
| 714 | `eventlook` | 事件反查（React `__reactProps$`） | ★★★ |
| 730 | `compname` | 组件名定位（fiber / Vue 实例） | ★★★ |
| 746 | `tablex` | 表格提取（JSON/CSV，默认 `#orders`） | ★★ |
| 787 | `globalsearch` | 全局数据搜索 | ★★ 高级 |
| 806 | `shadowdom` | Shadow DOM 穿透（说明卡） | ★★ 高级 |
| 822 | `zindex` | 层叠与遮挡分析 | ★ 高级 |

**样式与屏蔽 style（836–961）**

| 行 | id | 功能 | 级 |
|---|---|---|---|
| 836 | `hideEl` | 隐藏元素（拾取 + 撤销栈） | ★★★ |
| 849 | `rmfixed` | 移除 fixed 浮层 | ★★★ |
| 863 | `unlockScroll` | 解除滚动锁 | ★★★ |
| 881 | `noanim` | 停用全部动画 | ★★ |
| 889 | `unlockInput` | 解除输入限制 | ★★ |
| 910 | `plainpwd` | 密码明文切换 | ★★ |
| 919 | `selrestore` | 恢复可选/右键 | ★ |
| 933 | `outline` | 元素描边 | ★ |
| 942 | `flash` | 变更闪烁（MutationObserver） | ★★ |

**发给 LLM llm（962–1069，copy / store 子组）**

| 行 | id | grp | 功能 | 级 |
|---|---|---|---|---|
| 962 | `skeleton` | copy | 一键复制精简 DOM | ★★★ |
| 974 | `redact` | copy | 数据脱敏 | ★★★ |
| 986 | `elqa` | copy | 选中元素问答 | ★★★ |
| 1004 | `storectx` | store | 存入页面上下文（`__BA_CTX__` + `localStorage["ba:ctx"]`） | ★★★ |
| 1030 | `storeel` | store | 存入选中元素（`__BA_EL__`） | ★★ |
| 1047 | `a11y` | copy | a11y 修复建议 | ★ 高级 |

**开发产物 build（1070–1133）**

| 行 | id | 功能 | 级 |
|---|---|---|---|
| 1070 | `pwcode` | 生成 Playwright 代码 | ★★★ |
| 1088 | `userscript` | 生成油猴脚本骨架 | ★★★ |
| 1106 | `crawler` | 爬虫代码生成（Python） | ★★ |
| 1123 | `record` | 操作录制 → 步骤（演示数据） | ★★ |

### ④ 收尾（1134–1236）

| 行 | 区块 | 说明 |
|---|---|---|
| 1134–1136 | `FEATS_BY_ID` 索引 + 分类计数回填 | |
| 1138–1154 | `openAbout` 关于原型说明卡 | |
| 1155–1214 | 事件绑定 | FAB / 分类 / Popover hover / 拖拽吸边（5px 阈值，`ba-tbx-pos` 记忆）/ 热键 `Alt+Shift+D` |
| 1215–1226 | Esc 分级返回 | 详情浮层 → 列表 Popover → 面板 |
| 1227–1233 | 外点收起 | document 捕获 pointerdown |
| 1235 | 首次引导隐藏 coach | |

## 改动热点速查

| 想改什么 | 去哪 |
|---|---|
| 演示页样式 / 场景 | demo.css、demo.js |
| 面板宽度 / 分类布局 | toolbox.js `WCSS` 中 `.panel` / `.cats`（73–185） |
| 新增 / 调整分类 | `CATS`（200–212）；带子组给分类加 `groups:[{id,name}]` |
| 新增功能 | `FEATS` 对应分类插 `{id, cat, name, icon, star, desc, run}`；LLM 类加 `grp:'copy'|'store'` |
| 详情浮层定位 / 三层联动 | `layoutPop` / `layoutDpop`（257–290）、`openDetail`/`closeDetail`（353–380） |
| 复制 / 存储通道 | `copyText`（14–23）；存储功能写 `window.__BA_*` + `localStorage` |
| 快捷键 | 1215–1226 |
| 位置记忆 | 1191–1214；落扩展换 `chrome.storage` |
| 撤销栈 | 407–412 + 各功能的 `pushUndo` |
| 白名单门控演示 | demo.js `d-wl`（15–20）；真实门控在扩展版做 |
