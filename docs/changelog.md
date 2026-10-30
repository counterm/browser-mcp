# Changelog

格式参照 [Keep a Changelog](https://keepachangelog.com/)，按日期倒序记录。

## 2026-10-29 · feat: YAML 测试流（flow）编排扩展——子流程与数据驱动

- `broker.py`：
  - 子流程：新增编排动作 `do: flow {name, vars?}`——从库加载另一个 flow 校验后递归执行（同一目标页），报告该步嵌套子步骤（steps）与汇总（passed/total）；嵌套 ≤5 层、禁止循环引用（调用链写进失败原因），支持与 expect / retry / on_fail 组合；`vars` 先按父流程变量展开再覆盖子流程自身 vars
  - 数据驱动：flow 级 `data`（内联列表，≤200 组、值须标量）或 `data_file`（相对 flows/ 目录解析，.json 对象数组 / .csv 首行表头，utf-8-sig 兼容；校验时即归一化为 doc.data），每组数据完整跑一遍全部步骤——组间互不影响（组内仍遵循 stop_on_fail / on_fail）；报告新增 `data_rows / passed_rows / failed_rows / rows` 汇总，步骤条目带 `row` 标记；console 轨迹每组一条 `▶ 数据组 i/N`（不回显组值）；异步进度 steps_total 按 步×组 计
- `chrome-extension/toolbox/feats/build.js` + `docs/toolbox/feats/build.js`（两树同步）：报告渲染补数据组汇总行
- `cli_client.py`：输出补数据组汇总行
- 文档：`docs/spec-flow.md` 新增「子流程与数据驱动」「定时回归」（CLI + 计划任务 / Trae schedule 技能，无内置调度器）章节，do 表 / 字段表 / 分期状态更新；README 中英 flow 行更新
- 验证：`py_compile` + `node --check` 全过；8770 端口假页面 E2E——`do: flow` 子流程嵌套执行（子步骤 1、子汇总 1/1、vars 透传）、data 2 组 × 2 步 = 4 条目全带 row 标记且 2/2 组通过（steps_total=4）、`m4-cyc` 自引用被拦截（FAIL + 调用链）、`data` 含非标量值校验 400；测试流程已从库删除，测试进程与产物已清理
- 生效条件：重启 broker（MCP stdio 重连即可）；纯 broker 侧改动，扩展无需重载

## 2026-10-28 · feat: YAML 测试流（flow）M3——异步执行与步骤级重试

- `broker.py`：
  - 异步执行：`flow op=run` 新增 `mode:"async"`（MCP 与 `POST /flows/run` 均可）→ 立即返回 `{run_id, status:"running", steps_total, poll}`，后台 asyncio 任务跑 runner；新增 `op=status {run_id, wait_ms?}`（长轮询上限 60s）与 `GET /flows/status?run_id&wait_ms` 取实时进度（done/passed/failed）与最终报告；runner 每步结束回写 `FLOW_RUNS` 进度；记录存内存，done 超 1h 或总量超 50 由 janitor 清理；公共逻辑抽为 `flow_start_async` / `flow_status`
  - 步骤级重试：`retry`（额外次数，0~10）/ `retry_wait_ms`（间隔 ms，默认 1000，上限 60000），动作报错与断言不过都会重试，变量展开错误不重试，重试过程打 warn 级 console 轨迹，重试成功后报告清掉残留 error；flow_validate 校验数值范围
  - MCP `flow` 工具 schema / 描述同步（新增 mode / run_id / wait_ms 参数与 status op）
- `chrome-extension/background.js`：`tb:flow` 的 `run` 改走 `mode:"async"`，新增 `status`（`GET /flows/status`，wait_ms ≤ 30s 长轮询）
- `chrome-extension/toolbox/feats/build.js` + `docs/toolbox/feats/build.js`（两树同步）：面板「运行」改为「启动 → 轮询进度（N/M 步）→ 渲染报告」，长流不再受单次请求超时限制
- 文档：`docs/spec-flow.md`（retry/retry_wait_ms 字段、status op、/flows/status 端点、M3 落地说明）；README 中英 flow 行与 HTTP 表更新
- 验证：`py_compile` + `node --check` 全过；8770 端口假页面 E2E——`retry:2` 时点击第 3 次成功（尝试 3 次、ms≈431）、async 启动返回 run_id、status@0 为 running、长轮询到 done 且报告 3/3 通过、非法 retry=99 校验 400、未知 run_id 404 / MCP isError；测试进程与产物已清理
- 生效条件：重启 broker（MCP stdio 重连即可）；工具箱运行异步化需重载扩展并刷新页面

## 2026-10-28 · feat: YAML 测试流（flow）M2——工具箱录制器实装与 flow 库桥

- `chrome-extension/toolbox/feats/build.js` + `docs/toolbox/feats/build.js`（两树同步）：mock `record` 实装为「操作录制 → flow」（★2 → ★3 高级，功能总数不变 36/32）
  - 录制引擎（模块级）：capture 阶段 hook click / change / Enter；输入 change（失焦）记录、下拉记 value、勾选框记点击、密码记 `${env.PWD}` + `secret:true`；起始 URL 自动为首条 nav；input/textarea/select 聚焦点击与工具箱自身 DOM 不录；selector 用 `B.sel.bestSelector`，点击步附可见文本作运行时回退定位
  - 面板：flow 名 / 描述、开始/停止/清空、步骤列表（单步删除 + 「⇄变量」把录制值转 `${vars.vN}`）、YAML 实时预览、复制 / 下载 / 保存入库、粘贴 YAML 导入保存（服务端校验）、flow 库列表（运行 / 查看 YAML / 删除）、一键运行并以本页页桥标记为目标页渲染报告；原型树无扩展桥时录制与复制 / 下载可用，库功能给提示
  - 跨页续录：录制会话存 background `chrome.storage.session`（`flowrec:<tabId>`，tab 关闭即清）；工具箱每次注入 `tb:flowrec get` 询问，URL 变了由 background 自动补 nav 步骤
- `chrome-extension/background.js`：新增 `tb:flow`（`brokerFetch` 直连 broker HTTP：list/get/save/delete/run，真相源仍是磁盘 `flows/*.yaml`，无副本）与 `tb:flowrec`（录制会话 get/set/clear，get 时跨页自动补 nav）；`onRemoved` 随 tab 清录制会话
- 文档：`docs/spec-flow.md` M2 落地细节与已知边界（含 BRIDGE_TOKEN 401 说明）；`docs/toolbox-proto-map.md` record 行更新
- 验证：`node --check` 全过（两树 build.js + background.js）；生效需重载扩展并刷新页面
- 待做（M3）：异步执行（run_id + `op=status` 轮询）、步骤级 retry

## 2026-10-28 · feat: YAML 测试流（flow）M1——编排、执行、报告与 console 轨迹

- 新增 **YAML 测试流**：把页面操作序列编排成 YAML（每步唯一 id），broker 逐步执行并汇总报告——代替 Playwright 的轻量路线，不引入 Node，复用 page_call 全部命令；规范见 `docs/spec-flow.md`，示例 `flows/demo-smoke.yaml`
- `broker.py`：
  - flow runner：`do` 白名单（页面 ACTIONS 剔除 ping/snapshot/plog）、`${vars.x}` / `${env.NAME}` 变量展开（未定义即报错）、`secret` 步骤打码、`expect` 断言（url_contains / url_is / text / selector，0.3s 轮询至 `max_wait_ms`）、nav/back/reload 后 0.5s 缓冲、失败自动截图、报告落盘 `.flows/<flow>-<runid>.json`
  - MCP 新工具 `flow`（op=list/get/save/delete/run，风格同 netlog）：save 解析+校验（结构 / id 唯一 / do 白名单 / expect 键 / on_fail 枚举）后按原文落盘 `flows/<名>.yaml`（保留注释）；run 同步执行返回报告 JSON（MCP 等待上限 115s，长流程走 CLI）；initialize instructions 补 flow 一句
  - HTTP 端点：`GET /flows`、`POST /flows/run`、`GET|PUT|DELETE /flow/{name}`（CLI / 后续扩展桥共用）
  - 依赖：`requirements.txt` 加 `pyyaml>=6.0`（缺失时仅 flow 不可用，其余功能不受影响）
- `chrome-extension/content.js`：新增 `log` 动作——派发 `batb:flowlog` DOM 事件（ISOLATED world 的 console 过不了 capture-main 的 hook，plog 抓不到）
- `chrome-extension/capture-main.js`：监听 `batb:flowlog` 在 MAIN world 代打 console（`[flow:名]` 前缀 + 步骤/操作/值/OK/FAIL/耗时，失败为 error 级），DevTools 可见、`page_logs {q:"[flow:"}` 可拉整条轨迹
- `chrome-extension/background.js`：`CONTENT_ACTIONS` 注册 `log`
- `cli_client.py`：`flow` 子命令（`--page / --var k=v / --from-step / --keep-going`），逐步打印 OK/FAIL，退出码 0/1，CI 入口
- 文档：`docs/spec-flow.md`（新）；README / README.en.md 增补 flow 工具表、HTTP 端点、命令表 `log` 行、「YAML 测试流」章节与文件表；`.gitignore` 加 `.flows/`
- 验证：`py_compile` + `node --check` 通过；8770 端口起测试 broker，端点冒烟（list/save/get/校验失败/run 无页面 409/delete/MCP tools 含 flow）与「假页面」E2E（断言、失败自动截图、on_fail: continue、stop_on_fail 中断、报告落盘）全部通过，测试进程已清理
- 生效条件：**重启 broker**（MCP stdio 方式重连即可）；`log` 动作需重载扩展并刷新页面后才有 console 轨迹，未刷新不影响其余功能（回显失败静默跳过）
- 后续：M2 工具箱录制器（实装 mock `record`）+ flow 库桥（background HTTP 直写）；M3 异步执行 + `op=status` 轮询

## 2026-10-28 · 文档：全仓清理「油猴」表述，明确扩展为唯一接入方式

- `broker.py`：模块 docstring 与「没有页面接入」错误提示改为 Chrome 扩展；`/lp/*` 长轮询标注为早期油猴版的兼容保留通道
- `chrome-extension/background.js`：头部注释去掉「与油猴版的差异」对比，改为「扩展是唯一的页面接入方式」；「浏览器级动作（油猴做不到的部分）」改为「页面内脚本做不到的部分」
- `AGENTS.md`：删除「扩展与油猴互斥」旧提示，改为「Chrome 扩展是唯一受支持的页面接入端，user.js 仅存档、勿安装勿投入更新」；`/lp/*` 标注为兼容保留
- `page-bridge.user.js`：文件头加「已停止维护（DEPRECATED）、仅作存档」标注（以 `//` 注释置于 `==UserScript==` 块之前，不破坏元数据解析），@description 同步去掉油猴措辞
- `docs/spec-url-filter.md`：「关联现状」改为回顾式表述（油猴版曾硬编码白名单，本功能产品化落地扩展版）
- 保留不动：changelog 历史条目；工具箱「生成油猴脚本骨架」功能（`feats/build.js` 两套 + `toolbox-proto-map.md`，属面向用户的产品功能，与本项目接入方式无关）
- `node --check` / `py_compile` 通过

## 2026-10-28 · 文档：README 标题改名 Browser MCP，浏览器接入移除油猴方案

- README 标题（中英）「Browser Agent」改为「Browser MCP」
- 「浏览器接入」删除方案 B（油猴脚本）安装步骤，改为仅 Chrome 扩展一条路径；架构图、目录表同步去掉「扩展或油猴」双方案表述
- `page-bridge.user.js` 标记为「已停止维护、仅作存档」，文件保留不删
- 清理正文残留的油猴版对比描述（eval 表格、安全说明、已知边界、故障排查表）；file:// 与「允许用户脚本」两条注意事项并入接入步骤
- README.md 与 README.en.md 同步修改

## 2026-10-28 · 文档：README 以 MCP 为主线重组，扩展安装措辞对齐 Chrome 实际按钮

- README（中英同步）把 broker 明确定位为 **MCP 服务器**：简介与架构图改为「MCP 客户端（IDE / Agent / CLI）」视角，「MCP 接入」升为推荐接入章节并前移，stdio 自动拉起标为推荐方式，配置示例直接引用仓库根目录的 `.mcp.json`（本机生效）与 `.mcp.example.json`（可复制模板），补充 Trae / Claude Desktop 等客户端配置位置说明
- 原「外部怎么接入」章节清理为「HTTP API（不走 MCP 的直接接入）」：定位为 MCP 工具的底层接口，端点表中 `/mcp`、`/sse` 两行并入 MCP 传输表，不再重复
- 文件说明表补 `.mcp.json` / `.mcp.example.json` 两行；快速开始步骤 1 注明「只用 MCP stdio 时可跳过手动启动 broker」
- 扩展安装措辞对齐 Chrome 实际按钮：统一为「**加载未打包的扩展程序**」（Load unpacked）并强调选择本仓库的 `chrome-extension` 目录，替换原「加载已解压的扩展程序」表述

## 2026-10-28 · 文档：扩展安装只保留「加载解压缩的扩展」

- README（中英两份）删除 zip / `.crx` / Chrome Web Store 三种分发方式，改为「扩展安装与更新」：只支持 `chrome://extensions` 开启开发者模式后加载 `chrome-extension` 目录，并写明改代码后需「重新加载」扩展 + 刷新目标页面
- 移除 `build/make-test-key.mjs`（仅服务于 crx 打包）；目录说明表删除 `build/` 行，`.gitignore` 改为整目录忽略 `build/`
- `AGENTS.md` 的扩展命令改为「Load unpacked」流程，并删除「扩展 ID 由私钥决定」的说明
- MCP 部署章节核对无变更：`/mcp`（Streamable HTTP）、`/sse`（旧版 SSE）、`--stdio`（客户端拉起 broker）三种方式，以及 v0.1.16 的工具签名（`page_snapshot` 的 `max`/`text_max`、`page_call` 截图落盘 `{format,path,bytes}`、bid/selector/text 三选一）均已是最新

## 2026-10-28 · page-bridge 编排易用性优化（v0.1.16）

依据 `cipher-registration/docs/e2e/2026-10-28-page-bridge执行记录.md` 的实战反馈优化四个方面：

- **元素定位三选一**：`click` / `type` / `select` / `scroll` / `hover` / `upload` / `highlight` 除 `bid` 外支持 `selector`（CSS）与 `text`（按可见文本匹配，全等优先、包含兜底）——快照没给 bid 的自绘组件（如 el-link 图标壳）也能直接操作。`content.js` 与 `page-bridge.user.js` 同步
- **定位报错可自纠**：`element not found` 报错带上实际尝试的参数（`bid=3 / selector=… / text="…"`），并提示先 snapshot/dom 确认，LLM 能自行重试
- **快照优化**：表单控件显示当前值（el-select 从包装容器读选中文案，不再永远空白；密码框脱敏为 `***`；原生 select 显示 `选中文案 (value=…)`）；无 href 无文本的装饰性 `<a>` 不再进快照；`snapshot` 支持 `max`（元素条数，默认 300）/ `text_max`（正文字符数，默认 6000，0 省略）
- **mark 跨导航稳定**：`background.js` 的 `dropEntry`（导航/刷新 bye）不再清 `mark:<tabId>`，只有 `tabs.onRemoved` 才清——SPA 站点站内跳转后原 mark 依然可用
- **修复 netlog get/curl 不可达**：broker 传输层不再用 `id` 键做命令关联（此前会把 `netlog get {"id":N}` 的参数覆盖掉，永远 record not found），改用保留键 `__mid`，命令没带 id 时补发兼容旧页面端；扩展与油猴侧 `route/onCommand` 相应兼容 `__mid ?? id`
- **MCP 截图落盘**：`page_call` 的 `screenshot` 结果 base64 自动存到 broker 目录 `.screenshots/`，返回 `{format, path, bytes}`，LLM 用 Read 工具直接看图，不再撑爆上下文
- **MCP `page_snapshot` 透传** `max` / `text_max` 参数，工具描述补充用法
- **README 修正**（中英同步）：「允许用户脚本」开关**需重载扩展后生效**（SW 常驻时开关不会实时生效，原「约 5 秒自动生效」说法有误）；排错表补「页面响应超时（后台 tab 冻结，先 tab_activate）」与「element not found（重新 snapshot）」两条；命令表标注三选一定位
- 版本号 0.1.15→0.1.16（manifest / 油猴 / README 首屏同步）；`node --check` 全部通过，`broker.py` py_compile 通过，`save_dataurl` 单测通过；扩展侧需重载扩展并刷新页面，broker 需重启后生效
- **eval userScripts 结果通道改造（Chrome 实测修复）**：原实现依赖 `configureWorld({messaging:true})` + USER_SCRIPT world 内 `runtime.sendMessage` 回传，实测该链路不通且失败在 world 内是黑洞（只能干等 25s 超时后回落撞 CSP）。改为**共享 DOM 属性通道**：eval 结果写 `<html data-ba-eval-<id>>`（USER_SCRIPT world 与内容脚本共享 DOM），SW 轮询 content.js 新增的 `eval_result` 动作取回并清除，不再依赖 world messaging；`execute` 失败时直接报真实错误不再回落；ping 增加 `eval_reason` 诊断（`toggle-off`/`no-api`/`no-execute`），并在 eval 报 CSP 错误时按原因给出指引（Edge 无 userScripts API 会明确提示改用 Chrome——Edge 156 实测有开关 UI 但无 API）。另实测 **USER_SCRIPT world 默认继承页面 CSP**，eval 仍会被拦——`configureWorld` 补 `csp: "script-src 'self' 'unsafe-eval'"`（每次 execute 前确保已配置）后彻底打通

## 2026-10-28 · 工具箱中英双语 + README 英文镜像

- 工具箱新增语言层：`core.js` 提供 `B.t(中文, 英文)` / `B.lang` / `B.setLang()` / `B.toggleLang()` / `B.onLang()`，默认中文，选择存 `localStorage["ba:tbx-lang"]`，刷新后保持
- 面板底部新增「EN / 中文」一键切换按钮（原「关于」链接右侧）；`ui.js` 新增 `applyLang()`，重绘分类面板（含计数）、Popover 列表、关于页、撤销条，切换时收起三级详情避免中英混排
- 分类与全部功能对象补 `en:{ name, desc }`；所有界面文案统一 `t('中文','English')`——分类名/描述、功能名/描述、结果卡片标签、按钮、toast、note、placeholder、生成代码注释、复制到剪贴板的 prompt（含 MCP 交接提示词）、空状态与错误提示
- 各功能模块补 `t = B.t` 别名；`find.js` 内局部变量 `t`（tabs 按钮）与 `llm.js` 的 a11y 循环参数改名，避免遮蔽
- `boot.js` 拆出 `bindHeader()` / `bindCats()`，新增 `B.rebindLang()`：切换语言只重绑被重绘的头部与分类按钮，**不重跑** `B.rebind()`，避免 FAB / Popover 重复叠加监听
- README 改为中英双文件：`README.md` 中文（默认展示）、`README.en.md` 英文，两份均为完整内容，顶部用相对路径互链（`[English](./README.en.md)` / `[简体中文](./README.md)`）；原「单文件文末英文镜像」做法废弃
- `docs/toolbox-proto-map.md` 新增「中英双语（i18n）」约定章节并更新 core/ui/boot 模块导出说明
- 原型 `docs/toolbox/` 与扩展 `chrome-extension/toolbox/` 两套同步修改；`node --check` 全部通过（28 个 JS）；扩展侧需重载扩展并刷新页面后生效

## 2026-10-28 · 版本号提升至 0.1.15

- `chrome-extension/manifest.json` 0.1.2→0.1.15，`page-bridge.user.js` `@version` 0.1.0→0.1.15（两侧同步），README 首屏标注当前版本
- 扩展侧需在 `chrome://extensions` 重新加载；油猴侧需在脚本管理器里更新脚本后生效

## 2026-10-28 · 新增页面日志/异常捕获与 MCP `page_logs`

- `capture-main.js` 新增 MAIN world 日志层 `window.__BATB_LOG__`（`document_start` 先于页面脚本）：hook `console.log/info/warn/error/debug`、`window.error`（含捕获阶段的资源加载失败）、`unhandledrejection`、`securitypolicyviolation`；记录 `id/t/iso/perf/kind/level/text/url/line/col/stack/count`，环形 800 条、单条 2KB、1.5s 内同文本合并计数，序列化有深度 / 键数 / 字符上限，hook 全程 try/catch
- 新增 `batb:logq` / `batb:logq:res` 查询协议：`list` 按 `since` 游标增量返回；`wait_ms>0` 在页面侧长轮询等待新记录（≤20s）；`clear` 清空；`doc` token 标识文档，导航后返回 `navigated:true` 并从 0 开始
- `content.js` 新增 `plog` 动作（同 `netlog` 的 DOM 事件桥），`background.js` 的 `CONTENT_ACTIONS` 白名单加入 `plog`
- MCP 新增 `page_logs` 工具（`page`, `since`, `doc`, `kinds`, `levels`, `q`, `limit`, `text_max`, `wait_ms`, `clear`, `redact`）；`page_call {action:"plog"}` 同样可用
- 日志只在被查询时离开页面，文本默认脱敏（沿用 `redactText` 口径）；仅顶层 frame，油猴版不覆盖，跨域脚本错误仍可能只有 `Script error.`
- `node --check` 通过（capture-main.js / content.js / background.js）；扩展侧需重载扩展并刷新页面后生效

## 2026-10-28 · 精简 DOM 改为 Pug 缩进树，并新增 MCP `dom` 动作

- 工具箱「一键复制精简 DOM」输出由精简 HTML 改为 **Pug 缩进树**：`tag.class#id(attr) 文本`，2 空格缩进；新增 `B.pugDom`（`helpers.js`），保留 id / class（前 3 个）/ name / type / href / src / placeholder / role / aria-label / data-test*，**丢弃 value**；直接文本超 60 字截断；连续同类兄弟 ≥3 折叠为 `×N`（比对签名含 `tag#id.class`，避免把 `#app` 与弹层误判成同类）；默认上限 深度 8 / 1500 节点 / 6 万字符（工具箱放宽到 10 / 4000 / 20 万）；扩展与原型两套同步
- 页桥新增 `dom` 动作（`chrome-extension/content.js` + `page-bridge.user.js`）：参数 `selector / depth / maxNodes / maxChars / collapse / redact`，默认对输出脱敏（手机号 / 身份证 / 邮箱 / token / JWT），返回 `{selector, nodes, chars, truncated, content}`；`background.js` 的 `CONTENT_ACTIONS` 白名单加入 `dom`
- 页桥 `dom` 支持指定元素：新增 `bid` 参数（`selector` 填纯数字也按 bid 解析），只输出该元素及其子孙；工具箱同名功能增加选择器/bid 输入框与「查询」，默认仍为整页
- MCP 侧无需新增工具：`page_call {action:"dom"}` 即用；README 命令表与 MCP 工具说明、`docs/toolbox-proto-map.md` 同步
- `node --check` 通过（content.js / background.js / page-bridge.user.js / 两套 helpers.js / 两套 feats/llm.js）；扩展侧需重载扩展并刷新页面、油猴侧需更新脚本后生效

## 2026-10-28 · 修复 stdio 模式快照含非 GBK 字符导致 broker 崩溃

- 现象：IDE 以 stdio 拉起 broker 后，`list_pages` 正常，但 `page_snapshot` 一旦返回含 emoji 等非 GBK 字符的快照，MCP 连接立即 `Connection closed`，此后所有工具报 `Tool not found`，进程消失、8766 端口只剩 TIME_WAIT
- 原因：stdio 写回沿用 Windows 管道的默认 GBK 编码，`json.dumps(ensure_ascii=False)` 的结果遇不可编码字符时抛 `UnicodeEncodeError`，`mcp_stdio_loop` 没有兜底，异常直接终结进程（同时工具描述里的中文也因此显示为乱码）
- 修复：`main()` 进入 stdio 模式时对专用输出流 `reconfigure(encoding="utf-8", errors="replace", newline="\n")`，与 MCP stdio 协议的 UTF-8 约定对齐
- 验证：脚本按 IDE 方式（stdio + UTF-8）拉起 `broker.py --stdio`，对「工作台 - 密评备案信息系统」做 `page_snapshot`，返回 3148 字节 UTF-8 内容、中文标题正常、进程存活

## 2026-10-28 · broker.py 支持 stdio 传输：MCP 客户端拉起即自动启动 broker

- 新增 `--stdio`（或环境变量 `BRIDGE_MCP_STDIO=1`）：进程内同时跑 aiohttp 中枢（`127.0.0.1:8766`，页面照常接入）与 stdio JSON-RPC（每行一条，供 IDE 的 MCP 客户端用），无需先单独启动 broker
- stdio 模式下 `stdout` 只留给 JSON-RPC——启动时把 `sys.stdout` 重定向到 `stderr`，原有 `print` 日志自动落到 stderr，不污染协议流
- stdin 读取放在线程池（`run_in_executor`），Windows 下也可用；客户端断开（stdin EOF）→ 事件循环结束 → `runner.cleanup()` 退出进程、释放端口
- 端口被占用（已有 broker 在跑）时打印明确提示并 `exit 1`，避免两个实体的注册表各管一半；此时应让客户端直接连 `POST /mcp`
- README 的「MCP 接入」补充 stdio 配置示例与注意事项（绝对路径、.venv、勿用 `start-broker.bat` 配 stdio）
- `py_compile` 通过；实测 stdio 下 `initialize` / `tools/list` 正常、同进程 `/pages` 可访问、关闭 stdin 后进程退出且端口释放

## 2026-10-28 · broker.py 兼做 MCP 服务器（同进程同端口，无需第二个服务）

- `POST /mcp`：MCP Streamable HTTP 传输，无状态实现（不下发 `Mcp-Session-Id`）——支持 `initialize` / `ping` / `tools/list` / `tools/call`；通知类消息（`notifications/initialized` 等）回 202，批量请求按数组逐个处理；`GET /mcp` 按规范返回 405、`DELETE /mcp` 返回 200
- `GET /sse` + `POST /messages`：旧版 HTTP+SSE 传输——`endpoint` 事件给出带 `sessionId` 的提交地址（开了 token 时一并带上 `token`），响应经 SSE `message` 事件回传，15s `: ping` 心跳
- 新增 4 个 MCP 工具：`list_pages`（复用 `public()`）、`list_marks`（抽出 `marks_list()`，`GET /marks` 同步复用，消除重复逻辑）、`page_snapshot`、`page_call`（`action` 必填，其余参数原样透传；`page` 支持标记 id / pid，只有一个在线页面时可省略，超时上限 120s，与 `/call` 同一条转发链路）
- 不新增依赖（仍只依赖 aiohttp），鉴权沿用 `BRIDGE_TOKEN` 的 `?token=` / `X-Bridge-Token`
- README 增加「MCP 接入」小节与接口表两行；`py_compile` 通过，实测三条链路：Streamable HTTP 的 initialize / tools/list / tools/call、SSE 的 endpoint → POST → SSE 回包、工具 → 长轮询页面 → 结果回传

## 2026-10-28 · 「复制页桥标记」新增「MCP 提示页面」按钮

- `marker` 的按钮行在「复制标记 id」旁追加「MCP 提示页面」：一键复制页面交接提示词，含标记 id / 标题 / 网址，并说明「优先按标记 id 选中该页面（不支持时按网址匹配）、先读取一次页面快照确认是同一页面」
- 提示词面向**通用 MCP 浏览器工具**，不写死 broker 接口（`/mark` 等仍保留在下方代码块里供 curl 使用）
- 仅在页面已接入扩展桥、能取到标记 id 时出现；`chrome-extension/toolbox/feats/llm.js` 与原型 `docs/toolbox/feats/llm.js` 同步，`node --check` 通过

## 2026-10-28 · 接口列表 URL 拆解高亮（尾段 / 查询参数 / 锚点 tag）

- 「接口调用」列表与详情里的 URL 拆成「前缀 + tag」：最后一个 `/` 之后的路径尾段、`?` 后每个参数（按 `&` 拆）、`#` 后的锚点分别渲染成小标签；`?` 与 `#` 作为普通分隔字符保留在标签之外（灰蓝等宽 9.5px，不带底色），避免看不出分隔符
- tag 用低对比样式（9.5px 等宽、淡底、灰蓝字），查询参数用淡紫、锚点更淡，不抢状态码与时间的视觉；完整 URL 仍保留在 `title` 里可悬停查看
- 列表行内前缀 `flex:0 1 auto` 超宽省略，tag `flex:none` 自动换行、最多两行（`max-height:2.6em`），长 URL 不再把参数挤成 `u…`；详情弹窗 664px 宽下 tag 正常换行完整显示
- `core.js`（扩展 + 原型）新增 `.uh` / `.tg` 样式；`feats/capture.js` 抽出 `urlTags()` 供列表与详情共用；`node --check` 通过，本地视觉验证覆盖无参数 / 多参数 / 锚点 / 超长 URL 四种形态

## 2026-10-28 · 接口调用去掉静态资源；三级详情弹窗加宽到两倍

- **问题**：「接口调用」列表里混进图片地址——bg 侧 webRequest 把所有 http(s) 请求都记成「仅头」记录，`image` / `css` / `js` / `font` 等静态资源也在内
- **修复**：`background.js` 的 `onBeforeRequest` 增加 `webRequest.type` 白名单 `{xmlhttprequest, other, websocket, ping, main_frame, sub_frame}`（fetch/XHR、beacon、WebSocket 握手、当前页面与 iframe 的文档请求），静态资源不再入库；`capture-main.js` 的 `sync()` 对旧版本遗留的静态资源「仅头」记录（URL 为图片/CSS/JS/字体等后缀且无请求体）直接丢弃
- **弹窗加宽**：`ui.js` 的三级详情浮层宽度从固定 332px 改为自适应——目标 664px（列表宽两倍），按左右可用空间 `clamp(332, 664)` 收窄，仍保持「先左后右、顶边对齐、不重叠」的并排逻辑；列表不变
- **地址不被截断**：详情里请求/响应头的行原本继承 `.li .u` 的 `nowrap + ellipsis`，改为 `white-space:normal` 换行显示；URL 继续 `word-break:break-all`
- `docs/spec-net-protocol.md` 补充采集范围说明；`node --check` 通过（background.js / capture-main.js / ui.js / capture.js）；原型与扩展的 `ui.js` 同步，实测 1440px 视口下详情宽 664px、与列表间隔 10px、顶边对齐；929px 视口自适应收窄到可用宽度

## 2026-10-28 · 表单保存与填充：新增「复制 / 粘贴」导入导出

- 「复制」把当前站点已保存的表单导出成 JSON（`{_v, host, ts, fields}`）写入剪贴板；写入失败时弹框给出手动复制内容
- 「粘贴」读取剪贴板 JSON 后**直接填进当前页面**，与「填充已保存」等价：复用同一套匹配逻辑（先按选择器，页面结构变化时按顺序兜底），跨站点也能用，可撤销
- 导入兼容三种形态：本站导出结果、`localStorage["ba:formkit"]` 全量备份（优先取当前站点键）、纯字段数组；剪贴板读取被拒 / 不可用时退化为 `prompt` 手动粘贴
- 回填逻辑抽成 `applyFields()`，「填充已保存」与「粘贴」共用
- `chrome-extension/toolbox/feats/build.js` 与原型 `docs/toolbox/feats/build.js` 同步（顺带补齐原型缺失的 `btn` / `toast` / `$$` / `copyText` 引用），两文件 `node --check` 通过；`docs/toolbox-proto-map.md` 的 formkit 描述同步

## 2026-10-27 · 页桥标记重构：id 由扩展接入时生成，broker 存档 id → 网址

- 标记不再由「pid + broker 地址」拼字符串，而是每个网页一枚**网页 id**：`background.js` 在 tab 接入时用 JS 生成
  `pb_xxxxxxxxxx`，存 `chrome.storage.session`（按 tab 持久，SW 休眠 / 刷新不变，关 tab 即清），随 `hello` / `hb` 上报 broker
- broker 新增 `MARKS` 存档（id → url/title/在线状态）：`GET /marks` 列出全部、`GET /mark/{id}` 按 id 查网页、
  `POST /mark/{id}` 按 id 下发命令（等同 `/call/{pid}`）；页面离线时仍返回最后一次 URL，离线记录保留 24h
- 工具箱「复制页桥标记」改为**只复制 id**，并显示 id、标题、URL 与查询方式；`tb:pinfo` 返回值加入 `mark`
- 同步：长轮询注册 / 心跳透传 `mid`，README 接口表、`docs/toolbox-proto-map.md`、changelog 更新；`node --check` 与 `py_compile` 通过

## 2026-10-26 · 新增「复制页桥标记」：一枚标记让 LLM 自取指定页面

- 「发给 LLM」分类新增 `marker`（存入 / store 子组）：读取本 tab 在 broker 的 `pid`，生成可粘贴的标记
  `【页桥标记】PB::<pid>::<broker>`，附带页面 URL / 标题与查询方式；点「复制标记」即入剪贴板
- LLM 侧无需再让用户描述页面：`GET /pages` 确认 pid 在线 → `POST /call/<pid> {"action":"snapshot"}` 取实时快照（元素带 `bid`，可继续 `click` / `type`），与 `cli_client.py` 的 snapshot→decide→call 循环一致
- background 新增扩展桥动作 `tb:pinfo`（返回本 tab 的 `pageId` / `port` / `url` / `title`）；工具箱在 MAIN world 经 `batb:bridge` 取用。未接入 broker（扩展未连接 / 不在白名单 / 原型 `file://` 页）时降级为仅含 URL 的标记并说明原因
- 计数：扩展 35 → 36 项、原型 31 → 32 项；README 与 `docs/toolbox-proto-map.md` 的 llm 表格同步；原型 / 扩展 `feats/llm.js` 同步，`node --check` 通过

## 2026-10-26 · 元素拾取器：点击二级条目即进入拾取，省掉一次点按

- 在二层功能列表点击「元素拾取器」后，直接进入拾取模式（工具箱自动收起 → 移动高亮 → 点击锁定 → 结果回填到详情区），不再需要先等三级详情出现、再点「开始拾取」
- 三级详情里的按钮改为「重新拾取」，用于连续拾取多个元素（每次拾取前清空上一次结果）
- 拾取模式仍支持 Esc 取消；取消后详情区保留说明与「重新拾取」入口
- `chrome-extension/toolbox/feats/find.js` 与原型 `docs/toolbox/feats/find.js` 同步，`node --check` 通过

## 2026-10-26 · 修复拾取器事件反查：向上回溯祖先节点，支持 iframe 场景提示

- **现象**：在 Playcode React 预览页拾取按钮后，「事件处理」区为空
- **根因 1**：拾取常落在按钮内部的 `span` / `svg` / 图标上，而 React 只在真正写 JSX 的宿主节点上挂 `__reactProps$` + `onXxx`，子节点的 props 通常只有 `className/children`；旧实现只看拾取节点本身。真实 React 页面（react.dev）实测复现：按钮内 `span` 无 handler，祖先 `button` 上才有 `onClick`
- **修复**：从拾取节点向上逐级回溯（最多 10 层，经 `getRootNode().host` 穿透 Shadow DOM），取最近一个挂 `onXxx` 的 React / Vue 节点；结果标题标注 handler 所在的祖先节点（如「在祖先 button 上」），复制内容仍为 handler 源码
- **根因 2（Playcode 编辑器场景）**：若工具箱所在页面只是编辑器外壳、React 应用跑在 iframe 里，`elementFromPoint` 命中的是 `iframe` 本身，任何 DOM 都拿不到 handler
- **修复**：拾取结果为 `IFRAME` 时给出明确提示——用预览工具栏的「在新窗口打开预览」打开独立页面后再用工具箱（扩展目前只注入顶层 frame）
- 未找到时的文案补充「事件由 `addEventListener` 绑定时无法从 DOM 直接读出源码」；`chrome-extension/toolbox/feats/find.js` 与原型 `docs/toolbox/feats/find.js` 同步，两文件 `node --check` 通过

## 2026-10-26 · 查找分类精简：「事件反查」并入元素拾取器，移除评分与文本搜索

- 移除 `selrank`（Selector 稳定性评分）与 `textsearch`（按文本 / 属性搜索）两项功能：评分与实际使用脱节、全文搜索与浏览器自带查找重复
- `eventlook`（事件反查）并入「元素拾取器」：拾取锁定后，路径结果下方直接显示 **事件处理** 区——React 节点上 `__reactProps$` 的全部 `onXxx` handler 源码，或 Vue 组件实例 `vnode.props` 上的 `onXxx`；带代码框自带的复制按钮，未找到时给出拾取建议。独立入口删除（原先依赖 `ensurePicked()`，容易直接复用上一次拾取的元素，看起来像「没实现」）
- 查找分类 9 项 → 6 项；原型 / 扩展实际注册数校正为 **31 / 35 项**（README、`docs/toolbox-proto-map.md` 同步；原文档 33/37 已少计 1 项）
- `chrome-extension/toolbox/feats/find.js` 与原型 `docs/toolbox/feats/find.js` 同步；`feats/build.js` 中指向旧评分工具的提示文案、原型关于页的功能清单同步更新

## 2026-10-26 · 元素拾取器：Puppeteer 右侧新增复制图标按钮

- 拾取出结果后，四个写法标签（CSS / XPath / Playwright / Puppeteer）行尾追加一个「复制路径」图标按钮，点击复制**当前选中标签**的路径到剪贴板并 toast 提示「已复制路径」
- 复制内容取自下方代码框的实时文本，切换标签后再复制即为该标签的写法；复制按钮不带激活态，不影响标签选中逻辑
- `chrome-extension/toolbox/feats/find.js` 与原型 `docs/toolbox/feats/find.js` 同步；两文件 `node --check` 通过

## 2026-10-26 · 修复工具箱宿主被页面「整块重写文档」抹掉后不再出现

- **现象**：在 Playcode 预览页（`react-template.preview.playcode.io`）工具箱 FAB 短暂出现后消失，且不再回来
- **根因**：该站点的预览运行时在每次推送内容时执行 `document.open()` → `document.write(html)` → `document.close()` 重写整个文档（`__update__`），宿主 `#ba-toolbox-host` 随旧文档一起被移除；`resetObjectAfterInitialKeys('window', window)` 还会删掉注入后才加的 `window.BATB`。而扩展只在「导航完成 / SPA 路由变化 / 白名单变更」时注入——`document.open()` 既不是导航也不改 URL，所以工具箱不会自己回来；`batb:gate` 门控此时也只是给脱离文档的节点设 `display`，无任何效果
- **修复**：`core.js` 把一次性 `document.body.appendChild(host)` 换成 `mount()` + `heal()`——文档事件（`load` / `pageshow` / `readystatechange`）加 1s 低频轮询兜底（重写后 window 上的监听不一定还在），发现 `host.isConnected === false` 就挂回当前 `document.body`（`body` 尚未生成时下一轮再试）；节点与 Shadow 复用，界面状态与门控显隐（节点上的 `display`）原样保留，`B.dlog` 记录 `mount: 宿主脱离文档，已重新挂载`。若扩展随后重新注入产生同 ID 的新实例，旧实例自动让位（`host.remove()` + `stopHeal()`），不会出现两个 FAB
- 同类问题一并覆盖：`React createRoot(document.body)` 等清空/替换 body 的站点
- 原型 `docs/toolbox/core.js` 同步；README 故障排查表、`docs/toolbox-proto-map.md` 模块一览与「改动热点速查」同步
- **补丁（同日，同一站点暴露的第二段）**：宿主能挂回来了，但「FAB 在、点了没反应」
  - **根因**：`document.open()/write()/close()` 除摘掉宿主外，还会按规范清空 document 及其（shadow 包含）后代**与 window** 上的全部事件监听；而我们的绑定（boot.js 的 FAB/分类/Popover/拖拽/热键/点空白收起、ui.js 挂在 `#dpop-x`/`#undo-one`/`#undo-all` 上的 onclick、core.js 的 `batb:gate`）都是加载时一次性绑定的。节点对象、Shadow DOM、样式、定时器、localStorage 都还在，只有监听没了 → 「看得见、点不动」
  - **实测确认**（Chromium 真实浏览器）：重写后 `addEventListener` 与 `onclick` 一律静默失效（shadow 内节点同样失效）；`window` 上的监听一并失效；**document 对象身份不变**（`d0 === document`，无法用它判断重写）；定时器与 localStorage 存活
  - **修复**：core.js 的 1s 轮询改为 `mount()`，在其中做「自定义事件同步往返自检」（`batb:probe`）——自检不通说明监听被清空，就重绑 core 自己的监听（`bindCore()`：probe / gate / load / pageshow / readystatechange）并调 `B.rebind()`；boot.js 把全部绑定收进 `bindUi()` 并导出 `B.rebind`（内部先调 `B.ui.bindStatic()`，ui.js 把三个静态 onclick 收进 `bindStatic()` 导出）。重绑前监听确实已不存在，故不会重复绑定（Esc 不会一次关两层）；`createRoot(document.body)` 式只摘节点不清监听的站点，自检通过 → 不重绑，不会出现双份监听
  - `mount()` 顺带恢复被站点删掉的 `window.BATB`，避免扩展探测误判为「未注入」而重复注入
  - 验证：真实浏览器加载 12 个原型模块 → `document.write` 重写 → FAB 单击即开面板、分类单击出 Popover，连点两次=开/关各一次（无重复绑定）；`document.body.innerHTML=''` 路径同样正常且不产生 rebind 记录；`node --check` 6 个改动文件通过

## 2026-10-26 · 修复元素拾取器：拾取期间收起工具箱界面，选中后恢复

- **现象**：点「开始拾取」后 hover/点击页面元素，元素能正常锁定且结果已渲染，但面板、功能列表、详情浮层同时关闭，表现为「所有工具都消失」；且再次拾取时上一次结果会残留在详情区
- **根因 1（界面被误关）**：拾取器只在 **`click`** 捕获阶段拦截页面点击，而 `boot.js` 的「点击页面其他位置收起面板」监听的是 **捕获阶段 `pointerdown`**——pointerdown 先于 click，点页面选元素的同时先执行了 `ui.closePanel()`，等 pick 的 promise resolve 时浮层已关闭
- **根因 2（拾取界面遮挡）**：拾取期间面板/浮层停留在屏幕上，既挡视线也挡目标元素，与「进入拾取应专注页面」的预期不符
- **修复**：
  - `ui.js` 新增 `hideForPick()/showAfterPick()`，`core.js` 新增 `.pick-hide{display:none!important}`——拾取开始时把 FAB/面板/功能列表/详情浮层/撤销栈整体隐藏，选中或 Esc 取消后原样恢复并重算布局（不改变各自 open 状态，恢复即回到拾取前的界面）
  - `picker.js` 的 `pick()` 在创建遮罩时调用 `hideForPick()`，`cleanup()` 里调用 `showAfterPick()`；所有走 `B.pick()` 的功能（隐藏元素 / 容器截图 / 存入选中元素 / 事件反查 / 表格提取等）自动获得同样行为；`ensurePicked()` 打开详情即自动拾取的场景同样生效
  - `boot.js` 的 pointerdown 收起逻辑增加守卫 `if(sq('.picker-ov')) return;`（拾取期间页面点击 = 选中元素，不是点空白收起），与既有 Esc 守卫同口径
  - `feats/find.js` 的「元素拾取器」结果写入独立结果区 `out`，每次点击「开始拾取」先清空——只显示当前这次结果，不再残留上一次
- 原型 `docs/toolbox/` 四个文件（core / ui / picker / feats/find）同步；本地原型页真实鼠标验证：进入拾取后 FAB/面板/列表/详情/撤销栈全部隐藏 → 点击表格单元格 → 界面恢复且结果只有 1 份；再次拾取时旧结果清空；Esc 取消同样恢复界面

## 2026-10-22 · 采集新增「接口调用」：双层捕获 + netlog LLM 查看协议

- **双层捕获架构**（MV3 webRequest 拿不到响应体，页面 hook 看不到浏览器自动加的 Cookie，两层合并）：
  - 新增 `chrome-extension/capture-main.js`——manifest 静态声明 `document_start` + `world:"MAIN"` 注入，包裹 fetch/XHR 抓**请求体原文/响应体**（`clone()` 旁路流式读取、超 256KB cancel，不拖慢页面不全量缓冲；SSE/二进制/opaque 只记 meta），环形缓冲 300 条存页面内存（导航即清空，除主动查询不离开页面）；`feats/capture.js` 新增 `apinet`（接口调用，功能数 36→37，README 与 proto-map 同步）
  - background 加 webRequest 观察模式 5 监听器（`onBeforeRequest/onSendHeaders/onHeadersReceived/onCompleted/onErrorOccurred` 定稿）抓 **URL/method/全量请求头（`extraHeaders` 才有 Cookie/Authorization）/请求体/响应头与状态码**；只记白名单页；定稿落 `chrome.storage.session['neth:'+tabId]`（每 tab 150 条、2MB 体积护栏丢最旧、请求体截 16KB、不存响应体；SW 随时可被杀，不能只放全局变量）；tab 关闭清 key
  - 合并按 method + URL 归一化 + Δt≤8s 最近邻、**consume-once**（rid 去重防同 URL 轮询误并），歧义保留 `src='net'` 的「仅头」记录（整页跳转后 body 侧清空时仍可见）
- **复制**：`apinet` 列表（1.5s 轮询）→ 点行进详情（同详情浮层内切换）→ 请求头/请求体/响应头/响应体分区 + **复制调试文本 / 复制 cURL**；**默认脱敏**（Cookie/Authorization/token 头 → `«已脱敏»`，体套用 JWT/手机号/邮箱等占位，口径同 `B.REDACT`），按站开关 `localStorage["ba:netredact"]`
- **查看（上层总沟通协议）**：新增 broker 命令 `netlog`（进 hello `caps`）——`{"op":"list"}` 摘要（不含 body）→ `{"op":"get","id":N}` 完整记录 / `{"op":"curl"}` 回放 / `{"op":"clear"}`；链路 background → content.js → DOM 事件 `batb:netq` → MAIN world 捕获层应答（不走 eval：eval 在 USER_SCRIPT/ISOLATED world 看不到 MAIN world）；`cli_client.py` SYSTEM_PROMPT 同步；协议 spec 见 `docs/spec-net-protocol.md`
- manifest 0.1.1→0.1.2，permissions 加 `webRequest`（观察模式，无需 blocking）；**更新后需重载扩展并刷新页面**（捕获层随页面 document_start 注入）
- 原型 `docs/toolbox/` 不动：本功能依赖扩展后台/扩展桥，与 qr/capture 同属「仅扩展版」

## 2026-10-21 · 截图自动处理浮动元素（fixed / sticky）

- **fixed 元素临时隐藏、sticky 元素临时取消吸附**（转 `static`，只在原位出现一次），整页截图与容器截图共用——`markFloating(scroller)` 扫描 `body *` 按 computed position 打标（`data-ba-fx` / `data-ba-stk`）+ 页面级 CSS 生效，`finally` 里 `unmarkFloating()` 还原属性与样式；结果信息展示处理数量
- 容器截图跳过滚动容器自身与其祖先（避免把目标藏掉）；容器**内部**的 sticky 照常取消吸附（吸顶表头不再每屏重复）；标记在测量矩形之前完成，保证裁剪坐标不受布局微移影响
- fixed 为脱离文档流隐藏不影响布局；sticky 占据常规流位置，转 static 不改变高度——两种处理均不引入页面跳动；dlog 记录 `floating fixed=N sticky=M`
- README 采集段、proto-map `fullshot`/`elshot` 行同步

## 2026-10-21 · 拾取器改窗口捕获级事件 + 交互诊断日志

- **拾取事件模型重构**：此前依赖遮罩（`.picker-ov`）接收 mousemove/click——页面若有 z-index 更高的元素（弹窗/浮层）盖住遮罩，真实事件落不到遮罩上，拾取即失效（合成事件测试绕过了真实命中路径，故此前自测未复现）。改为：遮罩纯视觉（`pointer-events:none`），mousemove/click 挂 **window 捕获级**（页面任何元素都抢不走事件），点击在捕获阶段 `preventDefault + stopPropagation` 拦下（页面链接/按钮不响应）；元素命中回归 `elementFromPoint`（遮罩已不参与命中，页面最高层元素即所得）；悬在工具箱自身 UI 上时通过 `host.contains(e.target)` 判定不拾取；拾取期间注入 `*{cursor:crosshair!important}`；高亮框/提示条 z-index 提到 2147483601+，保证盖过页面任意浮层
- **新增交互诊断日志 `B.dlog`**：环形写入 `localStorage["ba:diaglog"]`（每站点 60 条）——拾取开始/命中/取消、容器截图进入/模式/矩形/步数/逐屏成功/异常全量埋点；用户 F12 Console 执行 `copy(localStorage.getItem('ba:diaglog'))` 即可把交互数据反馈给开发侧定位
- 原型 `docs/toolbox/` 的 core.js / picker.js 同步

## 2026-10-21 · 修复 FAB 在视口变矮后被淹没

- FAB 拖拽记忆的是绝对 `top`，F12 停靠等把视口压矮后会停在视口外不可见；boot.js 新增 `clampFab`——恢复记忆位置时与 `window.resize` 时把 `top` 钳回视口内（默认 `bottom:24px` 定位随视口自适应，不受影响）；面板开着时同步重算布局；原型 `docs/toolbox/boot.js` 同步
- 本地自测页（桥接桩模拟 `captureVisibleTab`）+ 真实浏览器验证：容器截图（容器内 4 屏滚动拼接、滚动位置还原、结果渲染）、区域截图退化、FAB 钳制（记忆 top=3000px 加载后入视口、resize 压矮仍入视口）三条链路通过

## 2026-10-21 · 修复元素拾取器：Shadow DOM 命中测试不穿透

- **修复 `pick()` 对页面元素完全失效**（隐藏元素 / 元素描边 / 查找 / 容器截图等所有拾取功能）：拾取遮罩挂在工具箱 Shadow DOM 内，`document.elementFromPoint` 不穿透 Shadow——遮罩盖屏后任何位置命中的都是宿主 `#ba-toolbox-host`，恰被 `t === host` 判为工具箱自身丢弃，导致永远无高亮、点击无响应（只能 Esc 退出）
- 改用 `document.elementsFromPoint` 取整叠命中元素，跳过宿主后取其下的真实页面元素；原型 `docs/toolbox/picker.js` 同步

## 2026-10-21 · 采集新增「容器截图」：只截某一容器内部的滚动范围

- **背景**：整页截图对 `document` 滚动拼接，页面滚动发生在内部容器（`overflow:auto` 区域）时文档不滚，只会截到当前一屏
- **新增** `feats/capture.js` 的 `elshot`（容器截图，功能数 35→36，README 与 proto-map 同步）：
  - **滚动定位**：拾取元素（或容器内任一元素）向上找最近可滚动祖先——`overflowY` 为 auto/scroll/overlay 且实际溢出（`scrollHeight > clientHeight`）才算；找不到则退化为区域截图（截取该元素当前可见部分）
  - **测量时机**：先隐藏工具箱与滚动条（容器打 `data-ba-nosb` + 注入对应 CSS，页面级滚动条同样隐藏）、`scrollIntoView({block:'nearest'})` 尽量把容器完整带入视口，之后才量 rect——避免滚动条消失/回流导致裁剪坐标漂移
  - **步长取可视切片高度**（视口 ∩ 容器矩形）而非 clientHeight：容器比视口高时按 clientHeight 步进会漏屏；末屏不足一整步时补截贴底位置，拼接按容器内容坐标（`scrollTop + 切片偏移`）定位，天然无重叠错位
  - **边界提示**：容器顶部/底部被视口裁住的内容物理上不可见、无法截取，输出缺口像素数；横向超出视口同样不截；容器内 sticky 元素每屏重复出现
- **整页截图补提示**：仅截到一屏（文档自身不可滚动）时，在结果里提示滚动可能发生在内部容器，引导改用「容器截图」
- 抽出 `showResult` / `stampName` 供两个截图功能共用；core.js 新增 `crop` 图标

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
