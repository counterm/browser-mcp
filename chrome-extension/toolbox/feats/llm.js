/* 工具箱 · feats/llm —— 「发给 LLM」分类（copy / store 两个子组）。
   交付通道只有两种：copy = 结果进剪贴板人工粘贴；store = 写 localStorage（+页面变量）让 LLM 经 broker 自取。 */
(function(B){
if(!B) return;
var $$ = B.u.$$, el = B.u.el, esc = B.u.esc, copyText = B.u.copyText;
var kv = B.w.kv, note = B.w.note, btn = B.w.btn, badge = B.w.badge, scoreBadge = B.w.scoreBadge, codeBox = B.w.codeBox, toast = B.w.toast;
var bestSelector = B.sel.bestSelector, xpathOf = B.sel.xpathOf, scoreSelector = B.sel.scoreSelector;
var pick = B.pick, ensurePicked = B.ensurePicked;
var detectStack = B.detectStack, REDACT = B.REDACT, redact = B.redact, skeleton = B.skeleton, NET = B.NET;

/* 扩展桥：取本页 broker pid（MAIN world 拿不到 chrome.*，经 batb:bridge 中转） */
function pinfo(){
  return new Promise(function(resolve, reject){
    var id = Math.random().toString(36).slice(2), done = false;
    var timer = setTimeout(function(){
      done = true; window.removeEventListener('batb:bridge:res', onRes);
      reject(new Error('扩展桥无响应（扩展未就绪或页面未接入 broker）'));
    }, 1500);
    function onRes(ev){
      var d = ev.detail;
      if(!d || d.id !== id || done) return;
      done = true; clearTimeout(timer); window.removeEventListener('batb:bridge:res', onRes);
      if(d.ok) resolve(d.data || {}); else reject(new Error(d.error || '扩展桥调用失败'));
    }
    window.addEventListener('batb:bridge:res', onRes);
    window.dispatchEvent(new CustomEvent('batb:bridge', { detail: { id: id, action: 'pinfo', params: {} } }));
  });
}

B.register([
/* ===== 复制（结果进剪贴板，人工粘贴进对话） ===== */
{ id:'skeleton', cat:'llm', grp:'copy', name:'一键复制精简 DOM', icon:'copy', star:3, desc:'去噪压缩为 JSON，含脱敏',
  run:function(b){
    var raw = skeleton(document.body);
    var safe = redact(raw);
    var pre = el('pre'); pre.textContent = safe.slice(0, 3000) + (safe.length > 3000 ? '\n…（全长 ' + safe.length + ' 字符，已省略展示）' : '');
    b.appendChild(el('div', 'd', '原文 <b>' + raw.length + '</b> 字符 → 精简后 <b>' + safe.length + '</b> 字符'));
    b.appendChild(pre);
    b.appendChild(el('div', 'row2')).appendChild(btn('复制精简 DOM（脱敏后）', function(){
      copyText(safe).then(function(){ toast('已复制（' + safe.length + ' 字符）'); });
    }, 'pri'));
    b.appendChild(note('去噪规则：移除 script/style/svg，仅保留 id/class/href/name/aria-label/data-test* 等有效属性；脱敏在复制前完成。'));
  }},
{ id:'redact', cat:'llm', grp:'copy', name:'数据脱敏', icon:'shield', star:3, desc:'手机号、身份证、token、邮箱自动打码',
  run:function(b){
    var text = document.body.innerText.slice(0, 20000);
    var counts = REDACT.map(function(r){ var m = text.match(r[0]); return { tag:r[1], n:m ? m.length : 0 }; });
    var safe = redact(text);
    b.appendChild(kv(counts.map(function(c){ return [c.tag, String(c.n) + ' 处']; })));
    var pre = el('pre');
    pre.textContent = safe.split('\n').filter(function(l){ return /PHONE|ID|EMAIL|TOKEN|JWT/.test(l); }).slice(0, 5).join('\n') || '（正文前 20000 字符内未发现敏感信息）';
    b.appendChild(pre);
    b.appendChild(el('div', 'row2')).appendChild(btn('复制脱敏后正文', function(){ copyText(safe).then(function(){ toast('已复制脱敏文本'); }); }, 'pri'));
    b.appendChild(note('规则：手机号 / 身份证 / 邮箱 / sk-、ghp-、xoxb- token / JWT。'));
  }},
{ id:'elqa', cat:'llm', grp:'copy', name:'选中元素问答', icon:'chat', star:3, desc:'打包元素上下文 + 你的问题，组成完整 prompt',
  run:function(b){
    ensurePicked().then(function(e){
      if(!e) return;
      var ta = el('textarea'); ta.rows = 2; ta.placeholder = '你的问题，如：这个按钮点击后会发生什么？';
      b.appendChild(el('div', 'fld')).appendChild(ta);
      b.appendChild(btn('组装并复制 Prompt', function(){
        var prompt =
'【页面】' + location.href + '（' + document.title + '）\n' +
'【元素】' + e.tagName.toLowerCase() + ' ' + bestSelector(e) + '\n' +
'【HTML】' + e.outerHTML.slice(0, 500) + '\n' +
'【可见文本】' + (e.textContent || '').trim().slice(0, 200) + '\n' +
'【问题】' + (ta.value || '（未填写）');
        copyText(prompt).then(function(){ toast('Prompt 已复制，可直接粘贴给 LLM'); });
      }, 'pri'));
    });
  }},
/* ===== 存储（写入浏览器变量 / localStorage，LLM 自取） ===== */
{ id:'storectx', cat:'llm', grp:'store', name:'存入页面上下文', icon:'package', star:3, desc:'结构化上下文写入 window / localStorage',
  run:function(b){
    var ctx = {
      url: location.href, title: document.title, ts: new Date().toISOString(),
      stack: detectStack(),
      viewport: { w: innerWidth, h: innerHeight },
      forms: $$('input,select,textarea').filter(function(e){ return e.type !== 'hidden'; }).map(function(e){
        var lg = e.labels && e.labels[0];
        return { tag:e.tagName.toLowerCase(), type:e.type || '', name:e.name || '', label:(lg ? lg.textContent.trim() : '') || e.placeholder || e.id || '' };
      }),
      table: (function(){ var tb = document.querySelector('table'); if(!tb) return null;
        return $$('tr', tb).map(function(tr){ return $$('td,th', tr).map(function(c){ return c.textContent.trim(); }); }); })(),
      net: NET.slice(-20),
      dom: redact(skeleton(document.body)).slice(0, 8000)
    };
    var json = JSON.stringify(ctx);
    window.__BA_CTX__ = ctx;
    try{ localStorage.setItem('ba:ctx', json); }catch(e){}
    b.appendChild(el('div', 'd', '已写入 <b>window.__BA_CTX__</b> 与 <b>localStorage["ba:ctx"]</b>，共 <b>' + json.length + '</b> 字符。'));
    b.appendChild(kv([['变量', badge('window.__BA_CTX__', 'b')], ['存储键', badge('ba:ctx', 'b')], ['字段', 'url / title / stack / viewport / forms / table / net / dom']]));
    b.appendChild(codeBox(
'// LLM 经 broker 自取（storage 读 localStorage，跨上下文可靠）\n' +
'POST /call/{pid}  {"action":"storage","key":"ba:ctx"}\n' +
'// window.__BA_CTX__ 仅页面主世界可见（控制台 / MAIN world eval）'));
    b.appendChild(note('变量随刷新 / 跳转失效；localStorage 可跨刷新保留。写入即生效，LLM 直接 storage 取用。'));
  }},
{ id:'storeel', cat:'llm', grp:'store', name:'存入选中元素', icon:'crosshair', star:2, desc:'拾取元素 → 写入变量，LLM 直接读',
  run:function(b){
    b.appendChild(el('div', 'note', '点击按钮进入拾取，选中元素后其定位与上下文写入 window.__BA_EL__。'));
    b.appendChild(btn('拾取并存入', function(){
      pick().then(function(e){
        if(!e) return;
        var sel = bestSelector(e);
        var obj = { url: location.href, selector: sel, xpath: xpathOf(e), score: scoreSelector(sel).score, html: e.outerHTML.slice(0, 1000), text: (e.textContent || '').trim().slice(0, 300) };
        window.__BA_EL__ = obj;
        try{ localStorage.setItem('ba:el', JSON.stringify(obj)); }catch(e2){}
        toast('已写入 window.__BA_EL__');
        b.appendChild(el('div', 'd', '已存入：<b>' + esc(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')) + '</b> ' + scoreBadge(scoreSelector(sel))));
        b.appendChild(codeBox('POST /call/{pid}  {"action":"storage","key":"ba:el"}\n// window.__BA_EL__ 仅页面主世界可见'));
      });
    }, 'pri'));
  }},
{ id:'marker', cat:'llm', grp:'store', name:'复制页桥标记', icon:'key', star:3, desc:'复制网页 id，LLM 凭 id 查回网页',
  run:function(b){
    var out = el('div');
    b.appendChild(el('div', 'note', '标记 id 在扩展接入本页时由 JS 生成并上报服务器；复制这个 id 交给 LLM，对方即可按 id 查到本页网址与实时快照。'));
    b.appendChild(out);
    function render(info, err){
      var broker = 'http://127.0.0.1:' + ((info && info.port) || 8766);
      var mark = info && info.mark;
      var title = (info && info.title) || document.title;
      var url = (info && info.url) || location.href;
      if(!mark){
        out.appendChild(kv([['页面', esc(title)], ['URL', esc(url)]]));
        out.appendChild(note((err && err.message ? esc(err.message) + '；' : '') + '当前页面未接入扩展桥，无法生成 / 读取标记。'));
        return;
      }
      out.appendChild(kv([['标记 id', badge(mark, 'b')], ['页面', esc(title)], ['URL', esc(url)]]));
      out.appendChild(el('div', 'row2')).appendChild(btn('复制标记 id', function(){
        copyText(mark).then(function(){ toast('已复制标记：' + mark); });
      }, 'pri'));
      out.appendChild(codeBox(
'# 凭标记找回网页（本机 broker 在跑）\n' +
'GET  ' + broker + '/mark/' + mark + '\n' +
'POST ' + broker + '/mark/' + mark + '  {"action":"snapshot"}\n' +
'GET  ' + broker + '/marks    # 列出全部标记 → 网址'));
      out.appendChild(note('id 随 tab 保存：刷新 / 跳转不变，关闭 tab 后失效；服务器保存 id → 网址映射，离线后仍可查到最近一次的 URL。'));
    }
    if(location.protocol === 'file:'){ render(null, new Error('原型页未接入扩展')); return; }
    pinfo().then(function(info){ render(info); }).catch(function(e){ render(null, e); });
  }},
/* ===== 复制 · 高级 ===== */
{ id:'a11y', cat:'llm', grp:'copy', name:'a11y 修复建议', icon:'person', star:1, desc:'整理可访问性缺陷为待办，可复制给 LLM', adv:true,
  run:function(b){
    var todos = [];
    $$('img').forEach(function(e){ if(!e.alt) todos.push('img 缺少 alt：' + bestSelector(e)); });
    $$('button,a[role=button]').forEach(function(e){
      if(!(e.textContent || '').trim() && !e.getAttribute('aria-label')) todos.push('按钮无可访问名称：' + bestSelector(e));
    });
    $$('input,select,textarea').forEach(function(e){
      var has = (e.labels && e.labels.length) || e.getAttribute('aria-label') || e.getAttribute('placeholder');
      if(!has) todos.push('表单字段缺标签：' + bestSelector(e));
    });
    $$('a').forEach(function(e){ if(!e.getAttribute('href')) todos.push('链接缺 href：' + bestSelector(e)); });
    var d = el('div', 'lst');
    if(todos.length) todos.forEach(function(t){ d.appendChild(el('div', 'li', '<span class="u">' + esc(t) + '</span>')); });
    else d.appendChild(el('div', 'li', '<span class="u">未发现明显缺陷</span>'));
    b.appendChild(d);
    if(todos.length){
      var txt = todos.join('\n');
      b.appendChild(el('div', 'row2')).appendChild(btn('复制待办清单给 LLM', function(){ copyText(txt).then(function(){ toast('已复制 ' + todos.length + ' 条'); }); }, 'pri'));
    }
    b.appendChild(note('检查规则：img alt / 按钮名称 / 字段标签 / 链接 href。可接 axe-core 增强。'));
  }}
]);
})(window.BATB);
