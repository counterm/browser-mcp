# 2026-11-02 · fix: stdio 拉起时端口已有 broker 则转发现有实例而非退出

- 问题：MCP 客户端（stdio 方式）拉起 `broker.py --stdio` 时，若已有 broker 占着 `127.0.0.1:8766`，旧逻辑打印 WinError 10048 后 `exit 1`，客户端表现为 `MCP error -32000: Connection closed`，还得手动把配置改成直连 `http://127.0.0.1:8766/mcp`
- 修复：监听失败时先用 `GET /pages`（3s 超时，带 `X-Bridge-Token`）探测端口；确为本项目 broker（200 + JSON 数组）时跳过自启，stdio 收到的每条 JSON-RPC 原样转发给现有实例的 `POST /mcp`——通知类（无 id）无回包，转发失败回 JSON-RPC `-32603` 且连接不断
- 效果：同一份 stdio MCP 配置在「没起 broker / 已起 broker」两种情况下都能用，客户端配置无需改动；也避免了两个实例页面注册表各管一半的分裂状态
- 端口被其他程序占用（探测非 200 / 非 JSON 数组）或 token 不匹配时，保留报错退出，提示检查端口或设 `BRIDGE_PORT` 换端口
- 转发超时 300s（`tools/call` 上限 120s、flow 同步 115s，留余量）；broker 中途挂掉会立即抛 `ClientError` 回错，不会悬挂
- README（中 / 英）「MCP 接入」的端口占用说明同步更新
