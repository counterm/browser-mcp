/* 工具箱 · helpers —— 网络拦截（接口清单数据源）+ 通用实现（技术栈/脱敏/精简 DOM 等）。 */
(function(B){
if(!B || B.NET) return; // 防重复注入（重复执行会二次包裹 fetch）
var $$ = B.u.$$;

/* ---------- 网络拦截（接口清单） ---------- */
var NET = B.NET = [];
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
/* XHR 拦截：覆盖 axios 等基于 XMLHttpRequest 的请求（原型包裹，不影响 instanceof） */
(function(){
  var p = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if(!p) return;
  var oOpen = p.open, oSend = p.send;
  p.open = function(method, url){ this.__ba_m = (method || 'GET').toUpperCase(); this.__ba_u = url || ''; return oOpen.apply(this, arguments); };
  p.send = function(){
    var self = this, t0 = performance.now();
    function rec(){
      self.removeEventListener('loadend', rec);
      NET.push({ m: self.__ba_m || 'GET', u: self.__ba_u || '', s: self.status || 'ERR', ms: Math.round(performance.now() - t0) });
    }
    this.addEventListener('loadend', rec);
    return oSend.apply(this, arguments);
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
B.maxDepth = function(root){
  var d = 0;
  (function w(n, l){ d = Math.max(d, l); for(var i = 0; i < n.children.length; i++) w(n.children[i], l + 1); })(root, 1);
  return d;
};
B.flashEl = function(e){ e.setAttribute('data-ba-flash', '1'); setTimeout(function(){ e.removeAttribute('data-ba-flash'); }, 1900); };
})(window.BATB);
