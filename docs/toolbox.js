/* 工具箱原型 —— FAB → 分类面板 → Popover 列表 → 详情浮层（dpop）。
   全部 DOM 挂在 #ba-toolbox-host 的 Shadow Root 里，与页面样式隔离。
   文件结构：① Shadow 样式 WCSS ② 基础设施 ③ 功能注册表 FEATS ④ 关于页与事件绑定。
   落扩展时改造点：chrome.storage 记位置 / 白名单门控 / 经 background 转发命令 */

(function(){
'use strict';
/* ============================================================
 * 工具箱原型：FAB → 分类面板 → hover Popover → 功能详情
 * 最终进扩展时的对应改造：Shadow DOM（已按此结构写）/
 * chrome.storage 记位置 / 白名单门控 / 经 background 转发命令
 * ============================================================ */

/* ---------- 基础工具 ---------- */
var $ = function(s, r){ return (r||document).querySelector(s); };
var $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };
function sq(s){ return shadow.querySelector(s); }        // Shadow DOM 内查询
function sqa(s){ return Array.prototype.slice.call(shadow.querySelectorAll(s)); }
function el(tag, cls, html){ var n = document.createElement(tag); if(cls) n.className = cls; if(html != null) n.innerHTML = html; return n; }
function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function copyText(t){ if(navigator.clipboard) return navigator.clipboard.writeText(t); var t2 = el('textarea'); t2.value = t; document.body.appendChild(t2); t2.select(); document.execCommand('copy'); t2.remove(); return Promise.resolve(); }

/* ---------- 图标 ---------- */
var ICONS = {
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
  undo:'<path d="M4 12a8 8 0 0113.7-5.7L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 01-13.7 5.7L4 16"/><path d="M4 20v-4h4"/>'
};
function I(name, size){ return '<svg viewBox="0 0 24 24" width="'+(size||16)+'" height="'+(size||16)+'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(ICONS[name]||'')+'</svg>'; }

/* ---------- 状态 ---------- */
var state = { open:false, cat:null, feat:null, picked:null, toggles:{}, undo:[], pin:false };
var HOST_ID = 'ba-toolbox-host';
var host = document.createElement('div');
host.id = HOST_ID;
host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:block;';
document.body.appendChild(host);
var shadow = host.attachShadow({mode:'open'});

/* ---------- Shadow 样式 ---------- */
var WCSS = `
*{box-sizing:border-box;margin:0;padding:0}
.fab,.panel,.pop,.pill-u,.toast,.coach,.picker-ov,.picker-box,.picker-tip{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
/* FAB */
.fab{position:fixed;right:24px;bottom:24px;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;cursor:pointer;pointer-events:auto;color:#e5e7eb;background:linear-gradient(135deg,#1f2937,#0f172a);border:1px solid rgba(255,255,255,.16);box-shadow:0 10px 28px rgba(2,6,23,.45);transition:transform .18s ease,box-shadow .18s ease;z-index:10}
.fab:hover{transform:scale(1.07)}
.fab:active{transform:scale(.97)}
.fab.drag{transition:none;cursor:grabbing}
.fab.on{background:linear-gradient(135deg,#312e81,#1e1b4b);border-color:rgba(165,180,252,.5)}
.fab .ic{transition:transform .2s ease}
.fab.on .ic{transform:rotate(90deg)}
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
.pf{display:flex;align-items:center;gap:6px;margin-top:11px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);font-size:10.5px;color:#64748b}
kbd{font:10px ui-monospace,monospace;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.14);border-bottom-width:2px;border-radius:4px;padding:1px 4px;color:#cbd5e1}
.pf .link{margin-left:auto;border:none;background:none;color:#818cf8;font-size:10.5px;cursor:pointer;padding:0}
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
.pop .d{font-size:11.5px;color:#94a3b8;line-height:1.65;margin-bottom:10px}
.pop .d b{color:#cbd5e1}
/* 结果组件 */
pre{background:rgba(2,6,23,.55);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:9px 10px;font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;color:#a5f3fc;overflow:auto;max-height:210px;white-space:pre;tab-size:2}
.kv{display:grid;grid-template-columns:auto 1fr;gap:5px 12px;font-size:11.5px}
.kv dt{color:#64748b;white-space:nowrap}
.kv dd{color:#cbd5e1;word-break:break-all;margin:0}
.bdg{display:inline-block;font-size:10px;border-radius:99px;padding:1px 8px;font-weight:600}
.bdg.g{background:rgba(34,197,94,.16);color:#4ade80}
.bdg.y{background:rgba(245,158,11,.16);color:#fbbf24}
.bdg.r{background:rgba(239,68,68,.16);color:#f87171}
.bdg.b{background:rgba(99,102,241,.18);color:#a5b4fc}
.bdg.mock{background:rgba(148,163,184,.14);color:#94a3b8}
.btn2{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e5e7eb;border-radius:8px;padding:5px 11px;font-size:11.5px;cursor:pointer;transition:background .15s}
.btn2:hover{background:rgba(255,255,255,.12)}
.btn2.pri{background:#4f46e5;border-color:#4f46e5;color:#fff}
.btn2.pri:hover{background:#6366f1}
.btn2.warn{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.35);color:#fca5a5}
.row2{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}
.note{font-size:10.5px;color:#64748b;line-height:1.6;background:rgba(255,255,255,.03);border-left:2px solid #475569;border-radius:0 8px 8px 0;padding:7px 10px;margin-top:8px}
.lst{max-height:220px;overflow:auto;margin-top:6px}
.li{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;font-size:11.5px;color:#cbd5e1}
.li:hover{background:rgba(255,255,255,.06)}
.li .m{font:10px ui-monospace,monospace;color:#a5b4fc;background:rgba(99,102,241,.14);border-radius:5px;padding:1px 6px;flex:none}
.li .u{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#94a3b8;font-size:10.5px}
.li .c{flex:none;font-size:10px}
.fld{display:flex;gap:6px;margin:6px 0}
.fld input{flex:1;background:rgba(2,6,23,.5);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:5px 9px;color:#e5e7eb;font-size:11.5px;outline:none}
.fld input:focus{border-color:#6366f1}
.fld textarea{width:100%;background:rgba(2,6,23,.5);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px 9px;color:#e5e7eb;font-size:11px;outline:none;resize:vertical}
.tabs{display:flex;gap:4px;margin-bottom:6px}
.tabs button{border:1px solid rgba(255,255,255,.1);background:none;color:#64748b;font-size:10.5px;border-radius:7px;padding:3px 9px;cursor:pointer}
.tabs button.on{color:#a5b4fc;border-color:rgba(99,102,241,.5);background:rgba(99,102,241,.1)}
.mock-tag{font-size:9.5px;color:#fbbf24;background:rgba(245,158,11,.12);border-radius:4px;padding:1px 5px;margin-left:6px;vertical-align:1px}
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
.picker-ov{position:fixed;inset:0;z-index:50;cursor:crosshair;background:rgba(2,6,23,.18)}
.picker-box{position:fixed;z-index:51;border:1.5px solid #f59e0b;background:rgba(245,158,11,.14);border-radius:3px;pointer-events:none;display:none;box-shadow:0 0 0 9999px rgba(2,6,23,.06)}
.picker-tip{position:fixed;z-index:52;background:#0f172a;color:#fbbf24;font:11px ui-monospace,monospace;border:1px solid rgba(245,158,11,.4);border-radius:7px;padding:4px 9px;pointer-events:none;display:none;max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (prefers-reduced-motion:reduce){.fab,.panel,.pop,.toast,.cat{transition:none!important}}
`;
var styleEl = document.createElement('style');
styleEl.textContent = WCSS;
shadow.appendChild(styleEl);

/* 注入到页面的样式（元素描边/停用动画/变更闪烁/恢复可选） */
function pageStyle(id, css){ var s = document.getElementById(id); if(css){ if(s) return; s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s); } else if(s) s.remove(); }
var STYLE = {
  outline:'[data-ba-ol]{outline:1px dashed rgba(245,158,11,.85)!important;outline-offset:-1px}',
  noanim:'*,*::before,*::after{transition:none!important;animation:none!important}',
  flash:'[data-ba-flash]{animation:baflash .9s ease 2}@keyframes baflash{0%,100%{outline:none}50%{outline:2px solid rgba(239,68,68,.9);outline-offset:1px}}',
  sel:'*{user-select:text!important;-webkit-user-select:text!important}'
};

/* ---------- 面板 / Popover DOM ---------- */
var CATS = [
  { id:'info',  name:'提示',       icon:'info',    color:'#3b82f6', desc:'这个页面到底是什么' },
  { id:'find',  name:'查找',       icon:'search',  color:'#f59e0b', desc:'找到那个该死的元素' },
  { id:'style', name:'样式与屏蔽', icon:'sliders', color:'#10b981', desc:'看清被挡住的东西' },
  { id:'llm',   name:'发给 LLM',   icon:'bot',     color:'#8b5cf6', desc:'复制粘贴 · 或存入变量让 LLM 自取', groups:[
      { id:'copy',  name:'复制 · 人工粘贴给 LLM' },
      { id:'store', name:'存储 · 写入浏览器变量，LLM 自取' }
  ]},
  { id:'build', name:'开发产物',   icon:'filecode',color:'#ec4899', desc:'能跑起来的脚本 / 指令' }
];

var fab = el('div', 'fab');
fab.setAttribute('role', 'button'); fab.setAttribute('tabindex', '0'); fab.setAttribute('aria-label', '打开工具箱');
fab.innerHTML = '<span class="ic">' + I('toolbox', 21) + '</span>';
shadow.appendChild(fab);

var panel = el('div', 'panel');
panel.innerHTML =
  '<div class="ph"><span class="pt">' + I('toolbox', 14) + ' 工具箱</span>' +
  '<span class="chip" id="wl-chip">白名单 · ' + (location.hostname || 'example.com') + '</span>' +
  '<button class="x" id="p-close" title="收起">' + I('close', 13) + '</button></div>' +
  '<div class="cats">' + CATS.map(function(c){
    return '<button class="cat" data-c="' + c.id + '" style="--c:' + c.color + '">' +
      '<span class="ci">' + I(c.icon, 17) + '</span><b>' + c.name + '</b><i data-c="' + c.id + '">·</i></button>';
  }).join('') + '</div>' +
  '<div class="pf"><span><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> 唤起</span>' +
  '<button class="link" id="p-about">关于原型</button></div>';
shadow.appendChild(panel);
function countOf(cid){ return FEATS.filter(function(f){ return f.cat === cid && !f.adv; }).length; }

var pop = el('div', 'pop');
pop.innerHTML =
  '<div class="ph2"><span class="t" id="pop-title"></span><span class="s" id="pop-sub"></span></div>' +
  '<div class="body" id="pop-body"><div class="plist" id="pop-list"></div></div>';
shadow.appendChild(pop);

/* 三级详情浮层：显示在二级 Popover 侧面（错开），列表保持可见可点 */
var dpop = el('div', 'pop dpop');
dpop.innerHTML =
  '<div class="ph2"><span class="t" id="dpop-title"></span><span class="s" id="dpop-sub"></span>' +
  '<button class="x" id="dpop-x" title="关闭">' + I('close', 13) + '</button></div>' +
  '<div class="body" id="dpop-body"><div class="d" id="dpop-desc"></div><div id="dt-body"></div></div>';
shadow.appendChild(dpop);

var undoPill = el('div', 'pill-u');
undoPill.innerHTML = '<span>已改动 <b id="undo-n">0</b> 处</span><button id="undo-one">' + I('undo', 11) + ' 撤销</button><button id="undo-all">全部恢复</button>';
shadow.appendChild(undoPill);

var toastEl = el('div', 'toast');
shadow.appendChild(toastEl);

if(!localStorage.getItem('ba-tbx-seen')){
  var coach = el('div', 'coach', '点我打开工具箱 · 可拖拽移位');
  fab.appendChild(coach);
  setTimeout(function(){ coach.classList.add('hide'); }, 6000);
}

/* ---------- 布局 ---------- */
function layout(){
  var f = fab.getBoundingClientRect();
  panel.style.left = clamp(f.left + f.width/2 - panel.offsetWidth/2, 8, innerWidth - panel.offsetWidth - 8) + 'px';
  panel.style.top = clamp(f.top - 12 - panel.offsetHeight, 8, innerHeight - 12) + 'px';
  if(pop.classList.contains('open')) layoutPop();
}
function layoutPop(){
  var p = panel.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  var left = p.left - w - 10;
  var flip = left < 8;
  if(flip) left = Math.min(p.right + 10, innerWidth - w - 8);
  pop.classList.toggle('arrow', true);
  pop.classList.toggle('left', flip);
  pop.style.left = clamp(left, 8, innerWidth - w - 8) + 'px';
  pop.style.top = clamp(p.bottom - h, 8, innerHeight - h - 8) + 'px';
  undoPill.style.left = clamp(p.left, 8, innerWidth - 200) + 'px';
  undoPill.style.top = clamp(p.top - 40, 8, innerHeight - 40) + 'px';
  if(dpop.classList.contains('open')) layoutDpop();
}
/* 三级详情浮层：贴在二级 Popover 侧面（左侧优先，空间不足翻到右侧），顶边对齐 */
function layoutDpop(){
  var p = pop.getBoundingClientRect(), w = dpop.offsetWidth, h = dpop.offsetHeight;
  var left = p.left - w - 10, flip = left < 8;
  if(flip) left = Math.min(p.right + 10, innerWidth - w - 8);
  dpop.style.left = clamp(left, 8, innerWidth - w - 8) + 'px';
  dpop.style.top = clamp(p.top, 8, innerHeight - h - 8) + 'px';
}
/* 内容变化（详情渲染/轮询更新/折叠展开）后重算位置，避免弹窗按旧高度定位而溢出屏幕 */
if(window.ResizeObserver){
  var _ro = new ResizeObserver(function(){ if(pop.classList.contains('open')) layoutPop(); });
  _ro.observe(pop); _ro.observe(dpop);
}

/* ---------- 开合 ---------- */
function openPanel(){
  state.open = true;
  panel.classList.add('open'); fab.classList.add('on');
  refreshUndo();
  layout();
}
function closePanel(){
  state.open = false; state.cat = null; state.feat = null; state.pin = false;
  panel.classList.remove('open'); fab.classList.remove('on');
  pop.classList.remove('open');
  dpop.classList.remove('open');
  undoPill.classList.remove('show');
  clearDetail();
}
function togglePanel(){ state.open ? closePanel() : openPanel(); }

/* ---------- Popover ---------- */
var hoverTimer = null;
function openPop(catId, pin){
  clearTimeout(hoverTimer);
  closeDetail();
  state.cat = catId;
  renderList(catId);
  pop.classList.add('open');
  state.pin = !!pin;
  layoutPop();
}
function closePop(){ pop.classList.remove('open'); closeDetail(); state.cat = null; state.pin = false; }
function scheduleClose(){ if(state.pin) return; clearTimeout(hoverTimer); hoverTimer = setTimeout(closePop, 240); }

function featRows(items){
  var main = items.filter(function(f){ return !f.adv; });
  var adv  = items.filter(function(f){ return f.adv; });
  return main.map(featRow).join('') +
    (adv.length ? '<div class="adv"><button class="adv-h">' + I('chevron', 11) + ' 高级功能（' + adv.length + '）</button><div class="adv-b">' + adv.map(featRow).join('') + '</div></div>' : '');
}
function renderList(catId){
  var c = CATS.filter(function(x){ return x.id === catId; })[0];
  sq('#pop-title').textContent = c.name;
  sq('#pop-sub').textContent = c.desc;
  var list = sq('#pop-list');
  var html;
  if(c.groups && c.groups.length){
    html = c.groups.map(function(g){
      var items = FEATS.filter(function(f){ return f.cat === catId && f.grp === g.id; });
      return items.length ? '<div class="grp-h">' + esc(g.name) + '</div>' + featRows(items) : '';
    }).join('');
  } else {
    html = featRows(FEATS.filter(function(f){ return f.cat === catId; }));
  }
  list.innerHTML = html;
  $$('.feat', list).forEach(function(b){ b.onclick = function(){ openDetail(FEATS_BY_ID[b.dataset.f]); }; });
  $$('.adv-h', list).forEach(function(h){ h.onclick = function(){ h.parentNode.classList.toggle('open'); layoutPop(); }; });
  $$('.cat', panel).forEach(function(b){ b.classList.toggle('act', b.dataset.c === catId); });
}
function featRow(f){
  return '<button class="feat" data-f="' + f.id + '"><span class="fi">' + I(f.icon, 14) + '</span>' +
    '<span class="fm"><b>' + f.name + '</b><s>' + f.desc + '</s></span>' +
    '<span class="st' + (f.star < 3 ? ' dim' : '') + '">' + '★'.repeat(f.star) + '</span></button>';
}

/* ---------- 详情 ---------- */
var detailTimer = null, cleanups = [];
function clearDetail(){
  clearInterval(detailTimer); detailTimer = null;
  cleanups.forEach(function(fn){ try{ fn(); }catch(e){} });
  cleanups = [];
  if(state.flashObs){ state.flashObs.disconnect(); state.flashObs = null; state.toggles.flash = false; pageStyle('ba-flash', null); }
  if(state.selHandler){ window.removeEventListener('contextmenu', state.selHandler, true); state.selHandler = null; state.toggles.sel = false; pageStyle('ba-sel', null); }
}
function openDetail(f){
  clearDetail();
  state.feat = f;
  state.pin = true;
  sq('#dpop-title').textContent = f.name;
  sq('#dpop-sub').textContent = f.mock ? '演示数据' : '';
  sq('#dpop-desc').innerHTML = f.desc;
  var b = sq('#dpop-body');
  b.scrollTop = 0;
  dpop.classList.add('open');
  layoutDpop();
  try{ Promise.resolve(f.run($('#dt-body', b))).catch(function(e){ toast('执行出错：' + e.message); }); }catch(e){ toast('执行出错：' + e.message); }
}
function closeDetail(){
  clearDetail();
  dpop.classList.remove('open');
  state.feat = null;
}
sq('#dpop-x').onclick = closeDetail;

/* ---------- 结果组件 ---------- */
function codeBox(code, maxH){
  var box = el('div');
  box.style.position = 'relative';
  var pre = el('pre'); pre.textContent = code; if(maxH) pre.style.maxHeight = maxH + 'px';
  var cp = el('button', 'btn2', I('copy', 11) + ' 复制');
  cp.style.cssText = 'position:absolute;top:6px;right:6px;padding:2px 8px;font-size:10px';
  cp.onclick = function(){ copyText(code).then(function(){ toast('已复制到剪贴板'); }); };
  box.appendChild(pre); box.appendChild(cp);
  return box;
}
function kv(rows){
  var d = el('dl', 'kv');
  rows.forEach(function(r){ var dt = el('dt'); dt.textContent = r[0]; var dd = el('dd'); dd.innerHTML = r[1]; d.appendChild(dt); d.appendChild(dd); });
  return d;
}
function note(t){ return el('div', 'note', t); }
function btn(label, fn, cls){ var b = el('button', 'btn2 ' + (cls || ''), label); b.onclick = fn; return b; }
function badge(t, k){ return '<span class="bdg ' + (k || 'b') + '">' + t + '</span>'; }
function scoreBadge(s){ return badge(s.score + ' 分', s.score >= 80 ? 'g' : s.score >= 50 ? 'y' : 'r') + ' <span style="font-size:10.5px;color:#64748b">' + s.why + '</span>'; }
function toast(msg){
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastEl._t); toastEl._t = setTimeout(function(){ toastEl.classList.remove('show'); }, 1900);
}

/* ---------- 撤销栈 ---------- */
function pushUndo(op){ state.undo.push(op); refreshUndo(); }
function refreshUndo(){ undoPill.classList.toggle('show', state.undo.length > 0); sq('#undo-n').textContent = state.undo.length; }
sq('#undo-one').onclick = function(){ var op = state.undo.pop(); if(op) op.restore(); refreshUndo(); toast('已撤销一步'); };
sq('#undo-all').onclick = function(){ while(state.undo.length) state.undo.pop().restore(); refreshUndo(); toast('已全部恢复'); };

/* ---------- 选择器 ---------- */
function cssPath(node){
  var path = [];
  while(node && node.nodeType === 1 && path.length < 5){
    var sel = node.tagName.toLowerCase();
    if(node.id){ path.unshift('#' + CSS.escape(node.id)); break; }
    var cls = Array.prototype.filter.call(node.classList, function(c){ return !/^[0-9]/.test(c); }).slice(0, 2);
    if(cls.length) sel += '.' + cls.map(CSS.escape).join('.');
    var parent = node.parentElement;
    if(parent){
      var same = Array.prototype.filter.call(parent.children, function(c){ return c.tagName === node.tagName; });
      if(same.length > 1) sel += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
    }
    path.unshift(sel);
    node = parent;
  }
  return path.join(' > ');
}
function bestSelector(node){
  if(!node || node.nodeType !== 1) return '';
  if(node.id) return '#' + CSS.escape(node.id);
  var attrs = ['data-testid', 'data-test', 'data-cy'];
  for(var i = 0; i < attrs.length; i++){ var v = node.getAttribute(attrs[i]); if(v) return '[' + attrs[i] + '="' + v + '"]'; }
  var al = node.getAttribute('aria-label'); if(al) return '[aria-label="' + al + '"]';
  var nm = node.getAttribute('name');
  if(nm && /^(input|select|textarea|button|form)$/i.test(node.tagName)) return node.tagName.toLowerCase() + '[name="' + nm + '"]';
  return cssPath(node);
}
var SCORE_RULES = [
  [/^\[data-test(id|-test|-cy)/, 100, '测试 ID，最稳'],
  [/^#[a-zA-Z][\w-]{2,}$/, 90, '语义化 id'],
  [/^\[aria-label=/, 85, '无障碍属性'],
  [/^\[name=/, 80, '表单 name'],
  [/^\.[a-zA-Z][\w-]*$/, 50, '单类名，可能重复'],
  [/nth-child|nth-of-type/, 15, '位置依赖，改版必炸'],
  [/^#[\d.]+$|^\._[\w-]+$/, 5, '自动生成，勿用']
];
function scoreSelector(sel){
  for(var i = 0; i < SCORE_RULES.length; i++) if(SCORE_RULES[i][0].test(sel)) return { score: SCORE_RULES[i][1], why: SCORE_RULES[i][2] };
  return { score: 40, why: '复合选择器' };
}
function xpathOf(node){
  var parts = [];
  while(node && node.nodeType === 1){
    var i = 1, sib = node.previousElementSibling;
    while(sib){ if(sib.tagName === node.tagName) i++; sib = sib.previousElementSibling; }
    parts.unshift(node.tagName.toLowerCase() + '[' + i + ']');
    node = node.parentElement;
  }
  return '/' + parts.join('/');
}

/* ---------- 拾取器 ---------- */
function pick(){
  return new Promise(function(res){
    var ov = el('div', 'picker-ov'), box = el('div', 'picker-box'), tip = el('div', 'picker-tip');
    shadow.appendChild(ov); shadow.appendChild(box); shadow.appendChild(tip);
    var cur = null;
    function cleanup(){ ov.remove(); box.remove(); tip.remove(); window.removeEventListener('keydown', onKey, true); }
    function onMove(e){
      var t = document.elementFromPoint(e.clientX, e.clientY);
      if(!t || t === host || host.contains(t)){ box.style.display = 'none'; tip.style.display = 'none'; cur = null; return; }
      cur = t;
      var r = t.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
      box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
      tip.style.display = 'block';
      tip.textContent = t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + ' · ' + bestSelector(t).slice(0, 60);
      tip.style.left = clamp(e.clientX + 12, 8, innerWidth - 260) + 'px';
      tip.style.top = (e.clientY + 18) + 'px';
    }
    function onClick(e){ e.preventDefault(); e.stopPropagation(); if(cur){ cleanup(); res(cur); } }
    function onKey(e){ if(e.key === 'Escape'){ cleanup(); res(null); } }
    window.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousemove', onMove);
    ov.addEventListener('click', onClick);
  });
}
function ensurePicked(){
  if(state.picked && state.picked.isConnected) return Promise.resolve(state.picked);
  toast('请在页面上拾取一个元素（Esc 取消）');
  return pick().then(function(e){ if(!e) return null; state.picked = e; return e; });
}
/* ---------- 网络拦截（接口清单） ---------- */
var NET = [
  { m:'GET', u:'/api/user/profile', s:200, ms:86, seed:true },
  { m:'GET', u:'/api/dashboard/stats', s:200, ms:143, seed:true }
];
(function(){
  var of = window.fetch;
  window.fetch = function(){
    var u = (typeof arguments[0] === 'string' ? arguments[0] : arguments[0] && arguments[0].url) || '';
    var m = (arguments[1] && arguments[1].method) || 'GET';
    var t0 = performance.now();
    return of.apply(this, arguments).then(function(r){ NET.push({ m:m, u:u, s:r.status, ms:Math.round(performance.now()-t0) }); return r; },
      function(e){ NET.push({ m:m, u:u, s:'ERR', ms:Math.round(performance.now()-t0) }); throw e; });
  };
})();

/* ---------- 功能实现 ---------- */
function detectStack(){
  var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  var any = document.querySelector('*');
  var v3 = any && any.__vueParentComponent, v2 = $$('*').filter(function(e){ return e.__vue__; })[0];
  return {
    React:  !!(hook || document.querySelector('[data-reactroot],#root>div')),
    Vue3:   !!(v3 || window.__VUE__),
    Vue2:   !!(v2 || window.Vue),
    Angular:!!document.querySelector('[ng-version]'),
    Next:   !!window.__NEXT_DATA__,
    Nuxt:   !!window.__NUXT__,
    Svelte: !!document.querySelector('[class*="svelte-"]'),
    jQuery: !!(window.jQuery && window.jQuery.fn && window.jQuery.fn.jquery)
  };
}
var REDACT = [
  [/\b1[3-9]\d{9}\b/g, '[PHONE]'],
  [/\b\d{17}[\dXx]\b/g, '[ID]'],
  [/\b[\w.-]+@[\w.-]+\.\w+\b/g, '[EMAIL]'],
  [/\b(sk|ghp|xoxb)-[\w-]{10,}/g, '[TOKEN]'],
  [/\beyJ[\w-]{10,}\.[\w-]+/g, '[JWT]']
];
function redact(t){ return REDACT.reduce(function(s, r){ return s.replace(r[0], r[1]); }, t); }
function skeleton(root){
  var clone = root.cloneNode(true);
  $$('script,style,svg,path,noscript', clone).forEach(function(n){ n.remove(); });
  $$('*', clone).forEach(function(n){
    Array.prototype.slice.call(n.attributes).forEach(function(a){
      if(!/^(id|class|href|src|name|type|value|placeholder|aria-label|data-(testid|test|cy|id))/i.test(a.name)) n.removeAttribute(a.name);
    });
  });
  return clone.innerHTML;
}
function maxDepth(root){
  var d = 0;
  (function w(n, l){ d = Math.max(d, l); for(var i = 0; i < n.children.length; i++) w(n.children[i], l + 1); })(root, 1);
  return d;
}
function flashEl(e){ e.setAttribute('data-ba-flash', '1'); setTimeout(function(){ e.removeAttribute('data-ba-flash'); }, 1900); }

/* ---------- 功能注册表 ---------- */
var FEATS = [
/* ===== 提示 ===== */
{ id:'stack', cat:'info', name:'技术栈指纹', icon:'gauge', star:3, desc:'识别 React / Vue / Angular 及 Next、Nuxt 等元框架',
  run:function(b){
    var s = detectStack(), hits = Object.keys(s).filter(function(k){ return s[k]; });
    b.appendChild(kv(hits.length
      ? [['检出框架', hits.map(function(h){ return badge(h, 'g'); }).join(' ')],
         ['判定依据', hits.join('、') + ' 的全局钩子 / 标记属性'],
         ['jQuery', window.jQuery ? 'v' + window.jQuery.fn.jquery : '—']]
      : [['检出框架', badge('纯静态页面', 'y')], ['说明', '未发现主流框架的全局钩子或标记属性']]));
    b.appendChild(note('检测依据：__REACT_DEVTOOLS_GLOBAL_HOOK__ / data-reactroot / __vue__ / [ng-version] / __NEXT_DATA__ / __NUXT__ / svelte- 类名 / jQuery。原型页在 <main> 上打了 data-reactroot 标记，故检出 React。'));
  }},
{ id:'env', cat:'info', name:'环境判定', icon:'globe', star:2, desc:'dev / staging / prod 判定与站点版本号',
  run:function(b){
    var h = location.hostname || '(file:// 本地文件)';
    var env = /^(localhost|127\.|192\.168\.|0\.0\.0\.0)/.test(h) ? 'dev'
      : /(staging|stage|test|pre|uat)/i.test(h) ? 'staging' : 'prod';
    b.appendChild(kv([
      ['地址', esc(h + location.pathname)],
      ['环境判定', badge(env, env === 'prod' ? 'g' : 'y')],
      ['版本号', esc(window.__APP_VERSION__ || '—（window.__APP_VERSION__ 未定义）')],
      ['元框架', (window.__NEXT_DATA__ ? 'Next.js ' : '') + (window.__NUXT__ ? 'Nuxt ' : '') || '—']
    ]));
  }},
{ id:'health', cat:'info', name:'页面健康度', icon:'activity', star:2, desc:'DOM 规模、嵌套深度、FCP/LCP、内存占用',
  run:function(b){
    var paint = performance.getEntriesByType('paint');
    var fcp = paint.filter(function(p){ return p.name === 'first-contentful-paint'; })[0];
    var mem = performance.memory;
    b.appendChild(kv([
      ['DOM 节点数', $$('*').length],
      ['正文文本量', (document.body.innerText || '').length + ' 字符'],
      ['最深嵌套', maxDepth(document.body) + ' 层'],
      ['FCP', fcp ? Math.round(fcp.startTime) + ' ms' : '—'],
      ['LCP', '需 PerformanceObserver 常驻监听'],
      ['JS 堆内存', mem ? (mem.usedJSHeapSize / 1048576).toFixed(1) + ' MB' : '—（浏览器不支持）'],
      ['事件监听器数', '—（仅 DevTools getEventListeners 可查）']
    ]));
  }},
{ id:'forms', cat:'info', name:'表单字段总览', icon:'form', star:3, desc:'列出全部 input/select/textarea 及校验规则',
  run:function(b){
    var rows = $$('input,select,textarea').filter(function(e){ return e.type !== 'hidden'; });
    if(!rows.length){ b.appendChild(el('div', 'note', '本页没有可交互表单字段。')); return; }
    var d = el('div', 'lst');
    rows.forEach(function(e){
      var label = '', lg = e.labels && e.labels[0];
      if(lg) label = lg.textContent.trim();
      label = label || e.placeholder || e.name || e.id || '（无标签）';
      var rules = [];
      if(e.required) rules.push('必填');
      if(e.maxLength > 0) rules.push('≤' + e.maxLength);
      if(e.pattern) rules.push('pattern');
      if(e.readOnly) rules.push('只读');
      if(e.disabled) rules.push('禁用');
      d.appendChild(el('div', 'li',
        '<span class="m">' + (e.tagName === 'TEXTAREA' ? 'textarea' : e.type || e.tagName.toLowerCase()) + '</span>' +
        '<span class="u">' + esc(label) + (rules.length ? ' · ' + esc(rules.join(' / ')) : '') + '</span>'));
    });
    b.appendChild(d);
    b.appendChild(note('原型页表单区专为此功能设计：maxlength / readonly / disabled / pattern 各一。'));
  }},
{ id:'net', cat:'info', name:'接口清单', icon:'share', star:3, desc:'抓取页面发出的 fetch/XHR：URL、状态码、耗时',
  run:function(b){
    var d = el('div', 'lst');
    b.appendChild(d);
    function render(){
      d.innerHTML = '';
      NET.slice().reverse().forEach(function(n){
        var cls = n.s === 200 ? 'g' : n.s === 'ERR' ? 'r' : 'y';
        d.appendChild(el('div', 'li',
          '<span class="m">' + n.m + '</span><span class="u" title="' + esc(n.u) + '">' + esc(n.u) + '</span>' +
          '<span class="c"><span class="bdg ' + cls + '">' + n.s + '</span> <span style="color:#475569">' + n.ms + 'ms</span>' +
          (n.seed ? '<span class="bdg mock">演示</span>' : '') + '</span>'));
      });
      if(!NET.length) d.appendChild(el('div', 'note', '暂无请求。点模拟页「触发一次请求」试试。'));
    }
    render();
    detailTimer = setInterval(render, 1200);
    b.appendChild(note('前 2 条为演示数据；工具箱加载后发出的真实 fetch/XHR 会实时追加。'));
  }},
{ id:'sdk', cat:'info', name:'第三方 SDK 盘点', icon:'package', star:1, desc:'埋点、监控、客服、A/B 实验脚本',
  run:function(b){
    var KNOWN = { 'google-analytics':'GA 埋点', 'googletagmanager':'GTM', sentry:'Sentry 监控', 'sentry-cdn':'Sentry 监控', segment:'Segment', hotjar:'Hotjar 录屏', clarity:'Clarity 录屏', growingio:'GrowingIO', sensorsdata:'神策数据', mixpanel:'Mixpanel', amplitude:'Amplitude', bugsnag:'Bugsnag', datadog:'Datadog RUM', intercom:'Intercom 客服', zhichi:'智齿客服' };
    var found = [];
    $$('script[src]').forEach(function(s){
      var h = (function(){ try{ return new URL(s.src).hostname; }catch(e){ return s.src; } })();
      Object.keys(KNOWN).forEach(function(k){ if(h.indexOf(k) > -1) found.push([KNOWN[k], h]); });
    });
    if(found.length){
      var d = el('div', 'lst');
      found.forEach(function(f){ d.appendChild(el('div', 'li', '<span class="u">' + esc(f[0]) + '</span><span class="c" style="color:#475569">' + esc(f[1]) + '</span>')); });
      b.appendChild(d);
    } else b.appendChild(el('div', 'note', '未发现已知第三方 SDK。'));
    b.appendChild(note('原型页引入了 2 个带 src 的脚本标签（google-analytics / example-cdn）用于演示识别。'));
  }},
/* ===== 查找 ===== */
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
  }},
/* ===== 样式与屏蔽 ===== */
{ id:'hideEl', cat:'style', name:'隐藏 / 删除元素', icon:'eyeoff', star:3, desc:'支持撤销，带操作栈',
  run:function(b){
    b.appendChild(el('div', 'note', '进入拾取模式后点击元素即隐藏；面板上方出现撤销栈，可单步撤销或全部恢复。'));
    b.appendChild(btn('开始拾取并隐藏', function(){
      pick().then(function(e){
        if(!e) return;
        var prev = e.style.display;
        pushUndo({ restore:function(){ e.style.display = prev; } });
        e.style.display = 'none';
        toast('已隐藏 1 个元素');
      });
    }, 'pri warn'));
  }},
{ id:'rmfixed', cat:'style', name:'移除 fixed 浮层', icon:'scissors', star:3, desc:'清掉悬浮条、吸顶导航，长截图必备',
  run:function(b){
    var targets = $$('body *').filter(function(e){
      return !host.contains(e) && getComputedStyle(e).position === 'fixed';
    });
    if(!targets.length){ b.appendChild(el('div', 'note', '当前页面没有 fixed 定位元素。')); return; }
    pushUndo({ restore:function(){ targets.forEach(function(e){ e.style.removeProperty('position'); }); } });
    targets.forEach(function(e){ e.style.setProperty('position', 'static', 'important'); });
    b.appendChild(el('div', 'd', '已将 <b>' + targets.length + '</b> 个 fixed 元素改为 static：'));
    var d = el('div', 'lst');
    targets.forEach(function(e){ d.appendChild(el('div', 'li', '<span class="u">' + esc(bestSelector(e).slice(0, 60)) + '</span>')); });
    b.appendChild(d);
    toast('已移除 ' + targets.length + ' 个 fixed 浮层');
  }},
{ id:'unlockScroll', cat:'style', name:'解除滚动锁', icon:'unlock', star:3, desc:'干掉 overflow:hidden，解锁锁定页面',
  run:function(b){
    var cands = [document.documentElement, document.body].concat($$('body *').filter(function(e){
      if(host.contains(e)) return false;
      var s = getComputedStyle(e);
      return (s.overflow === 'hidden' || s.overflowY === 'hidden') && (e.scrollHeight > e.clientHeight + 4 || e === document.body || e === document.documentElement);
    }));
    var changed = [];
    cands.forEach(function(e){
      var s = getComputedStyle(e);
      if(s.overflow === 'hidden' || s.overflowY === 'hidden'){ changed.push(e); }
    });
    if(!changed.length){ b.appendChild(el('div', 'note', '当前页面没有滚动锁。')); return; }
    pushUndo({ restore:function(){ changed.forEach(function(e){ e.style.removeProperty('overflow'); }); } });
    changed.forEach(function(e){ e.style.setProperty('overflow', 'auto', 'important'); });
    b.appendChild(el('div', 'd', '已解锁 <b>' + changed.length + '</b> 处滚动容器（含 body.locked 类造成的锁定）。'));
    toast('已解除滚动锁');
  }},
{ id:'noanim', cat:'style', name:'停用全部动画', icon:'zap', star:2, desc:'注入全局 transition/animation:none',
  run:function(b){
    var on = !state.toggles.noanim;
    state.toggles.noanim = on;
    pageStyle('ba-noanim', on ? STYLE.noanim : null);
    b.appendChild(el('div', 'd', on ? '已注入：<b>* { transition:none !important; animation:none !important }</b>' : '已恢复页面动画。'));
    b.appendChild(note('原型页的脉冲圆点、过渡都会立即静止。可重复点击本功能开关。'));
  }},
{ id:'unlockInput', cat:'style', name:'解除输入限制', icon:'unlock', star:2, desc:'去掉 maxlength、readonly、disabled',
  run:function(b){
    var changed = [];
    $$('input,textarea,select').forEach(function(e){
      var backup = { e:e, ml:e.getAttribute('maxlength'), ro:e.readOnly, dis:e.disabled };
      var dirty = false;
      if(e.hasAttribute('maxlength')){ e.removeAttribute('maxlength'); dirty = true; }
      if(e.readOnly){ e.readOnly = false; dirty = true; }
      if(e.disabled){ e.disabled = false; dirty = true; }
      if(dirty) changed.push(backup);
    });
    if(!changed.length){ b.appendChild(el('div', 'note', '没有发现输入限制。')); return; }
    pushUndo({ restore:function(){
      changed.forEach(function(c){
        if(c.ml != null) c.e.setAttribute('maxlength', c.ml);
        c.e.readOnly = c.ro; c.e.disabled = c.dis;
      });
    }});
    b.appendChild(el('div', 'd', '已解除 <b>' + changed.length + '</b> 个字段的限制（maxlength / readonly / disabled）。'));
    toast('已解除输入限制');
  }},
{ id:'plainpwd', cat:'style', name:'密码明文切换', icon:'eye', star:2, desc:'type=password → text，自查用',
  run:function(b){
    var on = !state.toggles.pwd;
    state.toggles.pwd = on;
    var n = 0;
    $$('input[type=password]').forEach(function(e){ e.type = on ? 'text' : 'password'; n++; });
    b.appendChild(el('div', 'd', on ? '已将 <b>' + n + '</b> 个密码框切换为明文' : '已恢复密码遮挡。'));
    if(!n) b.appendChild(note('本页没有密码框；原型页表单区有一个。'));
  }},
{ id:'selrestore', cat:'style', name:'恢复文本可选 / 右键', icon:'pointer', star:1, desc:'解除 user-select:none 与 contextmenu 拦截',
  run:function(b){
    var on = !state.toggles.sel;
    state.toggles.sel = on;
    if(state.selHandler){ window.removeEventListener('contextmenu', state.selHandler, true); state.selHandler = null; }
    pageStyle('ba-sel', on ? STYLE.sel : null);
    if(on){
      var h = function(ev){ ev.stopPropagation(); };
      window.addEventListener('contextmenu', h, true);
      state.selHandler = h;
    }
    b.appendChild(el('div', 'd', on ? '已注入全局 <b>user-select:text</b> 并拦截 contextmenu 事件' : '已恢复页面限制。'));
    b.appendChild(note('原型页「其他障碍物」卡片的禁止选中区域现在可以选中、可以右键。'));
  }},
{ id:'outline', cat:'style', name:'元素描边', icon:'grid', star:1, desc:'设计走查、对齐检查',
  run:function(b){
    var on = !state.toggles.ol;
    state.toggles.ol = on;
    pageStyle('ba-outline', on ? STYLE.outline : null);
    if(on) $$('body *').forEach(function(e){ if(!host.contains(e)) e.setAttribute('data-ba-ol', '1'); });
    else $$('[data-ba-ol]').forEach(function(e){ e.removeAttribute('data-ba-ol'); });
    b.appendChild(el('div', 'd', on ? '已为全部元素描边（虚线）' : '已取消描边。'));
  }},
{ id:'flash', cat:'style', name:'变更闪烁', icon:'activity', star:2, desc:'MutationObserver 高亮重绘区域',
  run:function(b){
    var on = !state.toggles.flash;
    state.toggles.flash = on;
    pageStyle('ba-flash', on ? STYLE.flash : null);
    if(state.flashObs){ state.flashObs.disconnect(); state.flashObs = null; }
    if(on){
      var ob = new MutationObserver(function(ms){
        ms.forEach(function(m){
          if(m.type === 'childList') m.addedNodes.forEach(function(n){ if(n.nodeType === 1 && !host.contains(n)) flashEl(n); });
          if(m.type === 'attributes' && m.target.nodeType === 1 && !host.contains(m.target)) flashEl(m.target);
        });
      });
      ob.observe(document.body, { childList:true, subtree:true, attributes:true });
      state.flashObs = ob;
      b.appendChild(el('div', 'd', '已开启变更监听：<b>DOM 变动会红框闪烁</b>'));
    } else b.appendChild(el('div', 'd', '已关闭变更监听。'));
    b.appendChild(note('保持本弹窗打开，去点页面上的按钮 / 打开弹窗，即可看到效果。'));
  }},
/* ===== 发给 LLM · 复制（结果进剪贴板，人工粘贴进对话） ===== */
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
    b.appendChild(note('原型页备注框里预置了手机号 / 身份证 / 邮箱 / sk- token 各一，可看到打码效果。'));
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
/* ===== 发给 LLM · 存储（写入浏览器变量 / localStorage，LLM 自取） ===== */
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
      table: (function(){ var tb = document.getElementById('orders'); if(!tb) return null;
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
'// LLM 经 broker 自取，无需人工粘贴\n' +
'POST /call/{pid}  {"action":"eval","code":"JSON.stringify(window.__BA_CTX__)"}\n' +
'POST /call/{pid}  {"action":"storage","op":"get","key":"ba:ctx"}'));
    b.appendChild(note('变量随刷新 / 跳转失效；localStorage 可跨刷新保留。写入即生效，LLM 直接 eval / storage 取用。'));
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
        b.appendChild(codeBox('POST /call/{pid}  {"action":"eval","code":"JSON.stringify(window.__BA_EL__)"}'));
      });
    }, 'pri'));
  }},
/* ===== 发给 LLM · 复制 · 高级 ===== */
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
    b.appendChild(note('检查规则：img alt / 按钮名称 / 字段标签 / 链接 href。扩展版可接 axe-core 增强。'));
  }},
/* ===== 开发产物：能跑起来的脚本 / 指令 ===== */
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
];
var FEATS_BY_ID = {};
FEATS.forEach(function(f){ FEATS_BY_ID[f.id] = f; });
sqa('.cat i').forEach(function(i){ i.textContent = countOf(i.dataset.c); });

/* ---------- 关于原型 ---------- */
function openAbout(){
  closeDetail();
  state.cat = null; state.feat = null; state.pin = true;
  sq('#pop-title').textContent = '关于原型';
  sq('#pop-sub').textContent = '设计确认用';
  pop.classList.add('open');
  var list = sq('#pop-list');
  list.innerHTML =
    '<div class="d" style="padding:4px 6px">交互规格：<b>右下角圆形 FAB</b>（可拖拽、记忆位置、Alt+Shift+D 唤起）→ 点击展开<b>五分类面板</b>（仍锚定右下角）→ 悬停分类弹出 <b>Popover</b> 功能列表 → 点击功能查看结果。<br><br>' +
    '交付模型：<b>发给 LLM</b> 拆成两条通道 —— <b>复制</b>（结果进剪贴板，人工粘贴进对话）与 <b>存储</b>（写入 window / localStorage，LLM 经 broker 的 eval / storage 自取）；能跑起来的脚本 / 指令归入 <b>开发产物</b>。<br><br>' +
    '真实实现（可在模拟页直接点）：拾取器、稳定性评分、文本搜索、表格提取、隐藏元素、移除 fixed、解除滚动锁、停用动画、解除输入限制、密码明文、恢复可选、描边、变更闪烁、精简 DOM、脱敏、存入上下文 / 选中元素、技术栈、环境、健康度、表单总览、接口清单、SDK 盘点、a11y。<br><br>' +
    '演示数据（结果卡形态）：事件反查 / 组件名定位（模拟页已挂假 fiber，可真实走通）、Shadow DOM 穿透、操作录制、Playwright / 油猴 / 爬虫代码。<br><br>' +
    '落地到扩展时：白名单门控（非白名单页不挂载）、chrome.storage 记位置、结果动作经 background 转发 broker。</div>';
  layoutPop();
}

/* ---------- 事件绑定 ---------- */
fab.addEventListener('click', function(){ if(!fab._moved) togglePanel(); });
fab.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); togglePanel(); } });
sq('#p-close').onclick = closePanel;
sq('#p-about').onclick = openAbout;

$$('.cat', panel).forEach(function(b){
  var id = b.dataset.c;
  b.addEventListener('mouseenter', function(){ if(!state.open) openPanel(); openPop(id); });
  b.addEventListener('mouseleave', scheduleClose);
  b.addEventListener('click', function(e){ e.stopPropagation(); state.pin ? closePop() : openPop(id, true); });
});
pop.addEventListener('mouseenter', function(){ clearTimeout(hoverTimer); });
pop.addEventListener('mouseleave', scheduleClose);
pop.addEventListener('click', function(e){ e.stopPropagation(); });

/* 拖拽 FAB */
(function(){
  var sx, sy, ox, oy, moved = false;
  fab.addEventListener('pointerdown', function(e){
    if(e.button !== 0) return;
    var r = fab.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = e.clientX - r.left; oy = e.clientY - r.top; moved = false;
    fab.setPointerCapture(e.pointerId);
    fab._moved = false;
  });
  fab.addEventListener('pointermove', function(e){
    if(sx == null) return;
    if(!moved && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 5) return;
    moved = true; fab._moved = true; fab.classList.add('drag');
    fab.style.left = clamp(e.clientX - ox, 4, innerWidth - 56) + 'px';
    fab.style.top = clamp(e.clientY - oy, 4, innerHeight - 56) + 'px';
    fab.style.right = 'auto'; fab.style.bottom = 'auto';
    if(state.open) layout();
  });
  function end(){
    if(sx == null) return;
    sx = null;
    fab.classList.remove('drag');
    if(moved){
      var r = fab.getBoundingClientRect();
      if(r.left + r.width / 2 < innerWidth / 2){ fab.style.left = '18px'; fab.style.right = 'auto'; }
      else { fab.style.right = '24px'; fab.style.left = 'auto'; }
      fab.style.top = clamp(r.top, 8, innerHeight - 60) + 'px';
      try{ localStorage.setItem('ba-tbx-pos', JSON.stringify({ l:fab.style.left, r:fab.style.right, t:fab.style.top })); }catch(e){}
      layout();
    }
    setTimeout(function(){ fab._moved = false; }, 0);
  }
  fab.addEventListener('pointerup', end);
  fab.addEventListener('pointercancel', end);
})();
(function(){ // 恢复位置
  try{
    var p = JSON.parse(localStorage.getItem('ba-tbx-pos') || 'null');
    if(p){ fab.style.left = p.l; fab.style.right = p.r; fab.style.top = p.t; fab.style.bottom = 'auto'; }
  }catch(e){}
})();

/* 全局热键 / Esc */
window.addEventListener('keydown', function(e){
  if(e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd')){ e.preventDefault(); togglePanel(); if(state.open) localStorage.setItem('ba-tbx-seen', '1'); }
  if(e.key === 'Escape'){
    if(sq('.picker-ov')) return; // 拾取器自行处理
    if(dpop.classList.contains('open')) closeDetail();
    else if(pop.classList.contains('open')) closePop();
    else if(state.open) closePanel();
  }
});
window.addEventListener('resize', function(){ if(state.open) layout(); });

/* 点击页面其他位置收起 */
document.addEventListener('pointerdown', function(e){
  if(!state.open) return;
  if(host.contains(e.target)) return;
  closePanel();
}, true);

/* 首次打开后隐藏引导 */
var _open = openPanel;
openPanel = function(){ var c = $('.coach', fab); if(c) c.classList.add('hide'); _open(); };
})();
