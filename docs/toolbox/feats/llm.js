/* 工具箱 · feats/llm —— 「发给 LLM」分类（copy / store 两个子组）。
   交付通道只有两种：copy = 结果进剪贴板人工粘贴；store = 写 window.__BA_* + localStorage 让 LLM 经 broker 自取。 */
(function(B){
var $$ = B.u.$$, el = B.u.el, esc = B.u.esc, copyText = B.u.copyText, t = B.t;
var kv = B.w.kv, note = B.w.note, btn = B.w.btn, badge = B.w.badge, scoreBadge = B.w.scoreBadge, codeBox = B.w.codeBox, toast = B.w.toast;
var bestSelector = B.sel.bestSelector, xpathOf = B.sel.xpathOf, scoreSelector = B.sel.scoreSelector;
var pick = B.pick, ensurePicked = B.ensurePicked;
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
{ id:'redact', cat:'llm', grp:'copy', name:'数据脱敏', en:{ name:'Redact Sensitive Data', desc:'Auto-mask phone numbers, IDs, tokens, emails' }, icon:'shield', star:3, desc:'手机号、身份证、token、邮箱自动打码',
  run:function(b){
    var text = document.body.innerText.slice(0, 20000);
    var counts = REDACT.map(function(r){ var m = text.match(r[0]); return { tag:r[1], n:m ? m.length : 0 }; });
    var safe = redact(text);
    b.appendChild(kv(counts.map(function(c){ return [c.tag, t(String(c.n) + ' 处', String(c.n) + ' hits')]; })));
    var pre = el('pre');
    pre.textContent = safe.split('\n').filter(function(l){ return /PHONE|ID|EMAIL|TOKEN|JWT/.test(l); }).slice(0, 5).join('\n') || t('（正文前 20000 字符内未发现敏感信息）', '(No sensitive data found in the first 20000 chars of body text)');
    b.appendChild(pre);
    b.appendChild(el('div', 'row2')).appendChild(btn(t('复制脱敏后正文', 'Copy Redacted Text'), function(){ copyText(safe).then(function(){ toast(t('已复制脱敏文本', 'Redacted text copied')); }); }, 'pri'));
    b.appendChild(note(t('原型页备注框里预置了手机号 / 身份证 / 邮箱 / sk- token 各一，可看到打码效果。',
      'The prototype note box pre-seeds one phone number / national ID / email / sk- token each, so you can preview the masking.')));
  }},
{ id:'elqa', cat:'llm', grp:'copy', name:'选中元素问答', en:{ name:'Ask About Selected Element', desc:'Bundle element context + your question into a full prompt' }, icon:'chat', star:3, desc:'打包元素上下文 + 你的问题，组成完整 prompt',
  run:function(b){
    ensurePicked().then(function(e){
      if(!e) return;
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
/* ===== 存储（写入浏览器变量 / localStorage，LLM 自取） ===== */
{ id:'storectx', cat:'llm', grp:'store', name:'存入页面上下文', en:{ name:'Store Page Context', desc:'Write structured context to window / localStorage' }, icon:'package', star:3, desc:'结构化上下文写入 window / localStorage',
  run:function(b){
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
    b.appendChild(el('div', 'd', t('已写入 <b>window.__BA_CTX__</b> 与 <b>localStorage["ba:ctx"]</b>，共 <b>' + json.length + '</b> 字符。',
      'Wrote <b>window.__BA_CTX__</b> and <b>localStorage["ba:ctx"]</b>, <b>' + json.length + '</b> chars total.')));
    b.appendChild(kv([[t('变量', 'Variable'), badge('window.__BA_CTX__', 'b')], [t('存储键', 'Storage key'), badge('ba:ctx', 'b')], [t('字段', 'Fields'), 'url / title / stack / viewport / forms / table / net / dom']]));
    b.appendChild(codeBox(
t('// LLM 经 broker 自取，无需人工粘贴\n', '// LLM fetches it via broker, no manual paste needed\n') +
'POST /call/{pid}  {"action":"eval","code":"JSON.stringify(window.__BA_CTX__)"}\n' +
'POST /call/{pid}  {"action":"storage","op":"get","key":"ba:ctx"}'));
    b.appendChild(note(t('变量随刷新 / 跳转失效；localStorage 可跨刷新保留。写入即生效，LLM 直接 eval / storage 取用。',
      'The variable is lost on refresh / navigation; localStorage survives refreshes. Written immediately; the LLM reads it via eval / storage.')));
  }},
{ id:'storeel', cat:'llm', grp:'store', name:'存入选中元素', en:{ name:'Store Selected Element', desc:'Pick an element → write it to a variable the LLM can read' }, icon:'crosshair', star:2, desc:'拾取元素 → 写入变量，LLM 直接读',
  run:function(b){
    b.appendChild(el('div', 'note', t('点击按钮进入拾取，选中元素后其定位与上下文写入 window.__BA_EL__。',
      'Click the button to start picking; the selected element\'s locator and context are written to window.__BA_EL__.')));
    b.appendChild(btn(t('拾取并存入', 'Pick & Store'), function(){
      pick().then(function(e){
        if(!e) return;
        var sel = bestSelector(e);
        var obj = { url: location.href, selector: sel, xpath: xpathOf(e), score: scoreSelector(sel).score, html: e.outerHTML.slice(0, 1000), text: (e.textContent || '').trim().slice(0, 300) };
        window.__BA_EL__ = obj;
        try{ localStorage.setItem('ba:el', JSON.stringify(obj)); }catch(e2){}
        toast(t('已写入 window.__BA_EL__', 'Written to window.__BA_EL__'));
        b.appendChild(el('div', 'd', t('已存入：<b>', 'Stored: <b>') + esc(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')) + '</b> ' + scoreBadge(scoreSelector(sel))));
        b.appendChild(codeBox('POST /call/{pid}  {"action":"eval","code":"JSON.stringify(window.__BA_EL__)"}'));
      });
    }, 'pri'));
  }},
{ id:'marker', cat:'llm', grp:'store', name:'复制页桥标记', en:{ name:'Copy Page Bridge Marker', desc:'Copy the page id so the LLM can look the page up' }, icon:'key', star:3, desc:'复制网页 id，LLM 凭 id 查回网页',
  run:function(b){
    var out = el('div');
    b.appendChild(el('div', 'note', t('标记 id 在扩展接入本页时由 JS 生成并上报服务器；复制这个 id 交给 LLM，对方即可按 id 查到本页网址与实时快照。',
      'The marker id is generated by JS when the extension attaches to this page and reported to the server; copy this id to the LLM and it can look up this page\'s URL and live snapshot by id.')));
    b.appendChild(out);
    function render(info, err){
      var broker = 'http://127.0.0.1:' + ((info && info.port) || 8766);
      var mark = info && info.mark;
      var title = (info && info.title) || document.title;
      var url = (info && info.url) || location.href;
      if(!mark){
        out.appendChild(kv([[t('页面', 'Page'), esc(title)], ['URL', esc(url)]]));
        var preErr = err && err.message ? esc(err.message) + t('；', '; ') : '';
        out.appendChild(note(preErr + t('当前页面未接入扩展桥，无法生成 / 读取标记。', 'This page is not connected to the extension bridge; cannot generate / read the marker.')));
        return;
      }
      out.appendChild(kv([[t('标记 id', 'Marker id'), badge(mark, 'b')], [t('页面', 'Page'), esc(title)], ['URL', esc(url)]]));
      var row = el('div', 'row2');
      row.appendChild(btn(t('复制标记 id', 'Copy Marker id'), function(){
        copyText(mark).then(function(){ toast(t('已复制标记：' + mark, 'Marker copied: ' + mark)); });
      }, 'pri'));
      row.appendChild(btn(t('MCP 提示页面', 'MCP Page Handoff'), function(){
        var prompt =
t('【页面交接】请用你的 MCP 工具接手这个浏览器页面：\n', '[Page Handoff] Take over this browser page with your MCP tools:\n') +
t('标记 id：', 'Marker id: ') + mark + '\n' +
t('标题：', 'Title: ') + String(title).replace(/\s+/g, ' ') + '\n' +
t('网址：', 'URL: ') + url + '\n' +
t('优先按标记 id 选中该页面（工具不支持时按网址匹配），先读取一次页面快照确认是同一页面，再执行我接下来的指令。',
  'Prefer selecting the page by marker id (fall back to URL matching if unsupported); read one page snapshot to confirm it is the same page, then follow my next instruction.');
        copyText(prompt).then(function(){ toast(t('已复制 MCP 提示', 'MCP handoff prompt copied')); });
      }));
      out.appendChild(row);
      out.appendChild(codeBox(
t('# 凭标记找回网页（本机 broker 在跑）\n', '# Look up a page by marker (local broker running)\n') +
'GET  ' + broker + '/mark/' + mark + '\n' +
'POST ' + broker + '/mark/' + mark + '  {"action":"snapshot"}\n' +
t('GET  ' + broker + '/marks    # 列出全部标记 → 网址', 'GET  ' + broker + '/marks    # list all markers → URLs')));
      out.appendChild(note(t('id 随 tab 保存：刷新 / 跳转不变，关闭 tab 后失效；服务器保存 id → 网址映射，离线后仍可查到最近一次的 URL。',
        'The id is stored per tab: unchanged across refresh / navigation, invalid once the tab closes; the server keeps an id → URL map, so the latest URL is still queryable after going offline.')));
    }
    if(location.protocol === 'file:'){ render(null, new Error(t('原型页未接入扩展', 'Prototype page not connected to the extension'))); return; }
    pinfo().then(function(info){ render(info); }).catch(function(e){ render(null, e); });
  }},
/* ===== 复制 · 高级 ===== */
{ id:'a11y', cat:'llm', grp:'copy', name:'a11y 修复建议', en:{ name:'a11y Fix Suggestions', desc:'Collect accessibility issues as a to-do list for the LLM' }, icon:'person', star:1, desc:'整理可访问性缺陷为待办，可复制给 LLM', adv:true,
  run:function(b){
    var todos = [];
    $$('img').forEach(function(e){ if(!e.alt) todos.push(t('img 缺少 alt：', 'img missing alt: ') + bestSelector(e)); });
    $$('button,a[role=button]').forEach(function(e){
      if(!(e.textContent || '').trim() && !e.getAttribute('aria-label')) todos.push(t('按钮无可访问名称：', 'button has no accessible name: ') + bestSelector(e));
    });
    $$('input,select,textarea').forEach(function(e){
      var has = (e.labels && e.labels.length) || e.getAttribute('aria-label') || e.getAttribute('placeholder');
      if(!has) todos.push(t('表单字段缺标签：', 'form field missing label: ') + bestSelector(e));
    });
    $$('a').forEach(function(e){ if(!e.getAttribute('href')) todos.push(t('链接缺 href：', 'link missing href: ') + bestSelector(e)); });
    var d = el('div', 'lst');
    if(todos.length) todos.forEach(function(todo){ d.appendChild(el('div', 'li', '<span class="u">' + esc(todo) + '</span>')); });
    else d.appendChild(el('div', 'li', '<span class="u">' + t('未发现明显缺陷', 'No obvious issues found') + '</span>'));
    b.appendChild(d);
    if(todos.length){
      var txt = todos.join('\n');
      b.appendChild(el('div', 'row2')).appendChild(btn(t('复制待办清单给 LLM', 'Copy To-Do List for LLM'), function(){ copyText(txt).then(function(){ toast(t('已复制 ' + todos.length + ' 条', 'Copied ' + todos.length + ' items')); }); }, 'pri'));
    }
    b.appendChild(note(t('检查规则：img alt / 按钮名称 / 字段标签 / 链接 href。扩展版可接 axe-core 增强。',
      'Checks: img alt / button name / field label / link href. The extension build can plug in axe-core for deeper checks.')));
  }}
]);
})(window.BATB);
