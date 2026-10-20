/* 工具箱 · feats/style —— 「样式与屏蔽」分类：隐藏/移除浮层/滚动锁/动画/输入限制/密码/可选/描边/闪烁。
   改动页面元素的功能统一走 pushUndo（撤销栈在 ui 模块），保证可恢复。 */
(function(B){
var $$ = B.u.$$, el = B.u.el, esc = B.u.esc;
var note = B.w.note, btn = B.w.btn, toast = B.w.toast;
var pick = B.pick, bestSelector = B.sel.bestSelector;
var state = B.state, host = B.host;
var pageStyle = B.style.pageStyle, STYLE = B.style.STYLE;
var pushUndo = B.ui.pushUndo;

B.register([
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
  }}
]);
})(window.BATB);
