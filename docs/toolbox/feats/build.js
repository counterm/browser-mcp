/* 工具箱 · feats/build —— 「开发产物」分类：能跑起来的脚本 / 指令（Playwright / 油猴 / 爬虫 / 录制步骤）。 */
(function(B){
var el = B.u.el, esc = B.u.esc;
var note = B.w.note, codeBox = B.w.codeBox, scoreBadge = B.w.scoreBadge;
var bestSelector = B.sel.bestSelector, xpathOf = B.sel.xpathOf, scoreSelector = B.sel.scoreSelector;
var ensurePicked = B.ensurePicked;

B.register([
{ id:'pwcode', cat:'build', name:'生成 Playwright 代码', icon:'filecode', star:3, desc:'直接产出可运行定位 / 操作片段',
  run:function(b){
    ensurePicked().then(function(e){
      if(!e) return;
      var sel = bestSelector(e), xp = xpathOf(e);
      var code =
'// Playwright\n' +
"const btn = page.locator('" + sel + "');\nawait btn.click();\n\n" +
'// 或按角色定位（更稳）\n' +
"await page.getByRole('button', { name: '" + (e.textContent || '').trim().slice(0, 20) + "' }).click();\n\n" +
'// Puppeteer\n' +
"const el = await page.waitForSelector('" + sel + "');\nawait el.click();\n\n" +
'// XPath 兜底\n' +
"page.locator('xpath=" + xp + "')";
      b.appendChild(codeBox(code));
      b.appendChild(el('div', null, '稳定性：' + scoreBadge(scoreSelector(sel))));
    });
  }},
{ id:'userscript', cat:'build', name:'生成油猴脚本骨架', icon:'filecode', star:3, desc:'@match 填当前域名 + 稳定 selector',
  run:function(b){
    ensurePicked().then(function(e){
      if(!e) return;
      var host2 = location.hostname || 'example.com';
      var code =
'// ==UserScript==\n' +
'// @name         工具箱助手 · ' + host2 + '\n' +
'// @match        https://' + host2 + '/*\n' +
'// @grant        none\n' +
'// ==/UserScript==\n' +
"(function () {\n  'use strict';\n  const SEL = '" + bestSelector(e) + "';\n" +
'  // 1. 等元素出现\n' +
"  const el = document.querySelector(SEL);\n  if (!el) return;\n" +
'  // 2. 你的逻辑\n})();';
      b.appendChild(codeBox(code));
    });
  }},
{ id:'crawler', cat:'build', name:'爬虫代码生成', icon:'code', star:2, desc:'表格 / 列表 → Python 提取脚本',
  run:function(b){
    var tb = document.getElementById('orders');
    var sel = tb ? bestSelector(tb) : 'table';
    var code =
'import requests\nfrom bs4 import BeautifulSoup\n\n' +
'URL = "' + (location.origin + location.pathname) + '"\n' +
'html = requests.get(URL, timeout=10, headers={"User-Agent": "..."}).text\n' +
'soup = BeautifulSoup(html, "html.parser")\n\n' +
'rows = []\n' +
"for tr in soup.select('" + sel + " tbody tr'):\n" +
"    cells = [td.get_text(strip=True) for td in tr.find_all('td')]\n" +
'    if cells:\n        rows.append(cells)\n\n' +
'print(rows)  # 或 csv.writer 落盘';
    b.appendChild(codeBox(code));
    b.appendChild(note('选择器由页面表格自动推导；接入真实站点后可按「Selector 评分」结果替换。'));
  }},
{ id:'record', cat:'build', name:'操作录制 → 步骤', icon:'clock', star:2, desc:'记录点击序列，导出可重放步骤', mock:true,
  run:function(b){
    b.appendChild(el('div', 'd', '录制 3 步后的导出效果：'));
    b.appendChild(codeBox(
'第一步：点击「导出订单」按钮（[data-reactroot] .hero .btn.pri）\n' +
'第二步：在「客户姓名」输入框填写「张伟」\n' +
'第三步：点击「打开弹窗」按钮，等待弹窗出现\n\n' +
'// 可导出为 cli_client.py 的重放脚本'));
    b.appendChild(note('录制依赖 content script 事件钩子，原型中以演示数据展示交互形态。'));
  }}
]);
})(window.BATB);
