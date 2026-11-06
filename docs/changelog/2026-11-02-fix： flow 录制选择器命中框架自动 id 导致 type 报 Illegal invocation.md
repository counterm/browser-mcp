# 2026-11-02 · fix: flow 录制选择器命中框架自动 id 导致 type 报 Illegal invocation

- 问题：Element Plus 页面录制的 `type` 步骤写成 `selector: "#el-id-384-65"`，回放报 `Illegal invocation`。原因是 `el-id-<计数器>-<n>` 每次挂载都重新分配：计数器变了会「找不到」，恰好撞上同名编号时会命中 div / li / select 等非输入元素，`HTMLInputElement.prototype.value` 的 setter 作用在错误对象上就抛这个无方向的错
- 修复 1（选择器来源）：`picker.js` 的 `bestSelector` / `cssPath` 新增 `UNSTABLE_ID` 跳过框架自动 id（Element Plus `el-id-N-M`、React `useId` `:r0:`、MUI `mui-N`、Radix / HeadlessUI / Downshift、`__BVID__`、纯数字开头），继续按 data-testid → aria-label → name → **placeholder** → cssPath 降级；属性选择器值统一走 `attrSel` 转义。Element Plus 输入框普遍带 `placeholder`（如 `input[placeholder="请输入应用名称"]`），比自动 id 稳定得多
- 修复 2（执行侧）：`content.js` 的 `type` 动作只用 `bid` / `selector` 定位，不再把 `text` 当兜底定位键（规范里 `type` 的 `text` 只是输入值，回退定位会把输入值当文本去匹配任意元素）；`setValue` 增加可输入性校验，目标不是 input / textarea / contenteditable 时直接报「目标不可输入：<tag#id.class>，type 需要 input / textarea / contenteditable」，不再抛 `Illegal invocation`
- 评分规则同步：新增 `[placeholder=…]` 75 分；`#el-id-N-M` / `#:r0:` / `#mui-N` 归入「自动生成，勿用」（5 分）
- 工具箱两棵树（`chrome-extension/toolbox/` + `docs/toolbox/`）同步改动；`node --check` 通过
- 追加修复（同日实测 Element Plus 表格录制）：`cssPath` 过滤交互态 / 状态修饰类（`hover-row`、`current-row`、`is-*`、`active`、`selected` …）。此前表格行录成 `tr.el-table__row.hover-row:nth-of-type(4)`，`hover-row` 只在悬停时存在，回放永远匹配不到，于是退化成按文本「修改」兜底
- 追加修复：`content.js` 的 `findByText` 只认可见元素（`getClientRects()` + `visibility/display/opacity`），避免「修改」命中下拉菜单里隐藏的「修改密码」，点开后弹错窗口；无可见候选时才回退到隐藏的精确匹配
- 实测时序提示：Element Plus 弹窗刚打开时表单数据尚未回填，立即 `type` 会被后续渲染覆盖成空值。YAML 里应在点击后加 `expect`（等表格行 / 等弹窗输入框）或 `do: wait`，再执行 `type`
- 追加修复（运行 flow 磁贴在扩展版里误报「需要扩展版」）：`build.js` 的 `hasExt` 探测用的是 `chrome.runtime.id`，但工具箱被 background 以 `world: 'MAIN'` 注入主世界，那里没有 `chrome.runtime`，判定永远为 false——保存入库 / 导入保存 / flow 库 / 跨页续录恢复全部被连坐禁用。改为经 DOM 事件桥异步探测（`batb:bridge` → content.js → background `tb:pinfo` 轻量调用，1.2s 超时）：有响应（含错误响应）即视为桥在，超时（真原型 / content.js 缺失）才判原型；`record` 与 `runflow` 面板先显示「正在探测扩展桥…」，探测完成再渲染。已在白名单页面实测桥探测返回页桥标记
- 存量 flow 需重录该步骤（旧 `#el-id-*` 选择器无法自动修正）；扩展更新后需刷新页面，`content.js` 才会换新
