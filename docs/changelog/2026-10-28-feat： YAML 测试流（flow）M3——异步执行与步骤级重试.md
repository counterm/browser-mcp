# 2026-10-28 · feat: YAML 测试流（flow）M3——异步执行与步骤级重试

- `broker.py`：
  - 异步执行：`flow op=run` 新增 `mode:"async"`（MCP 与 `POST /flows/run` 均可）→ 立即返回 `{run_id, status:"running", steps_total, poll}`，后台 asyncio 任务跑 runner；新增 `op=status {run_id, wait_ms?}`（长轮询上限 60s）与 `GET /flows/status?run_id&wait_ms` 取实时进度（done/passed/failed）与最终报告；runner 每步结束回写 `FLOW_RUNS` 进度；记录存内存，done 超 1h 或总量超 50 由 janitor 清理；公共逻辑抽为 `flow_start_async` / `flow_status`
  - 步骤级重试：`retry`（额外次数，0~10）/ `retry_wait_ms`（间隔 ms，默认 1000，上限 60000），动作报错与断言不过都会重试，变量展开错误不重试，重试过程打 warn 级 console 轨迹，重试成功后报告清掉残留 error；flow_validate 校验数值范围
  - MCP `flow` 工具 schema / 描述同步（新增 mode / run_id / wait_ms 参数与 status op）
- `chrome-extension/background.js`：`tb:flow` 的 `run` 改走 `mode:"async"`，新增 `status`（`GET /flows/status`，wait_ms ≤ 30s 长轮询）
- `chrome-extension/toolbox/feats/build.js` + `docs/toolbox/feats/build.js`（两树同步）：面板「运行」改为「启动 → 轮询进度（N/M 步）→ 渲染报告」，长流不再受单次请求超时限制
- 文档：`docs/spec-flow.md`（retry/retry_wait_ms 字段、status op、/flows/status 端点、M3 落地说明）；README 中英 flow 行与 HTTP 表更新
- 验证：`py_compile` + `node --check` 全过；8770 端口假页面 E2E——`retry:2` 时点击第 3 次成功（尝试 3 次、ms≈431）、async 启动返回 run_id、status@0 为 running、长轮询到 done 且报告 3/3 通过、非法 retry=99 校验 400、未知 run_id 404 / MCP isError；测试进程与产物已清理
- 生效条件：重启 broker（MCP stdio 重连即可）；工具箱运行异步化需重载扩展并刷新页面
