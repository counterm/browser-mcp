# Browser Agent

**简体中文** ｜ [English](#english)

把浏览器页面通过本地通道开放给任意 CLI / IDE / Agent 控制的轻量体系。
纯页面文本化（无截图依赖的多模态），LLM 用元素编号定位，适合做浏览器自动化编排。

当前版本：**v0.1.15**（`chrome-extension/manifest.json` 与 `page-bridge.user.js` 保持一致）

```
┌─ 浏览器（N 个标签页）──────────┐       ┌─ 本机 ───────────┐         ┌─ 任意外部工具 ────────────┐
│ 接入端（扩展 或 油猴脚本）      │ WS/   │ broker.py       │  HTTP   │ CLI / IDE / MCP / curl   │
│ ·自动加载，轻注入，零构建       │──────▶│ ·页面注册中心   │◀───────│ ·GET /pages   发现        │
│ ·hello 广播(url/title/caps)   │       │ ·上线/下线广播    │         │ ·校验 URL 是否适合        │
│ ·snapshot/动作执行/eval       │◀──────│ ·命令转发/等结果 │────────▶│ ·POST /call  接入操控     │
└──────────────────────────────┘        └─────────────────┘         └───────────────────────────┘
```

## 目录结构与文件说明

| 文件 | 作用 |
|---|---|
| `broker.py` | 本地注册/广播/转发中心。维护在线页面表，把外部命令转发给对应页面并等结果。**唯一需要常驻运行的进程** |
| `requirements.txt` | broker 的 Python 依赖（仅 aiohttp） |
| `cli_client.py` | 外部 CLI 接入示例（纯标准库）：发现 → 校验 URL → 接入 → LLM 驱动循环 |
| `chrome-extension/` | 接入端方案 A（推荐）：Chrome 扩展 MV3 |
| ├ `manifest.json` | 扩展清单：权限、注入规则（`<all_urls>`，排除 broker 自身端口）、action popup、options 页 |
| ├ `background.js` | Service Worker：每个标签页维持一条到 broker 的 WebSocket；命令路由（DOM 动作转发给 content，截图/标签管理自己执行）；站点白名单过滤；webRequest 观察模式接口捕获（URL/请求头/请求体/响应头） |
| ├ `filter.js` | 白名单核心：配置存储、eTLD+1 主域名提取、匹配引擎（SW/popup/options 共用） |
| ├ `popup.html` / `popup.js` | 工具栏弹窗：接入总开关、当前页白名单状态、一键加入/移出 |
| ├ `options.html` / `options.js` | 完整配置页：域名列表与正则规则的增删改查、导入导出、正则实时测试面板 |
| ├ `capture-main.js` | 页面捕获层（`document_start` 注入 MAIN world）：包裹 fetch/XHR 抓请求体/响应体，与 bg 的 webRequest 头记录合并；同时 hook `console` / 未捕获异常 / 资源加载失败 / CSP，写入 `__BATB_LOG__` 供 `plog` 查询。接口部分供「接口调用」工具与 `netlog` 协议共用（见 `docs/spec-net-protocol.md`） |
| ├ `content.js` | 内容脚本：每个标签页一个实例，负责 DOM 快照与动作执行（click/type/eval 等）；并为页面工具箱转发扩展桥消息（`batb:bridge` → background）、把 LLM 的 `netlog` / `plog` 查询转给页面捕获层 |
| └ `toolbox/` | 页面工具箱（设计原型 `docs/toolbox/` 的落地版）：14 个零构建模块，background 按白名单注入页面主世界，六分类 36 项功能（提示 / 查找 / 样式与屏蔽 / 发给 LLM / 开发产物 / 采集） |
| `page-bridge.user.js` | 接入端方案 B：油猴脚本版。与扩展二选一；被页面 CSP 拦截时自动降级 GM 长轮询 |
| `build/` | 打包产物与测试密钥：`make-test-key.mjs`（生成测试私钥）、`debug-extension.pem`、`chrome-extension.crx` |
| `docs/research/1.md` | 早期调研笔记（console 注入方案的原理与坑） |

> 扩展版与油猴版功能重叠，**不要同时装**，否则同一标签页会在 broker 里注册两条。
> 扩展版更强：不受页面 CSP 限制、支持跨标签动作和截图。

## 快速开始

### 1. 启动 broker（本机常驻）

```powershell
pip install -r requirements.txt
python broker.py
# 可选环境变量：
#   BRIDGE_PORT=8766          换端口
#   BRIDGE_TOKEN=xxx          接口鉴权（外部请求需带 ?token=xxx 或 X-Bridge-Token 头）
```

### 2. 浏览器接入（二选一）

**方案 A：Chrome 扩展（推荐）**

1. Chrome 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」→ 选择 `chrome-extension` 目录
4. 打开任意网页，页面自动广播上线

> 要操控本地 `file://` 页面，需在扩展详情页开启「允许访问文件网址」。

**方案 B：油猴脚本**

1. 安装 Tampermonkey 扩展
2. Tampermonkey 面板 → 添加新脚本 → 粘贴 `page-bridge.user.js` 全部内容 → 保存
3. 打开任意网页自动生效，无需其他操作

### 3. 验证

```powershell
curl http://127.0.0.1:8766/pages
# [{"id":"a1b2c3d4","url":"https://github.com","title":"GitHub","mode":"ws","ago":1.2}, ...]
```

打开几个标签页，每个都会出现一条记录。页面关闭/跳转时列表自动更新。

## Chrome 扩展怎么打包

**方式一：zip 分发（最常用）**

```powershell
Compress-Archive -Path chrome-extension\* -DestinationPath page-bridge-extension.zip
```

对方解压后按上面「加载已解压的扩展程序」安装（需开发者模式）。
注意：Windows 版 Chrome **不允许**直接拖装非商店 `.crx`，zip + 开发者模式是最省事的本地分发方式。

**方式二：Chrome 自带打包（生成 .crx）**

`chrome://extensions` → 「打包扩展程序」→ 扩展程序根目录选 `chrome-extension` → 打包。
得到 `.crx` + 私钥 `.pem`。**保管好 .pem**：以后更新要用同一私钥打包，扩展 ID 才不变。

命令行等效（也可用于测试流程自动化）：

```powershell
# 1. 生成测试私钥（输出 build\debug-extension.pem + 对应扩展 ID）
node build\make-test-key.mjs

# 2. 用指定私钥打包
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
    --pack-extension="E:\WORK\PROJECT\TOOLS\browser-agent\chrome-extension" `
    --pack-extension-key="E:\WORK\PROJECT\TOOLS\browser-agent\build\debug-extension.pem"
# 产出: chrome-extension.crx（Chrome 默认写在扩展目录旁）
```

扩展 ID 由私钥唯一决定（如测试密钥对应 `nfljnkjkdgddlmfnmgogjkipcaekndll`），
`make-test-key.mjs` 拒绝覆盖已有 `.pem`，防止误删后 ID 变化。
⚠️ 测试私钥仅限本地使用；泄露私钥 = 任何人可向同一扩展 ID 推送更新。

**方式三：上架 Chrome Web Store**

先在[开发者后台](https://chrome.google.com/webstore/devconsole)注册（一次性 $5）→ 上传方式一的 zip → 审核。
本扩展申请了 `<all_urls>` + `tabs` 权限，审核会要求说明用途，可能需要几天。

## 外部怎么接入（任何 CLI / IDE，无需 SDK）

| 接口 | 用途 |
|---|---|
| `GET /pages` | 发现：在线页面列表（id / url / title / mode / ago / eval_mode） |
| `GET /events` | 订阅广播（SSE）：`page_up` / `page_update` / `page_down` / `page_event` |
| `POST /call/{pid}` | 接入并执行一条命令：body 为命令 JSON，`?timeout=30` 控制等待 |
| `GET /marks` | 列出全部页桥标记：`mark` / `online` / `pid` / `url` / `title` |
| `GET /mark/{mark}` | 按标记查网页：返回在线状态、`pid`、URL、标题（离线时给最后一次的 URL） |
| `POST /mark/{mark}` | 按标记执行命令（body 同 `/call/{pid}`，如 `{"action":"snapshot"}`） |
| `WS /client` | 长连接：收广播 + attach 页面 + 双向命令流（适合 IDE agent 常驻会话） |
| `POST /mcp` | **MCP 服务器**（Streamable HTTP，无状态）：`initialize` / `tools/list` / `tools/call` |
| `GET /sse` + `POST /messages` | **MCP 服务器**（旧版 HTTP+SSE 传输），供只支持 SSE 的客户端 |

```powershell
# 发现并校验 URL（"是否适合接入"由外部自己判断，比如正则匹配域名）
curl http://127.0.0.1:8766/pages

# 看页面快照（LLM 的眼睛：交互元素带 [bid] 编号 + 正文）
curl -X POST http://127.0.0.1:8766/call/a1b2c3d4 -d "{\"action\":\"snapshot\"}"

# 点击 3 号元素
curl -X POST http://127.0.0.1:8766/call/a1b2c3d4 -d "{\"action\":\"click\",\"bid\":3}"

# 截图（仅扩展版支持，返回 base64 PNG）
curl -X POST http://127.0.0.1:8766/call/a1b2c3d4 -d "{\"action\":\"screenshot\"}"
```

## MCP 接入（broker 自带，只跑一个进程）

`broker.py` 直接提供 MCP 服务（HTTP 与 broker 同端口；stdio 则随 MCP 客户端拉起）：页面接入、CLI 调用、MCP 客户端共用这一个进程，不需要另起 MCP 服务，也不需要额外依赖。

| 传输 | 地址 / 命令 | 说明 |
|---|---|---|
| Streamable HTTP（推荐） | `http://127.0.0.1:8766/mcp` | 无状态，`POST` 直接返回 JSON-RPC 响应；`GET /mcp` 按规范返回 405 |
| 旧版 HTTP+SSE | `http://127.0.0.1:8766/sse` | `GET /sse` 下发 endpoint 事件 → `POST /messages?sessionId=...`，响应走 SSE |
| stdio | `python broker.py --stdio` | 由 MCP 客户端拉起，**broker 随 MCP 一起启动**，无需先跑 `start-broker.bat` |

**方式一：连已启动的 broker**（先跑 `start-broker.bat`；开了 `BRIDGE_TOKEN` 时 URL 追加 `?token=<token>`）：

```json
{
  "mcpServers": {
    "page-bridge": { "url": "http://127.0.0.1:8766/mcp" }
  }
}
```

**方式二：让 MCP 客户端自动拉起（stdio，进程即 broker）**：

```json
{
  "mcpServers": {
    "page-bridge": {
      "command": "python",
      "args": ["E:\\WORK\\PROJECT\\TOOLS\\browser-agent\\broker.py", "--stdio"]
    }
  }
}
```

- 用绝对路径；走项目虚拟环境时把 `command` 换成 `…\\browser-agent\\.venv\\Scripts\\python.exe`
- 进程内同时跑 stdio JSON-RPC 和 `127.0.0.1:8766` 中枢，页面照常接入；stdout 只留 JSON-RPC，日志全部走 stderr
- 客户端断开（stdin EOF）后进程自动退出、端口释放
- 同一端口只允许一个实例：已有 broker 在跑时 stdio 实例会报错退出，此时改用方式一
- 不要把 `start-broker.bat` 配成 stdio 的 `command`——bat 的 echo 会污染 stdout

MCP 工具：

| 工具 | 参数 | 作用 |
|---|---|---|
| `list_pages` | - | 发现当前接入的页面（id / mark / url / title / ago） |
| `list_marks` | - | 标记列表（离线时也给最后一次 URL） |
| `page_snapshot` | `page?` | 实时快照（交互元素带 bid 编号 + 正文） |
| `page_call` | `page?, action, timeout?, ...` | 下发任意命令，参数同下方命令表（click / type / nav / eval / dom / screenshot…） |
| `page_logs` | `page?, since?, doc?, kinds?, levels?, q?, limit?, text_max?, wait_ms?, clear?, redact?` | **仅扩展版**：读取页面运行日志与异常（console / 未捕获异常 / Promise 拒绝 / 资源加载失败 / CSP），带 `t / iso / perf` 发生时间、行列号与堆栈。用 `since` + `doc` 游标增量拉取；`wait_ms>0` 时页面侧长轮询等待新异常（≤20s），适合动作后确认是否报错 |

`page` 可传标记 id 或 pid；只有一个在线页面时可省略。工具调用与 `/call` 走同一条转发链路，超时上限同样 120s。

## 命令一览

`bid` 可传快照里的元素编号，也可直接传 CSS selector。

| action | 参数 | 说明 |
|---|---|---|
| `ping` | - | 探活，返回页面信息 |
| `snapshot` | - | 页面快照：url/title/viewport/滚动位置/元素列表/正文 |
| `dom` | `selector?, bid?, depth?, maxNodes?, maxChars?, collapse?, redact?` | 精简 DOM：**Pug 缩进树**（`tag.class#id(attr) 文本`），保留层级与语义属性。默认 `selector=body`、深度 8、1500 节点、6 万字符、连续同类兄弟 ≥3 折叠为 `×N`、`redact=true` 脱敏；传 `bid`（或 `selector` 填纯数字）可只输出该元素及其子孙；返回 `{selector, nodes, chars, truncated, content}` |
| `click` | `bid` | 滚动到元素并点击（带完整鼠标事件序列） |
| `type` | `bid, text, clear?` | 输入文本，走原生 setter，兼容 React/Vue 受控组件 |
| `press` | `key, bid?` | 按键（Enter 会自动提交表单/点击） |
| `select` | `bid, value` | 下拉选择 |
| `scroll` | `dy?` 或 `bid` | 滚动页面或滚到某元素 |
| `hover` | `bid` | 悬停 |
| `nav` | `url` | 页面跳转 |
| `back` / `reload` | - | 后退 / 刷新 |
| `eval` | `code` | 页面内执行任意 JS（支持 async/await）。扩展版优先走 userScripts 通道绕过 CSP；油猴版/未开启开关时走内容脚本，受页面 CSP 约束。详见下方「eval 与 CSP」 |
| `cookies` | `op?, name?, value?` | 读/写 cookie（op=get/set） |
| `storage` | `area?, key, value?` | 读/写 localStorage / sessionStorage |
| `upload` | `bid, files:[{name,mime,content}]` | 给 `<input type=file>` 塞文件 |
| `wait` | `ms` | 等待（上限 15s） |
| `highlight` | `bid` | 红框标出元素 2 秒（调试用） |
| `netlog` | `op, q?, id?, limit?, max?, redact?` | **仅扩展版**：查询页面捕获的接口记录（URL/请求体/响应/鉴权头）。`op=list` 拿摘要（不含 body）→ `op=get {"id":N}` 取完整记录 → `op=curl {"id":N}` 拿可回放 cURL；`op=clear` 清空。**`redact` 默认脱敏鉴权字段**，仅必要时置 false。详见 `docs/spec-net-protocol.md` |
| `plog` | `op?, since?, doc?, kinds?, levels?, q?, limit?, text_max?, wait_ms?, clear?, redact?` | **仅扩展版**：查询页面日志与异常。`kinds` 取 `console / exception / rejection / resource / csp`，`levels` 取 `error / warn / info / log / debug`；返回 `{doc, cursor, navigated, counts, items}`。`since` 传上次 `cursor` 增量拉取；`doc` 标识文档，导航后变化会返回 `navigated:true`；`wait_ms>0` 页面侧长轮询等待新异常（上限 20s）；`text_max` 默认单条 600 字符；`clear` 清空缓冲；`redact` 默认开 |
| `screenshot` | - | **仅扩展版**：截图，返回 `{format:"png", dataUrl}` |
| `tab_list` | - | **仅扩展版**：列出所有标签页 |
| `tab_open` | `url, active?` | **仅扩展版**：新开标签页 |
| `tab_close` | `tabId` | **仅扩展版**：关标签页（可传 pageId） |
| `tab_activate` | `tabId` | **仅扩展版**：切换到某标签页（可传 pageId） |

## cli_client.py（现成的编排示例）

```powershell
python cli_client.py list                          # 发现当前在线页面
python cli_client.py watch                         # 订阅广播事件流
python cli_client.py snap github.com               # 按 URL 子串找页面并看快照
python cli_client.py call <pid> "{\"action\":\"snapshot\"}"

# 一条龙：发现 → --match 校验 URL → 接入 → LLM 驱动循环直到 done
# 环境变量: OPENAI_API_KEY（必需） OPENAI_BASE_URL（可选，兼容接口） BRIDGE_MODEL（可选）
python cli_client.py run "在搜索框搜索 playwright 并打开第一个结果" --match github.com
```

`run` 的循环就是「snapshot → LLM 决策一个 JSON 命令 → POST /call → 结果回填 → 循环」，
你的 IDE/Agent 只需要复刻这个循环（或直接调 `/call` 接口）即可接入任何编排框架。

## 站点白名单

纯白名单模式：**只有白名单内的页面才接入 broker**（命中域名或正则即放行），其余页面不注册、不广播。

- **总开关（启用与否）**：popup 右上角与配置页标题栏右上角各有「启用」开关，**优先级高于一切规则**——关闭后所有页面断开 broker 且不注册（`/pages` 变空），重新打开自动按白名单恢复全部命中页面；状态只由开关本身表示，关闭时工具栏图标额外显示灰色 `OFF` 角标
- **入口**：点工具栏图标打开 popup —— 展示当前页是否在白名单（含命中来源：域名/正则），一键加入/移出
- **域名列表**：只存 eTLD+1 主域名（如 `github.com` 自动覆盖 `gist.github.com` 等所有子域名；`bbc.co.uk` 等多级后缀正确识别），支持增删改查、搜索、导入导出（JSON/纯文本）
- **正则规则**：匹配完整 URL，保存前校验合法性，附带实时测试面板
- **即时生效**：配置改动后已注册页面按新规则断开/恢复，无需刷新页面；当前 tab 命中白名单时工具栏图标显示角标 `W`
- 详细需求与设计见 `docs/spec-url-filter.md`

## 页面工具箱（toolbox）

按白名单注入的页面内工具面板，设计原型见 `docs/toolbox/`（架构图 `docs/toolbox-proto-map.md`）：

- **注入**：页面命中白名单后，background 经 `chrome.scripting` 把 `chrome-extension/toolbox/` 下 14 个模块注入**页面主世界**（MAIN world）——React fiber 反查、fetch 拦截、`window.__BA_*` 都要在页面上下文才可见；注入不受页面 CSP 限制
- **门控即时生效**：白名单配置变更后，已注入页面经 DOM 事件 `batb:gate` 同步显隐——移出白名单立即隐藏，重新命中自动恢复；未注入过的命中页面自动补注入
- **入口**：右下角圆形 FAB（可拖拽、位置记忆、`Alt+Shift+D` 唤起），六分类 36 项功能（提示 / 查找 / 样式与屏蔽 / 发给 LLM / 开发产物 / 采集）
- **中英双语**：面板底部「EN / 中文」一键切换，默认中文，选择存 `localStorage` 刷新后保持；分类、功能名与说明、结果卡片、提示语等全部界面文案均有英文版本
- **采集**：「网址二维码」把当前网址纯本地生成二维码（扫码在手机打开，可下载 PNG / 复制链接，内嵌 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) MIT 裁剪版）；「整页截图」滚动逐屏截取、拼接为长图并自动下载 PNG；「容器截图」拾取任意元素——可滚动容器只截其内部完整滚动范围（自动向上定位滚动祖先、逐屏裁剪拼接），普通元素截取当前可见区域——两类截图均自动处理浮动元素（fixed 临时隐藏、sticky 临时取消吸附，完成后还原），避免每屏重复；「接口调用」双层捕获页面请求——页面捕获层（`capture-main.js`，document_start 包裹 fetch/XHR）抓请求体/响应体 + webRequest 观察模式抓全量请求头（含 Cookie/Authorization），按 URL+时间合并，列表点开详情可**复制调试文本 / 复制 cURL** 粘给 LLM（默认脱敏 Cookie/token 等鉴权字段，可手动关）；截图两项均经**扩展桥**（content.js 中继 `batb:bridge` → background `captureVisibleTab`）实现，需 content.js 与扩展版本一致（更新扩展后刷新页面）
- **接口调用的 LLM 查看通道**：LLM 经 broker 发 `netlog` 命令自主查询捕获记录（`list` 摘要 → `get` 详情 / `curl` 回放，无需人工点击），协议与局限详见 `docs/spec-net-protocol.md`
- **发给 LLM 的存储通道**：结果写 `localStorage["ba:ctx"]` / `["ba:el"]`，LLM 经 broker 的 `storage` 动作自取（`window.__BA_*` 仅页面主世界可见，跨进程读取请用 storage）；「复制页桥标记」复制的是**网页 id**（扩展在页面接入时用 JS 生成、按 tab 存在 `chrome.storage.session`，随 hello/hb 上报），LLM 凭 `GET /mark/<id>` 即查回 URL 与在线状态、`POST /mark/<id> {"action":"snapshot"}` 取实时快照继续操作
- 增删功能：改 `toolbox/feats/<分类>.js` 里 `B.register([...])` 数组即可；模块清单/加载顺序见原型地图

## eval 与 CSP（扩展版）

`eval` 在内容脚本里执行时会受**页面 CSP** 约束：GitHub、腾讯元宝等 `script-src 'self'` 严格站点会直接报
`unsafe-eval` 拦截错误。扩展版提供 userScripts 通道绕过（Chrome ≥ 135）：

1. `chrome://extensions` → Page Bridge → **详情** → 打开「**允许用户脚本**」(Allow user scripts) 开关
2. 无需重载扩展，下一个心跳（约 5 秒）内生效

**客户端如何感知**（LLM 编排必读）：

- `GET /pages` 每条页面带 `eval_mode` 字段：
  - `"userscript"` — 已开启开关，eval 不受 CSP 限制，任何页面可用
  - `"fallback"` — 未开启，eval 走内容脚本，严格 CSP 站点会失败
- `ping` 的返回里也带 `eval_mode`
- 在受限页面上调 `eval` 失败时，`error` 里会附带开启指引与风险提示，LLM 可原样转告用户

**风险提示（请转告用户）**：「允许用户脚本」开启后，代理可在任何页面执行任意 JS（读写页面数据、代发请求等）。
只在自己可控的浏览器上开启；不要在不可信的编排方接入时开启。

## 安全说明

- broker 只绑定 `127.0.0.1`，局域网不可见；公网机器上请务必设置 `BRIDGE_TOKEN`
- `eval` 等于把页面权限完全交给接入方，**只在自己可控的浏览器上启用**
- `netlog` 查询默认脱敏 Cookie/Authorization/token 类字段；`redact:false` 会拿到真实凭据值，仅在可控环境按需使用（见 `docs/spec-net-protocol.md`）
- 油猴版可用 `CFG.urlFilter`（正则白名单）限制只广播特定站点；扩展版用「站点过滤」配置黑白名单（见上文）
- 请勿用于未授权的网站或他人会话

## 已知边界

- 跨域 iframe 内部内容拿不到（同源策略，所有页面注入方案皆如此）
- 浏览器下载、多窗口管理未覆盖（需 CDP）
- 油猴版在强 CSP 页面会降级长轮询，延迟略高；扩展版无此问题
- 启用 Trusted Types 且无 default policy 的页面（部分 Google 站点）上，工具箱 UI 可能挂载失败（innerHTML 被拦截）

## 故障排查

| 现象 | 排查 |
|---|---|
| `/pages` 始终为空 | broker 没跑起来？扩展装了但没开过普通网页？**总开关被关了？**（点工具栏图标看「接入启用」）扩展详情页看 Service Worker 报错 |
| 页面在列表里但命令超时 | 标签页被浏览器休眠了，切换过去激活即可；或页面关闭前有未完成命令 |
| 油猴版某些页面连不上 | 看控制台 `[bridge]` 日志，若显示"降级为 HTTP 长轮询"即 CSP 拦截，属正常；或改用扩展版 |
| `file://` 页面不上线 | 扩展详情开启「允许访问文件网址」；油猴需在设置里允许访问文件 |
| 页面右下角没出现工具箱 FAB | 页面是否在白名单（popup 查看命中）；扩展详情页看 Service Worker 报错；`file://` 需「允许访问文件网址」 |
| 工具箱「整页截图」报扩展桥无响应 | 扩展刚更新过、页面里的 content.js 还是旧版（没有桥），刷新页面即可；或扩展详情页看 Service Worker 报错 |
| 工具箱 FAB 出现过又自行消失 | 站点把整个文档重写了（`document.open()/write()/close()`，如 Playcode 预览运行时；或 `createRoot(document.body)` 清空 body），宿主节点被一并移除。core.js 会在 1s 内自动挂回，界面状态与白名单显隐保留；若始终不回，刷新页面并看 `localStorage["ba:diaglog"]` 里的 `mount` 记录 |
| 工具箱 FAB 在，但点了没反应 / 面板打不开 | 同上场景的第二段：整块重写文档会连带清空 document（含 Shadow DOM）与 window 上的**全部事件监听**，节点与样式还在但监听没了。core.js 每 1s 用自定义事件 `batb:probe` 自检监听，发现被清空即重绑（`ba:diaglog` 里会有 `rebind` 记录）；若仍无反应，刷新页面并把 `copy(localStorage.getItem('ba:diaglog'))` 的内容反馈 |
| 工具箱「接口调用」提示捕获层未加载 / `netlog` 超时 | 扩展刚更新过：重载扩展 + 刷新页面（页面捕获层 `capture-main.js` 随页面加载注入）；检查页面是否在白名单（bg 只记录白名单页的请求） |
| `eval` 报 CSP / unsafe-eval 错误 | 属正常（页面 CSP 限制）。按「eval 与 CSP」章节开启扩展的「允许用户脚本」开关；或改用其他 DOM 动作 |
| `/pages` 里 `eval_mode` 一直是 `fallback` | userScripts 需要 Chrome ≥ 135 且手动开启「允许用户脚本」开关；`chrome://extensions` → Page Bridge → 详情里找 |

---

## English

[简体中文](#browser-agent) ｜ **English**

A lightweight system that exposes browser pages to any CLI / IDE / Agent over a local channel.
Pages are turned into text (no screenshot-dependent multimodality); the LLM locates elements by their numeric IDs, which suits browser automation orchestration.

Current version: **v0.1.15** (kept in sync between `chrome-extension/manifest.json` and `page-bridge.user.js`)

```
            Browser (N tabs)                   Local machine                   Any external tool
┌──────────────────────────┐         ┌────────────────────────┐        ┌─────────────────────────┐
│ extension / userscript   │         │ broker.py              │        │ CLI / IDE / MCP / curl  │
│ · hello broadcast        │  WS/   │ · page registry        │ HTTP   │ · GET /pages            │
│ · snapshot / actions     │────────▶│ · forward + await      │──────▶│ · POST /call            │
│ · eval                   │◀────────│ · up/down broadcast    │◀───────│ · WS /client            │
└──────────────────────────┘         └────────────────────────┘        └─────────────────────────┘
```

### Directory and files

| File | Purpose |
|---|---|
| `broker.py` | Local registry / broadcast / forwarding hub. Keeps the online-page table, forwards external commands to the right page and waits for results. **The only process that must stay running** |
| `requirements.txt` | Python dependencies for the broker (aiohttp only) |
| `cli_client.py` | Reference external CLI client (stdlib only): discover → validate URL → attach → LLM-driven loop |
| `chrome-extension/` | Connector option A (recommended): Chrome extension MV3 |
| ├ `manifest.json` | Extension manifest: permissions, injection rules (`<all_urls>`, excluding the broker's own port), action popup, options page |
| ├ `background.js` | Service worker: one WebSocket per tab to the broker; command routing (DOM actions go to content, screenshots/tab management run here); site allowlist filtering; webRequest observational capture of API calls (URL/request headers/request body/response headers) |
| ├ `filter.js` | Allowlist core: config storage, eTLD+1 registrable-domain extraction, matching engine (shared by SW / popup / options) |
| ├ `popup.html` / `popup.js` | Toolbar popup: master switch, allowlist status of the current page, one-click add/remove |
| ├ `options.html` / `options.js` | Full settings page: CRUD for domain list and regex rules, import/export, live regex tester |
| ├ `capture-main.js` | Page capture layer (injected into MAIN world at `document_start`): wraps fetch/XHR to capture request/response bodies and merges them with header records from the bg webRequest layer; also hooks `console` / uncaught exceptions / failed resource loads / CSP and writes to `__BATB_LOG__` for `plog` queries. The API part is shared by the "API Calls" tool and the `netlog` protocol (see `docs/spec-net-protocol.md`) |
| ├ `content.js` | Content script: one instance per tab, responsible for DOM snapshots and action execution (click/type/eval, etc.); also relays extension-bridge messages for the in-page toolbox (`batb:bridge` → background) and forwards LLM `netlog` / `plog` queries to the page capture layer |
| └ `toolbox/` | In-page toolbox (production build of the design prototype in `docs/toolbox/`): 14 zero-build modules injected into the page MAIN world by background according to the allowlist; six categories, 36 features (Info / Find / Style & Blocking / Send to LLM / Dev Artifacts / Capture) |
| `page-bridge.user.js` | Connector option B: userscript version. Mutually exclusive with the extension; falls back to GM long-polling when blocked by page CSP |
| `build/` | Packaging artifacts and test key: `make-test-key.mjs` (generates a test private key), `debug-extension.pem`, `chrome-extension.crx` |
| `docs/research/1.md` | Early research notes (how console injection works and where it hurts) |

> The extension and the userscript overlap in functionality — **do not install both**, or a single tab will register twice in the broker.
> The extension is stronger: not subject to page CSP, cross-tab actions, and screenshots.

### Quick start

#### 1. Start the broker (resident on the local machine)

```powershell
pip install -r requirements.txt
python broker.py
# Optional environment variables:
#   BRIDGE_PORT=8766          change the port
#   BRIDGE_TOKEN=xxx          auth for the API (external requests need ?token=xxx or an X-Bridge-Token header)
```

#### 2. Connect a browser (pick one)

**Option A: Chrome extension (recommended)**

1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode" in the top-right corner
3. Click "Load unpacked" → select the `chrome-extension` directory
4. Open any web page; it broadcasts itself online automatically

> To drive local `file://` pages, enable "Allow access to file URLs" on the extension's details page.

**Option B: Userscript**

1. Install the Tampermonkey extension
2. Tampermonkey dashboard → Add a new script → paste the whole `page-bridge.user.js` → Save
3. Open any web page; it works automatically with no further steps

#### 3. Verify

```powershell
curl http://127.0.0.1:8766/pages
# [{"id":"a1b2c3d4","url":"https://github.com","title":"GitHub","mode":"ws","ago":1.2}, ...]
```

Open a few tabs and each one shows up as a record. The list updates automatically when pages close or navigate.

### Packaging the Chrome extension

**Option 1: zip distribution (most common)**

```powershell
Compress-Archive -Path chrome-extension\* -DestinationPath page-bridge-extension.zip
```

The recipient extracts it and installs it with "Load unpacked" as described above (Developer mode required).
Note: Chrome on Windows **does not allow** dragging and dropping a non-store `.crx`; zip + Developer mode is the easiest local distribution method.

**Option 2: Chrome's built-in packer (produces a .crx)**

`chrome://extensions` → "Pack extension" → choose `chrome-extension` as the extension root → Pack.
You get a `.crx` plus a private key `.pem`. **Keep the .pem safe**: future updates must be packed with the same key so the extension ID stays the same.

Command-line equivalent (also useful for automating the test flow):

```powershell
# 1. Generate a test private key (outputs build\debug-extension.pem and the matching extension ID)
node build\make-test-key.mjs

# 2. Pack with the specified key
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
    --pack-extension="E:\WORK\PROJECT\TOOLS\browser-agent\chrome-extension" `
    --pack-extension-key="E:\WORK\PROJECT\TOOLS\browser-agent\build\debug-extension.pem"
# Output: chrome-extension.crx (Chrome writes it next to the extension directory by default)
```

The extension ID is derived solely from the private key (the test key maps to `nfljnkjkdgddlmfnmgogjkipcaekndll`),
and `make-test-key.mjs` refuses to overwrite an existing `.pem` so the ID cannot change by accident.
⚠️ The test key is for local use only; leaking it means anyone can push updates to the same extension ID.

**Option 3: publish to the Chrome Web Store**

Register first at the [developer dashboard](https://chrome.google.com/webstore/devconsole) (one-time $5) → upload the zip from option 1 → review.
This extension requests `<all_urls>` + `tabs`, so review will ask for a justification and may take a few days.

### External integration (any CLI / IDE, no SDK)

| Endpoint | Purpose |
|---|---|
| `GET /pages` | Discover: list of online pages (id / url / title / mode / ago / eval_mode) |
| `GET /events` | Subscribe to broadcasts (SSE): `page_up` / `page_update` / `page_down` / `page_event` |
| `POST /call/{pid}` | Attach and execute one command: body is the command JSON, `?timeout=30` controls the wait |
| `GET /marks` | List all page-bridge marks: `mark` / `online` / `pid` / `url` / `title` |
| `GET /mark/{mark}` | Look up a page by mark: returns online state, `pid`, URL, title (last known URL when offline) |
| `POST /mark/{mark}` | Execute a command by mark (body same as `/call/{pid}`, e.g. `{"action":"snapshot"}`) |
| `WS /client` | Long-lived connection: broadcasts + attach + bidirectional command stream (good for a resident IDE agent session) |
| `POST /mcp` | **MCP server** (Streamable HTTP, stateless): `initialize` / `tools/list` / `tools/call` |
| `GET /sse` + `POST /messages` | **MCP server** (legacy HTTP+SSE transport) for clients that only support SSE |

```powershell
# Discover and validate URLs (whether a page is "suitable" is up to the external client, e.g. regex on the domain)
curl http://127.0.0.1:8766/pages

# View a page snapshot (the LLM's eyes: interactive elements carry [bid] numbers plus body text)
curl -X POST http://127.0.0.1:8766/call/a1b2c3d4 -d "{\"action\":\"snapshot\"}"

# Click element #3
curl -X POST http://127.0.0.1:8766/call/a1b2c3d4 -d "{\"action\":\"click\",\"bid\":3}"

# Screenshot (extension only, returns base64 PNG)
curl -X POST http://127.0.0.1:8766/call/a1b2c3d4 -d "{\"action\":\"screenshot\"}"
```

### MCP (built into the broker, one process)

`broker.py` serves MCP directly (HTTP shares the broker's port; stdio is launched by the MCP client): page connections, CLI calls and MCP clients all share this one process — no separate MCP service and no extra dependencies.

| Transport | Address / command | Notes |
|---|---|---|
| Streamable HTTP (recommended) | `http://127.0.0.1:8766/mcp` | Stateless; `POST` returns a JSON-RPC response directly; `GET /mcp` returns 405 per the spec |
| Legacy HTTP+SSE | `http://127.0.0.1:8766/sse` | `GET /sse` emits an endpoint event → `POST /messages?sessionId=...`; responses go over SSE |
| stdio | `python broker.py --stdio` | Launched by the MCP client; **the broker starts together with MCP**, no need to run `start-broker.bat` first |

**Option 1: connect to a running broker** (start `start-broker.bat` first; if `BRIDGE_TOKEN` is set, append `?token=<token>` to the URL):

```json
{
  "mcpServers": {
    "page-bridge": { "url": "http://127.0.0.1:8766/mcp" }
  }
}
```

**Option 2: let the MCP client launch it (stdio, the process is the broker)**:

```json
{
  "mcpServers": {
    "page-bridge": {
      "command": "python",
      "args": ["E:\\WORK\\PROJECT\\TOOLS\\browser-agent\\broker.py", "--stdio"]
    }
  }
}
```

- Use absolute paths; with the project virtualenv, set `command` to `…\\browser-agent\\.venv\\Scripts\\python.exe`
- The process runs both stdio JSON-RPC and the `127.0.0.1:8766` hub, so pages connect as usual; stdout carries only JSON-RPC, all logs go to stderr
- When the client disconnects (stdin EOF) the process exits automatically and frees the port
- Only one instance may use a port: if a broker is already running, the stdio instance exits with an error — use option 1 in that case
- Do not configure `start-broker.bat` as the stdio `command` — the bat file's echo would pollute stdout

MCP tools:

| Tool | Parameters | Purpose |
|---|---|---|
| `list_pages` | - | Discover currently connected pages (id / mark / url / title / ago) |
| `list_marks` | - | List marks (offline pages still report their last URL) |
| `page_snapshot` | `page?` | Live snapshot (interactive elements with bid numbers plus body text) |
| `page_call` | `page?, action, timeout?, ...` | Dispatch any command; parameters match the command table below (click / type / nav / eval / dom / screenshot…) |
| `page_logs` | `page?, since?, doc?, kinds?, levels?, q?, limit?, text_max?, wait_ms?, clear?, redact?` | **Extension only**: read page runtime logs and errors (console / uncaught exceptions / promise rejections / failed resources / CSP), with `t / iso / perf` timestamps, line/column numbers and stacks. Pull incrementally with the `since` + `doc` cursors; with `wait_ms>0` the page long-polls for new errors (≤20s), handy for confirming whether an action threw |

`page` accepts a mark id or pid; it can be omitted when only one page is online. Tool calls share the same forwarding path as `/call`, with the same 120s timeout ceiling.

### Commands

`bid` accepts an element number from a snapshot, or a CSS selector directly.

| action | Parameters | Notes |
|---|---|---|
| `ping` | - | Liveness check, returns page info |
| `snapshot` | - | Page snapshot: url/title/viewport/scroll position/element list/body text |
| `dom` | `selector?, bid?, depth?, maxNodes?, maxChars?, collapse?, redact?` | Condensed DOM: **Pug-style indented tree** (`tag.class#id(attr) text`), preserving hierarchy and semantic attributes. Defaults: `selector=body`, depth 8, 1500 nodes, 60k chars, runs of ≥3 identical siblings collapsed to `×N`, `redact=true`. Pass `bid` (or a bare number as `selector`) to output only that element and its descendants; returns `{selector, nodes, chars, truncated, content}` |
| `click` | `bid` | Scroll into view and click (with a full mouse event sequence) |
| `type` | `bid, text, clear?` | Type text using the native setter, works with controlled React/Vue components |
| `press` | `key, bid?` | Press a key (Enter submits the form / clicks automatically) |
| `select` | `bid, value` | Choose a dropdown option |
| `scroll` | `dy?` or `bid` | Scroll the page or scroll to an element |
| `hover` | `bid` | Hover |
| `nav` | `url` | Navigate the page |
| `back` / `reload` | - | Back / reload |
| `eval` | `code` | Execute arbitrary JS in the page (async/await supported). The extension prefers the userScripts channel to bypass CSP; the userscript version or a disabled toggle goes through the content script and is bound by page CSP. See "eval and CSP" below |
| `cookies` | `op?, name?, value?` | Read/write cookies (op=get/set) |
| `storage` | `area?, key, value?` | Read/write localStorage / sessionStorage |
| `upload` | `bid, files:[{name,mime,content}]` | Feed files into an `<input type=file>` |
| `wait` | `ms` | Wait (max 15s) |
| `highlight` | `bid` | Outline the element in red for 2 seconds (debugging) |
| `netlog` | `op, q?, id?, limit?, max?, redact?` | **Extension only**: query captured API records (URL/request body/response/auth headers). `op=list` gives summaries (bodies omitted) → `op=get {"id":N}` fetches a full record → `op=curl {"id":N}` returns a replayable cURL; `op=clear` empties the buffer. **`redact` masks auth fields by default**; set it to false only when necessary. See `docs/spec-net-protocol.md` |
| `plog` | `op?, since?, doc?, kinds?, levels?, q?, limit?, text_max?, wait_ms?, clear?, redact?` | **Extension only**: query page logs and errors. `kinds` accepts `console / exception / rejection / resource / csp`; `levels` accepts `error / warn / info / log / debug`; returns `{doc, cursor, navigated, counts, items}`. Pass the previous `cursor` as `since` for incremental pulls; `doc` identifies the document and changes after navigation with `navigated:true`; `wait_ms>0` long-polls on the page for new errors (max 20s); `text_max` defaults to 600 chars per entry; `clear` empties the buffer; `redact` defaults to on |
| `screenshot` | - | **Extension only**: screenshot, returns `{format:"png", dataUrl}` |
| `tab_list` | - | **Extension only**: list all tabs |
| `tab_open` | `url, active?` | **Extension only**: open a new tab |
| `tab_close` | `tabId` | **Extension only**: close a tab (accepts a pageId) |
| `tab_activate` | `tabId` | **Extension only**: switch to a tab (accepts a pageId) |

### cli_client.py (a ready-made orchestration example)

```powershell
python cli_client.py list                          # discover currently online pages
python cli_client.py watch                         # subscribe to the broadcast event stream
python cli_client.py snap github.com               # find a page by URL substring and view its snapshot
python cli_client.py call <pid> "{\"action\":\"snapshot\"}"

# All in one: discover → validate URL via --match → attach → LLM-driven loop until done
# Environment variables: OPENAI_API_KEY (required) OPENAI_BASE_URL (optional, compatible APIs) BRIDGE_MODEL (optional)
python cli_client.py run "search for playwright in the search box and open the first result" --match github.com
```

The `run` loop is exactly "snapshot → LLM decides on one JSON command → POST /call → feed the result back → repeat";
your IDE/Agent only needs to replicate this loop (or call `/call` directly) to plug into any orchestration framework.

### Site allowlist

Pure allowlist mode: **only pages on the allowlist connect to the broker** (a matching domain or regex lets a page through); all other pages never register or broadcast.

- **Master switch (enabled or not)**: the popup and the settings page title bar each have an "Enabled" toggle, which **takes precedence over all rules** — when off, every page disconnects from the broker and stops registering (`/pages` becomes empty), and turning it back on restores all matching pages automatically; the state is represented only by the switch itself, and when off the toolbar icon shows a grey `OFF` badge
- **Entry point**: click the toolbar icon to open the popup — shows whether the current page is allowlisted (including what matched: domain/regex) and offers one-click add/remove
- **Domain list**: stores only eTLD+1 registrable domains (e.g. `github.com` automatically covers all subdomains such as `gist.github.com`; multi-level suffixes like `bbc.co.uk` are handled correctly), with CRUD, search and import/export (JSON/plain text)
- **Regex rules**: matched against the full URL, validated before saving, with a live tester panel
- **Takes effect immediately**: after config changes, registered pages disconnect/reconnect under the new rules without a refresh; the toolbar icon shows a `W` badge when the current tab matches the allowlist
- Detailed requirements and design: `docs/spec-url-filter.md`

### In-page toolbox

An in-page tool panel injected according to the allowlist; the design prototype lives in `docs/toolbox/` (architecture map: `docs/toolbox-proto-map.md`):

- **Injection**: once a page matches the allowlist, background injects the 14 modules under `chrome-extension/toolbox/` into the **page MAIN world** via `chrome.scripting` — React fiber lookups, fetch interception and `window.__BA_*` are only visible in the page context; injection is not limited by page CSP
- **Gating takes effect immediately**: after allowlist changes, injected pages show/hide in sync via the DOM event `batb:gate` — leaving the allowlist hides the toolbox instantly, matching again restores it; matching pages that were never injected get injected on the fly
- **Entry point**: circular FAB at the bottom-right (draggable, position remembered, `Alt+Shift+D` to toggle); six categories, 36 features (Info / Find / Style & Blocking / Send to LLM / Dev Artifacts / Capture)
- **Bilingual (Chinese / English)**: the "EN / 中文" button at the bottom of the panel switches languages with one click; Chinese is the default and the choice is stored in `localStorage` across reloads. Categories, feature names and descriptions, result cards and prompts all have English versions
- **Capture**: "URL QR Code" generates a QR code for the current URL entirely locally (scan to open on your phone, download as PNG / copy the link; embeds a trimmed MIT build of [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)); "Full-page Screenshot" scrolls and captures screen by screen, stitches a long image and downloads it as PNG; "Container Screenshot" picks any element — for a scrollable container it captures the container's entire scroll range (locating the scrolling ancestor, clipping and stitching screen by screen), for a plain element it captures the currently visible area — both screenshot modes handle floating elements automatically (fixed elements are temporarily hidden, sticky elements temporarily unstick, then restored) to avoid repeats on every screen; "API Calls" captures requests in two layers — the page capture layer (`capture-main.js`, wrapping fetch/XHR at document_start) grabs request/response bodies while the webRequest observational mode grabs all request headers (including Cookie/Authorization), merged by URL + time; open a list item to **copy debug text / copy cURL** for the LLM (auth fields such as Cookie/token are masked by default, and this can be turned off). Both screenshot features go through the **extension bridge** (content.js relays `batb:bridge` → background `captureVisibleTab`), so content.js must match the extension version (refresh the page after updating the extension)
- **LLM viewing channel for API calls**: the LLM sends the `netlog` command through the broker to query captured records on its own (`list` summaries → `get` details / `curl` replay, no manual clicking); the protocol and its limits are documented in `docs/spec-net-protocol.md`
- **Storage channel for Send to LLM**: results are written to `localStorage["ba:ctx"]` / `["ba:el"]`, and the LLM reads them through the broker's `storage` action (`window.__BA_*` is only visible in the page MAIN world; use storage for cross-process reads). "Copy page-bridge mark" copies the **page id** (generated in JS when the extension attaches the page, stored per tab in `chrome.storage.session`, reported with hello/hb); the LLM can use `GET /mark/<id>` to look up the URL and online state, and `POST /mark/<id> {"action":"snapshot"}` to get a live snapshot and continue
- Adding/removing features: just edit the `B.register([...])` array in `toolbox/feats/<category>.js`; see the prototype map for the module list and load order

### eval and CSP (extension)

When `eval` runs in the content script it is bound by **page CSP**: strict `script-src 'self'` sites such as GitHub or Tencent Yuanbao reject it outright with an
`unsafe-eval` error. The extension offers a userScripts channel to bypass this (Chrome ≥ 135):

1. `chrome://extensions` → Page Bridge → **Details** → enable the "**Allow user scripts**" toggle
2. No extension reload needed; it takes effect within the next heartbeat (about 5 seconds)

**How clients can tell** (required reading for LLM orchestration):

- Every page in `GET /pages` carries an `eval_mode` field:
  - `"userscript"` — toggle enabled; eval is not limited by CSP and works on any page
  - `"fallback"` — toggle disabled; eval goes through the content script and fails on strict-CSP sites
- The `ping` response also carries `eval_mode`
- When `eval` fails on a restricted page, the `error` includes enabling instructions and a risk warning that the LLM can relay to the user verbatim

**Risk warning (please relay to the user)**: with "Allow user scripts" enabled, the agent can execute arbitrary JS on any page (read/write page data, send requests on your behalf, etc.).
Enable it only in a browser you control; never enable it when connecting an untrusted orchestrator.

### Security

- The broker binds only to `127.0.0.1` and is invisible on the LAN; always set `BRIDGE_TOKEN` on a public-facing machine
- `eval` hands full page privileges to the caller — **enable it only in a browser you control**
- `netlog` masks Cookie/Authorization/token-like fields by default; `redact:false` returns real credential values, use it only on demand in a controlled environment (see `docs/spec-net-protocol.md`)
- The userscript version can restrict broadcasting to specific sites with `CFG.urlFilter` (regex allowlist); the extension version uses the "site filter" config allow/deny list (see above)
- Do not use it on unauthorized websites or on someone else's session

### Known limitations

- Content inside cross-origin iframes is unreachable (same-origin policy; true of every page-injection approach)
- Browser downloads and multi-window management are not covered (requires CDP)
- The userscript version falls back to long-polling on strict-CSP pages, with slightly higher latency; the extension version has no such issue
- On pages with Trusted Types enabled and no default policy (some Google sites), the toolbox UI may fail to mount (innerHTML is blocked)

### Troubleshooting

| Symptom | What to check |
|---|---|
| `/pages` is always empty | Is the broker running? Extension installed but no regular web page opened yet? **Is the master switch off?** (click the toolbar icon and check "Connection enabled") Check the Service Worker errors on the extension details page |
| The page is listed but commands time out | The tab was discarded/suspended by the browser — switch to it to wake it up; or a command was left unfinished before the page closed |
| The userscript cannot connect on some pages | Check the `[bridge]` logs in the console; if it says "falling back to HTTP long-polling" it was blocked by CSP, which is expected; or switch to the extension |
| `file://` pages do not come online | Enable "Allow access to file URLs" on the extension details page; for the userscript, allow file access in its settings |
| No toolbox FAB at the bottom-right of the page | Is the page allowlisted (check the popup for a match)? Check Service Worker errors on the extension details page; `file://` requires "Allow access to file URLs" |
| The toolbox "Full-page Screenshot" says the extension bridge is not responding | The extension was just updated and the page still runs an old content.js (without the bridge) — refresh the page; or check Service Worker errors on the extension details page |
| The toolbox FAB appears and then disappears on its own | The site rewrote the whole document (`document.open()/write()/close()`, e.g. Playcode preview runtime; or `createRoot(document.body)` wiping the body), removing the host node along with it. core.js remounts it within 1s, preserving UI state and allowlist visibility; if it never comes back, refresh the page and check the `mount` entries in `localStorage["ba:diaglog"]` |
| The FAB is there but clicks do nothing / the panel will not open | The second half of the same scenario: rewriting the whole document also wipes the document (including the Shadow DOM) and **all event listeners on window**; nodes and styles remain but listeners are gone. core.js self-checks listeners every 1s via the custom event `batb:probe` and rebinds as soon as it detects this (`rebind` entries appear in `ba:diaglog`); if it still does not respond, refresh the page and report the output of `copy(localStorage.getItem('ba:diaglog'))` |
| The toolbox "API Calls" says the capture layer is not loaded / `netlog` times out | The extension was just updated: reload the extension + refresh the page (the page capture layer `capture-main.js` is injected as the page loads); check whether the page is allowlisted (bg records requests only for allowlisted pages) |
| `eval` reports a CSP / unsafe-eval error | Expected (page CSP restriction). Enable the extension's "Allow user scripts" toggle as described in "eval and CSP"; or use other DOM actions |
| `eval_mode` in `/pages` is always `fallback` | userScripts requires Chrome ≥ 135 plus manually enabling the "Allow user scripts" toggle; find it under `chrome://extensions` → Page Bridge → Details |
