# Changelog

格式参照 [Keep a Changelog](https://keepachangelog.com/)，按日期倒序记录。

## 2026-10-26 · 修复元素拾取器：拾取期间收起工具箱界面，选中后恢复

- **现象**：点「开始拾取」后 hover/点击页面元素，元素能正常锁定且结果已渲染，但面板、功能列表、详情浮层同时关闭，表现为「所有工具都消失」；且再次拾取时上一次结果会残留在详情区
- **根因 1（界面被误关）**：拾取器只在 **`click`** 捕获阶段拦截页面点击，而 `boot.js` 的「点击页面其他位置收起面板」监听的是 **捕获阶段 `pointerdown`**——pointerdown 先于 click，点页面选元素的同时先执行了 `ui.closePanel()`，等 pick 的 promise resolve 时浮层已关闭
- **根因 2（拾取界面遮挡）**：拾取期间面板/浮层停留在屏幕上，既挡视线也挡目标元素，与「进入拾取应专注页面」的预期不符
- **修复**：
  - `ui.js` 新增 `hideForPick()/showAfterPick()`，`core.js` 新增 `.pick-hide{display:none!important}`——拾取开始时把 FAB/面板/功能列表/详情浮层/撤销栈整体隐藏，选中或 Esc 取消后原样恢复并重算布局（不改变各自 open 状态，恢复即回到拾取前的界面）
  - `picker.js` 的 `pick()` 在创建遮罩时调用 `hideForPick()`，`cleanup()` 里调用 `showAfterPick()`；所有走 `B.pick()` 的功能（隐藏元素 / 容器截图 / 存入选中元素 / 事件反查 / 表格提取等）自动获得同样行为；`ensurePicked()` 打开详情即自动拾取的场景同样生效
  - `boot.js` 的 pointerdown 收起逻辑增加守卫 `if(sq('.picker-ov')) return;`（拾取期间页面点击 = 选中元素，不是点空白收起），与既有 Esc 守卫同口径
  - `feats/find.js` 的「元素拾取器」结果写入独立结果区 `out`，每次点击「开始拾取」先清空——只显示当前这次结果，不再残留上一次
- 原型 `docs/toolbox/` 四个文件（core / ui / picker / feats/find）同步；本地原型页真实鼠标验证：进入拾取后 FAB/面板/列表/详情/撤销栈全部隐藏 → 点击表格单元格 → 界面恢复且结果只有 1 份；再次拾取时旧结果清空；Esc 取消同样恢复界面

## 2026-10-22 · 采集新增「接口调用」：双层捕获 + netlog LLM 查看协议

- **双层捕获架构**（MV3 webRequest 拿不到响应体，页面 hook 看不到浏览器自动加的 Cookie，两层合并）：
  - 新增 `chrome-extension/capture-main.js`——manifest 静态声明 `document_start` + `world:"MAIN"` 注入，包裹 fetch/XHR 抓**请求体原文/响应体**（`clone()` 旁路流式读取、超 256KB cancel，不拖慢页面不全量缓冲；SSE/二进制/opaque 只记 meta），环形缓冲 300 条存页面内存（导航即清空，除主动查询不离开页面）；`feats/capture.js` 新增 `apinet`（接口调用，功能数 36→37，README 与 proto-map 同步）
  - background 加 webRequest 观察模式 5 监听器（`onBeforeRequest/onSendHeaders/onHeadersReceived/onCompleted/onErrorOccurred` 定稿）抓 **URL/method/全量请求头（`extraHeaders` 才有 Cookie/Authorization）/请求体/响应头与状态码**；只记白名单页；定稿落 `chrome.storage.session['neth:'+tabId]`（每 tab 150 条、2MB 体积护栏丢最旧、请求体截 16KB、不存响应体；SW 随时可被杀，不能只放全局变量）；tab 关闭清 key
  - 合并按 method + URL 归一化 + Δt≤8s 最近邻、**consume-once**（rid 去重防同 URL 轮询误并），歧义保留 `src='net'` 的「仅头」记录（整页跳转后 body 侧清空时仍可见）
- **复制**：`apinet` 列表（1.5s 轮询）→ 点行进详情（同详情浮层内切换）→ 请求头/请求体/响应头/响应体分区 + **复制调试文本 / 复制 cURL**；**默认脱敏**（Cookie/Authorization/token 头 → `«已脱敏»`，体套用 JWT/手机号/邮箱等占位，口径同 `B.REDACT`），按站开关 `localStorage["ba:netredact"]`
- **查看（上层总沟通协议）**：新增 broker 命令 `netlog`（进 hello `caps`）——`{"op":"list"}` 摘要（不含 body）→ `{"op":"get","id":N}` 完整记录 / `{"op":"curl"}` 回放 / `{"op":"clear"}`；链路 background → content.js → DOM 事件 `batb:netq` → MAIN world 捕获层应答（不走 eval：eval 在 USER_SCRIPT/ISOLATED world 看不到 MAIN world）；`cli_client.py` SYSTEM_PROMPT 同步；协议 spec 见 `docs/spec-net-protocol.md`
- manifest 0.1.1→0.1.2，permissions 加 `webRequest`（观察模式，无需 blocking）；**更新后需重载扩展并刷新页面**（捕获层随页面 document_start 注入）
- 原型 `docs/toolbox/` 不动：本功能依赖扩展后台/扩展桥，与 qr/capture 同属「仅扩展版」

## 2026-10-21 · 截图自动处理浮动元素（fixed / sticky）

- **fixed 元素临时隐藏、sticky 元素临时取消吸附**（转 `static`，只在原位出现一次），整页截图与容器截图共用——`markFloating(scroller)` 扫描 `body *` 按 computed position 打标（`data-ba-fx` / `data-ba-stk`）+ 页面级 CSS 生效，`finally` 里 `unmarkFloating()` 还原属性与样式；结果信息展示处理数量
- 容器截图跳过滚动容器自身与其祖先（避免把目标藏掉）；容器**内部**的 sticky 照常取消吸附（吸顶表头不再每屏重复）；标记在测量矩形之前完成，保证裁剪坐标不受布局微移影响
- fixed 为脱离文档流隐藏不影响布局；sticky 占据常规流位置，转 static 不改变高度——两种处理均不引入页面跳动；dlog 记录 `floating fixed=N sticky=M`
- README 采集段、proto-map `fullshot`/`elshot` 行同步

## 2026-10-21 · 拾取器改窗口捕获级事件 + 交互诊断日志

- **拾取事件模型重构**：此前依赖遮罩（`.picker-ov`）接收 mousemove/click——页面若有 z-index 更高的元素（弹窗/浮层）盖住遮罩，真实事件落不到遮罩上，拾取即失效（合成事件测试绕过了真实命中路径，故此前自测未复现）。改为：遮罩纯视觉（`pointer-events:none`），mousemove/click 挂 **window 捕获级**（页面任何元素都抢不走事件），点击在捕获阶段 `preventDefault + stopPropagation` 拦下（页面链接/按钮不响应）；元素命中回归 `elementFromPoint`（遮罩已不参与命中，页面最高层元素即所得）；悬在工具箱自身 UI 上时通过 `host.contains(e.target)` 判定不拾取；拾取期间注入 `*{cursor:crosshair!important}`；高亮框/提示条 z-index 提到 2147483601+，保证盖过页面任意浮层
- **新增交互诊断日志 `B.dlog`**：环形写入 `localStorage["ba:diaglog"]`（每站点 60 条）——拾取开始/命中/取消、容器截图进入/模式/矩形/步数/逐屏成功/异常全量埋点；用户 F12 Console 执行 `copy(localStorage.getItem('ba:diaglog'))` 即可把交互数据反馈给开发侧定位
- 原型 `docs/toolbox/` 的 core.js / picker.js 同步

## 2026-10-21 · 修复 FAB 在视口变矮后被淹没

- FAB 拖拽记忆的是绝对 `top`，F12 停靠等把视口压矮后会停在视口外不可见；boot.js 新增 `clampFab`——恢复记忆位置时与 `window.resize` 时把 `top` 钳回视口内（默认 `bottom:24px` 定位随视口自适应，不受影响）；面板开着时同步重算布局；原型 `docs/toolbox/boot.js` 同步
- 本地自测页（桥接桩模拟 `captureVisibleTab`）+ 真实浏览器验证：容器截图（容器内 4 屏滚动拼接、滚动位置还原、结果渲染）、区域截图退化、FAB 钳制（记忆 top=3000px 加载后入视口、resize 压矮仍入视口）三条链路通过

## 2026-10-21 · 修复元素拾取器：Shadow DOM 命中测试不穿透

- **修复 `pick()` 对页面元素完全失效**（隐藏元素 / 元素描边 / 查找 / 容器截图等所有拾取功能）：拾取遮罩挂在工具箱 Shadow DOM 内，`document.elementFromPoint` 不穿透 Shadow——遮罩盖屏后任何位置命中的都是宿主 `#ba-toolbox-host`，恰被 `t === host` 判为工具箱自身丢弃，导致永远无高亮、点击无响应（只能 Esc 退出）
- 改用 `document.elementsFromPoint` 取整叠命中元素，跳过宿主后取其下的真实页面元素；原型 `docs/toolbox/picker.js` 同步

## 2026-10-21 · 采集新增「容器截图」：只截某一容器内部的滚动范围

- **背景**：整页截图对 `document` 滚动拼接，页面滚动发生在内部容器（`overflow:auto` 区域）时文档不滚，只会截到当前一屏
- **新增** `feats/capture.js` 的 `elshot`（容器截图，功能数 35→36，README 与 proto-map 同步）：
  - **滚动定位**：拾取元素（或容器内任一元素）向上找最近可滚动祖先——`overflowY` 为 auto/scroll/overlay 且实际溢出（`scrollHeight > clientHeight`）才算；找不到则退化为区域截图（截取该元素当前可见部分）
  - **测量时机**：先隐藏工具箱与滚动条（容器打 `data-ba-nosb` + 注入对应 CSS，页面级滚动条同样隐藏）、`scrollIntoView({block:'nearest'})` 尽量把容器完整带入视口，之后才量 rect——避免滚动条消失/回流导致裁剪坐标漂移
  - **步长取可视切片高度**（视口 ∩ 容器矩形）而非 clientHeight：容器比视口高时按 clientHeight 步进会漏屏；末屏不足一整步时补截贴底位置，拼接按容器内容坐标（`scrollTop + 切片偏移`）定位，天然无重叠错位
  - **边界提示**：容器顶部/底部被视口裁住的内容物理上不可见、无法截取，输出缺口像素数；横向超出视口同样不截；容器内 sticky 元素每屏重复出现
- **整页截图补提示**：仅截到一屏（文档自身不可滚动）时，在结果里提示滚动可能发生在内部容器，引导改用「容器截图」
- 抽出 `showResult` / `stampName` 供两个截图功能共用；core.js 新增 `crop` 图标

## 2026-10-21 · 表单工具调整：移除「表单字段总览」，新增「表单保存与填充」

- **移除** `feats/info.js` 的 `forms`（表单字段总览）——功能由新的表单保存/填充取代，功能数 34→33（原型）/ 36→35（落地），README 与 proto-map 计数同步
- **新增** `feats/build.js` 的 `formkit`（表单保存与填充）：
  - **保存 / 回填**：按站点存 `localStorage["ba:formkit"]`（密码字段出于安全不入库），回填时 selector 匹配 + 字段顺序兜底（页面结构变化仍可用），select 按值/文本匹配选项；带「清除」
  - **随机填充**：按 name / id / placeholder / label / autocomplete 猜字段语义——邮箱 / 手机号 / 邮编 / 验证码 / 身份证给格式化假数据，姓名给中文随机名，省市地址给地区名，下拉框随机选非占位项，其余填随机字母；尊重 maxlength，跳过 hidden / 提交类 / 文件 / 勾选类与禁用只读字段
  - 填充走原生 setter + `input`/`change` 事件（兼容 React / Vue 受控组件），并压入撤销栈（undoPill 一键恢复）
- core.js 新增 `save` 图标；原型 `docs/toolbox/` 两文件同步

## 2026-10-21 · 「采集」分类代码审查修复

- **修复整页截图致命缺陷**：background `tb:shot` 返回 `{ok, dataUrl}`，而扩展桥协议（content.js respond）只透传 `data` 字段，`dataUrl` 永远到不了页面侧 → fullshot 必然失败；改为 `sendResponse({ ok: true, data: { dataUrl } })`，与桥协议对齐（双人交叉验证确认）
- `tb:shot` 直接用 `sender.tab.windowId`，省去一次 `chrome.tabs.get` IPC
- 整页截图文件名时间戳由 UTC（`toISOString`）改为本地时间
- 清理 `feats/capture.js` 未使用的 `btn` 解构；改动文件 `node --check` 通过

## 2026-10-21 · 工具箱新增「采集」分类：网址二维码 / 整页截图

- **新增分类 `capture`（采集）**：五分类 → 六分类，共 36 项功能（`cats.js` / `core.js` 图标 / `ui.js` 关于页同步）
- **网址二维码**（`feats/capture.js` + 新模块 `toolbox/qr.js`）：当前网址纯本地生成二维码，扫码在手机打开；可下载 PNG / 复制链接。`qr.js` 内嵌 [qrcode-generator@1.4.4](https://github.com/kazuhikoarase/qrcode-generator)（MIT）裁剪版——仅保留 Byte 模式（UTF-8）+ 自动版本 1-40，GIF/SVG/Kanji 等渲染与模式移除，工具箱用 canvas 自绘模块矩阵；jsQR 闭环测试通过（含 v40 容量边界与多字节 URL）
- **整页截图**：滚动逐屏截取 → 按 `devicePixelRatio` 拼接长图 → 自动下载 PNG；截图期间自动隐藏工具箱与页面滚动条，按实际 scrollY 定位每屏避免累积错位，页面高度超 32767px 截断提示，完成后展示预览；约 620ms/屏并带限额退避重试（规避 `captureVisibleTab` 每秒调用限制）
- **扩展桥**（content.js ↔ background.js）：工具箱在页面主世界收不到扩展消息，新增单次请求/响应通道——DOM 事件 `batb:bridge`（MAIN→ISOLATED）→ `chrome.runtime.sendMessage`（`tb:shot` → `captureVisibleTab`）→ `batb:bridge:res` 回传；扩展更新后旧 content.js 无桥时报错并提示刷新页面
- `background.js` TOOLBOX_FILES 注入清单加入 `qr.js` / `feats/capture.js`（现 14 个模块）；README、`docs/toolbox-proto-map.md` 同步（标注两项为扩展版专属，原型未含）

## 2026-10-21 · 工具箱落地 Chrome 扩展（5f04756）

- **新增 `chrome-extension/toolbox/`**：`docs/toolbox/` 原型 12 个模块落成扩展真实实现（core → cats → widgets → ui → picker → helpers → feats/{info,find,style,llm,build} → boot），五分类 34 项功能
- **白名单门控注入**（background.js）：页面命中白名单后经 `chrome.scripting` 注入**页面主世界**（MAIN world）——React fiber 反查、fetch 拦截、`window.__BA_*` 需在页面上下文才可见，且不受页面 CSP 限制
- **门控即时生效**：白名单配置变更后经 DOM 事件 `batb:gate` 同步已注入页面的显隐（移出即隐藏、重新命中自动恢复）；触发点覆盖标签页 complete / SPA 路由变化 / 配置变更 / 扩展重载后的存量页面
- **防重复注入**：各模块自身导出守卫 + `B.register` 按 id 去重（SW 重启重复执行不会出双 FAB、重复功能项、二次包裹 fetch）
- **原型 → 生产的适配**：移除演示页痕迹（接口清单种子数据、`#orders` 默认表格改为首个 `<table>`、演示页专属提示语改通用表述）；修正 store 通道提示（`storage` 动作参数与 content.js 签名对齐，`window.__BA_*` 仅页面主世界可见，跨进程读取以 `storage` 动作为主）
- manifest.json 新增 `scripting` 权限；README 增补「页面工具箱」章节与故障排查；原型地图标注扩展落地版位置

## 2026-10-20 · 工具箱原型模块化（544881d…d836acf）

- **新增 `docs/toolbox/` 设计原型**：零构建多文件模块（12 个 `<script>`，共享命名空间 `window.BATB`，file:// 可直接打开）+ 演示页三件套（`toolbox-proto.html` / `demo.css` / `demo.js`）
- **三层弹窗结构**：FAB → 分类面板 → hover Popover 功能列表 → 侧边详情浮层（dpop 与列表并排错开、ResizeObserver 自适应、Esc 分级返回）
- **交付通道模型确立**：「发给 LLM」拆成复制（剪贴板）与存储（`window.__BA_*` + `localStorage`）两条通道；能跑的脚本归入「开发产物」分类
- 模块地图见 `docs/toolbox-proto-map.md`

## 2026-10-19 · 项目初始化与站点白名单（bb5efff…0cc7acc）

- **init**：broker.py（本地注册/广播/转发中心，唯一常驻进程）+ 油猴脚本接入端（`page-bridge.user.js`）+ `cli_client.py` 编排示例（snapshot → LLM 决策 → POST /call 循环）
- **Chrome 扩展接入端（方案 A，MV3）**：background 维持每标签页 WS、命令路由（DOM 动作 → content.js 17 种动作；截图/标签管理 → SW 直执行）、userScripts 通道绕页面 CSP 执行 eval
- **站点白名单**：纯白名单模式（域名自动覆盖子域名 + 正则规则），popup 一键加入/移出、options 管理页（增删改查/导入导出/正则测试）、配置改动即时生效
- **接入总开关**：popup/options 右上角启用开关，优先级高于一切规则；关闭即断开全部页面且不注册，重开自动恢复
