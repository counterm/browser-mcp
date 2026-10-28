/* 工具箱 · ui —— 面板 / Popover / 详情浮层 DOM、布局、开合、列表与详情渲染、撤销栈、关于页。
   三层结构：FAB → 分类面板 → hover Popover 列表 → 详情浮层（dpop，与列表并排错开）。 */
(function(B){
var $ = B.u.$, $$ = B.u.$$, sq = B.u.sq, sqa = B.u.sqa, el = B.u.el, esc = B.u.esc, clamp = B.u.clamp, I = B.I;
var state = B.state, shadow = B.shadow, CATS = B.CATS;
var toast = B.w.toast, pageStyle = B.style.pageStyle;

/* ---------- DOM 构建 ---------- */
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
/* 三级详情浮层：贴在二级 Popover 侧面（左侧优先，空间不足翻到右侧），顶边对齐；
   宽度自适应：目标 664px（约列表宽的 2 倍），按左右可用空间收窄，最小保持 332px */
var DPOP_W = 664, DPOP_MIN = 332;
function layoutDpop(){
  var p = pop.getBoundingClientRect(), gap = 10;
  var spaceL = p.left - gap - 8, spaceR = innerWidth - p.right - gap - 8;
  var w = clamp(Math.min(DPOP_W, Math.max(spaceL, spaceR)), DPOP_MIN, DPOP_W);
  dpop.style.width = w + 'px';
  var h = dpop.offsetHeight;
  var left = p.left - w - gap, flip = left < 8;
  if(flip) left = Math.min(p.right + gap, innerWidth - w - 8);
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
  var c = fab.querySelector('.coach'); if(c) c.classList.add('hide');
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

/* ---------- 拾取期间临时隐藏整个工具箱 UI（FAB/面板/列表/详情/撤销栈），结束后原样恢复 ---------- */
function pickNodes(){ return [fab, panel, pop, dpop, undoPill]; }
function hideForPick(){ pickNodes().forEach(function(n){ n.classList.add('pick-hide'); }); }
function showAfterPick(){
  pickNodes().forEach(function(n){ n.classList.remove('pick-hide'); });
  if(state.open) layout();
}

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
function featRow(f){
  return '<button class="feat" data-f="' + f.id + '"><span class="fi">' + I(f.icon, 14) + '</span>' +
    '<span class="fm"><b>' + f.name + '</b><s>' + f.desc + '</s></span>' +
    '<span class="st' + (f.star < 3 ? ' dim' : '') + '">' + '★'.repeat(f.star) + '</span></button>';
}
function renderList(catId){
  var c = CATS.filter(function(x){ return x.id === catId; })[0];
  sq('#pop-title').textContent = c.name;
  sq('#pop-sub').textContent = c.desc;
  var list = sq('#pop-list');
  var html;
  if(c.groups && c.groups.length){
    html = c.groups.map(function(g){
      var items = B.FEATS.filter(function(f){ return f.cat === catId && f.grp === g.id; });
      return items.length ? '<div class="grp-h">' + esc(g.name) + '</div>' + featRows(items) : '';
    }).join('');
  } else {
    html = featRows(B.FEATS.filter(function(f){ return f.cat === catId; }));
  }
  list.innerHTML = html;
  $$('.feat', list).forEach(function(b){ b.onclick = function(){ openDetail(B.FEATS_BY_ID[b.dataset.f]); }; });
  $$('.adv-h', list).forEach(function(h){ h.onclick = function(){ h.parentNode.classList.toggle('open'); layoutPop(); }; });
  $$('.cat', panel).forEach(function(b){ b.classList.toggle('act', b.dataset.c === catId); });
}

/* ---------- 详情 ---------- */
var cleanups = [];
function clearDetail(){
  clearInterval(B.ui.detailTimer); B.ui.detailTimer = null;
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
/* ---------- 静态节点事件（可重跑：站点整块重写文档会清空全部监听，boot.js 的 bindUi 会调它） ---------- */
function bindStatic(){
  sq('#dpop-x').onclick = closeDetail;
  sq('#undo-one').onclick = function(){ var op = state.undo.pop(); if(op) op.restore(); refreshUndo(); toast('已撤销一步'); };
  sq('#undo-all').onclick = function(){ while(state.undo.length) state.undo.pop().restore(); refreshUndo(); toast('已全部恢复'); };
}
bindStatic();

/* ---------- 撤销栈 ---------- */
function pushUndo(op){ state.undo.push(op); refreshUndo(); }
function refreshUndo(){ undoPill.classList.toggle('show', state.undo.length > 0); sq('#undo-n').textContent = state.undo.length; }

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
    '真实实现（可在模拟页直接点）：拾取器（含事件反查）、表格提取、隐藏元素、移除 fixed、解除滚动锁、停用动画、解除输入限制、密码明文、恢复可选、描边、变更闪烁、精简 DOM、脱敏、存入上下文 / 选中元素、技术栈、环境、健康度、表单总览、接口清单、SDK 盘点、a11y。<br><br>' +
    '演示数据（结果卡形态）：组件名定位（模拟页已挂假 fiber，可真实走通）、Shadow DOM 穿透、操作录制、Playwright / 油猴 / 爬虫代码。<br><br>' +
    '落地到扩展时：白名单门控（非白名单页不挂载）、chrome.storage 记位置、结果动作经 background 转发 broker。</div>';
  layoutPop();
}

/* ---------- 导出 ---------- */
B.ui = {
  fab: fab, panel: panel, pop: pop, dpop: dpop, undoPill: undoPill,
  layout: layout, layoutPop: layoutPop, layoutDpop: layoutDpop,
  openPanel: openPanel, closePanel: closePanel, togglePanel: togglePanel,
  hideForPick: hideForPick, showAfterPick: showAfterPick,
  openPop: openPop, closePop: closePop, scheduleClose: scheduleClose, cancelClose: function(){ clearTimeout(hoverTimer); }, renderList: renderList,
  openDetail: openDetail, closeDetail: closeDetail, clearDetail: clearDetail, openAbout: openAbout,
  bindStatic: bindStatic,
  pushUndo: pushUndo, refreshUndo: refreshUndo,
  detailTimer: null /* 轮询类详情用：B.ui.detailTimer = setInterval(...)，clearDetail 会自动清 */
};
})(window.BATB);
