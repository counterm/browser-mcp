# 2026-10-30 · fix: 「运行 flow」磁贴补上 YAML 粘贴直接运行入口

- `chrome-extension/toolbox/feats/build.js` + `docs/toolbox/feats/build.js`（两树同步）：
  「运行 flow」磁贴顶部新增 YAML 粘贴框 +「运行 / 清空」按钮，`runFlowReq({ yaml })` 在当前页
  直接执行（不入库）；粘贴运行的报告区与 flow 库列表的报告区分开，互不覆盖；磁贴描述改为
  「粘贴 YAML 或从库选 flow」。原型树同样渲染粘贴框（无扩展桥，点「运行」提示改用扩展版 / CLI），
  不再整块只显示一行 CLI 说明。
- `docs/toolbox-proto-map.md`：`runflow` 说明补上「顶部粘贴 YAML 直接运行（不入库）」。
- MCP 侧无需改动：`broker.py` 的 `flow` 工具已支持 `op=run` 内联 `yaml`（也可 `op=save` 入库后按
  `name` 跑）；实测 `tools/call` 返回逐步报告。
- 验证：两树 `node --check` 通过；MCP `flow {"op":"run", yaml}` 冒烟流（wait + eval + 断言）2/2 通过。
  生效需重载扩展并刷新页面。
