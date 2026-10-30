# spec-flow：YAML 测试流（纯扩展执行）

> 用 YAML 编排页面操作序列（代替 Playwright 的轻量路线）：**不引入 Node / Playwright**。
> YAML 的解析与逐步执行都在**浏览器扩展**里完成；broker 只做传输与进度汇总，
> **不解析 YAML、不落盘、不存 flow 库**。

## 总体架构（扩展承担全部执行）

```
编写：工具箱录制 / 粘贴 / 手写 / LLM 生成
            │
            ▼
  LLM(MCP) / CLI / CI / 工具箱
            │  ① 传 YAML（库内按名，或内联文本）
            ▼
      broker（纯传输：页面注册 / 转发 / 内存进度）
            │  ② 转发给目标页面（action=flow_run / flow_lib）
            ▼
  浏览器扩展 · flowrun.js（内容脚本，逐页执行）
   - 解析 YAML（vendor/js-yaml）
   - 变量 / 断言 / 重试 / 数据组 / 子流程
   - 每步写 chrome.storage.session，换页后自动续跑
            │  ③ 进度 / 报告（WS flow_progress / flow_report）
            ▼
        broker 内存 run_id 状态 ← ④ 轮询
            │
            └→ 结果：逐步 OK/FAIL、耗时、URL、失败截图（dataUrl）
```

- **真相源 = 扩展本地库**（`chrome.storage.local` key `flows`：`name -> {yaml, ts}`）。
  不写 `flows/*.yaml`、不写 `.flows/` 报告、不存截图文件。
- **broker 只传**：HTTP / MCP 收到请求后，用页面 WS 下发 `flow_run` / `flow_lib`，
  按扩展回报维护内存 `FLOW_RUNS`（run_id → 进度与报告），供 `/flows/status` 轮询。
- **跨页续跑**：运行状态按 tab 存 `chrome.storage.session`（key `flowrun:<tabId>`），
  每步之前写入；导航后新页面里的 `flowrun.js` 向 background 取回状态并从下一步继续。
- **CLI 读取本地文件是允许的**：它只在客户端读入 YAML 文本再内联发送，不产生库副本。

## YAML schema（v1）

```yaml
flow: demo-login          # 必填，库内唯一名（小写字母/数字/-/_，≤64 字符）
desc: 登录并检查仪表盘     # 可选，描述（list 时展示）
vars:                     # 可选，${vars.x} 变量；密码走 ${env.NAME} 不写进 YAML
  user: admin
steps:                    # 必填，非空
  - id: s01               # 必填，flow 内唯一，报告与轨迹按 id 输出
    do: nav               # 必填，见下方动作表
    url: https://example.com/login
  - id: s02
    do: type
    selector: '#username' # 定位三选一：selector / text / bid（同 page_call）
    text: ${vars.user}    # type 的 text = 输入值
  - id: s03
    do: type
    selector: '#password'
    text: ${env.PWD}      # 由扩展本地 flowenv 注入（不落 YAML）
    secret: true          # 报告与 console 轨迹中打码为 ***
  - id: s04
    do: click
    selector: 'button[type=submit]'
    expect:               # 断言：单键映射或其列表，全部满足才过
      url_contains: /dashboard
    max_wait_ms: 8000
  - id: s05
    do: screenshot
    tag: dashboard
```

### 字段说明

| 字段 | 级别 | 说明 |
|---|---|---|
| `id` | 每步必填 | 步骤唯一 id；报告 / console / `from_step` 都以它引用 |
| `do` | 每步必填 | 动作名，见下表 |
| `expect` | 可选 | 断言：`url_contains` / `url_is` / `text`（正文包含）/ `selector`（存在）。单键映射或列表；每 0.3s 轮询至 `max_wait_ms` |
| `max_wait_ms` | 可选 | expect 轮询上限，默认 5000，上限 30000 |
| `retry` | 可选 | 失败后额外重试次数（总尝试 = retry+1，上限 10）。动作报错与断言不过都会重试；变量展开错误不重试 |
| `retry_wait_ms` | 可选 | 每次重试间隔毫秒，默认 1000，上限 60000 |
| `secret` | 可选 | true 时报告/轨迹里打码 `text` / `value` / `code` 值 |
| `on_fail` | 可选 | `continue` 该步失败继续跑（默认失败即停，除非 flow 级 `stop_on_fail=false`） |
| `name` / `vars` | `do: flow` 时 | `name`=子流程名（须在扩展库里）；`vars`=传给子流程的变量（先按父流程变量展开再覆盖子流程自身 vars） |
| 其余键 | 按动作 | **与 page_call 参数 1:1**（url / text / value / key / code / ms …），见 README 命令表 |

### 支持的 `do`

```
click type press select scroll hover nav back reload eval
cookies storage upload wait highlight dom screenshot
tab_list tab_open tab_close tab_activate netlog
flow   # 子流程（编排动作，见下文）
```

注意：

- **`type` 的 `text` 是输入值**，不要同时用它做定位；用 `selector` / `bid` 定位。
- 定位键 `bid` 是快照运行时编号，**不要写进 YAML**（每次运行都会变）；录制器只生成
  `selector`（`B.sel.bestSelector`）+ 可选 `text` 回退。
- 变量替换：`${vars.x}`（flow `vars` + 运行参数合并）与 `${env.NAME}`（扩展设置里的
  `flowenv` 映射，缺了报错），作用于动作参数与 expect 值，支持嵌套结构。
- `nav` / `back` / `reload` 后固定等 0.5s 再继续；真正等待页面就绪请写 `expect`。
- 不支持 `data_file`（浏览器内读不到仓库文件）；数据请内联到 `data`。

## 子流程与数据驱动

### 子流程（`do: flow`）

```yaml
- id: s03
  do: flow
  name: sub-login          # 扩展库里的另一个 flow（须先保存入库）
  vars: { user: ${vars.u} } # 可选：传给子流程的变量
```

- 子流程在**同一目标页**上执行；报告里该步嵌套子步骤（`steps`）与汇总（`passed/total`）
- 子流程自身失败（含其内部断言）→ 该步失败；可配合 `expect` / `retry` / `on_fail`
- 嵌套 ≤ 5 层；**禁止循环引用**（调用链写进失败原因）
- 步骤 `vars` 先按父流程变量展开，再覆盖子流程自身 `vars`

### 数据驱动（仅 `data`）

```yaml
flow: search-check
data:                     # 内联列表（≤200 组）
  - { kw: playwright }
  - { kw: puppeteer }
steps: [...]              # 每组数据完整跑一遍，${vars.kw} 取当组值
```

- 每组独立判定成败，某组失败**不影响后续组**（组内仍遵循 `stop_on_fail` / `on_fail`）
- 报告：`data_rows / passed_rows / failed_rows` 汇总 + `rows` 明细；每个步骤条目带 `row` 标记；
  异步进度按 步×组 计
- console 轨迹每组一条 `▶ 数据组 i/N`（不回显组值）
- 全部组跑完才结束；某组因 `stop_on_fail` 中断时，未跑到的组不计入 `rows`

### 定时回归

无内置调度器，两种现成方式：

- **CLI + 系统计划任务**（Windows 任务计划 / cron）：定时执行
  `python cli_client.py flow <本地flow.yaml> --page <标记>`，退出码 0/1 即成败
- **Trae 的 schedule 技能**：定时触发同一命令并把结果消息化

## 执行语义

1. 逐步执行；每步收集 `{id, do, params(脱敏), ok, ms, url(执行后), error?, expect?, row?, dataUrl?(截图)}`。
2. **跨页续跑**：动作执行前写 `pending` 到 session；若动作触发跳转，新页面实例发现 URL
   已变且 pending 属于 nav/click/press/back/reload，即判定该步完成并继续下一步。
3. 失败（命令报错或断言不过）→ **自动截图**（`captureVisibleTab`，dataUrl 内联进报告，不落盘）；
   `on_fail: continue` 放行，否则中断（`stop_on_fail=false` 时全量跑完）。
4. `screenshot` 步骤返回 dataUrl，报告内联（工具箱渲染缩略图；CLI 只显示长度，避免刷屏）。
5. **console 轨迹**：每步执行后往页面 console 打一行
   `[flow:名] s04 click selector=… → OK 340ms`（FAIL 带原因，error 级别）。
   实现链：flowrun 调 content `log` 动作 → 派发 `batb:flowlog` → capture-main.js 在
   MAIN world 代打。LLM 拉轨迹：`page_logs {q: "[flow:"}`。
6. **报告** JSON：同步返回；异步模式下由 broker 内存保留，`/flows/status` done 时返回。

## 接口

### MCP 工具 `flow`（op 风格，同 netlog）

| op | 参数 | 说明 |
|---|---|---|
| `list` | - | 列出扩展库（name / desc / steps / mtime） |
| `get` | `name` | 取 YAML 文本 |
| `save` | `yaml` | 解析 + 校验（结构 / id 唯一 / do 存在 / data 形状），存进扩展库（保留原文注释） |
| `delete` | `name` | 删除 |
| `run` | `name` 或 `yaml`，`page?`, `vars?`, `from_step?`, `stop_on_fail?`, `mode?` | 执行并返回报告。`mode=sync`（默认）等完返回（MCP 等待上限 115s）；`mode=async` 立即返回 `{run_id, status:"running", steps_total, poll}` |
| `status` | `run_id`, `wait_ms?` | 轮询异步运行：`{flow, status, steps_total, done, passed, failed}`，done 时带完整 `report`；`wait_ms` 上限 60000 |

> 库操作（list/get/save/delete）需要一个在线页面即可（库是扩展本地存储）；
> 没有在线页面时返回明确错误。运行记录只在 broker 内存，done 超 1h 清理。

### HTTP（CLI / 扩展桥 / 外部接入共用）

```
GET    /flows          库列表
POST   /flows/run      执行  body {name|yaml, page?, vars?, from_step?, stop_on_fail?, mode?}
                       （?timeout 默认 600s；mode=async 立即返回 run_id；超时后返回 202 + run_id）
GET    /flows/status   异步进度轮询  ?run_id=xxx&wait_ms=0（done 时带完整报告）
GET    /flow/{name}    取 YAML 文本
PUT    /flow/{name}    保存  body {"yaml": "..."}（扩展侧解析 + 校验后入扩展库）
DELETE /flow/{name}    删除
```

### CLI（CI 入口，只需 python + Chrome 扩展 + broker）

```
python cli_client.py flow <本地flow.yaml> [--page mark] [--var k=v ...]
                   [--from-step s03] [--keep-going]
```

逐步打印 `OK/FAIL id do 参数 → 结果`，退出码 0/1；本地文件在客户端读取后内联发送。

## 存放

| 位置 | 内容 |
|---|---|
| `chrome.storage.local.flows` | flow 库（`name -> {yaml, ts}`，浏览器本地，按扩展安装隔离） |
| `chrome.storage.local.flowenv` | `${env.X}` 的映射（如 `{PWD: "..."}`），不入 YAML |
| `chrome.storage.session.flowrun:<tabId>` | 未完成的运行状态（跨导航续跑，tab 关闭即清） |
| broker 内存 `FLOW_RUNS` | 运行进度 / 报告（按 run_id，重启 broker 即清） |

## 限制与分期

- **纯扩展执行**：YAML 解析器为 `chrome-extension/vendor/js-yaml.min.js`（随扩展打包，
  content script 与 background 共用）；无 Python runner、无 pyyaml 依赖。
- **录制**：capture 阶段 hook click / change / Enter；输入在 change（失焦）时记录，
  下拉记 value，勾选框记点击，密码记 `${env.PWD}` + `secret:true`；起始 URL 自动记为第一条 nav；
  工具箱自身 DOM（Shadow Root）不录；selector 由 `B.sel.bestSelector` 生成，点击步附可见文本。
  - 跨页续录：录制会话存 background `chrome.storage.session`（key `flowrec:<tabId>`）；
    工具箱每次注入时询问，URL 变了由 background 自动补一条 nav 步骤；tab 关闭即清。
  - 导出 / 导入：复制 / 下载 YAML；粘贴后「导入保存」或「直接运行（不保存）」。
  - flow 库与运行（扩展版）：`tb:flow` 桥 → background 直接读写 `chrome.storage.local`；
    「运行」经 broker 转发给本页 `flowrun.js`，报告渲染进面板（截图内联为缩略图）。
- **重试**：`retry`（额外次数，上限 10）/ `retry_wait_ms`（间隔，默认 1000）；动作报错与
  断言不过都会重试，变量展开错误不重试；重试成功后报告不留 error。
- **已知边界**：`type` 不支持按 text 定位；iframe 内元素依赖现有 click/dom 能力；
  expect 的 `text` 读 `innerText`；`data_file` 不支持；`${env.X}` 只在扩展本地配置里取；
  录制依赖 toolbox 注入的白名单页面；broker 开启 `BRIDGE_TOKEN` 时工具箱的库操作 / 运行会 401。
- **前置条件**：扩展更新后需**刷新页面**（content script / flowrun 才会换新）；运行目标页需已接入白名单。
