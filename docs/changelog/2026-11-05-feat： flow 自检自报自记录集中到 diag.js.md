# 2026-11-05 · feat: flow 自检 / 自报 / 自记录集中到 `diag.js`

- 新增 `chrome-extension/diag.js`（隔离世界，manifest 加载顺序 `vendor → diag → content → flowrun`），全部能力收在这一个文件里，其它文件只留锚点：
  - `content.js`：`wrapActions(ACTIONS)` 一处（就地包装动作表，flowrun 拿到的同一份对象自动生效）
  - `flowrun.js`：`stepStart` / `stepEnd`（步骤边界）、`collectEvidence`（失败分支）、`lintFlow` + `buildDiagnostics`（报告组装）、`recordRun`（运行结束）
  - `toolbox/feats/build.js`：报告里通用渲染 `warnings` / `evidence` / `diagnostics`
- 动作效果自检：flow 步骤内 `click` 用 MutationObserver 观察 250ms（childList + URL / 弹窗数变化），`type` / `select` 回读 `el.value`；无变化或回读不符写入 `entry.warnings`。只告警不判失败，手动 / LLM 单次调用不采样（`stepStart` 未调用时零开销）
- 失败取证：失败步自动抓目标周围 DOM 片段（`dom`，≤2.5K）、console 尾部（`plog` warn/error，20 条）、当前弹窗标题、URL / title，写进 `entry.evidence`，总长 ≤8KB，报告里折叠展示
- 静态 lint：运行开始时扫 YAML（`nth-of-type(N≥6)`、弹窗 / 遮罩位置序号、纯位置点击缺 `text`、`type` 目标不像输入框、连续跳转又关 auto-wait），写入 `report.diagnostics.lint`，工具箱报告头部展示
- 自记录：运行结束把摘要（通过率、失败步、告警、lint）写入页面同源 `localStorage["ba:tbx-records"]`（与工具箱「操作记录」同一 key / schema，直接可在设置面板回查）
- 容错：`__batbDiag` 缺席或 diag 内部抛错时全部静默降级（所有锚点 `D?.xxx?.()` + try/catch），自检绝不阻断 flow；`recordRun` 的 storage 配额截断与 `B.rec` 保持一致（200 条 / 100KB）
- 验证：`node --check` 通过（diag.js / content.js / flowrun.js / build.js），`manifest.json` JSON 解析通过；扩展重载 + 刷新页面生效
