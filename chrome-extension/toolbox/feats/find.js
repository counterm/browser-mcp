/* 工具箱 · feats/find —— 「查找」分类：拾取器（含事件 handler）/ 组件名 / 表格提取 + 3 项高级。 */
(function(B){
if(!B) return;
var $$ = B.u.$$, el = B.u.el, esc = B.u.esc, copyText = B.u.copyText;
var note = B.w.note, btn = B.w.btn, kv = B.w.kv, badge = B.w.badge, scoreBadge = B.w.scoreBadge, codeBox = B.w.codeBox, toast = B.w.toast;
var bestSelector = B.sel.bestSelector, xpathOf = B.sel.xpathOf, scoreSelector = B.sel.scoreSelector;
var pick = B.pick, ensurePicked = B.ensurePicked;
var host = B.host, state = B.state;

/* Vue 事件反查：从组件实例的 vnode.props 取 onXxx 事件 handler + setupState 方法名 */
function vueInfo(e){
  var inst = e && e.__vueParentComponent;
  if(!inst) return null;
  var name = (inst.type && (inst.type.name || inst.type.__name)) || 'Anonymous';
  var props = (inst.vnode && inst.vnode.props) || {};
  var handlers = [], methods = [];
  Object.keys(props).forEach(function(k){
    if(/^on[A-Z]/.test(k) && typeof props[k] === 'function') handlers.push([k, props[k]]);
  });
  var ss = inst.setupState || {};
  Object.keys(ss).forEach(function(k){ if(typeof ss[k] === 'function') methods.push(k); });
  return { name: name, handlers: handlers, methods: methods };
}
/* 拾取结果附带事件 handler：React props / Vue 组件实例上的 onXxx。
   从拾取节点向上逐级找——点进按钮里的 span / svg / 图标时，handler 通常挂在祖先宿主节点上。 */
function reactHandler(start){
  var cur = start, depth = 0;
  while(cur && cur.nodeType === 1 && depth < 10){
    var pk = Object.keys(cur).filter(function(k){ return k.indexOf('__reactProps$') === 0; })[0];
    if(pk && cur[pk]){
      var lines = Object.keys(cur[pk]).filter(function(k){ return /^on[A-Z]/.test(k) && typeof cur[pk][k] === 'function'; })
        .map(function(k){ return '// React ' + k + '\n' + cur[pk][k].toString(); });
      if(lines.length) return { code: lines.join('\n\n'), node: cur };
    }
    var root = cur.getRootNode && cur.getRootNode();
    cur = cur.parentElement || (root && root.host) || null; /* 穿透 Shadow DOM 宿主继续向上 */
    depth++;
  }
  return null;
}
function vueHandler(start){
  var cur = start, depth = 0;
  while(cur && cur.nodeType === 1 && depth < 10){
    var vi = vueInfo(cur);
    if(vi && vi.handlers.length){
      return { code: vi.handlers.map(function(h){ return '// Vue ' + vi.name + ' · ' + h[0] + '\n' + h[1].toString(); }).join('\n\n'), node: cur };
    }
    var root = cur.getRootNode && cur.getRootNode();
    cur = cur.parentElement || (root && root.host) || null;
    depth++;
  }
  return null;
}
function handlerOf(e){
  var r = reactHandler(e) || vueHandler(e);
  if(r) return r;
  if(typeof e.onclick === 'function') return { code: '// 原生 onclick\n' + e.onclick.toString(), node: e };
  return null;
}
/* 生产构建下 Vue 不暴露 __vueParentComponent，用 scoped data-v- / 库类名兜底识别 */
function hasVueMark(e){
  var n = e;
  while(n && n.nodeType === 1){
    if(n.attributes){
      for(var i = 0; i < n.attributes.length; i++){ if(n.attributes[i].name.indexOf('data-v-') === 0) return true; }
    }
    if(n.matches && n.matches('[class*="el-"]')) return true;
    n = n.parentElement;
  }
  return false;
}

B.register([
/* 查找分类：元素拾取器（含路径 + 事件 handler）/ 组件名 / 表格提取 + 3 项高级 */
{ id:'picker', cat:'find', name:'元素拾取器', icon:'crosshair', star:3, desc:'hover 高亮 + 点击锁定，输出 4 种写法 + 事件 handler',
  run:function(b){
    b.appendChild(el('div', 'note', '点击下方条目即进入拾取模式：工具箱自动收起，移动高亮、点击锁定后结果回到这里；Esc 取消。'));
    var out = el('div'); /* 结果区：每次拾取先清空上一次结果，只保留当前这次 */
    function start(){
      out.textContent = '';
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
        /* Puppeteer 右侧：复制当前标签页的路径 */
        var cp = el('button', '', B.I('copy', 11));
        cp.title = '复制当前路径';
        cp.style.cssText = 'display:inline-flex;align-items:center;padding:3px 7px';
        cp.onclick = function(){ copyText(pre.textContent).then(function(){ toast('已复制路径'); }); };
        tabs.appendChild(cp);
        var box = el('div');
        box.appendChild(el('div', 'd', '已锁定：<b>' + esc(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')) + '</b> ' + scoreBadge(scoreSelector(sel))));
        box.appendChild(tabs); box.appendChild(pre);
        out.appendChild(box);
        /* 事件反查合并进拾取结果：React props / Vue 实例上的 onXxx handler */
        var h = handlerOf(e), evBox = el('div');
        evBox.style.marginTop = '8px';
        evBox.appendChild(el('div', 'd', '事件处理' + (h && h.node !== e
          ? '（在祖先 <b>' + esc(h.node.tagName.toLowerCase() + (h.node.id ? '#' + h.node.id : '')) + '</b> 上）'
          : '')));
        evBox.appendChild(h ? codeBox(h.code) : note(e.tagName === 'IFRAME'
          ? '拾取到的是 iframe：React 应用运行在子框架内，工具箱只注入顶层页面。请在预览工具栏用「在新窗口打开预览」后，到那个页面使用工具箱。'
          : '该元素及其祖先均未挂 React / Vue 事件 handler。React 请拾取按钮节点本身；若事件由 addEventListener 绑定，则无法从 DOM 上直接读出源码。'));
        out.appendChild(evBox);
      });
    }
    b.appendChild(btn('重新拾取', start, 'pri'));
    b.appendChild(out);
    start(); /* 点击二级条目直接进入拾取，不必再点一次按钮 */
  }},
{ id:'compname', cat:'find', name:'组件名定位', icon:'layers', star:3, desc:'从 React fiber / Vue 实例拿组件名',
  run:function(b){
    ensurePicked().then(function(e){
      if(!e) return;
      var fk = Object.keys(e).filter(function(k){ return k.indexOf('__reactFiber$') === 0; })[0];
      var vk = Object.keys(e).filter(function(k){ return k === '__vueParentComponent'; })[0];
      if(fk && e[fk] && e[fk].type){
        b.appendChild(kv([['组件名', badge(e[fk].type.displayName || e[fk].type.name || String(e[fk].type), 'g')], ['节点', esc(bestSelector(e))]]));
      } else if(vk){
        b.appendChild(kv([['组件名', badge(e[vk].type.name || e[vk].type.__name || 'Vue 组件', 'g')]]));
      } else if(hasVueMark(e)){
        b.appendChild(el('div', 'note', '检测到 Vue 作用域标记（data-v- / el-），但生产构建未暴露组件名；组件名仅在开发构建可见。'));
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
    var tb = document.querySelector('table');
    if(tb) show(tb);
    b.appendChild(btn(tb ? '拾取其他表格' : '拾取表格', function(){
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
    b.appendChild(note('open root 可用上方脚本递归进入；封闭 root 需 CDP 或扩展 eval 通道。'));
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
    b.appendChild(note('工具箱自身挂在 z-index 2147483646 的独立宿主上，永远在最上层。'));
  }}
]);
})(window.BATB);
