# 2026-11-02 · feat: flow 定位类动作 auto-wait——元素未出现窗口内轮询，录制 flow 回放不再跑赢异步渲染

- 问题：实测 Element Plus 管理台（宿主机管理页），录制的 flow 回放稳定停在表格步——点菜单后路由切换，表格数据异步加载 1s+，而 flow 约 600ms 就执行到点行步骤，selector 与 text 兜底双双 `element not found`，按默认策略中断（轨迹实测两次分别败于 615ms / 574ms）。录制器只记稳态选择器、不生成等待，**重录无效**，手改 YAML 补 `expect` 治标不治本
- 修复：`flowrun.js` 执行侧加 Playwright 式 auto-wait——定位类动作（click / type / select / hover / press）抛 `element not found` 时不立即失败，在窗口内每 0.3s 重试定位直至元素出现。窗口由新步骤键 `auto_wait_ms` 控制：默认 5000ms，step 级可覆盖，0 关闭，上限 30000（进 `validate` 数值校验与 `CTRL`，不下发为动作参数）；其余报错不受影响立即失败；窗口耗尽时错误信息追加「（auto-wait Nms 内元素未出现）」便于在轨迹里识别
- 边界：只对「element not found」生效；显式等待语义（等 url / 正文 / selector、断言式轮询）仍推荐 `expect`，auto-wait 只兜「元素晚到」。跨页续跑 `pending` 判定不受影响（auto-wait 发生在单步动作内部）
- `node --check` 通过；扩展更新后需刷新目标页面，新 `flowrun.js` 才会生效
