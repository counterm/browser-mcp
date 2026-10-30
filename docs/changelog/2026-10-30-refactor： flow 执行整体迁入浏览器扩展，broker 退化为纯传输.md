# 2026-10-30 · refactor: flow 执行整体迁入浏览器扩展，broker 退化为纯传输

- 新架构：LLM / CLI / 工具箱 → broker（只转发）→ 页面内扩展执行器。broker **不再解析 YAML、
  不存 flow 库、不写报告 / 截图文件**；运维只需 broker + 扩展两个本地组件。
- `chrome-extension/vendor/js-yaml.min.js`：打包 js-yaml 4.1.0，content script 与 background 共用。
- `chrome-extension/flowrun.js`（新增，内容脚本）：解析 YAML → 变量展开 / 断言 / 重试 / 数据组 /
  子流程 / 跨页续跑；每步前把运行状态写 `chrome.storage.session`（`flowrun:<tabId>`），
  换页后新实例向 background 取回并继续；进度与报告经 WS `flow_progress` / `flow_report` 上报。
  失败步自动截图（`captureVisibleTab`，dataUrl 内联，不落盘）。console 轨迹沿用 `log` 动作。
- `chrome-extension/content.js`：暴露 `globalThis.__batbExec`（ACTIONS / pageInfo / sleep / locate / serialize）供执行器复用。
- `chrome-extension/manifest.json`：content_scripts 依次注入 `vendor/js-yaml.min.js` → `content.js` → `flowrun.js`。
- `chrome-extension/background.js`：
  - flow 库改为 `chrome.storage.local.flows`（name → {yaml, ts}），保存前做 schema 校验；
  - 新增 `flow_run` / `flow_lib` 浏览器级动作，`flow_save` / `flow_clear` / `flow_resume`（运行状态续存）、
    `flow_bg`（截图 / eval / tab_* 代理）、进度与报告上报；tab 关闭时清理 `flowrun:<tabId>`；
  - 工具箱的库操作（list/get/save/delete）不再经 broker HTTP，直接读写扩展本地库；运行仍走 broker 传输。
- `broker.py`：
  - 删除 pyyaml 依赖、磁盘 flow 库、Python runner、`.flows/` 报告与文件 CRUD；
  - `/flows`、`/flow/{name}` 改为经在线页面转发 `flow_lib`（任一在线页面即可）；
  - `/flows/run` 转发 `flow_run`，新增内存 `FLOW_RUNS` 维护进度；`/flows/status` 契约不变；
  - 同步等待超时返回 202 + run_id（CLI 自动转异步轮询）；`flow` MCP 工具描述同步更新。
- `cli_client.py`：`flow` 仍读本地文件（内联发送，允许），新增 202 → `/flows/status` 轮询；
  报告截图改为 dataUrl 长度提示，去掉 `.flows/` 报告路径。
- 工具箱（`chrome-extension/toolbox/feats/build.js` + `docs/toolbox/feats/build.js`，两树同步）：
  「导入」旁新增「直接运行（不保存）」；报告截图渲染缩略图（dataUrl）；库文案改为「浏览器本地」。
- `docs/spec-flow.md` 全量重写；`README.md` / `README.en.md` 架构与接口表同步；
  `requirements.txt` 去掉 pyyaml；`flows/demo-smoke.yaml` 仅作 CLI 示例。
- 验证：`node --check`（flowrun / background / content / 两树 build.js / vendor）与
  `python -m py_compile broker.py cli_client.py` 通过；生效需重载扩展并刷新页面。
