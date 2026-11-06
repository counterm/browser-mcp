/* 工具箱 · core —— 命名空间 / 基础工具 / 图标 / 挂载 / 样式。必须最先加载。
   模块化说明：全部为普通 <script>（零构建，file:// 可直接打开），
   共享命名空间 window.BATB；功能文件调用 B.register([...]) 注册。
   加载顺序：core → cats → widgets → ui → picker → helpers → feats/* → boot
   落扩展时改造点：chrome.storage 记位置 / 白名单门控 / 经 background 转发命令 */
(function(){
'use strict';
if(window.BATB) return; // 防重复注入
var B = window.BATB = { FEATS:[] };

/* ---------- 基础工具 ---------- */
B.u = {
  $: function(s, r){ return (r||document).querySelector(s); },
  $$: function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); },
  el: function(tag, cls, html){ var n = document.createElement(tag); if(cls) n.className = cls; if(html != null) n.innerHTML = html; return n; },
  esc: function(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); },
  clamp: function(v, a, b){ return Math.max(a, Math.min(b, v)); },
  copyText: function(t){ if(navigator.clipboard) return navigator.clipboard.writeText(t); var t2 = document.createElement('textarea'); t2.value = t; document.body.appendChild(t2); t2.select(); document.execCommand('copy'); t2.remove(); return Promise.resolve(); },
  sq: null, sqa: null /* Shadow DOM 内查询，挂载后填充 */
};

/* ---------- 语言：默认中文，可切换英文；文案统一走 B.t(中文, 英文) ---------- */
B.LANG_KEY = 'ba:tbx-lang';
B.lang = 'zh';
try{ if(localStorage.getItem(B.LANG_KEY) === 'en') B.lang = 'en'; }catch(e){}
B.t = function(zh, en){ return B.lang === 'en' ? (en == null ? zh : en) : zh; };
B.langHooks = [];
B.onLang = function(fn){ if(typeof fn === 'function') B.langHooks.push(fn); };
B.setLang = function(lang){
  B.lang = lang === 'en' ? 'en' : 'zh';
  try{ localStorage.setItem(B.LANG_KEY, B.lang); }catch(e){}
  if(B.ui && B.ui.applyLang) B.ui.applyLang();
  B.langHooks.forEach(function(fn){ try{ fn(B.lang); }catch(e){} });
};
B.toggleLang = function(){ B.setLang(B.lang === 'en' ? 'zh' : 'en'); };

/* ---------- 统一配置（设置面板）：直接复制到剪贴板 / 唤起快捷键等 ---------- */
B.CFG_KEY = 'ba:tbx-cfg';
B.cfg = { autoCopy:true, hotkey:'Alt+Shift+D' };
try{
  var _cfg = JSON.parse(localStorage.getItem(B.CFG_KEY) || '{}');
  if(_cfg && typeof _cfg.autoCopy === 'boolean') B.cfg.autoCopy = _cfg.autoCopy;
  if(_cfg && typeof _cfg.hotkey === 'string' && _cfg.hotkey) B.cfg.hotkey = _cfg.hotkey;
}catch(e){}
B.hotkeyParts = function(s){
  var parts = String(s || 'Alt+Shift+D').split('+').map(function(x){ return x.trim(); }).filter(Boolean);
  return { alt:parts.indexOf('Alt') > -1, ctrl:parts.indexOf('Ctrl') > -1, shift:parts.indexOf('Shift') > -1,
    meta:parts.indexOf('Meta') > -1, key:(parts[parts.length - 1] || 'D').toLowerCase() };
};
B.hotkeyMatch = function(e, s){
  var p = B.hotkeyParts(s);
  return !!p.alt === !!e.altKey && !!p.ctrl === !!e.ctrlKey && !!p.shift === !!e.shiftKey && !!p.meta === !!e.metaKey &&
    (e.key.length === 1 ? e.key.toLowerCase() : e.key) === p.key;
};
/* 扩展级全局配置桥：经 content.js 的 batb:bridge 转 background 的 chrome.storage.local */
B.extCfg = function(op, patch, timeoutMs){
  return new Promise(function(resolve, reject){
    var id = 'cfg' + Date.now() + Math.random().toString(36).slice(2), done = false;
    var timer = setTimeout(function(){
      if(done) return; done = true; window.removeEventListener('batb:bridge:res', onRes); reject(new Error('timeout'));
    }, timeoutMs || 2500);
    function onRes(ev){
      var d = ev.detail || {};
      if(d.id !== id || done) return;
      done = true; clearTimeout(timer); window.removeEventListener('batb:bridge:res', onRes);
      d.ok ? resolve(d.data) : reject(new Error(d.error || 'failed'));
    }
    window.addEventListener('batb:bridge:res', onRes);
    window.dispatchEvent(new CustomEvent('batb:bridge', { detail:{ id:id, action:'cfg', params:{ op:op, patch:patch || {} } } }));
  });
};
B.loadExtCfg = function(){
  return B.extCfg('get', null, 2500).then(function(data){
    if(!data || typeof data !== 'object') return;
    if(typeof data.autoCopy === 'boolean') B.cfg.autoCopy = data.autoCopy;
    if(typeof data.hotkey === 'string' && data.hotkey) B.cfg.hotkey = data.hotkey;
    try{ localStorage.setItem(B.CFG_KEY, JSON.stringify(B.cfg)); }catch(e){}
    if(B.ui && B.state && B.state.settings && B.ui.openSettings) B.ui.openSettings();
  }).catch(function(){});
};
B.setCfg = function(k, v){
  B.cfg[k] = v;
  try{ localStorage.setItem(B.CFG_KEY, JSON.stringify(B.cfg)); }catch(e){}
  var patch = {}; patch[k] = v;
  B.extCfg('set', patch, 3000).catch(function(){});
};
/* 其他标签页改了全局配置：background 广播 → content.js → 这里实时生效 */
window.addEventListener('batb:cfg', function(ev){
  var d = ev.detail || {};
  if(typeof d.autoCopy === 'boolean') B.cfg.autoCopy = d.autoCopy;
  if(typeof d.hotkey === 'string' && d.hotkey) B.cfg.hotkey = d.hotkey;
  try{ localStorage.setItem(B.CFG_KEY, JSON.stringify(B.cfg)); }catch(e){}
  if(B.ui && B.state && B.state.settings && B.ui.openSettings) B.ui.openSettings();
});

/* ---------- 操作记录：所有工具结果统一落 localStorage（约 100KB，超出丢弃最早） ---------- */
B.REC_KEY = 'ba:tbx-records';
B.rec = (function(){
  var MAX_CHARS = 100 * 1024, MAX_ITEMS = 200;
  function load(){ try{ var a = JSON.parse(localStorage.getItem(B.REC_KEY) || '[]'); return Array.isArray(a) ? a : []; }catch(e){ return []; } }
  function save(arr){
    while(arr.length > MAX_ITEMS) arr.shift();
    var s = JSON.stringify(arr);
    while(s.length > MAX_CHARS && arr.length > 1){ arr.shift(); s = JSON.stringify(arr); }
    if(s.length > MAX_CHARS && arr.length) arr[0].text = String(arr[0].text || '').slice(0, MAX_CHARS - 1024);
    try{ localStorage.setItem(B.REC_KEY, JSON.stringify(arr)); }catch(e){}
  }
  function add(title, text, feat){
    text = String(text == null ? '' : text);
    if(!text.trim()) return;
    var arr = load(), last = arr[arr.length - 1];
    /* 同一次操作先记录渲染结果、随后复制精确文本：15 秒内并成一条，避免重复条目 */
    if(last && last.feat === (feat || '') && Date.now() - last.ts < 15000){
      last.ts = Date.now(); last.title = title || last.title; last.text = text;
    } else {
      arr.push({ ts:Date.now(), feat:feat || '', title:title || '', text:text });
    }
    save(arr);
  }
  return { load:load, add:add, used:function(){ try{ return (localStorage.getItem(B.REC_KEY) || '').length * 2; }catch(e){ return 0; } },
    clear:function(){ try{ localStorage.removeItem(B.REC_KEY); }catch(e){} } };
})();
/* 复制入口统一收口：无论是否真正写入剪贴板，都先记录一条操作结果 */
var _copyText = B.u.copyText;
B.u.copyText = function(text, meta){
  meta = meta || {};
  if(!meta.noLog){
    var f = B.state && B.state.feat;
    B.rec.add(meta.title || (f ? B.t(f.name, f.en && f.en.name) : B.t('复制结果', 'Copied result')),
      String(text), f ? f.id : 'copy');
  }
  return _copyText.call(B.u, text);
};

/* ---------- 图标 ---------- */
B.ICONS = {
  toolbox:'<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M9 8V6a3 3 0 016 0v2M9.5 13.5h5"/>',
  close:'<path d="M6 6l12 12M18 6L6 18"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  sliders:'<path d="M4 8h8M16 8h4M4 16h4M12 16h8"/><circle cx="14" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>',
  bot:'<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/>',
  chevron:'<path d="M9 6l6 6-6 6"/>',
  gauge:'<path d="M12 14l4-4"/><path d="M4.5 18a9 9 0 1115 0"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z"/>',
  activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  form:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h5"/>',
  share:'<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  package:'<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  crosshair:'<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
  code:'<path d="M8 6l-5 6 5 6M16 6l5 6-5 6"/>',
  layers:'<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  table:'<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M10 10v9"/>',
  key:'<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8M16 6l2.5 2.5M13.5 8.5L16 11"/>',
  shadow:'<rect x="4" y="4" width="10" height="10" rx="2"/><rect x="10" y="10" width="10" height="10" rx="2"/>',
  scissors:'<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/>',
  zap:'<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  eye:'<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/>',
  eyeoff:'<path d="M4 4l16 16"/><path d="M10 5.2A9.6 9.6 0 0112 5c6.5 0 10 6 10 6a17 17 0 01-3 3.8M6.6 6.7A17 17 0 002 11s3.5 6 10 6c1 0 1.9-.1 2.7-.4"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
  unlock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.6-1.6"/>',
  pointer:'<path d="M5 3l14 8-6 1.5L10 19z"/>',
  grid:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>',
  copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h8"/>',
  filecode:'<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M10 12l-2 2 2 2M14 12l2 2-2 2"/>',
  chat:'<path d="M21 12a8 8 0 01-8 8H5l-2 2V12a8 8 0 018-8h2a8 8 0 018 8z"/>',
  shield:'<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  person:'<circle cx="12" cy="7" r="3"/><path d="M5 20a7 7 0 0114 0"/>',
  undo:'<path d="M4 12a8 8 0 0113.7-5.7L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 01-13.7 5.7L4 16"/><path d="M4 20v-4h4"/>',
  save:'<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  pause:'<path d="M9 5v14M15 5v14"/>',
  play:'<path d="M8 5l11 7-11 7z"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>'
};
B.I = function(name, size){ return '<svg viewBox="0 0 24 24" width="'+(size||16)+'" height="'+(size||16)+'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(B.ICONS[name]||'')+'</svg>'; };

/* ---------- 状态与挂载 ---------- */
B.state = { open:false, cat:null, feat:null, picked:null, toggles:{}, undo:[], pin:false };
B.HOST_ID = 'ba-toolbox-host';
var host = document.createElement('div');
host.id = B.HOST_ID;
host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:block;';
B.host = host;
var shadow = B.shadow = host.attachShadow({mode:'open'});
B.u.sq = function(s){ return shadow.querySelector(s); };
B.u.sqa = function(s){ return Array.prototype.slice.call(shadow.querySelectorAll(s)); };

/* ---------- 宿主挂载 + 自愈 ----------
   少数站点会整块换掉文档：document.open()/write()/close() 重写（如 Playcode 预览运行时每次
   推送内容都重写一遍）、或 React createRoot(document.body) 清空 body。前者除摘掉宿主外，还会
   按规范清空 document 及其（shadow 包含）后代与 window 上的**全部事件监听**——节点对象、
   Shadow DOM、样式与定时器都还在，只有监听没了，表现为「FAB 还在但点了没反应」。
   监听失效后没法靠事件自救，故用一个 1s 轮询兜底（定时器不受重写影响）：
   ① 宿主脱离文档 → 挂回当前 body（节点/Shadow 复用，面板开合状态与门控 display 原样保留）；
   ② 用一次自定义事件的同步往返自检监听是否还在 → 不在就重绑本模块监听并调 B.rebind()（boot.js 暴露）。 */
var healTimer = null, mounted = false, probeBack = false;
function onProbe(){ probeBack = true; }
function bindCore(){
  window.addEventListener('batb:probe', onProbe);
  window.addEventListener('batb:gate', onGate);
  window.addEventListener('load', mount);
  window.addEventListener('pageshow', mount);
  window.addEventListener('readystatechange', mount);
}
function mount(){
  if(!window.BATB) window.BATB = B; // 站点可能删掉注入后才加的 window 键，恢复免被扩展探测误判为未注入而重复注入
  if(!host.isConnected){
    var other = document.getElementById(B.HOST_ID);
    if(other && other !== host){ host.remove(); stopHeal(); return; } // 扩展重新注入了新实例，本实例让位
    var parent = document.body || document.documentElement;
    if(parent){
      parent.appendChild(host);
      if(mounted && B.dlog) B.dlog('mount', '宿主脱离文档，已重新挂载');
      mounted = true;
    }
  }
  probeBack = false;
  try{ window.dispatchEvent(new Event('batb:probe')); }catch(e){}
  if(!probeBack){ // 文档被重写：监听已清空 → 重绑（重绑前监听确实不存在，不会重复绑定）
    bindCore();
    if(B.rebind) B.rebind();
    if(mounted && B.dlog) B.dlog('rebind', '监听被文档重写清空，已重新绑定');
  }
}
function stopHeal(){ if(healTimer){ clearInterval(healTimer); healTimer = null; } }
bindCore();
mount();
healTimer = setInterval(mount, 1000);

/* ---------- Shadow 样式 ---------- */
var WCSS = `
*{box-sizing:border-box;margin:0;padding:0}
.fab,.panel,.pop,.pill-u,.toast,.coach,.rec-hud,.picker-ov,.picker-box,.picker-tip{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
/* FAB */
.fab{position:fixed;right:24px;bottom:24px;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;cursor:pointer;pointer-events:auto;color:#e5e7eb;background:linear-gradient(135deg,#1f2937,#0f172a);border:1px solid rgba(255,255,255,.16);box-shadow:0 10px 28px rgba(2,6,23,.45);transition:transform .18s ease,box-shadow .18s ease;z-index:10}
.fab:hover{transform:scale(1.07)}
.fab:active{transform:scale(.97)}
.fab.drag{transition:none;cursor:grabbing}
.fab.on{background:linear-gradient(135deg,#312e81,#1e1b4b);border-color:rgba(165,180,252,.5)}
.fab .ic{transition:transform .2s ease}
.fab.on .ic{transform:rotate(90deg)}
/* 录制 HUD（替代 FAB）：暂停 / 停止；录制期间三层弹窗与撤销条由 ui 隐藏 */
.rec-hud{position:fixed;right:24px;bottom:24px;display:none;align-items:center;gap:4px;padding:4px;border-radius:99px;background:rgba(15,23,42,.94);border:1px solid rgba(255,255,255,.16);box-shadow:0 10px 28px rgba(2,6,23,.45);backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);z-index:10;pointer-events:auto}
.rec-hud.show{display:flex}
.rec-hud .rh{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e5e7eb;cursor:pointer;transition:background .15s}
.rec-hud .rh:hover{background:rgba(255,255,255,.14)}
.rec-hud .rh-s{background:rgba(239,68,68,.92);border-color:rgba(239,68,68,.9);color:#fff}
.rec-hud .rh-s:hover{background:#dc2626}
/* 面板 */
.panel{position:fixed;width:212px;padding:13px;border-radius:18px;color:#e5e7eb;background:rgba(15,23,42,.92);border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 50px rgba(2,6,23,.5);backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);opacity:0;transform:scale(.9) translateY(10px);transform-origin:bottom right;pointer-events:none;transition:opacity .16s ease,transform .18s cubic-bezier(.2,.9,.3,1.2);z-index:20}
.panel.open{opacity:1;transform:none;pointer-events:auto}
.ph{display:flex;align-items:center;gap:8px;margin-bottom:11px}
.pt{display:flex;align-items:center;gap:5px;font-size:13px;font-weight:700;flex:none;white-space:nowrap}
.chip{flex:1 1 auto;min-width:0;font-size:10.5px;color:#86efac;background:rgba(34,197,94,.14);border:1px solid rgba(34,197,94,.3);border-radius:99px;padding:2px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ph .x{margin-left:auto;width:24px;height:24px;display:grid;place-items:center;border:none;background:rgba(255,255,255,.06);color:#9ca3af;border-radius:7px;cursor:pointer}
.ph .x:hover{background:rgba(255,255,255,.12);color:#fff}
.cats{display:grid;grid-template-columns:1fr;gap:6px}
.cat{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:12px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.03);color:#cbd5e1;cursor:pointer;text-align:left;transition:background .15s,border-color .15s,transform .15s}
.cat:hover,.cat.act{background:rgba(255,255,255,.08);border-color:var(--c);transform:translateY(-1px)}
.cat .ci{color:var(--c);display:grid;place-items:center}
.cat b{font-size:12.5px;color:#f1f5f9;font-weight:600}
.cat i{font-style:normal;font-size:10px;color:#64748b;background:rgba(255,255,255,.07);border-radius:99px;padding:1px 6px;margin-left:auto}
.cat.act i{color:var(--c)}
.pf{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:11px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);font-size:10.5px;color:#64748b}
kbd{font:10px ui-monospace,monospace;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.14);border-bottom-width:2px;border-radius:4px;padding:1px 4px;color:#cbd5e1}
.pf .link{border:none;background:none;color:#818cf8;font-size:10.5px;cursor:pointer;padding:0}
.pf .lang{margin-left:auto}
.pf .about{margin-left:6px}
.pf .link:hover{color:#a5b4fc;text-decoration:underline}
/* Popover */
.pop{position:fixed;width:332px;max-height:72vh;display:flex;flex-direction:column;border-radius:16px;color:#e5e7eb;background:rgba(15,23,42,.94);border:1px solid rgba(255,255,255,.12);box-shadow:0 22px 60px rgba(2,6,23,.55);backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);opacity:0;transform:translateX(10px);pointer-events:none;transition:opacity .14s ease,transform .16s ease;z-index:30;overflow:hidden}
.pop.open{opacity:1;transform:none;pointer-events:auto}
.pop::after{content:"";position:absolute;right:-6px;bottom:26px;width:12px;height:12px;background:inherit;border-right:1px solid rgba(255,255,255,.12);border-top:1px solid rgba(255,255,255,.12);transform:rotate(45deg);display:none}
.pop.arrow::after{display:block}
.pop.arrow.left::after{right:auto;left:-6px;border:none;border-left:1px solid rgba(255,255,255,.12);border-bottom:1px solid rgba(255,255,255,.12)}
.ph2{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex:none}
.ph2 .t{font-size:12.5px;font-weight:700;color:#f1f5f9}
.ph2 .s{font-size:10.5px;color:#64748b;margin-left:auto}
.ph2 .x{width:24px;height:24px;flex:none;display:grid;place-items:center;border:none;background:rgba(255,255,255,.06);color:#9ca3af;border-radius:7px;cursor:pointer}
.ph2 .x:hover{background:rgba(255,255,255,.12);color:#fff}
.body{overflow-y:auto;overscroll-behavior:contain;padding:8px}
.body::-webkit-scrollbar{width:8px}
.body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:8px}
/* 三级详情浮层（dpop）内部间距加大，避免内容拥挤 */
.dpop .body{padding:14px}
/* 功能行 */
.feat{display:flex;align-items:center;gap:9px;width:100%;padding:8px 9px;border:none;background:none;border-radius:10px;cursor:pointer;text-align:left;color:#cbd5e1}
.feat:hover{background:rgba(255,255,255,.07)}
.feat .fi{flex:none;width:26px;height:26px;display:grid;place-items:center;border-radius:8px;background:rgba(255,255,255,.06);color:#a5b4fc}
.feat .fm{flex:1;min-width:0;display:flex;flex-direction:column}
.feat b{font-size:12.5px;font-weight:600;color:#e5e7eb}
.feat s{text-decoration:none;font-size:10.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.feat .st{flex:none;font-size:9px;color:#fbbf24;letter-spacing:1px}
.feat .st.dim{color:#475569}
.adv{margin-top:6px;border-top:1px dashed rgba(255,255,255,.1);padding-top:6px}
.adv-h{display:flex;align-items:center;gap:5px;width:100%;border:none;background:none;color:#64748b;font-size:10.5px;cursor:pointer;padding:4px 6px;border-radius:7px}
.adv-h:hover{color:#94a3b8;background:rgba(255,255,255,.04)}
.adv-h svg{transition:transform .15s}
.adv.open .adv-h svg{transform:rotate(90deg)}
.adv-b{display:none}
.adv.open .adv-b{display:block}
.grp-h{font-size:10px;font-weight:600;color:#8296b3;padding:8px 9px 2px;letter-spacing:.3px}
.grp-h:first-child{padding-top:2px}
/* 三级详情浮层（与二级 Popover 错开，不占位列表）；.d 也用于关于页文案 */
.pop .d{font-size:11.5px;color:#94a3b8;line-height:1.65;margin-bottom:12px}
.pop .d b{color:#cbd5e1}
/* 结果组件 */
pre{background:rgba(2,6,23,.55);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:11px 13px;font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;color:#a5f3fc;overflow:auto;max-height:260px;white-space:pre;tab-size:2}
.kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:11.5px}
.kv dt{color:#64748b;white-space:nowrap}
.kv dd{color:#cbd5e1;word-break:break-all;margin:0}
.bdg{display:inline-block;font-size:10px;border-radius:99px;padding:1px 8px;font-weight:600}
.bdg.g{background:rgba(34,197,94,.16);color:#4ade80}
.bdg.y{background:rgba(245,158,11,.16);color:#fbbf24}
.bdg.r{background:rgba(239,68,68,.16);color:#f87171}
.bdg.b{background:rgba(99,102,241,.18);color:#a5b4fc}
.bdg.mock{background:rgba(148,163,184,.14);color:#94a3b8}
.btn2{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e5e7eb;border-radius:8px;padding:6px 14px;font-size:11.5px;cursor:pointer;transition:background .15s}
.btn2:hover{background:rgba(255,255,255,.12)}
.btn2.pri{background:#4f46e5;border-color:#4f46e5;color:#fff}
.btn2.pri:hover{background:#6366f1}
.btn2.warn{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.35);color:#fca5a5}
.row2{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.note{font-size:10.5px;color:#64748b;line-height:1.6;background:rgba(255,255,255,.03);border-left:2px solid #475569;border-radius:0 8px 8px 0;padding:9px 12px;margin-top:10px}
.lst{max-height:240px;overflow:auto;margin-top:8px}
.li{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;font-size:11.5px;color:#cbd5e1}
.li:hover{background:rgba(255,255,255,.06)}
.li .m{font:10px ui-monospace,monospace;color:#a5b4fc;background:rgba(99,102,241,.14);border-radius:5px;padding:1px 6px;flex:none}
.li .u{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#94a3b8;font-size:10.5px}
.li .c{flex:none;font-size:10px}
/* URL 拆解 tag：尾段 / 查询参数 / 锚点用低对比小标签，前缀超宽省略 */
.li .u.uh{display:flex;flex-wrap:wrap;align-items:center;gap:3px 4px;overflow:hidden;max-height:2.6em;white-space:normal}
.li .u.uh>.p{flex:0 1 auto;min-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tg{display:inline-block;font:9.5px ui-monospace,monospace;line-height:1.6;padding:0 4px;border-radius:4px;background:rgba(148,163,184,.10);color:#8494a8;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
.li .u.uh>.tg{flex:none;max-width:100%}
.tg.q{background:rgba(99,102,241,.10);color:#8f9ddc}
.tg.h{background:rgba(148,163,184,.07);color:#64748b}
.tgline .tg{margin:0 3px 2px 0}
.sep{flex:none;color:#64748b;font:9.5px ui-monospace,monospace;line-height:1.6}
.fld{display:flex;gap:8px;margin:8px 0}
.fld input{flex:1;background:rgba(2,6,23,.5);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px 11px;color:#e5e7eb;font-size:11.5px;outline:none}
.fld input:focus{border-color:#6366f1}
.fld textarea{width:100%;background:rgba(2,6,23,.5);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:7px 11px;color:#e5e7eb;font-size:11px;outline:none;resize:vertical}
.tabs{display:flex;gap:6px;margin-bottom:10px}
.tabs button{border:1px solid rgba(255,255,255,.1);background:none;color:#64748b;font-size:10.5px;border-radius:8px;padding:5px 13px;cursor:pointer}
.tabs button.on{color:#a5b4fc;border-color:rgba(99,102,241,.5);background:rgba(99,102,241,.1)}
.mock-tag{font-size:9.5px;color:#fbbf24;background:rgba(245,158,11,.12);border-radius:4px;padding:1px 5px;margin-left:6px;vertical-align:1px}
/* 设置面板 */
.set-row{display:flex;align-items:center;gap:8px;padding:8px 9px;border-bottom:1px solid rgba(255,255,255,.06);font-size:11.5px;color:#cbd5e1}
.set-row .sl{flex:1;min-width:0}
.set-row .sl b{display:block;font-size:12px;color:#e5e7eb;font-weight:600}
.set-row .sl s{text-decoration:none;font-size:10.5px;color:#64748b}
.seg{display:flex;gap:3px;flex:none}
.seg button{border:1px solid rgba(255,255,255,.12);background:none;color:#94a3b8;font-size:10.5px;border-radius:7px;padding:3px 9px;cursor:pointer}
.seg button.on{color:#a5b4fc;border-color:rgba(99,102,241,.5);background:rgba(99,102,241,.12)}
.sw{position:relative;width:38px;height:20px;border-radius:99px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);cursor:pointer;flex:none;transition:background .15s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#94a3b8;transition:transform .15s,background .15s}
.sw.on{background:rgba(79,70,229,.5);border-color:rgba(99,102,241,.6)}
.sw.on::after{transform:translateX(18px);background:#c7d2fe}
.set-row.hk{border-bottom:none;padding-bottom:3px}
.hk-edit{display:flex;align-items:center;flex-wrap:wrap;gap:5px;padding:0 9px 9px;border-bottom:1px solid rgba(255,255,255,.06)}
.hk-cb{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.18);color:#94a3b8;font-size:10.5px;cursor:pointer;user-select:none;transition:border-color .15s,background .15s,color .15s}
.hk-cb input{display:none}
.hk-cb::before{content:"";flex:none;width:10px;height:10px;border-radius:3px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.04);box-sizing:border-box}
.hk-cb.on{border-color:#818cf8;color:#e0e7ff;background:rgba(99,102,241,.25)}
.hk-cb.on::before{content:"✓";text-align:center;line-height:10px;font-size:9px;font-weight:700;border-color:#818cf8;background:#4f46e5;color:#fff}
.hk-key{width:34px;height:22px;text-align:center;font-size:12px;font-weight:600;color:#e5e7eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:7px;outline:none;font-family:ui-monospace,monospace}
.hk-key:focus{border-color:rgba(99,102,241,.6)}
.rec-list{margin-top:6px}
.rec-item{padding:7px 8px;border-radius:9px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);margin-bottom:6px}
.rec-item .rh{display:flex;align-items:center;gap:6px}
.rec-item .rh b{font-size:11px;color:#e5e7eb;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rec-item .rh time{font-size:10px;color:#64748b;flex:none}
.rec-item p{font-size:10.5px;color:#94a3b8;line-height:1.5;margin:4px 0 0;font-family:ui-monospace,monospace;max-height:3em;overflow:hidden;white-space:pre-wrap;word-break:break-all}
.rec-item button{border:none;background:rgba(255,255,255,.08);color:#cbd5e1;border-radius:6px;padding:2px 8px;font-size:10px;cursor:pointer;flex:none}
.rec-item button:hover{background:rgba(255,255,255,.16)}
/* 撤销栈 / toast / 引导 */
.pill-u{position:fixed;display:none;align-items:center;gap:8px;background:rgba(15,23,42,.94);border:1px solid rgba(255,255,255,.12);border-radius:99px;padding:6px 8px 6px 13px;font-size:11px;color:#cbd5e1;box-shadow:0 10px 26px rgba(2,6,23,.4);z-index:25;pointer-events:auto}
.pill-u.show{display:flex}
.pill-u button{border:none;background:rgba(255,255,255,.08);color:#e5e7eb;border-radius:99px;padding:3px 10px;font-size:10.5px;cursor:pointer}
.pill-u button:hover{background:rgba(255,255,255,.16)}
.toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,10px);background:rgba(15,23,42,.95);border:1px solid rgba(255,255,255,.14);color:#e5e7eb;font-size:12px;border-radius:10px;padding:8px 14px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:60;box-shadow:0 10px 30px rgba(2,6,23,.5)}
.toast.show{opacity:1;transform:translate(-50%,0)}
.coach{position:fixed;right:calc(100% + 12px);top:50%;transform:translateY(-50%);white-space:nowrap;background:#111827;color:#e5e7eb;font-size:11.5px;border-radius:9px;padding:7px 11px;box-shadow:0 8px 22px rgba(2,6,23,.4);pointer-events:none;z-index:15;opacity:.96}
.coach::after{content:"";position:absolute;right:-5px;top:50%;margin-top:-5px;width:10px;height:10px;background:#111827;transform:rotate(45deg)}
.coach.hide{display:none}
/* 拾取器 */
.pick-hide{display:none!important} /* 拾取期间临时隐藏工具箱 UI（FAB/面板/列表/详情/撤销栈） */
.picker-ov{position:fixed;inset:0;z-index:50;background:rgba(2,6,23,.18);pointer-events:none}
.picker-box{position:fixed;z-index:2147483601;border:1.5px solid #f59e0b;background:rgba(245,158,11,.14);border-radius:3px;pointer-events:none;display:none;box-shadow:0 0 0 9999px rgba(2,6,23,.06)}
.picker-tip{position:fixed;z-index:2147483602;background:#0f172a;color:#fbbf24;font:11px ui-monospace,monospace;border:1px solid rgba(245,158,11,.4);border-radius:7px;padding:4px 9px;pointer-events:none;display:none;max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (prefers-reduced-motion:reduce){.fab,.panel,.pop,.toast,.cat{transition:none!important}}
`;
var styleEl = document.createElement('style');
styleEl.textContent = WCSS;
shadow.appendChild(styleEl);

/* 注入到页面的样式（元素描边/停用动画/变更闪烁/恢复可选） */
B.style = {
  pageStyle: function(id, css){ var s = document.getElementById(id); if(css){ if(s) return; s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s); } else if(s) s.remove(); },
  STYLE: {
    outline:'[data-ba-ol]{outline:1px dashed rgba(245,158,11,.85)!important;outline-offset:-1px}',
    noanim:'*,*::before,*::after{transition:none!important;animation:none!important}',
    flash:'[data-ba-flash]{animation:baflash .9s ease 2}@keyframes baflash{0%,100%{outline:none}50%{outline:2px solid rgba(239,68,68,.9);outline-offset:1px}}',
    sel:'*{user-select:text!important;-webkit-user-select:text!important}'
  }
};

/* ---------- 诊断日志：环形写入 localStorage["ba:diaglog"]（按站点），供用户 copy 后反馈 ---------- */
B.dlog = function(tag, msg){
  try{
    var k = 'ba:diaglog', arr = JSON.parse(localStorage.getItem(k) || '[]');
    arr.push('[' + new Date().toISOString().slice(11, 23) + '] ' + tag + ': ' + msg);
    if(arr.length > 60) arr = arr.slice(-60);
    localStorage.setItem(k, JSON.stringify(arr));
  }catch(e){}
};

B.FEATS = [];
B.register = function(feats){ Array.prototype.push.apply(B.FEATS, feats); };

/* ---------- 白名单门控：注册在 bindCore() 里，文档被重写清空监听后由 mount() 重新注册
   （原型演示页 demo.js 的 d-wl 是直接改 host 的 display，此监听与扩展版行为一致） ---------- */
function onGate(ev){
  var allowed = !!(ev.detail && ev.detail.allowed);
  host.style.display = allowed ? 'block' : 'none';
  if(!allowed && B.ui && B.ui.closePanel) B.ui.closePanel();
}
})();
