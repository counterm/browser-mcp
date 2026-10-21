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

/* ---------- 通用实现 ---------- */
B.detectStack = function(){
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
