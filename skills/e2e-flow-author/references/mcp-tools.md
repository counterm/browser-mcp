# page-bridge MCP 速查

工具名在 MCP 客户端里可能带前缀（如 `mcp_page-bridge_page_snapshot`），语义相同。

## 发现页面

```json
{ "tool": "list_pages" }
```

返回在线页面（id / url / title / mode / eval_mode）。生产与测试环境要按 URL 区分，别点错。

```json
{ "tool": "list_marks" }
```

按业务标记找页面（如 `mark: "cipher-reg-admin"`）。

## 看页面

```json
{ "tool": "page_snapshot", "arguments": { "page": "cipher-reg-admin", "max": 150, "text_max": 2000 } }
```

交互元素带 `bid` 编号，正文按需裁剪。首次进入页面先看快照，不要直接猜选择器。

```json
{ "tool": "page_call", "arguments": {
  "page": "cipher-reg-admin",
  "action": "dom",
  "selector": ".el-dialog",
  "depth": 6,
  "maxChars": 20000
} }
```

看弹窗/表单的真实 DOM（Pug 缩进树），用来确认 placeholder、name、aria-label、业务 class。

## 操作页面

```json
{ "tool": "page_call", "arguments": { "page": "cipher-reg-admin", "action": "click", "text": "新增用户" } }
{ "tool": "page_call", "arguments": { "page": "cipher-reg-admin", "action": "type", "selector": "input[placeholder=\"请填写账户\"]", "text": "e2e_demo" } }
{ "tool": "page_call", "arguments": { "page": "cipher-reg-admin", "action": "press", "key": "Enter" } }
{ "tool": "page_call", "arguments": { "page": "cipher-reg-admin", "action": "screenshot" } }
```

截图经 MCP 调用会落盘，返回 `{format, path, bytes}`，用 Read 直接看图片。

其它常用 action：`nav`、`back`、`reload`、`select`、`scroll`、`hover`、`upload`、`wait`、`highlight`、`eval`。
`eval` 在强 CSP 页面可能被拦，需要扩展开启「允许用户脚本」并重载扩展。

## 看日志与接口

```json
{ "tool": "page_logs", "arguments": { "page": "cipher-reg-admin", "q": "[flow:", "limit": 200 } }
```

看 flow 逐步轨迹、页面异常、CSP、资源加载失败。增量拉取用 `since` + `doc`。

```json
{ "tool": "page_call", "arguments": { "page": "cipher-reg-admin", "action": "netlog", "op": "list", "limit": 50 } }
{ "tool": "page_call", "arguments": { "page": "cipher-reg-admin", "action": "netlog", "op": "get", "id": 12 } }
```

`list` 拿摘要，`get` 拿请求/响应详情，`curl` 拿可回放命令。默认脱敏鉴权字段，生产环境不要关。

## flow 库与运行

| op | 参数 | 说明 |
|---|---|---|
| `save` | `yaml` | 解析 + 校验 + 入库（保留注释） |
| `list` | - | 列出库里的 flow |
| `get` | `name` | 取 YAML 原文 |
| `delete` | `name` | 删除 |
| `run` | `name` 或 `yaml`，`page?`，`vars?`，`from_step?`，`stop_on_fail?`，`mode?` | 执行并返回报告 |
| `status` | `run_id`，`wait_ms?` | 轮询异步运行，done 时带完整报告 |

推荐流程：

```json
{ "tool": "flow", "arguments": { "op": "save", "yaml": "<flow yaml>" } }
{ "tool": "flow", "arguments": { "op": "run", "name": "account-create", "page": "cipher-reg-admin", "mode": "async" } }
{ "tool": "flow", "arguments": { "op": "status", "run_id": "<run_id>", "wait_ms": 30000 } }
```

同步模式 MCP 等待上限约 115s；长流程用 `async` + `status`。

## 数据库（设计期只读）

用 MySQL MCP 只做 `SELECT`，例如：

```sql
SELECT username, phone, account_status_cd
FROM sys_user
WHERE del_flag = 0
ORDER BY create_time DESC
LIMIT 5;
```

用途：

- 选一条真实记录做查询 / 编辑 / 删除场景。
- 运行后核对新增记录是否落库。
- 解析字典值（`sys_dict` / `sys_dict_item`）。

禁止：`INSERT` / `UPDATE` / `DELETE` / DDL。写操作只能通过页面 flow，并带唯一前缀和清理方案。

## 常用排错组合

```text
page_snapshot → 发现页面不对/没登录
page_logs {q:"[flow:"} → flow 轨迹
page_logs {levels:["error"], limit:50} → 页面报错
page_call {action:"netlog", op:"list"} → 接口没发/4xx/5xx
page_call {action:"dom", selector:".el-dialog"} → 弹窗结构变了
page_call {action:"screenshot"} + Read → 视觉确认
```
