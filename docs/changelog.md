# Changelog

格式参照 [Keep a Changelog](https://keepachangelog.com/)，按日期倒序记录。

## 2026-10-21 · 表单工具调整：移除「表单字段总览」，新增「表单保存与填充」

- **移除** `feats/info.js` 的 `forms`（表单字段总览）——功能由新的表单保存/填充取代，功能数 34→33（原型）/ 36→35（落地），README 与 proto-map 计数同步
- **新增** `feats/build.js` 的 `formkit`（表单保存与填充）：
  - **保存 / 回填**：按站点存 `localStorage["ba:formkit"]`（密码字段出于安全不入库），回填时 selector 匹配 + 字段顺序兜底（页面结构变化仍可用），select 按值/文本匹配选项；带「清除」
  - **随机填充**：按 name / id / placeholder / label / autocomplete 猜字段语义——邮箱 / 手机号 / 邮编 / 验证码 / 身份证给格式化假数据，姓名给中文随机名，省市地址给地区名，下拉框随机选非占位项，其余填随机字母；尊重 maxlength，跳过 hidden / 提交类 / 文件 / 勾选类与禁用只读字段
  - 填充走原生 setter + `input`/`change` 事件（兼容 React / Vue 受控组件），并压入撤销栈（undoPill 一键恢复）
- core.js 新增 `save` 图标；原型 `docs/toolbox/` 两文件同步

## 2026-10-21 · 「采集」分类代码审查修复

- **修复整页截图致命缺陷**：background `tb:shot` 返回 `{ok, dataUrl}`，而扩展桥协议（content.js respond）只透传 `data` 字段，`dataUrl` 永远到不了页面侧 → fullshot 必然失败；改为 `sendResponse({ ok: true, data: { dataUrl } })`，与桥协议对齐（双人交叉验证确认）
- `tb:shot` 直接用 `sender.tab.windowId`，省去一次 `chrome.tabs.get` IPC
- 整页截图文件名时间戳由 UTC（`toISOString`）改为本地时间
- 清理 `feats/capture.js` 未使用的 `btn` 解构；改动文件 `node --check` 通过

## 2026-10-21 · 工具箱新增「采集」分类：网址二维码 / 整页截图

- **新增分类 `capture`（采集）**：五分类 → 六分类，共 36 项功能（`cats.js` / `core.js` 图标 / `ui.js` 关于页同步）
- **网址二维码**（`feats/capture.js` + 新模块 `toolbox/qr.js`）：当前网址纯本地生成二维码，扫码在手机打开；可下载 PNG / 复制链接。`qr.js` 内嵌 [qrcode-generator@1.4.4](https://github.com/kazuhikoarase/qrcode-generator)（MIT）裁剪版——仅保留 Byte 模式（UTF-8）+ 自动版本 1-40，GIF/SVG/Kanji 等渲染与模式移除，工具箱用 canvas 自绘模块矩阵；jsQR 闭环测试通过（含 v40 容量边界与多字节 URL）
- **整页截图**：滚动逐屏截取 → 按 `devicePixelRatio` 拼接长图 → 自动下载 PNG；截图期间自动隐藏工具箱与页面滚动条，按实际 scrollY 定位每屏避免累积错位，页面高度超 32767px 截断提示，完成后展示预览；约 620ms/屏并带限额退避重试（规避 `captureVisibleTab` 每秒调用限制）
- **扩展桥**（content.js ↔ background.js）：工具箱在页面主世界收不到扩展消息，新增单次请求/响应通道——DOM 事件 `batb:bridge`（MAIN→ISOLATED）→ `chrome.runtime.sendMessage`（`tb:shot` → `captureVisibleTab`）→ `batb:bridge:res` 回传；扩展更新后旧 content.js 无桥时报错并提示刷新页面
- `background.js` TOOLBOX_FILES 注入清单加入 `qr.js` / `feats/capture.js`（现 14 个模块）；README、`docs/toolbox-proto-map.md` 同步（标注两项为扩展版专属，原型未含）

## 2026-10-21 · 工具箱落地 Chrome 扩展（5f04756）

- **新增 `chrome-extension/toolbox/`**：`docs/toolbox/` 原型 12 个模块落成扩展真实实现（core → cats → widgets → ui → picker → helpers → feats/{info,find,style,llm,build} → boot），五分类 34 项功能
- **白名单门控注入**（background.js）：页面命中白名单后经 `chrome.scripting` 注入**页面主世界**（MAIN world）——React fiber 反查、fetch 拦截、`window.__BA_*` 需在页面上下文才可见，且不受页面 CSP 限制
- **门控即时生效**：白名单配置变更后经 DOM 事件 `batb:gate` 同步已注入页面的显隐（移出即隐藏、重新命中自动恢复）；触发点覆盖标签页 complete / SPA 路由变化 / 配置变更 / 扩展重载后的存量页面
- **防重复注入**：各模块自身导出守卫 + `B.register` 按 id 去重（SW 重启重复执行不会出双 FAB、重复功能项、二次包裹 fetch）
- **原型 → 生产的适配**：移除演示页痕迹（接口清单种子数据、`#orders` 默认表格改为首个 `<table>`、演示页专属提示语改通用表述）；修正 store 通道提示（`storage` 动作参数与 content.js 签名对齐，`window.__BA_*` 仅页面主世界可见，跨进程读取以 `storage` 动作为主）
- manifest.json 新增 `scripting` 权限；README 增补「页面工具箱」章节与故障排查；原型地图标注扩展落地版位置

## 2026-10-20 · 工具箱原型模块化（544881d…d836acf）

- **新增 `docs/toolbox/` 设计原型**：零构建多文件模块（12 个 `<script>`，共享命名空间 `window.BATB`，file:// 可直接打开）+ 演示页三件套（`toolbox-proto.html` / `demo.css` / `demo.js`）
- **三层弹窗结构**：FAB → 分类面板 → hover Popover 功能列表 → 侧边详情浮层（dpop 与列表并排错开、ResizeObserver 自适应、Esc 分级返回）
- **交付通道模型确立**：「发给 LLM」拆成复制（剪贴板）与存储（`window.__BA_*` + `localStorage`）两条通道；能跑的脚本归入「开发产物」分类
- 模块地图见 `docs/toolbox-proto-map.md`

## 2026-10-19 · 项目初始化与站点白名单（bb5efff…0cc7acc）

- **init**：broker.py（本地注册/广播/转发中心，唯一常驻进程）+ 油猴脚本接入端（`page-bridge.user.js`）+ `cli_client.py` 编排示例（snapshot → LLM 决策 → POST /call 循环）
- **Chrome 扩展接入端（方案 A，MV3）**：background 维持每标签页 WS、命令路由（DOM 动作 → content.js 17 种动作；截图/标签管理 → SW 直执行）、userScripts 通道绕页面 CSP 执行 eval
- **站点白名单**：纯白名单模式（域名自动覆盖子域名 + 正则规则），popup 一键加入/移出、options 管理页（增删改查/导入导出/正则测试）、配置改动即时生效
- **接入总开关**：popup/options 右上角启用开关，优先级高于一切规则；关闭即断开全部页面且不注册，重开自动恢复
