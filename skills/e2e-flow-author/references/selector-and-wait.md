# 选择器与等待

## 选择器优先级

1. `data-testid`
2. `aria-label`
3. `name`
4. `placeholder`
5. 稳定 CSS（业务 class + 语义属性）
6. 文本 `text`（仅用于按钮、标签、菜单项）

禁止：

- 框架自动 id：Element Plus `el-id-N-M`、React `:r0:`、MUI `mui-N`、Radix / HeadlessUI / Downshift。
- 大序号 `nth-of-type` / `nth-child`。
- 纯坐标点击（`x` / `y` 只用于消歧，不作为首选）。
- 源码里的 scoped class（带 hash）直接当选择器。

## 怎么拿选择器

1. `page_snapshot` 看交互元素和 bid。
2. `page_call {action:"dom", selector:"<弹窗或表单容器>", depth:6}` 看真实属性。
3. 对 Element Plus 弹窗，优先限定在 `.el-dialog` / `.el-drawer` 内，避免命中页面上的同名输入框。
4. 同一页面有多个相同 placeholder 时，用 `bid` 或更外层容器限定；不要依赖顺序。

## 等待

- 定位类动作（click / type / select / hover / press）自带 auto-wait（默认 5s，0.3s 轮询）。
- 路由切换后的数据渲染，用 `expect: {selector}` 或 `expect: {text}` 等，不要写固定 `sleep`。
- 弹窗打开：`expect: {selector: '.el-dialog'}`。
- 列表回查：`expect: {text: '${vars.username}'}`。
- 接口慢时优先加 `expect`，不要盲目加大全局等待。

## 文本匹配

- 点击文本是“目标文本包含查询文本”的单向匹配。
- 不要反过来用查询文本包含目标文本；旧页面同构按钮会被误命中。
- 文本要截取稳定片段，例如“新增用户”而不是“新增用户（当前部门）”。

## 输入

- `type` 只支持 `bid` / `selector`，`text` 参数是输入值，不是定位文本。
- 目标必须是 `input` / `textarea` / `contenteditable`，否则报“目标不可输入”。
- 受控组件走原生 setter，一般不需要额外触发事件。
- 密码步骤加 `secret: true`，值用 `${env.PWD}`。

## 下拉与弹窗

- Element Plus `el-select`：先点触发器，再点下拉项；下拉项通常在 `body` 下的 teleport 容器里。
- 弹窗内容在 `.el-dialog` / `.el-drawer` 内；关闭后 DOM 可能仍在，断言要配合可见性或文本变化。
- 表格行操作按钮：先用唯一文本（账号 / 名称）限定行，再点行内按钮；不要直接点第 N 行。

## iframe

- iframe 内元素的事件反查和部分能力受限；优先在顶层页面操作。
- 必须进 iframe 时，用 `eval` 或页面提供的独立预览窗口，并在报告里标注限制。

## 失败排查顺序

1. 看报告失败步的 `error` / `evidence` / `warnings`。
2. `page_logs {q:"[flow:"}` 看轨迹，确认是没找到、点错还是断言不过。
3. `page_call {action:"dom", selector:"<目标容器>"}` 看当前真实 DOM。
4. `page_call {action:"highlight", selector:"..."}` 红框确认元素。
5. `page_call {action:"screenshot"}` 截图，再用 Read 看图片。
6. 最后才改选择器；不要先放宽断言。
