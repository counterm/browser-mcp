# 2026-10-27 · 页桥标记重构：id 由扩展接入时生成，broker 存档 id → 网址

- 标记不再由「pid + broker 地址」拼字符串，而是每个网页一枚**网页 id**：`background.js` 在 tab 接入时用 JS 生成
  `pb_xxxxxxxxxx`，存 `chrome.storage.session`（按 tab 持久，SW 休眠 / 刷新不变，关 tab 即清），随 `hello` / `hb` 上报 broker
- broker 新增 `MARKS` 存档（id → url/title/在线状态）：`GET /marks` 列出全部、`GET /mark/{id}` 按 id 查网页、
  `POST /mark/{id}` 按 id 下发命令（等同 `/call/{pid}`）；页面离线时仍返回最后一次 URL，离线记录保留 24h
- 工具箱「复制页桥标记」改为**只复制 id**，并显示 id、标题、URL 与查询方式；`tb:pinfo` 返回值加入 `mark`
- 同步：长轮询注册 / 心跳透传 `mid`，README 接口表、`docs/toolbox-proto-map.md`、changelog 更新；`node --check` 与 `py_compile` 通过
