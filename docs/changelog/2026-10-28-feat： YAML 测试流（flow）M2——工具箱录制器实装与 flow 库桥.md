# 2026-10-28 · feat: YAML 测试流（flow）M2——工具箱录制器实装与 flow 库桥

- `chrome-extension/toolbox/feats/build.js` + `docs/toolbox/feats/build.js`（两树同步）：mock `record` 实装为「操作录制 → flow」（★2 → ★3 高级，功能总数不变 36/32）
  - 录制引擎（模块级）：capture 阶段 hook click / change / Enter；输入 change（失焦）记录、下拉记 value、勾选框记点击、密码记 `${env.PWD}` + `secret:true`；起始 URL 自动为首条 nav；input/textarea/select 聚焦点击与工具箱自身 DOM 不录；selector 用 `B.sel.bestSelector`，点击步附可见文本作运行时回退定位
  - 面板：flow 名 / 描述、开始/停止/清空、步骤列表（单步删除 + 「⇄变量」把录制值转 `${vars.vN}`）、YAML 实时预览、复制 / 下载 / 保存入库、粘贴 YAML 导入保存（服务端校验）、flow 库列表（运行 / 查看 YAML / 删除）、一键运行并以本页页桥标记为目标页渲染报告；原型树无扩展桥时录制与复制 / 下载可用，库功能给提示
  - 跨页续录：录制会话存 background `chrome.storage.session`（`flowrec:<tabId>`，tab 关闭即清）；工具箱每次注入 `tb:flowrec get` 询问，URL 变了由 background 自动补 nav 步骤
- `chrome-extension/background.js`：新增 `tb:flow`（`brokerFetch` 直连 broker HTTP：list/get/save/delete/run，真相源仍是磁盘 `flows/*.yaml`，无副本）与 `tb:flowrec`（录制会话 get/set/clear，get 时跨页自动补 nav）；`onRemoved` 随 tab 清录制会话
- 文档：`docs/spec-flow.md` M2 落地细节与已知边界（含 BRIDGE_TOKEN 401 说明）；`docs/toolbox-proto-map.md` record 行更新
- 验证：`node --check` 全过（两树 build.js + background.js）；生效需重载扩展并刷新页面
- 待做（M3）：异步执行（run_id + `op=status` 轮询）、步骤级 retry
