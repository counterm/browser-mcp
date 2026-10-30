# 2026-10-30 · feat: 录制体验——去 YAML 首行注释、录制时隐藏弹窗、暂停/停止 HUD、停止自动复制

- `chrome-extension/toolbox/feats/build.js` + `docs/toolbox/feats/build.js`（两树同步）：
  - `stepsYaml` 去掉首行 `# 由工具箱操作录制生成 · schema 见 docs/spec-flow.md`，导出/复制/入库的 YAML 直接以 `flow:` 开头
  - 录制新增暂停态 `REC.paused`：暂停时解除页面事件监听（不记步骤），HUD 图标 pause ⇄ play；暂停期间换页的，恢复时自动补一条 `nav`
  - 停止时 `copyText` 自动把 YAML 写入剪切板，再恢复三层弹窗并重绘录制详情；复制失败则提示用面板「复制 YAML」
  - 跨页恢复（`flowrec get`）同样拉起 HUD，并按暂停态决定是否绑定事件
- `chrome-extension/toolbox/ui.js` + `docs/toolbox/ui.js`（两树同步）：新增 `beginRecord/endRecord/setRecordPaused`——录制期间给 FAB/面板/列表/详情/撤销条加 `pick-hide`，右下角改显「暂停 + 停止」HUD（跟随 FAB 拖拽位置），结束后原样恢复；`togglePanel` 录制中禁用
- `chrome-extension/toolbox/boot.js` + `docs/toolbox/boot.js`（两树同步）：录制中屏蔽 Alt+Shift+D / Esc 分级返回与「点页面收起」，避免误关隐藏中的弹窗
- `chrome-extension/toolbox/core.js` + `docs/toolbox/core.js`（两树同步）：新增 `pause/play/stop` 图标与 `.rec-hud` 样式
- `chrome-extension/background.js`：`flowrec get` 仅在 `on && !paused` 时补 nav 步骤，暂停期间的页面跳转不进 flow
- 验证：两树 `node --check` 通过；生效需重载扩展并刷新页面（原型树刷新 file:// 页即可）
