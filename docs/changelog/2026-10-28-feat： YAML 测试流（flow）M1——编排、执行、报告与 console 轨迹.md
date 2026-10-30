# 2026-10-28 · feat: YAML 测试流（flow）M1——编排、执行、报告与 console 轨迹

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
