---
name: e2e-flow-author
description: 联合前端页面规则、后端 DTO/DDL 与字典生成可执行的 Page Bridge flow YAML。当用户要求为某个管理后台页面新建、补全或修复 E2E 测试流，或需要随机/字典数据填充、跨前后端核对字段约束时使用。不用于纯接口测试或与浏览器无关的单元测试。
---

# E2E Flow Author

把源码事实收敛成 `contract.yaml`，再生成 `flow.yaml`，最后用 page-bridge MCP 跑通并修复。
不要凭记忆写字段规则，也不要把随机值写死进 YAML。

## 何时使用

- 为某个页面生成新增 / 编辑 / 查询 / 删除的 E2E flow。
- 需要按前后端约束生成手机号、邮箱、账号、身份证、字典值等测试数据。
- 已有 flow 跑不通，需要根据报告证据修选择器、等待或断言。
- 需要把“源码约束”和“运行结果”对齐，排查前后端字段不一致。

不适用：纯接口测试、没有浏览器的单元测试、只需要解释 flow 语法。

## 输入

至少拿到：

- 目标页面 URL（生产或测试环境要明确）。
- 前端源码目录（Vue / React 均可）。
- 后端源码目录（Controller / DTO / Entity）。
- 数据库 DDL 或 Liquibase 目录（可选，但强烈建议）。
- 只读数据库连接（可选；用于选已有记录和运行后核对）。

缺哪项就明确说明，不要用猜测补齐。

## 安装 / 指定

技能源文件在本仓库 `skills/e2e-flow-author/`，不会自动注入。

- 项目级安装：`powershell -File skills/e2e-flow-author/scripts/install.ps1`
  默认复制到 `<repo>/.trae/skills/e2e-flow-author/`。
- 装到别的项目：`powershell -File skills/e2e-flow-author/scripts/install.ps1 -Dest D:\path\to\repo\.trae\skills`
- 覆盖已有安装：加 `-Force`。
- Claude Code：复制到 `<repo>/.claude/skills/`。
- 不安装也可以：在会话里指定“读取 `skills/e2e-flow-author/SKILL.md` 并按其流程执行”。

## 工作流

### 1. Discover

按“页面 → 接口 → 后端 → 表 → 字典”顺序取证，不要先写 YAML。

1. 从 URL 找前端路由和视图组件，读查询表单、新增/编辑弹窗、`rules`、下拉选项、placeholder。
2. 找前端 API 模块，记录 method / path / 请求体、响应结构。
3. 找后端 Controller、DTO、Entity，记录 `@NotBlank`、`@Pattern`、`@Size`、`@Email`、`@Phone`、`@IdCard` 等约束。
4. 找 DDL / changelog，记录列类型、长度、可空、唯一约束。
5. 找字典常量 / `sys_dict`，把字典值解析成具体列表。
6. 用 `page_snapshot` 和 `page_call {action:"dom"}` 看真实渲染结果，拿稳定选择器；源码里的 class 只能作参考。

### 2. Contract

先写 `contract.yaml`，再写 flow。契约格式见 `references/contract-schema.md`，示例见
`assets/contract.example.yaml`。硬要求：

- 每个字段写 `sources`（文件 + 行号）；没有出处的字段标 `unverified`。
- 前端、DTO、DDL 冲突时取最严；把冲突的两处都写进 `notes`。
- 字典值必须在设计期解析成 `values`，运行期不查库。
- 契约是唯一中间产物，flow 只引用 `${vars.x}`，不直接引用源码。

### 3. Compose

按场景矩阵生成，不要只写 happy path：

- 新增成功（必填齐全、合法数据）
- 新增校验失败（逐个必填 / 格式 / 长度）
- 查询已有记录（用设计期从数据库选出的真实值）
- 编辑（改一个可回滚字段）
- 删除（只删本次创建或明确标记的测试数据）

flow 语法见 `references/flow-schema-v2.md`，示例见 `assets/flow.example.yaml`。
写操作必须满足：

- 唯一值用 `fixtures` 生成，账号 / 邮箱带 `e2e_` 前缀和 run token。
- 有 `teardown`（当前 v2 尚未内置时，至少在报告里写明清理步骤，交由人工或后置作业）。
- 步骤 id 唯一，关键步骤有正向 `expect`。
- 密码等敏感值走 `${env.X}` + `secret:true`，不落 YAML。

### 4. Verify

1. `flow {op:"save", yaml}` 先做结构校验。
2. `flow {op:"run", name|yaml, mode:"async"}`，用 `flow {op:"status", run_id, wait_ms}` 轮询。
3. 读报告：失败步的 `error`、`evidence`、`warnings`、`report.diagnostics.lint`。
4. 用 `page_logs {q:"[flow:"}` 看逐步轨迹；用 `page_call {action:"netlog", op:"list"}` 看接口是否发出、状态码是否正确。
5. 截图用 `page_call {action:"screenshot"}`，再用 Read 看落盘图片。

### 5. Repair

- 只改选择器、等待、fixture 参数、步骤顺序。
- 不允许为了跑通删除或放宽断言。
- 连续 3 轮仍失败就停下来，输出“失败步骤 + 证据 + 怀疑的源码约束”，不要继续瞎试。
- 修完把原因写进 flow 的 `desc` 或报告备注，避免下次重复踩坑。

## 硬规则

- 选择器优先级：`data-testid` → `aria-label` → `name` → `placeholder` → 稳定 CSS。
- 禁止框架自动 id（Element Plus `el-id-N-M`、React `:r0:`、MUI `mui-N`）、大序号 `nth-of-type`、纯坐标点击。
- 点击文本只做“目标文本包含查询文本”的单向匹配；不要反过来用查询文本包含目标文本，否则旧页面同构按钮会被误命中。
- 生产环境：专用测试账号；数据库只读；手机号 / 邮箱用内部测试池，避免真实短信 / 邮件触达。
- 每个写操作都有唯一前缀和清理方案；禁止删除不带前缀的数据。
- 报告用中文，保留证据，不把敏感值写进 `desc` / `notes` / 截图说明。

## 输出

- `contracts/<page>.contract.yaml`
- `flows/<page>-<scenario>.flow.yaml`
- 运行报告摘要：通过 / 失败步 / 告警 / lint / 证据位置
- 如发现前后端约束不一致，单列“源码冲突”一节

## 参考

- `references/contract-schema.md`：字段契约结构与冲突处理
- `references/flow-schema-v2.md`：flow v2 语法与生成器
- `references/selector-and-wait.md`：选择器、等待、常见回放坑
- `references/mcp-tools.md`：page-bridge MCP 调用示例
- `assets/contract.example.yaml`：账号管理页契约示例
- `assets/flow.example.yaml`：新增账号 flow 示例
