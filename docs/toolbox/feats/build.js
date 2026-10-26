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
{ id:'crawler', cat:'build', name:'爬虫代码生成', icon:'code', star:2, desc:'表格 / 列表 → Python 提取脚本（自动识别 SPA）',
  run:function(b){
    var tb = document.getElementById('orders');
    var sel = tb ? bestSelector(tb) : 'table';
    var url = location.origin + location.pathname;
    var code =
'import requests\nfrom bs4 import BeautifulSoup\n\n' +
'URL = "' + url + '"\n' +
'html = requests.get(URL, timeout=10, headers={"User-Agent": "..."}).text\n' +
'soup = BeautifulSoup(html, "html.parser")\n\n' +
'rows = []\n' +
"for tr in soup.select('" + sel + " tbody tr'):\n" +
"    cells = [td.get_text(strip=True) for td in tr.find_all('td')]\n" +
'    if cells:\n        rows.append(cells)\n\n' +
'print(rows)  # 或 csv.writer 落盘';
    b.appendChild(codeBox(code));

    var stack = (B.detectStack && B.detectStack()) || {};
    var fw = Object.keys(stack).filter(function(k){ return stack[k] && /React|Vue|Angular|Svelte|Next|Nuxt/.test(k); });
    if(fw.length){
      var pw =
'from playwright.sync_api import sync_playwright\n\n' +
'URL = "' + url + '"\n' +
'rows = []\n' +
'with sync_playwright() as p:\n' +
'    b = p.chromium.launch(headless=True)\n' +
'    pg = b.new_page()\n' +
'    pg.goto(URL, wait_until="networkidle")\n' +
"    for tr in pg.query_selector_all('" + sel + " tbody tr'):\n" +
'        cells = [c.inner_text() for c in tr.query_selector_all("td")]\n' +
'        if cells: rows.append(cells)\n' +
'    b.close()\n' +
'print(rows)';
      b.appendChild(el('div', 'grp-h', '客户端渲染（' + fw.join('/') + '）· 推荐 Playwright'));
      b.appendChild(codeBox(pw));
      b.appendChild(note('检测到 ' + fw.join('/') + '：页面为客户端渲染，requests 拉到的 HTML 是空壳、抓不到表格数据。上面这份 Playwright 脚本会真正执行 JS 后再读 DOM，才能取到渲染后的内容。'));
    } else {
      b.appendChild(note('选择器由页面表格自动推导；接入真实站点后可按「Selector 评分」结果替换。'));
    }
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
  }},
{ id:'formkit', cat:'build', name:'表单保存与填充', icon:'save', star:3, desc:'按站点保存/回填表单值；随机假数据一键填充',
  run:function(b){
    /* ---------- 存储：localStorage['ba:formkit'] = { [host]: {ts, fields:[{s,l,t,v}]} } ---------- */
    var HOST = location.hostname || ('file:' + (location.pathname || '/'));
    function load(){ try{ return JSON.parse(localStorage.getItem('ba:formkit') || '{}'); }catch(e){ return {}; } }
    function store(all){ try{ localStorage.setItem('ba:formkit', JSON.stringify(all)); }catch(e){} }
    function kind(e){
      if(e.tagName === 'SELECT') return 'select';
      if(e.tagName === 'TEXTAREA') return 'textarea';
      return (e.type || 'text').toLowerCase();
    }
    function fields(){
      return $$('input,select,textarea').filter(function(e){
        if(/^(hidden|submit|button|reset|image|file|checkbox|radio)$/.test((e.type || '').toLowerCase())) return false;
        if(e.disabled || e.readOnly) return false;
        return e.getClientRects().length > 0;
      });
    }
    function label(e){
      var lg = e.labels && e.labels[0];
      return (lg && lg.textContent.trim()) || e.placeholder || e.getAttribute('aria-label') || e.name || e.id ||
        (e.tagName === 'SELECT' ? '下拉框' : kind(e));
    }
    /* 原生 setter + input/change，兼容 React/Vue 受控组件 */
    function setVal(e, v){
      var proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
        : e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      var d = Object.getOwnPropertyDescriptor(proto, 'value');
      try{ if(d && d.set) d.set.call(e, v); else e.value = v; }catch(x){ e.value = v; }
      try{
        e.dispatchEvent(new Event('input', { bubbles:true }));
        e.dispatchEvent(new Event('change', { bubbles:true }));
      }catch(x){}
    }

    /* ---------- 随机假数据 ---------- */
    function pick(a){ return a[Math.floor(Math.random() * a.length)]; }
    function str(n){ var s = '', p = 'abcdefghjkmnpqrstuvwxyz'; for(var i = 0; i < n; i++) s += p[Math.floor(Math.random() * p.length)]; return s; }
    function dig(n){ var s = ''; for(var i = 0; i < n; i++) s += Math.floor(Math.random() * 10); return s; }
    var PROV = ['北京市','上海市','广东省','浙江省','江苏省','四川省','湖北省','山东省','福建省','湖南省'];
    var CITY = ['杭州市','宁波市','苏州市','南京市','成都市','武汉市','青岛市','厦门市','广州市','长沙市'];
    var DIST = ['西湖区','滨江区','南山区','高新区','鼓楼区','江汉区','越秀区','天河区','静安区','浦东新区'];
    function cname(){ return pick('赵钱孙李周吴郑王冯陈蒋沈韩杨朱秦许何吕张孔曹严华金魏陶姜'.split('')) +
      pick(['伟','芳','娜','敏','静','磊','军','洋','勇','艳','杰','涛','明','超','霞','平','雪','彤','轩','然','涵','萱','俊','欣','怡','远','东','华']); }
    function region(k){ return k === 'p' ? pick(PROV) : k === 'c' ? pick(CITY) : k === 'd' ? pick(DIST) : pick(PROV) + pick(CITY) + pick(DIST); }
    /* 按 name / id / placeholder / label / autocomplete 猜字段语义 */
    function guess(e){
      var t = (e.type || '').toLowerCase(), ml = e.maxLength > 0 ? e.maxLength : 100;
      var key = ((e.name || '') + ' ' + (e.id || '') + ' ' + (e.placeholder || '') + ' ' + label(e) + ' ' +
        (e.getAttribute('autocomplete') || '')).toLowerCase();
      function cut(s){ return s.length > ml ? s.slice(0, ml) : s; }
      if(t === 'email' || /e-?mail|邮箱/.test(key)) return cut(str(6) + dig(3) + '@example.com');
      if(t === 'tel' || /phone|mobile|tel|手机|电话|号码|联系/.test(key)) return cut(pick(['13','15','17','18','19']) + dig(9));
      if(/邮编|zip|postal/.test(key)) return cut(dig(6));
      if(/验证码|captcha|短信/.test(key)) return cut(dig(6));
      if(/身份证|sfz|idcard/.test(key)) return cut(dig(17) + pick(['0','1','2','3','4','5','6','7','8','9','X']));
      if(t === 'password') return cut(str(6) + dig(3) + 'A1');
      if(/user|账号|帐号|昵称|nick/.test(key)) return cut(str(8));
      if(/姓名|名字|称呼|name/.test(key)) return cut(cname());
      if(/地址|address|addr|省.*市|所在地|地区/.test(key)) return cut(region());
      if(/省|province/.test(key)) return cut(region('p'));
      if(/市|city/.test(key)) return cut(region('c'));
      if(/区|region|区域/.test(key)) return cut(region('d'));
      if(t === 'url' || /url|网址|网站|site|主页|博客|blog|链接|link/.test(key)) return cut('https://' + str(7) + '.com');
      if(/(^|\W)qq(\W|$)/.test(key)) return cut(dig(9));
      if(/微信|wechat|wx|vx/.test(key)) return cut(str(5) + dig(4));
      if(t === 'date' || /日期|birthday|出生/.test(key)) return cut('19' + dig(2) + '-' + ('0' + (1 + Math.floor(Math.random() * 12))).slice(-2) + '-' + ('0' + (1 + Math.floor(Math.random() * 28))).slice(-2));
      if(t === 'number' || /年龄|age|数量|qty|quantity/.test(key)) return cut(dig(2));
      return cut(str(8)); /* 其余随便填字母 */
    }
    function randOption(e){
      var opts = $$('option', e).filter(function(o){
        var s = (o.value || '').trim() + ' ' + o.textContent.trim();
        return s.trim() && !/请选择|全部|不限|select/i.test(s);
      });
      if(!opts.length) return false;
      var o = pick(opts);
      setVal(e, o.value || o.textContent.trim());
      return true;
    }

    /* ---------- 渲染 ---------- */
    var out = el('div');
    var status = el('div', 'note');
    function showRows(title, rows){
      out.innerHTML = '';
      out.appendChild(el('div', 'grp-h', esc(title)));
      var d = el('div', 'lst');
      rows.forEach(function(r){
        d.appendChild(el('div', 'li',
          '<span class="m">' + esc(r[0]) + '</span>' +
          '<span class="u" title="' + esc(r[1]) + '">' + esc(r[1]) + '</span>' +
          '<span class="c" style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(r[2]) + '">' + esc(r[2]) + '</span>'));
      });
      out.appendChild(d);
    }
    function refresh(){
      var rec = load()[HOST];
      var n = rec && rec.fields ? rec.fields.length : 0;
      status.innerHTML = n
        ? '当前站点已保存 <b style="color:#cbd5e1">' + n + '</b> 个字段 · ' + new Date(rec.ts).toLocaleTimeString()
        : '当前站点还没有保存的表单：先在页面上手填一遍 → 「保存表单」，下次即可一键回填。';
    }
    function undoable(prev){
      B.ui.pushUndo({ restore:function(){ prev.forEach(function(p){ try{ setVal(p[0], p[1]); }catch(x){} }); } });
    }

    var row = el('div', 'row2');
    row.appendChild(btn('保存表单', function(){
      var rows = [], pwd = 0;
      fields().forEach(function(e){
        if(e.tagName === 'INPUT' && e.type === 'password'){ if(e.value) pwd++; return; } /* 密码不入库 */
        var v = e.tagName === 'SELECT' ? (e.value || (e.selectedOptions && e.selectedOptions[0] ? e.selectedOptions[0].textContent.trim() : '')) : e.value;
        if(!v) return;
        var s = ''; try{ s = bestSelector(e); }catch(x){}
        rows.push({ s:s, l:label(e), t:kind(e), v:v });
      });
      if(!rows.length){ toast('没有已填写的字段可保存'); return; }
      var all = load();
      all[HOST] = { ts: Date.now(), fields: rows };
      store(all);
      showRows('已保存 ' + rows.length + ' 个字段', rows.map(function(r){ return [r.t, r.l, r.v]; }));
      refresh();
      toast('已保存 ' + rows.length + ' 个字段' + (pwd ? '（密码字段出于安全已跳过）' : ''));
    }));
    row.appendChild(btn('填充已保存', function(){
      var rec = load()[HOST];
      if(!rec || !rec.fields || !rec.fields.length){ toast('当前站点还没有保存的表单，先「保存表单」'); return; }
      var cur = fields(), prev = [], rows = [], miss = 0;
      rec.fields.forEach(function(f, i){
        var e = null;
        if(f.s){ try{ var m = document.querySelector(f.s); if(m && kind(m) === f.t && cur.indexOf(m) > -1) e = m; }catch(x){} }
        if(!e && cur[i] && kind(cur[i]) === f.t) e = cur[i]; /* 结构变化时按顺序兜底 */
        if(!e){ miss++; return; }
        if(e.tagName === 'SELECT'){
          var hit = $$('option', e).filter(function(o){ return o.value === f.v || o.textContent.trim() === f.v; })[0];
          if(!hit){ miss++; return; }
        }
        prev.push([e, e.value]);
        setVal(e, e.tagName === 'SELECT' ? hit.value : f.v);
        rows.push([kind(e), label(e), e.value]);
      });
      if(!rows.length){ toast('没找到匹配的表单字段（页面结构可能变了）'); return; }
      undoable(prev);
      showRows('已回填 ' + rows.length + ' 个字段' + (miss ? ' · ' + miss + ' 个未匹配' : ''), rows);
      toast('已回填 ' + rows.length + ' 个字段');
    }));
    row.appendChild(btn('随机填充', function(){
      var fs = fields(), prev = [], rows = [];
      fs.forEach(function(e){
        var old = e.value, ok;
        if(e.tagName === 'SELECT') ok = randOption(e);
        else { var v = guess(e); ok = !!v; if(ok) setVal(e, v); }
        if(!ok) return;
        prev.push([e, old]);
        rows.push([kind(e), label(e), e.value]);
      });
      if(!rows.length){ toast('没有可填充的表单字段'); return; }
      undoable(prev);
      showRows('随机填充 ' + rows.length + ' 个字段', rows);
      toast('已随机填充 ' + rows.length + ' 个字段，误填可撤销');
    }, 'pri'));
    row.appendChild(btn('清除', function(){
      var all = load(); delete all[HOST]; store(all);
      refresh(); toast('已清除当前站点保存的表单');
    }, 'warn'));
    b.appendChild(row);
    b.appendChild(status);
    b.appendChild(out);
    refresh();
    b.appendChild(note('随机填充按 name / placeholder / label / autocomplete 猜语义：邮箱 / 手机号 / 邮编 / 验证码 / 身份证给格式化假数据，姓名给中文随机名，省市地址给地区名，下拉框随机选非占位项，其余填随机字母；尊重 maxlength。保存按站点存于 localStorage["ba:formkit"]，密码字段跳过。填充走原生 setter + input/change 事件（兼容 React / Vue），误填可从撤销条恢复。'));
  }}
]);
})(window.BATB);
