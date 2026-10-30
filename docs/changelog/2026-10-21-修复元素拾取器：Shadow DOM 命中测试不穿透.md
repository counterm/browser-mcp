# 2026-10-21 · 修复元素拾取器：Shadow DOM 命中测试不穿透

- **修复 `pick()` 对页面元素完全失效**（隐藏元素 / 元素描边 / 查找 / 容器截图等所有拾取功能）：拾取遮罩挂在工具箱 Shadow DOM 内，`document.elementFromPoint` 不穿透 Shadow——遮罩盖屏后任何位置命中的都是宿主 `#ba-toolbox-host`，恰被 `t === host` 判为工具箱自身丢弃，导致永远无高亮、点击无响应（只能 Esc 退出）
- 改用 `document.elementsFromPoint` 取整叠命中元素，跳过宿主后取其下的真实页面元素；原型 `docs/toolbox/picker.js` 同步
