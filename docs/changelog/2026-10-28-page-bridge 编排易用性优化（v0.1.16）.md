# 2026-10-28 · page-bridge 编排易用性优化（v0.1.16）

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
