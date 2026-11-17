# 字段契约（contract.yaml）

契约是“源码事实”和“flow 数据”之间的唯一中间层。先写契约，再写 flow；不要跳过。

## 结构

```yaml
page: /system/account
env: production            # production / staging / local
api:
  create: { method: POST, path: /sys-user }
  list:   { method: GET,  path: /sys-user }
  update: { method: PUT,  path: /sys-user }
  remove: { method: DELETE, path: /sys-user }
table: sys_user
sources:
  ui:  sz-admin/src/views/system/accountManage/components/UserAdd.vue
  api: sz-admin/src/api/modules/system/user.ts
  dto: sz-boot-parent/.../SysUserCreateDTO.java
  ddl: sz-boot-parent/.../024_sys_user.xml
  dict: sz-boot-parent/.../AccountStatusConstant.java
fields:
  username:
    label: 账户
    type: string
    required: true
    pattern: '^\w+$'
    min: 3
    max: 32
    unique: true
    ui: 'input[placeholder="请填写账户"]'
    sources: [ui, dto, ddl]
  phone:
    label: 手机号
    type: string
    pattern: '^1[3-9]\d{9}$'
    max: 20
    ui: 'input[placeholder="请填写手机号"]'
    sources: [dto, ddl]
  email:
    label: 邮箱
    type: string
    format: email
    max: 256
    ui: 'input[placeholder="请填写邮箱地址"]'
    sources: [dto, ddl]
  idCard:
    label: 身份证
    type: string
    format: cn_idcard
    max: 32
    ui: 'input[placeholder="请填写身份证"]'
    sources: [dto, ddl]
  sex:
    label: 性别
    type: enum
    values: [0, 1, 2]
    sources: [ui]
  accountStatusCd:
    label: 账户状态
    type: dict
    dict: account_status
    values: [1000001, 1000002, 1000003]
    sources: [dict]
  deptId:
    label: 部门
    type: ref
    ref: sys_dept.id
    required: false
    sources: [ui, ddl]
```

## 从哪里取

| 目标 | 前端 | 后端 | 数据库 |
|---|---|---|---|
| 字段名 / label | 表单 `el-form-item` / `Form.Item` | DTO 字段 | 列名 / 注释 |
| 必填 | `rules.required` | `@NotBlank` / `@NotNull` | `nullable=false` |
| 长度 | `min` / `max` / `maxlength` | `@Size` | `VARCHAR(n)` |
| 格式 | `rules.pattern` / `validator` | `@Pattern` / `@Email` / `@Phone` / `@IdCard` | 长度、类型 |
| 枚举 | 下拉 `options` | 常量类 / 枚举 | 字典表 |
| 唯一 | 页面提示 / 保存报错 | Service 唯一校验 | unique index |
| 选择器 | 渲染后的 placeholder / name / aria-label | — | — |

前端 `rules` 可能只是 UI 提示，后端注解才是最终守门人；DDL 只负责存储边界。
三者不一致时以“更严”的为准，并在 `notes` 里写清冲突。

## 冲突处理

示例：`username`

- 前端：3–32 位，`^\w+$`
- DTO：`@Size(min=3,max=32)` + `@Pattern("^\\w+$")`
- DDL：`VARCHAR(32)`

结论：`min: 3, max: 32, pattern: '^\w+$'`，三处一致。

示例：`phone`

- 前端：没有格式规则
- DTO：`@Phone`
- DDL：`VARCHAR(20)`

结论：`pattern: '^1[3-9]\d{9}$'`，`max: 20`。不要把 DDL 的 20 当成手机号长度。

## 设计期 vs 运行期

- 设计期（LLM）：读源码、读 DDL、只读查库、解析字典、选已有记录。
- 运行期（扩展）：只读页面，按 `fixtures` 生成新值，填表、点击、断言。

所以：

- “查询 / 编辑 / 删除”已有记录：设计期查出具体值，写进 flow 的 `vars` / `data`。
- “新增”记录：运行期用 `fixtures` 生成唯一值，不要写死。
- 契约里的 `dict.values` 必须是具体值；运行期不查字典接口。

## 校验清单

- [ ] 每个字段都有 `sources`
- [ ] 必填 / 长度 / 格式 / 唯一四类约束都已核对
- [ ] 字典值已解析成 `values`
- [ ] 选择器来自真实 DOM，不是源码里的 class
- [ ] 生产环境字段（手机号 / 邮箱）使用测试池
- [ ] 冲突项写进 `notes`，没有静默取一个
