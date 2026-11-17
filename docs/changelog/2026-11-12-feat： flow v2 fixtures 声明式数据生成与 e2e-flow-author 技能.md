# feat: flow v2 fixtures 声明式数据生成 + e2e-flow-author 技能

日期：2026-11-12

## 背景

v1 的 `vars` 只能写静态值，LLM 生成 E2E flow 时只能把账号、手机号、邮箱写死；重复运行会撞唯一约束，生产环境也容易污染真实数据。需要把“生成规则”和“实测值”分开。

## 改动

### flow v2（`chrome-extension/flowrun.js`）

- 新增 `version` / `seed` / `fixtures` 三个顶层字段；v1 文档不受影响。
- 新增生成器：`username`、`phone`、`email`、`cn_idcard`、`date`、`number`、`uuid`、`seq`、`pattern`、`string`、`bool`，以及 `pick` / `dict` / `ref` / `env` / `template` / `const`。
- 物化顺序：`flow.vars` → `fixtures` → 运行参数 `vars` → `data` 当组；后者覆盖前者。
- 每个数据组单独物化，`unique` 值按 `run_id + 组号` 变化；跨页续跑复用已物化结果。
- 启动时提前物化一次，生成器 / `pattern` 错误在启动阶段就返回，不会跑到一半才失败。
- 报告新增 `version` / `seed` / `fixtures`；`secret: true` 的 fixture 值在报告里打码为 `***`，步骤参数也会按生成值二次打码。
- `dict` 不查库：`values` 必须由设计期解析后内联，运行期只取值。

### 技能

- 新增 `skills/e2e-flow-author/`：`SKILL.md` + 契约 / flow 语法 / 选择器 / MCP 速查 + 账号管理示例。
- 新增 `scripts/install.ps1`：按需复制到 `<repo>/.trae/skills/`，或通过 `-Dest` 指定其它项目。
- 技能明确“先契约、后 flow”，并要求每个字段记录源码出处、冲突取最严。

## 验证

- `node --check chrome-extension/flowrun.js`
- 临时 Node 脚本抽取生成器代码，校验 username / phone / cn_idcard / pattern / dict / template / 跨组唯一性，全部通过（脚本已删除）。

## 边界

- 本轮只落 `fixtures`；`extract`、`setup` / `teardown`、`expect.net`、运行期查库属于下一阶段，技能文档已标注“不要生成”。
- fixtures 只在顶层 flow 物化；子流程通过 `vars` 接收具体值。
- 扩展更新后仍需刷新目标页，`flowrun.js` 才会换新。
