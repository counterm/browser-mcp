/* 工具箱 · feats/find —— 「查找」分类：拾取器 / 评分 / 文本搜索 / 事件反查 / 组件名 / 表格提取 + 3 项高级。 */
(function(B){
var $$ = B.u.$$, el = B.u.el, esc = B.u.esc, copyText = B.u.copyText;
var note = B.w.note, btn = B.w.btn, kv = B.w.kv, badge = B.w.badge, scoreBadge = B.w.scoreBadge, codeBox = B.w.codeBox, toast = B.w.toast;
var bestSelector = B.sel.bestSelector, xpathOf = B.sel.xpathOf, scoreSelector = B.sel.scoreSelector;
var pick = B.pick, ensurePicked = B.ensurePicked;
var host = B.host, state = B.state, flashEl = B.flashEl;

B.register([
{ id:'picker', cat:'find', name:'元素拾取器', icon:'crosshair', star:3, desc:'hover 高亮 + 点击锁定，输出 4 种写法',
  run:function(b){
    b.appendChild(el('div', 'note', '点击下方按钮进入拾取模式：移动高亮、点击锁定、Esc 取消。'));
    b.appendChild(btn('开始拾取', function(){
      pick().then(function(e){
        if(!e) return;
        state.picked = e;
        var sel = bestSelector(e);
        var tabs = el('div', 'tabs');
        var names = ['CSS', 'XPath', 'Playwright', 'Puppeteer'], codes = [
          sel,
          'xpath=' + xpathOf(e),
          "page.locator('" + sel + "')",
          "await page.waitForSelector('" + sel + "')"
        ];
        var pre = el('pre'); pre.textContent = codes[0];
        names.forEach(function(n, i){
          var t = el('button', i === 0 ? 'on' : '', n);
          t.onclick = function(){ $$('button', tabs).forEach(function(x){ x.classList.remove('on'); }); t.classList.add('on'); pre.textContent = codes[i]; };
          tabs.appendChild(t);
        });
        var box = el('div');
        box.appendChild(el('div', 'd', '已锁定：<b>' + esc(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')) + '</b> ' + scoreBadge(scoreSelector(sel))));
        box.appendChild(tabs); box.appendChild(pre);
        b.appendChild(box);
      });
    }, 'pri'));
  }},
{ id:'selrank', cat:'find', name:'Selector 稳定性评分', icon:'target', star:3, desc:'给生成的 selector 打分并标色',
  run:function(b){
    ensurePicked().then(function(e){
      if(!e) return;
      var sel = bestSelector(e), s = scoreSelector(sel);
      b.appendChild(el('div', 'd', '<b>' + esc(sel) + '</b>'));
      b.appendChild(el('div', null, scoreBadge(s)));
      b.appendChild(codeBox(sel + '\n\n// 评分 ' + s.score + '：' + s.why));
      b.appendChild(note('90+ 放心写进自动化；50 左右建议补 data-testid；15 以下改版必炸。'));
    });
  }},
{ id:'textsearch', cat:'find', name:'按文本 / 属性搜索', icon:'search', star:3, desc:'全页搜索文本，列出命中元素并可跳转',
  run:function(b){
    var f = el('div', 'fld');
    var inp = el('input'); inp.placeholder = '输入要搜索的文本，如「订单」';
    var go = el('button', 'btn2', '搜索');
    f.appendChild(inp); f.appendChild(go); b.appendChild(f);
    var d = el('div', 'lst'); b.appendChild(d);
    function run(){
      var q = inp.value.trim(); d.innerHTML = '';
      if(!q) return;
      var hits = $$('body *').filter(function(e){
        return e.children.length === 0 && (e.textContent || '').indexOf(q) > -1 && !host.contains(e) && e.offsetParent !== null;
      }).slice(0, 40);
      hits.forEach(function(e){
        var li = el('div', 'li', '<span class="u">' + esc((e.textContent || '').trim().slice(0, 50)) + '</span><span class="c" style="color:#475569">' + esc(e.tagName.toLowerCase()) + '</span>');
        li.style.cursor = 'pointer';
        li.onclick = function(){ e.scrollIntoView({ behavior:'smooth', block:'center' }); flashEl(e); };
        d.appendChild(li);
      });
      if(!hits.length) d.appendChild(el('div', 'note', '无命中。'));
    }
    go.onclick = run;
    inp.onkeydown = function(ev){ if(ev.key === 'Enter') run(); };
  }},
{ id:'eventlook', cat:'find', name:'事件反查', icon:'code', star:3, desc:'这个按钮绑定了什么 handler',
  run:function(b){
    ensurePicked().then(function(e){
      if(!e) return;
      var pk = Object.keys(e).filter(function(k){ return k.indexOf('__reactProps$') === 0; })[0];
      var fk = Object.keys(e).filter(function(k){ return k.indexOf('__reactFiber$') === 0; })[0];
      if(pk && e[pk].onClick){
        b.appendChild(el('div', 'd', '找到 React props 上的 <b>onClick</b>：'));
        b.appendChild(codeBox(e[pk].onClick.toString()));
        b.appendChild(note('把 handler 源码整段喂给 LLM，比截图描述强十倍。'));
      } else {
        b.appendChild(el('div', 'd', '该元素上未找到框架事件后门' + (fk ? '' : '（无 __reactProps$ / __vue__ / jQuery 事件）') + '。'));
        b.appendChild(note('原型页的「导出订单」按钮挂了演示用的 __reactProps$abc123.onClick，可拾取它查看真实代码路径。'));
      }
    });
  }},
{ id:'compname', cat:'find', name:'组件名定位', icon:'layers', star:3, desc:'从 React fiber / Vue 实例拿组件名',
  run:function(b){
    ensurePicked().then(function(e){
      if(!e) return;
      var fk = Object.keys(e).filter(function(k){ return k.indexOf('__reactFiber$') === 0; })[0];
      var vk = Object.keys(e).filter(function(k){ return k === '__vueParentComponent'; })[0];
      if(fk && e[fk] && e[fk].type){
        b.appendChild(kv([['组件名', badge(e[fk].type.displayName || e[fk].type.name || String(e[fk].type), 'g')], ['节点', esc(bestSelector(e))]]));
        b.appendChild(note('原型页「导出订单」按钮挂了演示 fiber，组件名 ExportButton。'));
      } else if(vk){
        b.appendChild(kv([['组件名', badge(e[vk].type.name || e[vk].type.__name || 'Vue 组件', 'g')]]));
      } else {
        b.appendChild(el('div', 'note', '未检出 React fiber / Vue 实例。'));
      }
    });
  }},
{ id:'tablex', cat:'find', name:'表格提取', icon:'table', star:2, desc:'选中表格 → JSON / CSV',
  run:function(b){
    function extract(tb){
      var head = $$('th', tb).map(function(x){ return x.textContent.trim(); });
      var rows = $$('tr', tb).map(function(tr){
        return $$('td', tr).map(function(td){ return td.textContent.trim(); });
      }).filter(function(r){ return r.length; });
      return { head: head, rows: rows };
    }
    function show(tb){
      var r = extract(tb), data = r.rows.map(function(row){ var o = {}; r.head.forEach(function(h, i){ o[h || ('col' + i)] = row[i]; }); return o; });
      var tabs = el('div', 'tabs');
      var pre = el('pre');
      var json = JSON.stringify(data.slice(0, 3), null, 2) + (data.length > 3 ? '\n// …共 ' + data.length + ' 行' : '');
      var csv = [r.head.join(',')].concat(r.rows.map(function(x){ return x.join(','); })).join('\n');
      var views = [['JSON', json], ['CSV', csv]];
      views.forEach(function(v, i){
        var t = el('button', i === 0 ? 'on' : '', v[0]);
        t.onclick = function(){ $$('button', tabs).forEach(function(x){ x.classList.remove('on'); }); t.classList.add('on'); pre.textContent = v[1]; };
        tabs.appendChild(t);
      });
      pre.textContent = json;
      var box = el('div');
      box.appendChild(el('div', 'd', '共提取 <b>' + r.rows.length + '</b> 行 × <b>' + r.head.length + '</b> 列'));
      box.appendChild(tabs); box.appendChild(pre);
      var cp = btn('复制 ' + (r.head.length ? 'CSV' : 'JSON'), function(){ copyText(csv).then(function(){ toast('已复制 CSV'); }); });
      box.appendChild(el('div', 'row2')).appendChild(cp);
      b.appendChild(box);
    }
    var tb = document.getElementById('orders');
    if(tb) show(tb);
    b.appendChild(btn('拾取其他表格', function(){
      pick().then(function(e){
        if(!e) return;
        var t = e.tagName === 'TABLE' ? e : e.closest('table');
        if(t){ b.innerHTML = ''; b.appendChild(el('div', 'note', '表格：' + esc(bestSelector(t)))); show(t); }
        else toast('拾取的不是表格');
      });
    }));
  }},
/* ===== 查找 · 高级 ===== */
{ id:'globalsearch', cat:'find', name:'全局数据搜索', icon:'key', star:2, desc:'在 window 对象里搜关键词，找 state 藏在哪', adv:true,
  run:function(b){
    var f = el('div', 'fld');
    var inp = el('input'); inp.placeholder = '输入关键词，如 user / store / token';
    var go = el('button', 'btn2', '搜索');
    f.appendChild(inp); f.appendChild(go); b.appendChild(f);
    var d = el('div', 'lst'); b.appendChild(d);
    function run(){
      var q = inp.value.trim().toLowerCase(); d.innerHTML = '';
      if(!q) return;
      var hits = Object.keys(window).filter(function(k){ return k.toLowerCase().indexOf(q) > -1; }).slice(0, 50);
      hits.forEach(function(k){
        var v; try{ v = String(window[k]).slice(0, 60); }catch(e){ v = '(不可读)'; }
        d.appendChild(el('div', 'li', '<span class="m">' + esc(k) + '</span><span class="u">' + esc(v) + '</span>'));
      });
      if(!hits.length) d.appendChild(el('div', 'note', 'window 上一级无命中（深层属性需在 Console 里递归）。'));
    }
    go.onclick = run; inp.onkeydown = function(ev){ if(ev.key === 'Enter') run(); };
  }},
{ id:'shadowdom', cat:'find', name:'Shadow DOM 穿透', icon:'shadow', star:2, desc:'常规选择器进不去的区域', adv:true,
  run:function(b){
    b.appendChild(el('div', 'd', '封闭 Shadow Root 无法枚举，可用两条路：'));
    b.appendChild(codeBox(
'// 1. 递归向下（open root 可进）\n' +
'function deepQuery(root, sel){\n' +
'  let out = [...root.querySelectorAll(sel)];\n' +
'  root.querySelectorAll("*").forEach(e => {\n' +
'    if (e.shadowRoot) out.push(...deepQuery(e.shadowRoot, sel));\n' +
'  });\n' +
'  return out;\n' +
'}\n' +
'deepQuery(document, "button");\n\n' +
'// 2. CDP / userScripts 通道由扩展侧提供（见 README「eval 与 CSP」）'));
    b.appendChild(note('本原型页未挂 shadow root，故无真实命中；此项在扩展版随 eval 通道落地。'));
  }},
{ id:'zindex', cat:'find', name:'层叠与遮挡分析', icon:'layers', star:1, desc:'谁盖住了谁、z-index 全览', adv:true,
  run:function(b){
    var list = $$('body *').filter(function(e){
      return !host.contains(e) && getComputedStyle(e).position !== 'static';
    }).map(function(e){ return { e:e, z:parseInt(getComputedStyle(e).zIndex, 10) || 0, p:getComputedStyle(e).position }; })
     .sort(function(a, b2){ return b2.z - a.z; }).slice(0, 10);
    var d = el('div', 'lst');
    list.forEach(function(x){
      d.appendChild(el('div', 'li', '<span class="m">z' + x.z + '</span><span class="u">' + esc(x.p + ' · ' + bestSelector(x.e).slice(0, 50)) + '</span>'));
    });
    b.appendChild(d);
    b.appendChild(note('原型工具箱自身 z-index 为 2147483646，永远在最上层。'));
  }}
]);
})(window.BATB);
