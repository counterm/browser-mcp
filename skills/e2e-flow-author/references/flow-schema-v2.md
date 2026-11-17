# Flow YAML v2（fixtures）

v1 文档完全兼容。v2 只新增顶层 `version` / `seed` / `fixtures`，步骤写法不变。

## 最小示例

```yaml
version: 2
flow: account-create
desc: 新增账号并回查
seed: 20261112                # 可选；固定后本次运行可复现
vars:
  base: '${env.BASE}'
fixtures:
  username: { gen: username, pattern: '^\w+$', min: 3, max: 32, prefix: e2e_, unique: true }
  phone:    { gen: phone, pattern: '^1[3-9]\d{9}$' }
  email:    { gen: email, domain: example.com }
  idCard:   { gen: cn_idcard }
  sex:      { pick: [1, 2] }
  status:   { dict: account_status, values: [1000001, 1000002], pick: first }
steps:
  - { id: s01, do: nav, url: '${vars.base}/system/account' }
  - { id: s02, do: click, text: 新增用户, expect: { selector: '.el-dialog' } }
  - { id: s03, do: type, selector: 'input[placeholder="请填写账户"]', text: '${vars.username}' }
  - { id: s04, do: type, selector: 'input[placeholder="请填写手机号"]', text: '${vars.phone}' }
  - { id: s05, do: type, selector: 'input[placeholder="请填写邮箱地址"]', text: '${vars.email}' }
  - { id: s06, do: click, text: 确定, expect: { text: 新增成功 } }
  - { id: s07, do: type, selector: 'input[placeholder="请填写账户"]', text: '${vars.username}' }
  - { id: s08, do: click, text: 查询, expect: { text: '${vars.username}' } }
```

## fixtures 字段

每个键会成为 `${vars.<键>}`。值可以是标量（常量），也可以是生成器对象。

| 写法 | 产出 | 主要参数 |
|---|---|---|
| `gen: username` | 字母数字账号，默认 `e2e_<token>` | `prefix` `min` `max` `length` `unique` |
| `gen: phone` | 11 位手机号 `1[3-9]\d{9}` | `prefix` `unique` |
| `gen: email` | `<prefix><token>@<domain>` | `prefix` `domain` |
| `gen: cn_idcard` | 18 位身份证（含校验位） | `area`（默认 110101） |
| `gen: date` | 日期 | `offset`（天）`format`（默认 `YYYY-MM-DD`） |
| `gen: number` | 整数 | `min` `max` |
| `gen: uuid` | UUID v4 | — |
| `gen: seq` | 序号 | `start` `step` |
| `gen: pattern` | 按正则生成 | `pattern` |
| `gen: string` | 随机字母数字 | `length` `prefix` `suffix` |
| `gen: bool` | 布尔 | — |
| `pick: [...]` | 从列表取一个 | `pick` |
| `dict: 名称` | 从字典值取 | `dict` `values` `pick: first/last/random` |
| `ref: 键名` | 引用已生成的 fixture | `ref` |
| `env: 名称` | 读扩展 `flowenv` | `env` |
| `template: 字符串` | 变量模板，可引用已生成的 fixture | `template` |
| `const: 任意值` | 常量 | `const` |

通用可选字段：

- `pattern`：生成后的兜底校验；不匹配会启动失败，并报出哪个 fixture。
- `unique`：同一次运行内保证不重复；重复时账号 / 邮箱自动加 run token，其他值加 `_<token>`。
- `secret`：为 `true` 时，报告 `report.fixtures` 里该值打码为 `***`。

## 物化顺序

```
flow.vars → fixtures → 运行参数 vars → data 当组
```

后者覆盖前者。因此：

- `flow.vars` 放静态常量。
- `fixtures` 放动态生成值。
- `flow run {vars:{...}}` 可临时覆盖（例如指定某个已存在账号）。
- `data` 每组可以覆盖同名 fixture，用于“这一组用固定值”。

每个 `data` 组单独物化；`unique` 值按 `run_id + 组号` 变化。
跨页续跑复用已物化的结果，不会因为页面跳转重新生成。

## 生成器细节

- `username`：`prefix + base36(hash(run_id + 组号))`，默认 `e2e_` 前缀，天然满足 `^\w+$`。
- `phone`：`1` + `[3-9]` + 9 位；`unique` 时后 9 位由 hash 决定。
- `email`：默认 `example.com`，适合生产环境避免真实触达。
- `cn_idcard`：默认区号 `110101`，生日 1980–2009，校验位按国标计算。
- `pattern`：支持字面量、`\d \w \s`、字符类、分组、`{n,m}`、`*`、`+`、`?`；
  不支持断言、反向引用等复杂语法。生成后仍会用 `pattern` 校验，不通过就报错。
- `dict`：`values` 必填。设计期把字典值解析后内联；运行期不查库、不查接口。

## 当前未实现（不要生成）

以下语法是规划项，当前扩展版本会忽略或报未知字段，**不要写进可运行 flow**：

- 步骤级 `extract` / `save_as`
- 顶层 `setup` / `teardown`
- `expect.net` 接口断言
- 运行期查数据库 / 查字典

在它们落地前：

- 清理动作写成普通步骤，放在最后。
- 已有记录用设计期查库后写进 `vars` / `data`。
- 接口是否正确用 `page_call {action:"netlog"}` 另行核对。

## 校验与排错

- `flow save` 会校验 `version`、`seed`、`fixtures` 结构和生成器名。
- 启动时物化一次，生成器错误会在 `flow run` 立刻返回，不会跑到一半才失败。
- 报错格式：`fixtures.<键>: ...`，按提示改 `pattern` / `min` / `max` / `values`。
- 报告新增 `version`、`seed`、`fixtures`（打码后），用于复现。
