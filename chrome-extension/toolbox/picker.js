/* 工具箱 · picker —— 选择器工具（cssPath / bestSelector / 评分 / XPath）+ 元素拾取器。 */
(function(B){
if(!B || B.sel) return; // 防重复注入
var el = B.u.el, clamp = B.u.clamp, esc = B.u.esc, toast = B.w.toast;
var state = B.state, shadow = B.shadow, host = B.host;

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

B.sel = { cssPath: cssPath, bestSelector: bestSelector, SCORE_RULES: SCORE_RULES, scoreSelector: scoreSelector, xpathOf: xpathOf };
B.pick = pick;
B.ensurePicked = ensurePicked;
})(window.BATB);
