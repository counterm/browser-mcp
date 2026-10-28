/* 工具箱 · boot —— 收尾：注册表索引 / 分类计数 / 全部事件绑定（必须最后加载）。
   新增 feats/<cat>.js 后，在 background.js 的 TOOLBOX_FILES 清单中、boot.js 之前按序加文件名即可。 */
(function(B){
if(!B || B.FEATS_BY_ID) return; // 防重复注入（重复绑定会让 Esc 一次关两层）
var $ = B.u.$, $$ = B.u.$$, sq = B.u.sq, sqa = B.u.sqa, clamp = B.u.clamp;
var state = B.state;
var ui = B.ui, fab = ui.fab, panel = ui.panel, pop = ui.pop, dpop = ui.dpop;

/* ---------- 注册表索引 + 分类计数回填 ---------- */
B.FEATS_BY_ID = {};
B.FEATS.forEach(function(f){ B.FEATS_BY_ID[f.id] = f; });
B.countOf = function(cid){ return B.FEATS.filter(function(f){ return f.cat === cid && !f.adv; }).length; };
sqa('.cat i').forEach(function(i){ i.textContent = B.countOf(i.dataset.c); });

/* ---------- 事件绑定（可重跑：站点整块重写文档会清空全部监听，core.js 自检发现后调 B.rebind） ---------- */
/* 头部按钮与分类按钮：切换语言时面板内容会被重绘（旧节点事件随之丢失），只需重绑这两组 */
function bindHeader(){
  sq('#p-close').onclick = ui.closePanel;
  sq('#p-about').onclick = ui.openAbout;
  sq('#p-lang').onclick = function(){ B.toggleLang(); };
}
function bindCats(){
  $$('.cat', panel).forEach(function(b){
    var id = b.dataset.c;
    b.addEventListener('mouseenter', function(){ if(!state.open) ui.openPanel(); ui.openPop(id); });
    b.addEventListener('mouseleave', ui.scheduleClose);
    b.addEventListener('click', function(e){ e.stopPropagation(); state.pin ? ui.closePop() : ui.openPop(id, true); });
  });
}
function bindUi(){
if(B.ui && B.ui.bindStatic) B.ui.bindStatic(); /* ui.js 里挂在静态节点上的 onclick（重写后同样被清空） */
/* ---------- 基础事件 ---------- */
fab.addEventListener('click', function(){ if(!fab._moved) ui.togglePanel(); });
fab.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); ui.togglePanel(); } });
bindHeader();
bindCats();
pop.addEventListener('mouseenter', ui.cancelClose);
pop.addEventListener('mouseleave', ui.scheduleClose);
pop.addEventListener('click', function(e){ e.stopPropagation(); });

/* ---------- 拖拽 FAB ---------- */
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
    if(state.open) ui.layout();
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
      ui.layout();
    }
    setTimeout(function(){ fab._moved = false; }, 0);
  }
  fab.addEventListener('pointerup', end);
  fab.addEventListener('pointercancel', end);
})();
/* 视口尺寸变化（如 F12 停靠改变高度）时把 FAB 钳回视口内——记忆位置是绝对 top，视口变矮会被淹没 */
function clampFab(){
  if(!fab.style.top) return; /* 默认 bottom:24px 定位随视口自适应，无需处理 */
  var h = fab.offsetHeight || 52;
  fab.style.top = clamp(parseFloat(fab.style.top) || 0, 4, Math.max(innerHeight - h - 4, 4)) + 'px';
  if(state.open) ui.layout();
}
window.addEventListener('resize', clampFab);
clampFab();

/* ---------- 全局热键 / Esc 分级返回：详情浮层 → 列表 Popover → 面板 ---------- */
window.addEventListener('keydown', function(e){
  if(e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd')){ e.preventDefault(); ui.togglePanel(); if(state.open) localStorage.setItem('ba-tbx-seen', '1'); }
  if(e.key === 'Escape'){
    if(sq('.picker-ov')) return; // 拾取器自行处理
    if(dpop.classList.contains('open')) ui.closeDetail();
    else if(pop.classList.contains('open')) ui.closePop();
    else if(state.open) ui.closePanel();
  }
});
window.addEventListener('resize', function(){ if(state.open) ui.layout(); });

/* ---------- 点击页面其他位置收起 ---------- */
document.addEventListener('pointerdown', function(e){
  if(!state.open) return;
  if(sq('.picker-ov')) return; // 拾取中：页面上的点击是「选中元素」，不是「点空白收起」
  if(B.host.contains(e.target)) return;
  ui.closePanel();
}, true);
}
B.rebind = bindUi;
/* 切换语言后只重绑重绘过的节点，避免给 FAB / Popover 重复叠加监听 */
B.rebindLang = function(){ if(B.ui && B.ui.bindStatic) B.ui.bindStatic(); bindHeader(); bindCats(); };

/* 恢复 FAB 位置（按站点存于 localStorage）：只做一次，须在 clampFab() 之前 */
(function(){
  try{
    var p = JSON.parse(localStorage.getItem('ba-tbx-pos') || 'null');
    if(p){ fab.style.left = p.l; fab.style.right = p.r; fab.style.top = p.t; fab.style.bottom = 'auto'; }
  }catch(e){}
})();
bindUi();
})(window.BATB);
