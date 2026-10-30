# 2026-10-22 · 采集新增「接口调用」：双层捕获 + netlog LLM 查看协议

- **双层捕获架构**（MV3 webRequest 拿不到响应体，页面 hook 看不到浏览器自动加的 Cookie，两层合并）：
  - 新增 `chrome-extension/capture-main.js`——manifest 静态声明 `document_start` + `world:"MAIN"` 注入，包裹 fetch/XHR 抓**请求体原文/响应体**（`clone()` 旁路流式读取、超 256KB cancel，不拖慢页面不全量缓冲；SSE/二进制/opaque 只记 meta），环形缓冲 300 条存页面内存（导航即清空，除主动查询不离开页面）；`feats/capture.js` 新增 `apinet`（接口调用，功能数 36→37，README 与 proto-map 同步）
  - background 加 webRequest 观察模式 5 监听器（`onBeforeRequest/onSendHeaders/onHeadersReceived/onCompleted/onErrorOccurred` 定稿）抓 **URL/method/全量请求头（`extraHeaders` 才有 Cookie/Authorization）/请求体/响应头与状态码**；只记白名单页；定稿落 `chrome.storage.session['neth:'+tabId]`（每 tab 150 条、2MB 体积护栏丢最旧、请求体截 16KB、不存响应体；SW 随时可被杀，不能只放全局变量）；tab 关闭清 key
  - 合并按 method + URL 归一化 + Δt≤8s 最近邻、**consume-once**（rid 去重防同 URL 轮询误并），歧义保留 `src='net'` 的「仅头」记录（整页跳转后 body 侧清空时仍可见）
- **复制**：`apinet` 列表（1.5s 轮询）→ 点行进详情（同详情浮层内切换）→ 请求头/请求体/响应头/响应体分区 + **复制调试文本 / 复制 cURL**；**默认脱敏**（Cookie/Authorization/token 头 → `«已脱敏»`，体套用 JWT/手机号/邮箱等占位，口径同 `B.REDACT`），按站开关 `localStorage["ba:netredact"]`
- **查看（上层总沟通协议）**：新增 broker 命令 `netlog`（进 hello `caps`）——`{"op":"list"}` 摘要（不含 body）→ `{"op":"get","id":N}` 完整记录 / `{"op":"curl"}` 回放 / `{"op":"clear"}`；链路 background → content.js → DOM 事件 `batb:netq` → MAIN world 捕获层应答（不走 eval：eval 在 USER_SCRIPT/ISOLATED world 看不到 MAIN world）；`cli_client.py` SYSTEM_PROMPT 同步；协议 spec 见 `docs/spec-net-protocol.md`
- manifest 0.1.1→0.1.2，permissions 加 `webRequest`（观察模式，无需 blocking）；**更新后需重载扩展并刷新页面**（捕获层随页面 document_start 注入）
- 原型 `docs/toolbox/` 不动：本功能依赖扩展后台/扩展桥，与 qr/capture 同属「仅扩展版」
