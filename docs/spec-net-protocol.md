# 接口捕获与「netlog」查看协议说明

> 版本：v1.0（2026-10-22）
> 适用范围：`chrome-extension/`（Chrome 扩展 MV3，Chrome ≥ 120）
> 关联：工具箱「采集 · 接口调用」（`feats/capture.js` 的 `apinet`）、broker 命令协议（README「命令一览」）、`chrome-extension/capture-main.js`（页面捕获层）

## 1. 背景与目标

「接口调用」有两种使用模式：

| 模式 | 流程 | 落点 |
|---|---|---|
| **复制** | 工具箱里点开某条请求 → 复制调试文本 / cURL → 人工粘贴给 LLM | `apinet` UI |
| **查看** | LLM 经 broker 主动查询页面捕获的接口记录，无需人工点击 | `netlog` 命令（本协议） |

## 2. 双层捕获架构

MV3 下 webRequest 观察模式拿不到响应体（MV2 起即如此），而页面 hook 看不到浏览器自动加的 Cookie——两层各取所长，按 URL + 时间合并：

| 层 | 实现 | 能拿到 |
|---|---|---|
| **background（网络层）** | webRequest 观察模式 5 监听器：`onBeforeRequest`(+`requestBody`) / `onSendHeaders`(+`requestHeaders,extraHeaders`) / `onHeadersReceived`(+`responseHeaders,extraHeaders`) / `onCompleted` / `onErrorOccurred`（定稿） | URL、method、**全量请求头（含 Cookie/Authorization，必须 `extraHeaders`，否则 Chrome 72+ 隐去）**、请求体（formData/raw）、响应头、状态码、耗时 |
| **页面 MAIN world** | `capture-main.js` 于 `document_start` 注入（manifest 静态声明 `world:"MAIN"`），包裹 fetch/XHR | 请求头（JS 设置的）、**请求体原文**、**响应体**（`clone()` 旁路流式读取，超限 cancel，不拖慢页面） |

**采集范围**：bg 侧只收 `webRequest.type` ∈ `{xmlhttprequest, other, websocket, ping}`（即 fetch/XHR、beacon、WebSocket 握手）；`image` / `stylesheet` / `script` / `font` / `media` 等静态资源不进清单（否则图片地址会混进「接口调用」）。旧版本遗留的静态资源「仅头」记录，在 `sync()` 里按 URL 后缀 + 无请求体判定后丢弃。

**合并规则**（`capture-main.js` 的 `sync()`，consume-once）：

- method 相同 + URL 归一化相等（`decodeURI`，含 query）+ 时间差最小且 ≤ 8s → 并入，`src='merged'`
- bg 记录一次消费（`rid` 去重），同 URL 轮询不会误并到另一条
- 歧义不并：bg 记录找不到配对的页面记录 → 合成 `src='net'` 的「仅头」记录（整页跳转后 body 侧清空，仅这类记录保留）

**存储**：

| 侧 | 位置 | 容量 |
|---|---|---|
| 页面侧（含响应体） | `window.__BATB_NET__.recs` 内存环形 | 300 条 / 单体 256KB（×4 预检），导航即清空 |
| bg 侧（仅头部） | `chrome.storage.session['neth:'+tabId]`（SW 随时被杀，必须落 storage） | 150 条/tab、序列化 ≤ 2MB/tab 超限丢最旧、请求体截断 16KB、**不存响应体**；tab 关闭即清 |

## 3. 数据模型（一条记录）

| 字段 | 说明 |
|---|---|
| `id` | 页面侧自增序号（netlog 查询用的句柄） |
| `t` / `ms` | 开始时间戳 / 耗时 |
| `src` | `page`（仅页面 hook）/ `merged`（双层合并）/ `net`（仅网络层头部） |
| `kind` | `fetch` / `xhr` / `net` |
| `m` / `u` | method / 完整 URL |
| `reqHdr` / `resHdr` | `[{k,v}]`，展示/导出时按脱敏开关过滤 |
| `reqBody` / `resBody` | 文本（超限截断带标记）；二进制/SSE 等只留 `note` |
| `s` | 状态码，失败为 `ERR` |
| `note` / `pending` | 未捕获原因 / 响应体读取中 |

## 4. netlog 协议（LLM 查看通道）

通道：broker `POST /call/{pid}`，命令 `{"action":"netlog", ...}`（已列入 hello 广播的 `caps`）。
链路：background 路由 → content.js `ACTIONS.netlog` → DOM 事件 `batb:netq` → 页面捕获层应答 `batb:netq:res`。
不走 `eval`：eval 在 USER_SCRIPT/ISOLATED world，看不到 MAIN world 的 `__BATB_NET__`。

| op | 参数 | 返回 |
|---|---|---|
| `list` | `q?`（URL 子串过滤）、`limit?`=30（≤200）、`redact?`=true | `{ver, count, redact, items:[摘要]}`——**摘要不含 body**：`{id,t,src,kind,m,u,s,ms,note,pending,reqBody:bool,resBody:bool}` |
| `get` | `id`、`redact?`=true、`max?`=8192（body 截断字符数） | 完整记录（§3 全字段） |
| `curl` | `id`、`redact?`=true | 可回放的 cURL 文本（`-X/-H/--data-raw`） |
| `clear` | - | `'ok'` |

错误：`record not found: N` / `接口捕获层无响应（扩展更新后未刷新页面？请刷新后重试）` / `unknown op: …（支持 list/get/curl/clear）`。
典型用法：先 `list` 拿摘要定位目标接口 → 再 `get` 取详情（或 `curl` 直接回放）。

## 5. 脱敏（默认开）

- **请求/响应头**：名匹配 `authorization / proxy-authorization / cookie / set-cookie / x-api-key / api-key / x-auth-token / x-csrf-token / csrf-token / token`（不分大小写）→ 值替换 `«已脱敏»`
- **请求/响应体**：JWT、`sk-`/`ghp-`/`xoxb`/`rk-` 类 token、手机号、邮箱 → 占位符（口径同工具箱 `B.REDACT`）
- 开关：UI「脱敏」按钮（按站存 `localStorage["ba:netredact"]`）；协议传 `redact:false`
- ⚠️ `redact:false` 等于把 Cookie/session/Authorization 真实值交给 LLM 上下文——仅在本机可控环境、确有需要时使用；凭据泄露后改密码未必来得及

## 6. 局限与边界

- 只覆盖 fetch/XHR + 网络层头部：图片/CSS 等浏览器直发资源只有「仅头」记录；`mode:'no-cors'` 的 opaque response 读不了；SSE（`text/event-stream`）与二进制只记 meta；响应体超上限只记 meta 或截断
- 重定向链记录末跳；SW 冷启动极早请求可能缺 bg 侧记录（页面侧 hook 不受影响）
- MAIN world hook **全站生效**（`document_start` 读不到白名单）：记录只存页面内存、除主动查询外不离开页面，泄露面为零；极少数站点检测 `fetch.toString()` 原生性可能受影响
- 同 URL 高频轮询靠 consume-once 防误并；仍歧义时保留 page-only 记录（缺全量请求头，标注 `src='page'`）
- 页面侧环形缓冲满 300 条后滚动丢弃最旧

## 7. 扩展方向

未来同类「被动查看」数据源（console 日志、storage 快照、性能条目等）沿用同款结构化命令模式：background `CONTENT_ACTIONS` 注册 action → content.js 经 DOM 事件桥转发 MAIN world 数据层 → op 命名 `list/get/clear`、hello `caps` 声明，LLM 无需 eval 即可查询。
