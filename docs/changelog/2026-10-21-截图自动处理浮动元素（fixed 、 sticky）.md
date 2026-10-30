# 2026-10-21 · 截图自动处理浮动元素（fixed / sticky）

- **fixed 元素临时隐藏、sticky 元素临时取消吸附**（转 `static`，只在原位出现一次），整页截图与容器截图共用——`markFloating(scroller)` 扫描 `body *` 按 computed position 打标（`data-ba-fx` / `data-ba-stk`）+ 页面级 CSS 生效，`finally` 里 `unmarkFloating()` 还原属性与样式；结果信息展示处理数量
- 容器截图跳过滚动容器自身与其祖先（避免把目标藏掉）；容器**内部**的 sticky 照常取消吸附（吸顶表头不再每屏重复）；标记在测量矩形之前完成，保证裁剪坐标不受布局微移影响
- fixed 为脱离文档流隐藏不影响布局；sticky 占据常规流位置，转 static 不改变高度——两种处理均不引入页面跳动；dlog 记录 `floating fixed=N sticky=M`
- README 采集段、proto-map `fullshot`/`elshot` 行同步
