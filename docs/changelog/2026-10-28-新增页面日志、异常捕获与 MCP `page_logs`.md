# 2026-10-28 · 新增页面日志/异常捕获与 MCP `page_logs`

- `capture-main.js` 新增 MAIN world 日志层 `window.__BATB_LOG__`（`document_start` 先于页面脚本）：hook `console.log/info/warn/error/debug`、`window.error`（含捕获阶段的资源加载失败）、`unhandledrejection`、`securitypolicyviolation`；记录 `id/t/iso/perf/kind/level/text/url/line/col/stack/count`，环形 800 条、单条 2KB、1.5s 内同文本合并计数，序列化有深度 / 键数 / 字符上限，hook 全程 try/catch
- 新增 `batb:logq` / `batb:logq:res` 查询协议：`list` 按 `since` 游标增量返回；`wait_ms>0` 在页面侧长轮询等待新记录（≤20s）；`clear` 清空；`doc` token 标识文档，导航后返回 `navigated:true` 并从 0 开始
- `content.js` 新增 `plog` 动作（同 `netlog` 的 DOM 事件桥），`background.js` 的 `CONTENT_ACTIONS` 白名单加入 `plog`
- MCP 新增 `page_logs` 工具（`page`, `since`, `doc`, `kinds`, `levels`, `q`, `limit`, `text_max`, `wait_ms`, `clear`, `redact`）；`page_call {action:"plog"}` 同样可用
- 日志只在被查询时离开页面，文本默认脱敏（沿用 `redactText` 口径）；仅顶层 frame，油猴版不覆盖，跨域脚本错误仍可能只有 `Script error.`
- `node --check` 通过（capture-main.js / content.js / background.js）；扩展侧需重载扩展并刷新页面后生效
