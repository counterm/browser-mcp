# 2026-10-29 · feat: YAML 测试流（flow）编排扩展——子流程与数据驱动

- `broker.py`：
  - 子流程：新增编排动作 `do: flow {name, vars?}`——从库加载另一个 flow 校验后递归执行（同一目标页），报告该步嵌套子步骤（steps）与汇总（passed/total）；嵌套 ≤5 层、禁止循环引用（调用链写进失败原因），支持与 expect / retry / on_fail 组合；`vars` 先按父流程变量展开再覆盖子流程自身 vars
  - 数据驱动：flow 级 `data`（内联列表，≤200 组、值须标量）或 `data_file`（相对 flows/ 目录解析，.json 对象数组 / .csv 首行表头，utf-8-sig 兼容；校验时即归一化为 doc.data），每组数据完整跑一遍全部步骤——组间互不影响（组内仍遵循 stop_on_fail / on_fail）；报告新增 `data_rows / passed_rows / failed_rows / rows` 汇总，步骤条目带 `row` 标记；console 轨迹每组一条 `▶ 数据组 i/N`（不回显组值）；异步进度 steps_total 按 步×组 计
- `chrome-extension/toolbox/feats/build.js` + `docs/toolbox/feats/build.js`（两树同步）：报告渲染补数据组汇总行
- `cli_client.py`：输出补数据组汇总行
- 文档：`docs/spec-flow.md` 新增「子流程与数据驱动」「定时回归」（CLI + 计划任务 / Trae schedule 技能，无内置调度器）章节，do 表 / 字段表 / 分期状态更新；README 中英 flow 行更新
- 验证：`py_compile` + `node --check` 全过；8770 端口假页面 E2E——`do: flow` 子流程嵌套执行（子步骤 1、子汇总 1/1、vars 透传）、data 2 组 × 2 步 = 4 条目全带 row 标记且 2/2 组通过（steps_total=4）、`m4-cyc` 自引用被拦截（FAIL + 调用链）、`data` 含非标量值校验 400；测试流程已从库删除，测试进程与产物已清理
- 生效条件：重启 broker（MCP stdio 重连即可）；纯 broker 侧改动，扩展无需重载
