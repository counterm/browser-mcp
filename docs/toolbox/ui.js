/* 工具箱 · ui —— 面板 / Popover / 详情浮层 DOM、布局、开合、列表与详情渲染、撤销栈、关于页。
   三层结构：FAB → 分类面板 → hover Popover 列表 → 详情浮层（dpop，与列表并排错开）。
   文案：默认中文；分类 / 功能带 en 字段，界面字符串统一走 B.t(中文, 英文)。 */
(function(B){
if(!B || B.ui) return; // 防重复注入
var $ = B.u.$, $$ = B.u.$$, sq = B.u.sq, sqa = B.u.sqa, el = B.u.el, esc = B.u.esc, clamp = B.u.clamp, I = B.I, t = B.t;
var state = B.state, shadow = B.shadow, CATS = B.CATS;
var toast = B.w.toast, pageStyle = B.style.pageStyle;

function cName(c){ return t(c.name, c.en && c.en.name); }
function cDesc(c){ return t(c.desc, c.en && c.en.desc); }
function gName(g){ return t(g.name, g.en && g.en.name); }
function fName(f){ return t(f.name, f.en && f.en.name); }
function fDesc(f){ return t(f.desc, f.en && f.en.desc); }

/* ---------- DOM 构建 ---------- */
var fab = el('div', 'fab');
fab.setAttribute('role', 'button'); fab.setAttribute('tabindex', '0');
fab.innerHTML = '<span class="ic">' + I('toolbox', 21) + '</span>';
shadow.appendChild(fab);
function paintFab(){ fab.setAttribute('aria-label', t('打开工具箱', 'Open toolbox')); }

/* ---------- 录制 HUD：录制期间替代 FAB（暂停 / 停止）；三层弹窗由 beginRecord/endRecord 隐藏与恢复 ---------- */
var recHud = el('div', 'rec-hud');
recHud.innerHTML = '<button class="rh rh-p" type="button"></button><button class="rh rh-s" type="button"></button>';
shadow.appendChild(recHud);
var recCtl = null;
function paintRecHud(paused){
  var pb = recHud.querySelector('.rh-p'), sb = recHud.querySelector('.rh-s');
  var pt = paused ? t('继续录制', 'Resume recording') : t('暂停录制', 'Pause recording');
  pb.innerHTML = I(paused ? 'play' : 'pause', 16);
  pb.title = pt; pb.setAttribute('aria-label', pt);
  sb.innerHTML = I('stop', 15);
  var st = t('停止录制并复制 YAML', 'Stop recording and copy YAML');
  sb.title = st; sb.setAttribute('aria-label', st);
}
paintRecHud(false);
recHud.querySelector('.rh-p').onclick = function(e){ e.stopPropagation(); if(recCtl && recCtl.onPause) recCtl.onPause(); };
recHud.querySelector('.rh-s').onclick = function(e){ e.stopPropagation(); if(recCtl && recCtl.onStop) recCtl.onStop(); };

var panel = el('div', 'panel');
function paintPanel(){
  panel.innerHTML =
    '<div class="ph"><span class="pt">' + I('toolbox', 14) + ' ' + t('工具箱', 'Toolbox') + '</span>' +
    '<span class="chip" id="wl-chip">' + t('白名单', 'Allowlist') + ' · ' + (location.hostname || 'example.com') + '</span>' +
    '<button class="x" id="p-close" title="' + t('收起', 'Collapse') + '">' + I('close', 13) + '</button></div>' +
    '<div class="cats">' + CATS.map(function(c){
      return '<button class="cat" data-c="' + c.id + '" style="--c:' + c.color + '">' +
        '<span class="ci">' + I(c.icon, 17) + '</span><b>' + cName(c) + '</b><i data-c="' + c.id + '">' + (B.countOf ? B.countOf(c.id) : '·') + '</i></button>';
    }).join('') + '</div>' +
    '<div class="pf"><span><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> ' + t('唤起', 'Toggle') + '</span>' +
    '<button class="link lang" id="p-lang" title="' + t('切换到英文', 'Switch to Chinese') + '">' + t('EN', '中文') + '</button>' +
    '<button class="link about" id="p-about">' + t('关于原型', 'About') + '</button></div>';
}
paintPanel();
paintFab();
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
  '<button class="x" id="dpop-x" title="' + t('关闭', 'Close') + '">' + I('close', 13) + '</button></div>' +
  '<div class="body" id="dpop-body"><div class="d" id="dpop-desc"></div><div id="dt-body"></div></div>';
shadow.appendChild(dpop);

var undoPill = el('div', 'pill-u');
function paintUndoPill(n){
  undoPill.innerHTML = '<span>' + t('已改动 <b id="undo-n">' + n + '</b> 处', 'Changed <b id="undo-n">' + n + '</b> items') + '</span>' +
    '<button id="undo-one">' + I('undo', 11) + ' ' + t('撤销', 'Undo') + '</button><button id="undo-all">' + t('全部恢复', 'Restore all') + '</button>';
}
paintUndoPill(0);
shadow.appendChild(undoPill);

if(!localStorage.getItem('ba-tbx-seen')){
  var coach = el('div', 'coach', t('点我打开工具箱 · 可拖拽移位', 'Click to open the toolbox · draggable'));
  fab.appendChild(coach);
  setTimeout(function(){ coach.classList.add('hide'); }, 6000);
}
/* 语言切换时重绘引导气泡文案（若仍在） */
function paintCoach(){
  var c = fab.querySelector('.coach');
  if(c) c.textContent = t('点我打开工具箱 · 可拖拽移位', 'Click to open the toolbox · draggable');
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
  state.open = false; state.cat = null; state.feat = null; state.pin = false; state.about = false;
  panel.classList.remove('open'); fab.classList.remove('on');
  pop.classList.remove('open');
  dpop.classList.remove('open');
  undoPill.classList.remove('show');
  clearDetail();
}
function togglePanel(){ if(state.recording) return; state.open ? closePanel() : openPanel(); }

/* ---------- 拾取期间临时隐藏整个工具箱 UI（FAB/面板/列表/详情/撤销栈），结束后原样恢复 ---------- */
function pickNodes(){ return [fab, panel, pop, dpop, undoPill]; }
function hideForPick(){ pickNodes().forEach(function(n){ n.classList.add('pick-hide'); }); }
function showAfterPick(){
  pickNodes().forEach(function(n){ n.classList.remove('pick-hide'); });
  if(state.open) layout();
}
/* ---------- 录制期间：隐藏三层弹窗与撤销条，FAB 换成「暂停 / 停止」HUD；结束后原样恢复 ---------- */
function beginRecord(ctl){
  if(state.recording) return;
  state.recording = true; recCtl = ctl || null;
  pickNodes().forEach(function(n){ n.classList.add('pick-hide'); });
  /* HUD 跟随 FAB 的位置（含拖拽记忆位置） */
  recHud.style.left = fab.style.left; recHud.style.right = fab.style.right;
  recHud.style.top = fab.style.top; recHud.style.bottom = fab.style.bottom;
  recHud.classList.add('show');
  paintRecHud(!!(ctl && ctl.paused));
}
function endRecord(){
  if(!state.recording) return;
  state.recording = false; recCtl = null;
  recHud.classList.remove('show');
  pickNodes().forEach(function(n){ n.classList.remove('pick-hide'); });
  if(state.open) layout();
}
function setRecordPaused(paused){
  if(!state.recording) return;
  if(recCtl) recCtl.paused = !!paused;
  paintRecHud(!!paused);
}

/* ---------- Popover ---------- */
var hoverTimer = null;
function openPop(catId, pin){
  clearTimeout(hoverTimer);
  closeDetail();
  state.cat = catId;
  state.about = false;
  renderList(catId);
  pop.classList.add('open');
  state.pin = !!pin;
  layoutPop();
}
function closePop(){ pop.classList.remove('open'); closeDetail(); state.cat = null; state.pin = false; state.about = false; }
function scheduleClose(){ if(state.pin) return; clearTimeout(hoverTimer); hoverTimer = setTimeout(closePop, 240); }

function featRows(items){
  var main = items.filter(function(f){ return !f.adv; });
  var adv  = items.filter(function(f){ return f.adv; });
  return main.map(featRow).join('') +
    (adv.length ? '<div class="adv open"><button class="adv-h">' + I('chevron', 11) + ' ' + t('高级功能（' + adv.length + '）', 'Advanced (' + adv.length + ')') + '</button><div class="adv-b">' + adv.map(featRow).join('') + '</div></div>' : '');
}
function featRow(f){
  return '<button class="feat" data-f="' + f.id + '"><span class="fi">' + I(f.icon, 14) + '</span>' +
    '<span class="fm"><b>' + fName(f) + '</b><s>' + fDesc(f) + '</s></span>' +
    '<span class="st' + (f.star < 3 ? ' dim' : '') + '">' + '★'.repeat(f.star) + '</span></button>';
}
function renderList(catId){
  var c = CATS.filter(function(x){ return x.id === catId; })[0];
  if(!c) return;
  sq('#pop-title').textContent = cName(c);
  sq('#pop-sub').textContent = cDesc(c);
  var list = sq('#pop-list');
  var html;
  if(c.groups && c.groups.length){
    html = c.groups.map(function(g){
      var items = B.FEATS.filter(function(f){ return f.cat === catId && f.grp === g.id; });
      return items.length ? '<div class="grp-h">' + esc(gName(g)) + '</div>' + featRows(items) : '';
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
  state.about = false;
  state.pin = true;
  sq('#dpop-title').textContent = fName(f);
  sq('#dpop-sub').textContent = f.mock ? t('演示数据', 'Demo data') : '';
  sq('#dpop-desc').innerHTML = fDesc(f);
  var b = sq('#dpop-body');
  $('#dt-body', b).innerHTML = ''; /* 清空上一个功能的详情内容，避免切换时残留 */
  b.scrollTop = 0;
  dpop.classList.add('open');
  layoutDpop();
  try{ Promise.resolve(f.run($('#dt-body', b))).catch(function(e){ toast(t('执行出错：', 'Execution error: ') + e.message); }); }catch(e){ toast(t('执行出错：', 'Execution error: ') + e.message); }
}
function closeDetail(){
  clearDetail();
  dpop.classList.remove('open');
  state.feat = null;
}
/* ---------- 静态节点事件（可重跑：站点整块重写文档会清空全部监听，boot.js 的 bindUi 会调它） ---------- */
function bindStatic(){
  sq('#dpop-x').onclick = closeDetail;
  sq('#undo-one').onclick = function(){ var op = state.undo.pop(); if(op) op.restore(); refreshUndo(); toast(t('已撤销一步', 'Undone one step')); };
  sq('#undo-all').onclick = function(){ while(state.undo.length) state.undo.pop().restore(); refreshUndo(); toast(t('已全部恢复', 'All changes restored')); };
}
bindStatic();

/* ---------- 撤销栈 ---------- */
function pushUndo(op){ state.undo.push(op); refreshUndo(); }
function refreshUndo(){ undoPill.classList.toggle('show', state.undo.length > 0); var n = sq('#undo-n'); if(n) n.textContent = state.undo.length; }

/* ---------- 关于原型 ---------- */
function openAbout(){
  closeDetail();
  state.cat = null; state.feat = null; state.pin = true; state.about = true;
  sq('#pop-title').textContent = t('关于原型', 'About');
  sq('#pop-sub').textContent = t('设计确认用', 'Design reference');
  pop.classList.add('open');
  var list = sq('#pop-list');
  list.innerHTML =
    '<div class="d" style="padding:4px 6px">' + t(
      '交互规格：<b>右下角圆形 FAB</b>（可拖拽、记忆位置、Alt+Shift+D 唤起）→ 点击展开<b>五分类面板</b>（仍锚定右下角）→ 悬停分类弹出 <b>Popover</b> 功能列表 → 点击功能查看结果。<br><br>' +
      '交付模型：<b>发给 LLM</b> 拆成两条通道 —— <b>复制</b>（结果进剪贴板，人工粘贴进对话）与 <b>存储</b>（写入 window / localStorage，LLM 经 broker 的 eval / storage 自取）；能跑起来的脚本 / 指令归入 <b>开发产物</b>。<br><br>' +
      '真实实现（可在模拟页直接点）：拾取器（含事件反查）、表格提取、隐藏元素、移除 fixed、解除滚动锁、停用动画、解除输入限制、密码明文、恢复可选、描边、变更闪烁、精简 DOM、脱敏、存入上下文 / 选中元素、技术栈、环境、健康度、表单总览、接口清单、SDK 盘点、a11y。<br><br>' +
      '演示数据（结果卡形态）：组件名定位（模拟页已挂假 fiber，可真实走通）、Shadow DOM 穿透、操作录制、Playwright / 油猴 / 爬虫代码。<br><br>' +
      '落地到扩展时：白名单门控（非白名单页不挂载）、chrome.storage 记位置、结果动作经 background 转发 broker。',
      'Interaction: <b>circular FAB at the bottom-right</b> (draggable, remembers its position, Alt+Shift+D to toggle) → click to expand the <b>five-category panel</b> (still anchored bottom-right) → hover a category for the <b>Popover</b> feature list → click a feature to see its result.<br><br>' +
      'Delivery model: <b>Send to LLM</b> has two channels — <b>Copy</b> (clipboard, paste manually into the chat) and <b>Store</b> (window / localStorage; the LLM reads it through the broker\'s eval / storage); runnable scripts or commands go to <b>Dev Artifacts</b>.<br><br>' +
      'Really implemented (clickable on the demo page): element picker (with event handler lookup), table extraction, hide element, remove fixed, unlock scroll, disable animations, unlock input limits, plain-text password, restore selection, outlines, mutation flash, condensed DOM, redaction, store context / selected element, tech stack, environment, health, form overview, network list, SDK audit, a11y.<br><br>' +
      'Demo data (result-card shape): component name locator (the demo page has a fake fiber and really works), Shadow DOM piercer, action recording, Playwright / userscript / crawler code.<br><br>' +
      'When shipped as an extension: allowlist gating (not mounted on non-allowlisted pages), position stored in chrome.storage, result actions forwarded through background to the broker.'
    ) + '</div>';
  layoutPop();
}

/* ---------- 语言切换：重绘面板 / 列表 / 关于页 / 撤销条，再交回 boot 重绑事件 ---------- */
function applyLang(){
  paintPanel();
  paintFab();
  paintCoach();
  paintUndoPill(state.undo.length);
  sq('#dpop-x').title = t('关闭', 'Close');
  if(state.open) layout();
  if(state.about){
    openAbout();
  } else if(pop.classList.contains('open') && state.cat){
    closeDetail();          /* 详情内容由功能脚本生成，切换语言后收起，避免中英混排 */
    renderList(state.cat);
    layoutPop();
  }
  if(B.rebindLang) B.rebindLang();
}

/* ---------- 导出 ---------- */
B.ui = {
  fab: fab, panel: panel, pop: pop, dpop: dpop, undoPill: undoPill,
  layout: layout, layoutPop: layoutPop, layoutDpop: layoutDpop,
  openPanel: openPanel, closePanel: closePanel, togglePanel: togglePanel,
  hideForPick: hideForPick, showAfterPick: showAfterPick,
  beginRecord: beginRecord, endRecord: endRecord, setRecordPaused: setRecordPaused,
  openPop: openPop, closePop: closePop, scheduleClose: scheduleClose, cancelClose: function(){ clearTimeout(hoverTimer); }, renderList: renderList,
  openDetail: openDetail, closeDetail: closeDetail, clearDetail: clearDetail, openAbout: openAbout,
  bindStatic: bindStatic, applyLang: applyLang,
  pushUndo: pushUndo, refreshUndo: refreshUndo,
  detailTimer: null /* 轮询类详情用：B.ui.detailTimer = setInterval(...)，clearDetail 会自动清 */
};
})(window.BATB);
