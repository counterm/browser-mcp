/* 工具箱 · helpers —— 网络拦截（接口清单数据源）+ 通用实现（技术栈/脱敏/精简 DOM 等）。 */
(function(B){
var $$ = B.u.$$;

/* ---------- 网络拦截（接口清单） ---------- */
var NET = B.NET = [
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

/* ---------- 通用实现 ---------- */
B.detectStack = function(){
  var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  var any = document.querySelector('*');
  var v3 = any && any.__vueParentComponent, v2 = $$('*').filter(function(e){ return e.__vue__; })[0];
  /* 生产构建会摇树掉 __vueParentComponent / __VUE__，用库类名 / scoped 作用域标记兜底 */
  var elp = document.querySelector('.el-button,.el-table,.el-input,.el-menu,.el-dialog,.el-form,.el-tag');
  var scoped = false;
  var els = document.getElementsByTagName('*'), n = Math.min(els.length, 300);
  for(var i = 0; i < n && !scoped; i++){
    var a = els[i].attributes;
    for(var j = 0; j < a.length; j++){ if(a[j].name.indexOf('data-v-') === 0){ scoped = true; break; } }
  }
  return {
    React:  !!(hook || document.querySelector('[data-reactroot],#root>div')),
    Vue3:   !!(v3 || window.__VUE__ || elp || scoped),
    Vue2:   !!(v2 || window.Vue),
    Angular:!!document.querySelector('[ng-version]'),
    Next:   !!window.__NEXT_DATA__,
    Nuxt:   !!window.__NUXT__,
    Svelte: !!document.querySelector('[class*="svelte-"]'),
    jQuery: !!(window.jQuery && window.jQuery.fn && window.jQuery.fn.jquery)
  };
};
B.REDACT = [
  [/\b1[3-9]\d{9}\b/g, '[PHONE]'],
  [/\b\d{17}[\dXx]\b/g, '[ID]'],
  [/\b[\w.-]+@[\w.-]+\.\w+\b/g, '[EMAIL]'],
  [/\b(sk|ghp|xoxb)-[\w-]{10,}/g, '[TOKEN]'],
  [/\beyJ[\w-]{10,}\.[\w-]+/g, '[JWT]']
];
B.redact = function(t){ return B.REDACT.reduce(function(s, r){ return s.replace(r[0], r[1]); }, t); };
B.skeleton = function(root){
  var clone = root.cloneNode(true);
  $$('script,style,svg,path,noscript', clone).forEach(function(n){ n.remove(); });
  $$('*', clone).forEach(function(n){
    Array.prototype.slice.call(n.attributes).forEach(function(a){
      if(!/^(id|class|href|src|name|type|value|placeholder|aria-label|data-(testid|test|cy|id))/i.test(a.name)) n.removeAttribute(a.name);
    });
  });
  return clone.innerHTML;
};
/* 精简 DOM → Pug 缩进树：保留层级与语义属性，按深度/节点/字符三重裁剪；
   连续同类兄弟超过阈值折叠为 ×N。前端调试、写选择器、判断组件结构用。 */
var DOM_ATTRS = ['name','type','href','src','placeholder','role','aria-label','data-testid','data-test','data-cy','data-id'];
var DOM_SKIP = { SCRIPT:1, STYLE:1, SVG:1, NOSCRIPT:1, LINK:1, META:1, TEMPLATE:1 };
B.pugDom = function(root, opts){
  opts = opts || {};
  var maxDepth = opts.depth > 0 ? opts.depth : 8;
  var maxNodes = opts.maxNodes > 0 ? opts.maxNodes : 1500;
  var maxChars = opts.maxChars > 0 ? opts.maxChars : 60000;
  var collapse = opts.collapse == null ? 3 : opts.collapse;
  var lines = [], nodes = 0, chars = 0, stop = false, truncated = false;
  function ownText(el){
    var t = '';
    for(var i = 0; i < el.childNodes.length; i++){
      var n = el.childNodes[i];
      if(n.nodeType === 3) t += n.nodeValue;
    }
    return t.replace(/\s+/g, ' ').trim();
  }
  function line(el){
    var s = el.tagName.toLowerCase();
    if(el.id) s += '#' + el.id;
    var cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if(cls.length) s += cls.map(function(c){ return '.' + c; }).join('');
    var attrs = [];
    DOM_ATTRS.forEach(function(k){
      var v = el.getAttribute(k);
      if(v != null) attrs.push(k + '="' + v.replace(/\s+/g, ' ').slice(0, 60).replace(/"/g, '&quot;') + '"');
    });
    if(el.hasAttribute('disabled')) attrs.push('disabled');
    if(el.hasAttribute('checked')) attrs.push('checked');
    if(attrs.length) s += '(' + attrs.join(' ') + ')';
    var txt = ownText(el);
    if(txt) s += ' ' + (txt.length > 60 ? txt.slice(0, 60) + '…' : txt);
    return s;
  }
  function sig(el){ return el.tagName + '|' + (el.id || '') + '|' + (el.getAttribute('class') || ''); }
  function emit(el, depth){
    if(stop) return;
    if(depth > maxDepth){ truncated = true; return; }
    if(nodes >= maxNodes){ stop = true; truncated = true; return; }
    var ln = new Array(depth + 1).join('  ') + line(el);
    chars += ln.length + 1;
    if(chars > maxChars){ stop = true; truncated = true; return; }
    lines.push(ln);
    nodes++;
    var kids = Array.prototype.slice.call(el.children).filter(function(c){ return !DOM_SKIP[c.tagName]; });
    for(var i = 0; i < kids.length; i++){
      var run = 1;
      while(collapse >= 2 && i + run < kids.length && sig(kids[i + run]) === sig(kids[i])) run++;
      if(collapse >= 2 && run >= collapse){
        var at = lines.length;
        emit(kids[i], depth + 1);
        if(lines.length > at) lines[at] += ' ×' + run;
        i += run - 1;
      } else {
        emit(kids[i], depth + 1);
      }
    }
  }
  emit(root, 0);
  if(truncated) lines.push('…（已截断：节点 ' + nodes + '，字符 ' + chars + '）');
  var content = lines.join('\n');
  return { content: content, nodes: nodes, chars: content.length, truncated: truncated };
};
B.maxDepth = function(root){
  var d = 0;
  (function w(n, l){ d = Math.max(d, l); for(var i = 0; i < n.children.length; i++) w(n.children[i], l + 1); })(root, 1);
  return d;
};
B.flashEl = function(e){ e.setAttribute('data-ba-flash', '1'); setTimeout(function(){ e.removeAttribute('data-ba-flash'); }, 1900); };
})(window.BATB);
