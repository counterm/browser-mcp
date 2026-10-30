# spec-flow：YAML 测试流

> 用 YAML 编排页面操作序列（代替 Playwright 的轻量路线）：**不引入 Node / Playwright**，
> 由 broker（Python）解析并逐步下发**现有的 page_call 命令**执行，扩展只做执行器。
> 面向回归冒烟、页面操作流；复杂场景仍可用工具箱 `pwcode` 生成 Playwright 代码。

## 总体架构（单一 runner 原则）

```
编写：工具箱录制（实装）/ 粘贴导入 / 手写
            │
            ▼
flows/*.yaml ────────────── broker · flow runner（唯一执行器，Python）
（真相源，Git 友好）            │  逐步构造 page_call 同款命令
   ▲                           ▼
   │                    content.js 动作执行（click / type / nav / eval …）
LLM(MCP flow) / CLI / CI        │
            ┌───────────────────┴───────────────┐
            ▼                                   ▼
   运行报告 JSON（一次性反馈，落盘 .flows/）   console 回显（[flow:名] 前缀，
                                              capture-main MAIN world 代打，
                                              plog 可用 q="[flow:" 拉取轨迹）
```

- **真相源 = broker 磁盘 `flows/*.yaml`**：CLI / CI / Git 直接读；LLM 经 MCP 读写同一份。
  不用 chrome.storage / OPFS 做真相源（CLI 拿不到文件、进不了 Git）；扩展侧
  `chrome.storage.session` 只做**录制会话续存**（按 tab，跨导航存活，tab 关闭即清）。
  工具箱的库操作经 `batb:bridge` → background 直接 fetch broker HTTP 端点（同一真相源，无副本）。
- **runner 只在 broker**：Python 解析 YAML，逐步走 `call_page`；不往扩展塞 YAML 解析器。

## YAML schema（v1）

```yaml
flow: demo-login          # 必填，唯一名 = 文件名（小写字母/数字/-/_，≤64 字符）
desc: 登录并检查仪表盘     # 可选，描述（list 时展示）
vars:                     # 可选，${vars.x} 变量；密码走 ${env.NAME} 不落盘
  user: admin
steps:                    # 必填，非空
  - id: s01               # 必填，flow 内唯一，报告与轨迹按 id 输出
    do: nav               # 必填，见下方动作表
    url: https://example.com/login
  - id: s02
    do: type
    selector: '#username' # 定位三选一：selector / text / bid（同 page_call）
    text: ${vars.user}    # type 的 text = 输入值（type 不支持按 text 定位，见下）
  - id: s03
    do: type
    selector: '#password'
    text: ${env.DEMO_PWD}
    secret: true          # 报告与 console 轨迹中打码为 ***
  - id: s04
    do: click
    selector: 'button[type=submit]'
    text: 登录            # 备选定位：页面端 locate 按 bid→selector→text 依次回退
    expect:               # 断言：单键映射或其列表，全部满足才过
      url_contains: /dashboard
    max_wait_ms: 8000     # expect 轮询上限（默认 5000，上限 30000）
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
| `retry` | 可选 | 失败后额外重试次数（总尝试 = retry+1，上限 10）。动作报错与断言不过都会重试；变量展开错误不重试；重试过程往 console 打 warn 轨迹 |
| `retry_wait_ms` | 可选 | 每次重试间隔毫秒，默认 1000，上限 60000 |
| `secret` | 可选 | true 时报告/轨迹里打码 `text` / `value` / `code` 值 |
| `on_fail` | 可选 | `continue` 该步失败继续跑（默认失败即停，除非 flow 级 `stop_on_fail=false`） |
| `name` / `vars` | `do: flow` 时 | `name`=子流程名（须已保存入库）；`vars`=传给子流程的变量（先按父流程变量展开再覆盖子流程自身 vars） |
| 其余键 | 按动作 | **与 page_call 参数 1:1**（url / text / value / key / code / ms / files …），见 README 命令表 |

### 支持的 `do`（= page_call 白名单，剔除 runner 内部用的 ping/snapshot/plog，另有编排动作 flow）

```
click type press select scroll hover nav back reload eval
cookies storage upload wait highlight dom screenshot
tab_list tab_open tab_close tab_activate netlog
flow   # 子流程（编排动作，见下文）
```

注意：

- **`type` 的 `text` 是输入值**，不要同时用它做定位（页面端会把值当可见文本再试一次）；
  用 `selector` / `bid` 定位。`select` 的值走 `value`，无冲突。
- 定位键 `bid` 是快照运行时编号，**不要写进 YAML**（每次运行都会变）；录制器只生成
  `selector`（`B.sel.bestSelector`）+ 可选 `text` 回退。
- 变量替换：`${vars.x}`（flow `vars` + 运行参数合并）与 `${env.NAME}`（环境变量，缺了报错），
  作用于动作参数与 expect 值，支持嵌套结构（如 `files`）。
- `nav` / `back` / `reload` 后固定等 0.5s 再继续；真正等待页面就绪请写 `expect`。

## 子流程与数据驱动

### 子流程（`do: flow`）

```yaml
- id: s03
  do: flow
  name: sub-login          # flows/ 库里的另一个 flow（须先保存入库）
  vars: { user: ${vars.u} } # 可选：传给子流程的变量
```

- 子流程在**同一目标页**上执行；报告里该步嵌套子步骤（`steps`）与汇总（`passed/total`）
- 子流程自身失败（含其内部断言）→ 该步失败；可配合 `expect` / `retry` / `on_fail`
- 嵌套 ≤ 5 层；**禁止循环引用**（自引用与互引都会让该步失败并在报告写明调用链）
- 步骤 `vars` 先按父流程变量展开，再覆盖子流程自身 `vars`（子流程自己的 vars 仍生效）

### 数据驱动（`data` / `data_file`）

```yaml
flow: search-check
data:                     # 内联列表（≤200 组），或改用 data_file: users.csv
  - { kw: playwright }
  - { kw: puppeteer }
steps: [...]              # 每组数据完整跑一遍，${vars.kw} 取当组值
```

- `data` 与 `data_file` 二选一；`data_file` 相对 **flows/ 目录**解析，支持 `.json`（对象数组）
  与 `.csv`（首行表头，值均为字符串，UTF-8 含 BOM 兼容）
- 每组独立判定成败，某组失败**不影响后续组**（组内仍遵循 `stop_on_fail` / `on_fail`）
- 报告：`data_rows / passed_rows / failed_rows` 汇总 + `rows` 明细；每个步骤条目带 `row` 标记；
  异步进度按 步×组 计
- console 轨迹每组一条 `▶ 数据组 i/N`（不回显组值，避免敏感数据进 console）

### 定时回归

无内置调度器，两种现成方式：

- **CLI + 系统计划任务**（Windows 任务计划 / cron）：定时执行
  `python cli_client.py flow flows/regression.yaml`，退出码 0/1 即成败，报告落 `.flows/`
- **Trae 的 schedule 技能**：定时触发同一命令并把结果消息化

## 执行语义

1. 逐步执行；每步收集 `{id, do, params(脱敏), ok, ms, url(执行后), error?, expect?, path?(截图)}`。
2. 失败（命令报错或断言不过）→ **自动截图**存 `.flows/`，路径写进报告；
   `on_fail: continue` 放行，否则中断（`stop_on_fail=false` 时全量跑完）。
3. `screenshot` 步骤：dataUrl 自动落盘 `.screenshots/`，报告给 `path`（同 page_call）。
4. **console 轨迹**：每步执行后往页面 console 打一行
   `[flow:名] s04 click selector=… → OK 340ms`（FAIL 带原因，error 级别）。
   实现链：broker `log` 动作 → content.js 派发 `batb:flowlog` → capture-main.js 在
   MAIN world 代打（ISOLATED world 的 console 过不了它的 hook，plog 抓不到）。
   LLM 拉轨迹：`page_logs {q: "[flow:"}`。纯 fallback 页面无 capture-main，静默跳过。
5. **报告** JSON 同步返回（MCP 一次性反馈），同时落盘 `.flows/<flow>-<runid>.json`。

## 接口

### MCP 工具 `flow`（op 风格，同 netlog）

| op | 参数 | 说明 |
|---|---|---|
| `list` | - | 列出 flows/ 库（name / desc / steps / mtime） |
| `get` | `name` | 取 YAML 文本 |
| `save` | `yaml` | 解析 + 校验（结构 / id 唯一 / do 白名单 / expect 键），存 `flows/<flow名>.yaml`（保留原文注释） |
| `delete` | `name` | 删除 |
| `run` | `name` 或 `yaml`，`page?`, `vars?`, `from_step?`, `stop_on_fail?`, `mode?` | 执行并返回报告。`mode=sync`（默认）等完返回（MCP 等待上限 115s）；`mode=async` 立即返回 `{run_id, status:"running", steps_total, poll}`，报告同时照常落盘 |
| `status` | `run_id`, `wait_ms?` | 轮询异步运行：返回 `{flow, status, steps_total, done, passed, failed}`，done 时带完整 `report`；`wait_ms`（上限 60000）为长轮询等待。运行记录只在 broker 内存，done 超 1h 或总量超 50 清理 |

### HTTP（CLI / 扩展桥 / 外部接入共用）

```
GET    /flows          库列表
POST   /flows/run      执行  body {name|yaml, page?, vars?, from_step?, stop_on_fail?, mode?}（?timeout 默认 600；mode=async 立即返回 run_id）
GET    /flows/status   异步进度轮询  ?run_id=xxx&wait_ms=0（done 时带完整报告）
GET    /flow/{name}    取 YAML 文本
PUT    /flow/{name}    保存  body {"yaml": "..."}（解析+校验后落盘）
DELETE /flow/{name}    删除
```

### CLI（CI 入口，只需 python + Chrome 扩展 + broker）

```
python cli_client.py flow flows/demo-smoke.yaml [--page mark] [--var k=v ...]
                   [--from-step s03] [--keep-going]
```

逐步打印 `OK/FAIL id do 参数 → 结果`，退出码 0/1；报告路径在结尾输出。

## 存放

| 路径 | 内容 |
|---|---|
| `flows/*.yaml` | flow 库（真相源，随仓库版本化） |
| `.flows/*.json` | 运行报告存档（不入 Git，已加 .gitignore）；失败截图与 page_call 截图同存 `.screenshots/` |

## 限制与分期

- M1（已实现）：broker runner + `flow` MCP 工具 + HTTP 端点 + CLI + console 回显。
  同步执行，MCP 上限 115s。
- M2（已实现）：工具箱「操作录制 → flow」实装（`feats/build.js` 两树同步，替换原 mock）：
  - 录制：capture 阶段 hook click / change / Enter；输入在 change（失焦）时记录，下拉记 value，
    勾选框记点击，密码记 `${env.PWD}` + `secret:true`（明文不落盘）；起始 URL 自动记为第一条 nav；
    input/textarea/select 的聚焦点击不录（噪音）；工具箱自身 DOM（Shadow Root）不录；
    selector 由 `B.sel.bestSelector` 生成，点击步附可见文本（`text`）作运行时回退定位。
  - 跨页续录：录制会话存 background `chrome.storage.session`（key `flowrec:<tabId>`）；
    工具箱每次注入时 `tb:flowrec get` 询问，URL 变了由 background 自动补一条 nav 步骤；
    tab 关闭即清。
  - 导出 / 导入：复制 / 下载 YAML；粘贴 YAML「导入保存」（服务端 schema 校验）。
  - flow 库与运行（扩展版）：`tb:flow` 桥 → background `brokerFetch` 直连 broker HTTP
    （list/get/save/delete/run）；库内一键「运行」以本页页桥标记为目标页，报告渲染进面板。
    原型树无扩展桥：录制与复制 / 下载可用，库功能显示提示。
  - 值转变量：「⇄变量」按钮把录制值替换为 `${vars.vN}` 并收进 flow `vars`。
- M3（已实现）：
  - 异步执行：`run` 带 `mode=async`（MCP / HTTP 均可）立即返回 `run_id`，`op=status`（可
    `wait_ms` 长轮询）取进度 `{done/passed/failed}` 与最终报告；工具箱「运行」已切到该模式
    （进度条式刷新，长流不受单次请求超时限制）；CLI 仍为同步。
  - 步骤级重试：`retry`（额外次数，上限 10）/ `retry_wait_ms`（间隔，默认 1000）；动作报错与
    断言不过都会重试，变量展开错误不重试；重试过程打 warn 级 console 轨迹；重试成功后报告
    不留 error。
- 编排扩展（已实现）：
  - 子流程：`do: flow {name, vars?}` 从库加载另一个 flow 递归执行（同一目标页），报告嵌套
    子步骤与汇总；嵌套 ≤5 层、禁循环引用（调用链写进失败原因）
  - 数据驱动：flow 级 `data`（内联 ≤200 组）或 `data_file`（flows/ 下 .json/.csv），每组完整
    跑一遍；报告 `data_rows/passed_rows/failed_rows` + `rows` 明细，步骤条目带 `row` 标记，
    组间互不影响；工具箱与 CLI 报告均显示数据组汇总
  - 定时回归：无内置调度器，走 CLI + 系统计划任务 / Trae schedule 技能（见上文）
- 已知边界：`type` 不支持按 text 定位；iframe 内元素依赖现有 click/dom 的能力边界；
  expect 的 `text` 读的是 `innerText`（`display:none` 文本不算）；
  录制依赖 toolbox 注入的白名单页面（未注入的页面不记录）；
  broker 开启 `BRIDGE_TOKEN` 时工具箱的库操作 / 运行会 401（扩展侧没有 token，
  WS 通道本身不鉴权属既有行为）——本地单机场景建议不设 token。
