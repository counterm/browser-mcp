/* 工具箱 · feats/llm —— 「发给 LLM」分类（copy / store 两个子组）。
   交付通道只有两种：copy = 结果进剪贴板人工粘贴；store = 写 window.__BA_* + localStorage 让 LLM 经 broker 自取。 */
(function(B){
var $$ = B.u.$$, el = B.u.el, esc = B.u.esc, copyText = B.u.copyText, t = B.t;
var kv = B.w.kv, note = B.w.note, btn = B.w.btn, badge = B.w.badge, scoreBadge = B.w.scoreBadge, codeBox = B.w.codeBox, toast = B.w.toast;
var bestSelector = B.sel.bestSelector, xpathOf = B.sel.xpathOf, scoreSelector = B.sel.scoreSelector;
var pick = B.pick, ensurePicked = B.ensurePicked;
var state = B.state;
var detectStack = B.detectStack, REDACT = B.REDACT, redact = B.redact, pugDom = B.pugDom, NET = B.NET;

/* 扩展桥：取本页 broker pid（MAIN world 拿不到 chrome.*，经 batb:bridge 中转） */
function pinfo(){
  return new Promise(function(resolve, reject){
    var id = Math.random().toString(36).slice(2), done = false;
    var timer = setTimeout(function(){
      done = true; window.removeEventListener('batb:bridge:res', onRes);
      reject(new Error(t('扩展桥无响应（扩展未就绪或页面未接入 broker）', 'Extension bridge not responding (extension not ready or page not attached to broker)')));
    }, 1500);
    function onRes(ev){
      var d = ev.detail;
      if(!d || d.id !== id || done) return;
      done = true; clearTimeout(timer); window.removeEventListener('batb:bridge:res', onRes);
      if(d.ok) resolve(d.data || {}); else reject(new Error(d.error || t('扩展桥调用失败', 'Extension bridge call failed')));
    }
    window.addEventListener('batb:bridge:res', onRes);
    window.dispatchEvent(new CustomEvent('batb:bridge', { detail: { id: id, action: 'pinfo', params: {} } }));
  });
}

B.register([
/* ===== 复制（结果进剪贴板，人工粘贴进对话） ===== */
{ id:'skeleton', cat:'llm', grp:'copy', name:'一键复制精简 DOM', en:{ name:'Copy Condensed DOM', desc:'Pug indent tree, denoised + redacted' }, icon:'copy', star:3, desc:'Pug 缩进树，去噪压缩 + 脱敏',
  run:function(b){
    var f = el('div', 'fld');
    var inp = el('input'); inp.placeholder = t('CSS 选择器或 bid，如 .el-table__body / 12；留空 = 整页', 'CSS selector or bid, e.g. .el-table__body / 12; empty = whole page');
    var go = btn(t('查询', 'Query'), function(){ render(inp.value.trim()); }, 'pri');
    f.appendChild(inp); f.appendChild(go); b.appendChild(f);

    var stats = el('div', 'd'); b.appendChild(stats);
    var pre = el('pre'); b.appendChild(pre);
    var row = el('div', 'row2'); b.appendChild(row);
    var safe = '';
    row.appendChild(btn(t('复制这段 Pug（脱敏后）', 'Copy This Pug (Redacted)'), function(){
      if(!safe){ toast(t('先查询一个元素', 'Query an element first')); return; }
      copyText(safe).then(function(){ toast(t('已复制（' + safe.length + ' 字符）', 'Copied (' + safe.length + ' chars)')); });
    }, 'pri'));

    function render(q){
      var root = document.body, label = t('整页', 'Whole page');
      if(q){
        root = /^\d+$/.test(q) ? document.querySelector('[data-bid="' + q + '"]')
          : document.querySelector(q);
        label = /^\d+$/.test(q) ? 'bid ' + q : q;
      }
      if(!root){ toast(t('未找到元素：' + label, 'Element not found: ' + label)); return; }
      var res = pugDom(root, { depth: 10, maxNodes: 4000, maxChars: 200000, collapse: 3 });
      safe = redact(res.content);
      stats.innerHTML = t('范围 <b>' + esc(label) + '</b> · 节点 <b>' + res.nodes + '</b> · Pug <b>' + safe.length + '</b> 字符',
        'Range <b>' + esc(label) + '</b> · Nodes <b>' + res.nodes + '</b> · Pug <b>' + safe.length + '</b> chars')
        + (res.truncated ? t('（已达上限，已截断）', ' (limit reached, truncated)') : '');
      pre.textContent = safe.slice(0, 3000) + (safe.length > 3000 ? t('\n…（全长 ' + safe.length + ' 字符，已省略展示）', '\n…(full length ' + safe.length + ' chars, display truncated)') : '');
    }
    render('');
    b.appendChild(note(t('Pug 规则：2 空格缩进，tag.class#id(attr) 文本；只留 id/class/name/type/href/src/placeholder/aria-label/data-test*，丢弃 value 并在复制前脱敏；连续同类兄弟 ≥3 个折叠为 ×N；上限 深度 10 / 4000 节点 / 20 万字符。填入选择器或 bid 可只看该元素及其子孙。',
      'Pug rules: 2-space indent, tag.class#id(attr) text; keep only id/class/name/type/href/src/placeholder/aria-label/data-test*, drop value and redact before copying; runs of ≥3 same-type siblings collapse to ×N; limits: depth 10 / 4000 nodes / 200k chars. Enter a selector or bid to inspect only that element and its descendants.')));
  }},
{ id:'elqa', cat:'llm', grp:'copy', name:'选中元素问答', en:{ name:'Ask About Selected Element', desc:'Bundle element context + your question into a full prompt' }, icon:'chat', star:3, desc:'打包元素上下文 + 你的问题，组成完整 prompt',
  run:function(b){
    pick().then(function(e){
      if(!e) return;
      state.picked = e;
      var ta = el('textarea'); ta.rows = 2; ta.placeholder = t('你的问题，如：这个按钮点击后会发生什么？', 'Your question, e.g. what happens when this button is clicked?');
      b.appendChild(el('div', 'fld')).appendChild(ta);
      b.appendChild(btn(t('组装并复制 Prompt', 'Build & Copy Prompt'), function(){
        var prompt =
t('【页面】' + location.href + '（' + document.title + '）', '[Page] ' + location.href + ' (' + document.title + ')') + '\n' +
t('【元素】', '[Element] ') + e.tagName.toLowerCase() + ' ' + bestSelector(e) + '\n' +
t('【HTML】', '[HTML] ') + e.outerHTML.slice(0, 500) + '\n' +
t('【可见文本】', '[Visible Text] ') + (e.textContent || '').trim().slice(0, 200) + '\n' +
t('【问题】', '[Question] ') + (ta.value || t('（未填写）', '(not provided)'));
        copyText(prompt).then(function(){ toast(t('Prompt 已复制，可直接粘贴给 LLM', 'Prompt copied — paste it straight into your LLM chat')); });
      }, 'pri'));
    });
  }},
{ id:'marker', cat:'llm', grp:'copy', name:'复制页桥标记', en:{ name:'Copy Page Bridge Marker', desc:'Copy the page id so the LLM can look the page up' }, icon:'key', star:3, desc:'复制网页 id，LLM 凭 id 查回网页',
  run:function(b){
    if(B.ui && B.ui.closePanel) B.ui.closePanel();
    if(location.protocol === 'file:'){ toast(t('原型页未接入扩展', 'Prototype page not connected to the extension')); return; }
    pinfo().then(function(info){
      if(!info || !info.mark){ toast(t('当前页面未接入扩展桥，无法生成标记', 'Page not connected to the extension bridge')); return; }
      copyText(info.mark).then(function(){
        toast(t('已复制标记 id：' + info.mark, 'Marker id copied: ' + info.mark));
      });
      try{
        console.groupCollapsed('%c [BA] marker ' + t('已复制', 'copied'), 'color:#4fb;font-weight:bold');
        console.log('mark =', info.mark);
        console.log('title =', (info.title || document.title));
        console.log('url =', info.url || location.href);
        var broker = 'http://127.0.0.1:' + ((info && info.port) || 8766);
        console.log('GET  ' + broker + '/mark/' + info.mark);
        console.log('POST ' + broker + '/mark/' + info.mark + '  {"action":"snapshot"}');
        console.groupEnd();
      }catch(e){}
    }).catch(function(e){ toast(t('扩展桥调用失败：' + (e.message || ''), 'Extension bridge failed: ' + (e.message || ''))); });
  }},
/* ===== 存储（写入浏览器变量 / localStorage，LLM 自取） ===== */
{ id:'storectx', cat:'llm', grp:'store', name:'存入页面上下文', en:{ name:'Store Page Context', desc:'Write structured context to window / localStorage' }, icon:'package', star:3, desc:'结构化上下文写入 window / localStorage',
  run:function(b){
    if(B.ui && B.ui.closePanel) B.ui.closePanel();
    var ctx = {
      url: location.href, title: document.title, ts: new Date().toISOString(),
      stack: detectStack(),
      viewport: { w: innerWidth, h: innerHeight },
      forms: $$('input,select,textarea').filter(function(e){ return e.type !== 'hidden'; }).map(function(e){
        var lg = e.labels && e.labels[0];
        return { tag:e.tagName.toLowerCase(), type:e.type || '', name:e.name || '', label:(lg ? lg.textContent.trim() : '') || e.placeholder || e.id || '' };
      }),
      table: (function(){ var tb = document.getElementById('orders'); if(!tb) return null;
        return $$('tr', tb).map(function(tr){ return $$('td,th', tr).map(function(c){ return c.textContent.trim(); }); }); })(),
      net: NET.slice(-20),
      dom: redact(pugDom(document.body, { depth: 8, maxNodes: 800, maxChars: 8000 }).content)
    };
    var json = JSON.stringify(ctx);
    window.__BA_CTX__ = ctx;
    try{ localStorage.setItem('ba:ctx', json); }catch(e){}
    toast(t('页面上下文已写入（window.__BA_CTX__ + ba:ctx），共 ' + json.length + ' 字符',
      'Page context written (window.__BA_CTX__ + ba:ctx), ' + json.length + ' chars total'));
    try{
      console.groupCollapsed('%c [BA] storectx ' + t('页面上下文已写入', 'page context stored'), 'color:#4fb;font-weight:bold');
      console.log('window.__BA_CTX__ =', ctx);
      console.log('localStorage["ba:ctx"] ✓  ' + json.length + ' chars');
      console.trace();
      console.groupEnd();
    }catch(e2){}
  }},
{ id:'storeel', cat:'llm', grp:'store', name:'存入选中元素', en:{ name:'Store Selected Element', desc:'Pick an element → write it to a variable the LLM can read' }, icon:'crosshair', star:2, desc:'拾取元素 → 写入变量，LLM 直接读',
  run:function(b){
    pick().then(function(e){
      if(!e) return;
      state.picked = e;
      var sel = bestSelector(e);
      var obj = { url: location.href, selector: sel, xpath: xpathOf(e), score: scoreSelector(sel).score, html: e.outerHTML.slice(0, 1000), text: (e.textContent || '').trim().slice(0, 300) };
      window.__BA_EL__ = obj;
      try{ localStorage.setItem('ba:el', JSON.stringify(obj)); }catch(e2){}
      toast(t('已存入 window.__BA_EL__（' + esc(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')) + '）',
        'Stored to window.__BA_EL__ (' + e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ')'));
      try{
        console.groupCollapsed('%c [BA] storeel ' + t('已存入', 'stored'), 'color:#4fb;font-weight:bold');
        console.log('window.__BA_EL__ =', obj);
        console.log('POST /call/{pid}  {"action":"storage","key":"ba:el"}');
        console.groupEnd();
      }catch(e3){}
    });
  }},
]);
})(window.BATB);
