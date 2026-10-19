# Browser Agent

把浏览器页面通过本地通道开放给任意 CLI / IDE / Agent 控制的轻量体系。
纯页面文本化（无截图依赖的多模态），LLM 用元素编号定位，适合做浏览器自动化编排。

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
| ├ `background.js` | Service Worker：每个标签页维持一条到 broker 的 WebSocket；命令路由（DOM 动作转发给 content，截图/标签管理自己执行）；站点白名单过滤 |
| ├ `filter.js` | 白名单核心：配置存储、eTLD+1 主域名提取、匹配引擎（SW/popup/options 共用） |
| ├ `popup.html` / `popup.js` | 工具栏弹窗：接入总开关、当前页白名单状态、一键加入/移出 |
| ├ `options.html` / `options.js` | 完整配置页：域名列表与正则规则的增删改查、导入导出、正则实时测试面板 |
| └ `content.js` | 内容脚本：每个标签页一个实例，负责 DOM 快照与动作执行（click/type/eval 等 17 种） |
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
| `WS /client` | 长连接：收广播 + attach 页面 + 双向命令流（适合 IDE agent 常驻会话） |

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

## 命令一览

`bid` 可传快照里的元素编号，也可直接传 CSS selector。

| action | 参数 | 说明 |
|---|---|---|
| `ping` | - | 探活，返回页面信息 |
| `snapshot` | - | 页面快照：url/title/viewport/滚动位置/元素列表/正文 |
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
- 油猴版可用 `CFG.urlFilter`（正则白名单）限制只广播特定站点；扩展版用「站点过滤」配置黑白名单（见上文）
- 请勿用于未授权的网站或他人会话

## 已知边界

- 跨域 iframe 内部内容拿不到（同源策略，所有页面注入方案皆如此）
- 浏览器下载、多窗口管理未覆盖（需 CDP）
- 油猴版在强 CSP 页面会降级长轮询，延迟略高；扩展版无此问题

## 故障排查

| 现象 | 排查 |
|---|---|
| `/pages` 始终为空 | broker 没跑起来？扩展装了但没开过普通网页？**总开关被关了？**（点工具栏图标看「接入启用」）扩展详情页看 Service Worker 报错 |
| 页面在列表里但命令超时 | 标签页被浏览器休眠了，切换过去激活即可；或页面关闭前有未完成命令 |
| 油猴版某些页面连不上 | 看控制台 `[bridge]` 日志，若显示"降级为 HTTP 长轮询"即 CSP 拦截，属正常；或改用扩展版 |
| `file://` 页面不上线 | 扩展详情开启「允许访问文件网址」；油猴需在设置里允许访问文件 |
| `eval` 报 CSP / unsafe-eval 错误 | 属正常（页面 CSP 限制）。按「eval 与 CSP」章节开启扩展的「允许用户脚本」开关；或改用其他 DOM 动作 |
| `/pages` 里 `eval_mode` 一直是 `fallback` | userScripts 需要 Chrome ≥ 135 且手动开启「允许用户脚本」开关；`chrome://extensions` → Page Bridge → 详情里找 |
