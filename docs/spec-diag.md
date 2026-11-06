# spec-diag：flow 自检 / 自报 / 自记录

一句话：**flow 跑完自己检查、自己上报、自己留档**。全部实现集中在 `chrome-extension/diag.js`，其它文件只保留一行锚点，避免检查逻辑散落到执行器里。

## 1. 边界与约定

- 只服务 flow 运行：`flowrun.js` 调 `stepStart()` 之后才采样；手动 `page_call` / LLM 单次调用 `stepStart` 未调用，自检零开销、行为零变化。
- **只告警，不判失败**：效果异常写 `entry.warnings`，不影响该步 `ok`；严格模式（warning 升级为 fail）尚未开启。
- **自检不能成为故障源**：`diag.js` 内部所有异常自吞；锚点统一 `D?.xxx?.()` + `try/catch`；`diag.js` 缺席时 flow 行为完全不变。
- 隔离世界（与 `content.js` 同一个 content script 世界），不是 MAIN world；工具箱主世界看不到 `__batbDiag`。

## 2. 加载顺序与依赖

`manifest.json` 的 `content_scripts.js` 顺序固定：

```
vendor/js-yaml.min.js → diag.js → content.js → flowrun.js
```

- `diag.js` 先于 `content.js`，才能在 `content.js` 末尾把动作表交出去。
- 无外部依赖、无构建步骤；只读 `globalThis.__batbExec.ACTIONS`（`content.js` 暴露）。
- 对外只暴露 `globalThis.__batbDiag = { wrapActions, stepStart, stepEnd, collectEvidence, lintFlow, buildDiagnostics, recordRun }`。

### 锚点（改动只在这几行）

| 文件 | 锚点 | 作用 |
|---|---|---|
| `content.js` | `wrapActions(ACTIONS)`（文件末尾） | 就地包装动作表；`flowrun` 拿到的 `__batbExec.ACTIONS` 是同一份对象，包装自动生效 |
| `flowrun.js` | `stepStart(step)`（每步开始） | 建立当前步骤采样上下文 |
| `flowrun.js` | `collectEvidence(step, error)`（步骤失败分支） | 采集现场证据 |
| `flowrun.js` | `stepEnd(entry)`（每步结束） | 汇总本步效果告警，写入 `entry.warnings` |
| `flowrun.js` | `lintFlow(doc)` + `buildDiagnostics(rep, lint)`（组装报告） | 写 `report.diagnostics` |
| `flowrun.js` | `recordRun(rep)`（运行结束） | 运行摘要写操作记录 |
| `toolbox/feats/build.js` | 报告渲染 | 展示 `warnings` / `evidence` / `diagnostics` |

## 3. 能力一：动作效果自检

包装范围为 `EFFECT_ACTIONS = click / type / select`。

**click**
- 动作执行前注册 `MutationObserver`（`document.documentElement`，`childList + subtree`）。
- 动作自身 `sleep(150ms)` 后再观察 `OBSERVE_MS = 250ms`。
- `changed = mutations > 0 || URL 变化 || 可见弹窗数变化`。
- 弹窗数口径：可见的 `.el-dialog` / `[role="dialog"]` / `.el-overlay` 数量（`.el-overlay` 会与 `.el-dialog` 重复计数，只用于变化检测，不用于判断弹窗个数）。
- `changed === false` → 告警：`点击后 250ms 内页面无变化（可能命中旧页面 / 隐藏节点，或该元素当前无响应）`。

**type / select**
- 回读控件值：`locate({ selector, bid })`（**不带 text**，避免把输入值当定位条件）。
- `el.value !== 期望值`（期望值非空）→ 告警：`输入未生效：回读值「…」≠ 期望「…」`。
- 受控组件吞值、输入掩码改写是这条检查的主要目标。

**汇总**
- 每步最多记 10 条效果（`cur.effects`），`stepEnd` 去重后最多写 5 条 `warnings`。
- 动作本身报错时才不写效果告警（失败已有 `error` 兜底）。

## 4. 能力二：失败取证

`collectEvidence(step, error)` 写入 `entry.evidence`，字段固定：

| 字段 | 内容 | 上限 |
|---|---|---|
| `at` | ISO 时间 | — |
| `url` / `title` | 当前地址 / 标题 | 300 / 120 |
| `error` | 失败原因 | 300 |
| `target` | `{ selector, text }`（该步定位参数） | 200 / 80 |
| `dialogs` | 可见弹窗文本，最多 3 个 | 每个 60 |
| `dom` | 目标周围 DOM 片段（`ACTIONS.dom`，depth 2） | 2500 字符 |
| `logs` | 页面 console 尾部（`plog`，warn/error，20 条） | 每条 120 |

- 超时：DOM 800ms、日志 1200ms；超时即放弃，不让取证拖慢失败步。
- 总长兜底：`JSON.stringify(evidence) ≤ 8000`；超限先对半砍 `dom`，再把 `logs` 截到最近 5 条。

## 5. 能力三：静态 lint

`lintFlow(doc)` 在运行开始时扫 YAML，最多 20 条（`MAX_LINT`）。规则：

1. 选择器里 `nth-of-type(N)` 且 `N ≥ 6` → 结构一变就漂移。
2. 选择器含 `el-overlay` / `el-dialog` 且含 `nth-of-type` → 弹窗数量一变就点不中，建议标题文本 / `data-testid`。
3. `do: click` + 选择器含 `nth-of-type` + 没有 `text` → 无法校验命中的是不是同一个按钮。
4. `do: type` + 选择器不像输入框（不含 `input|textarea|contenteditable|select`）→ 多半定位错了。
5. 本步与上一步都是跳转类（`NAVISH = nav/back/reload/click/press/tab_open/tab_activate`）+ 没有 `expect` + `auto_wait_ms === 0` → 跨页 / 异步渲染会直接失败。

lint 是启发式提示，不是正确性保证；`nth-of-type` 阈值写成 `>= 6`，小序号（1–5）不报。

## 6. 能力四：自报（报告汇总）

`buildDiagnostics(rep, lint)` 产出：

```json
{
  "diagnostics": {
    "lint": ["步骤 s07：…"],
    "warnings": [{ "id": "s03", "msg": "点击后 250ms 内页面无变化…" }]
  }
}
```

- `lint` 上限 20，`warnings` 上限 50（`MAX_WARN`）。
- 步骤级明细仍在 `steps[i].warnings` / `steps[i].evidence`，聚合列表只是给报告头部做概览。

### 工具箱展示（`toolbox/feats/build.js`）

- 步骤行：`warnings` 以橙色 `! …` 逐条追加；`evidence` 收进可折叠 `<details>` 的「现场证据」。
- 报告头部：有 lint 或聚合 warning 时显示 `自检 N lint · M runtime`，并逐条列出 lint。
- 现状：聚合 `warnings` 只计数，不重复列文本（步骤行已经展示过）。

## 7. 能力五：自记录

`recordRun(rep)` 把运行摘要写页面同源 `localStorage["ba:tbx-records"]`，与工具箱「设置 → 操作记录」**同一 key、同一 schema**：

```json
{
  "ts": 1793870583765,
  "feat": "flowrun",
  "title": "flow verify-s03-account-create · OK 9/9",
  "text": "PASS 9/9 步\nLINT 步骤 s07：…\nURL http://…/system/account"
}
```

- `text` 行序：`PASS/FAIL x/y 步`（有数据组时追加 `数据组 x/y`）→ 最多 5 条失败步 → `WARN <id> <msg>` → `LINT <msg>` → 最后一步 `URL`。
- `text ≤ 2000` 字符；数组上限 200 条；序列化后 `≤ 102400` 字符，超限从最旧开始丢。
- 不依赖 broker 常驻内存，运行完即可在工具箱回查；站点清空 localStorage 会一起清掉。

## 8. 容错与降级

- 所有锚点均为可选调用：`D?.stepStart?.()` 等，`diag.js` 没加载 / 加载失败时 flow 照常跑。
- `wrapActions` 有 `wrapped` 幂等标记，重复调用不会二次包装。
- `recordRun` 的读写全部 `try/catch`；配额满或 JSON 损坏时静默放弃，不影响报告返回。
- 效果采样只在 `cur` 非空时进行；步骤外的动作（跨页续跑的 click 等）不产生告警。

## 9. 实测记录（2026-11-05）

在同一目标站点重载扩展 + 刷新页面后跑真实 flow（`nav /system/menu → 账号管理 → 新增用户 → 三个输入 → 确定 → 改手机号 → 确定`）：

- 首跑暴露：`s03` 报 ok，但 `evidence.dialogs` 是「新增菜单」，`s04` 找不到账户输入框。根因是 `findByText()` 双向包含让短标签「新增」顶替「新增用户」，已修（见 [fix 记录](./changelog/2026-11-05-fix：%20text%20兜底把「新增」当成「新增用户」，仍会点到旧页面同构按钮.md)）。
- 修复后复跑 `9/9` 全过；`diagnostics.lint` 正常报出 `s07 / s09` 的 `nth-of-type(10)` 与弹窗位置序号（4 条）；成功点击步 `warnings` 为空。
- `localStorage["ba:tbx-records"]` 末尾记录：`flow verify-s03-account-create · OK 9/9`。
- 说明自检三段链路都真实生效：失败步有 evidence，报告有 diagnostics，结束有 record。

## 10. 已知边界

1. **「找到了但找错了」拦不住**：click 只看「有没有变化」。旧页面同构按钮被点中时也可能有变化（弹出错误弹窗）。这类问题靠 `selector` 的 `text` 校验 + `findByText` 双向包含修复 + evidence 里的弹窗标题排查，自检本身不判定对错。
2. **250ms 观察窗**：慢接口 / 长动画可能超出窗口 → 「无变化」误报；无关节点动画 / 闪烁又会让 `changed` 恒为 true → 漏报。两者都只是 warning。
3. **DOM 取证有裁剪**：depth 2 / 2500 字符，虚拟列表或深层弹窗可能截不到目标节点；日志只覆盖 `capture-main.js` 捕获的浏览器 console。
4. **secret 步骤证据未打码**：`flowrun` 的 `params` 会打 `***`，但 `collectEvidence` 的 `target.text` 直接取原值；密码类步骤失败时证据里可能是明文（待修）。
5. **lint 是启发式**：阈值（`nth-of-type >= 6`）和正则都是经验规则，不替代人工检查。
6. **记录同源共享**：`ba:tbx-records` 与工具箱操作记录共用，清站点数据会一起丢失。

## 11. 维护指引

- 新增 lint 规则：只改 `diag.js` 的 `lintFlow()`，保持单条一句话、可执行建议。
- 新增效果检查：把动作名加进 `EFFECT_ACTIONS`，在 `withEffect()` 里补充采样 / 回读分支。
- 调整体量：常量集中在文件头（`MAX_EVIDENCE / MAX_LINT / MAX_WARN / OBSERVE_MS / REC_KEY`）。
- 改完验证：`node --check chrome-extension/diag.js`（同时跑涉及的 `content.js` / `flowrun.js`），然后**重载扩展 + 刷新目标页**才生效。
- 不要改 `page-bridge.user.js`（存档版，不受支持）。
