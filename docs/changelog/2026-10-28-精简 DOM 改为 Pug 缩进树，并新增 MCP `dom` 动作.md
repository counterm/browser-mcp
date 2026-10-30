# 2026-10-28 · 精简 DOM 改为 Pug 缩进树，并新增 MCP `dom` 动作

- 工具箱「一键复制精简 DOM」输出由精简 HTML 改为 **Pug 缩进树**：`tag.class#id(attr) 文本`，2 空格缩进；新增 `B.pugDom`（`helpers.js`），保留 id / class（前 3 个）/ name / type / href / src / placeholder / role / aria-label / data-test*，**丢弃 value**；直接文本超 60 字截断；连续同类兄弟 ≥3 折叠为 `×N`（比对签名含 `tag#id.class`，避免把 `#app` 与弹层误判成同类）；默认上限 深度 8 / 1500 节点 / 6 万字符（工具箱放宽到 10 / 4000 / 20 万）；扩展与原型两套同步
- 页桥新增 `dom` 动作（`chrome-extension/content.js` + `page-bridge.user.js`）：参数 `selector / depth / maxNodes / maxChars / collapse / redact`，默认对输出脱敏（手机号 / 身份证 / 邮箱 / token / JWT），返回 `{selector, nodes, chars, truncated, content}`；`background.js` 的 `CONTENT_ACTIONS` 白名单加入 `dom`
- 页桥 `dom` 支持指定元素：新增 `bid` 参数（`selector` 填纯数字也按 bid 解析），只输出该元素及其子孙；工具箱同名功能增加选择器/bid 输入框与「查询」，默认仍为整页
- MCP 侧无需新增工具：`page_call {action:"dom"}` 即用；README 命令表与 MCP 工具说明、`docs/toolbox-proto-map.md` 同步
- `node --check` 通过（content.js / background.js / page-bridge.user.js / 两套 helpers.js / 两套 feats/llm.js）；扩展侧需重载扩展并刷新页面、油猴侧需更新脚本后生效
