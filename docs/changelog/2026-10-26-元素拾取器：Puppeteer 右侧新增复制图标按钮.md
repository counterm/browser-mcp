# 2026-10-26 · 元素拾取器：Puppeteer 右侧新增复制图标按钮

- 拾取出结果后，四个写法标签（CSS / XPath / Playwright / Puppeteer）行尾追加一个「复制路径」图标按钮，点击复制**当前选中标签**的路径到剪贴板并 toast 提示「已复制路径」
- 复制内容取自下方代码框的实时文本，切换标签后再复制即为该标签的写法；复制按钮不带激活态，不影响标签选中逻辑
- `chrome-extension/toolbox/feats/find.js` 与原型 `docs/toolbox/feats/find.js` 同步；两文件 `node --check` 通过
