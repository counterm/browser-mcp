/*
 * Page Bridge - 接口捕获层（MAIN world · document_start 注入，manifest 静态声明）
 * 职责：包裹页面 fetch/XHR，捕获「接口调用」完整记录（URL / 请求头 / 请求体 / 响应头 / 响应体），
 *       挂在 window.__BATB_NET__ 供工具箱「采集 · 接口调用」与 LLM 查看协议（netlog）共用。
 *
 * 双层架构：本文件只有页面侧能拿到的（请求体原文、响应体）；请求头全量（含浏览器自动加的
 * Cookie 等）由 background webRequest（extraHeaders）抓取，经扩展桥 batb:bridge → tb:net 拉回，
 * 按 method + URL 归一化 + 时间窗（≤8s）合并，consume-once 防同 URL 轮询误并。
 *
 * 设计取舍（详见 docs/spec-net-protocol.md）：
 *   - 记录只存页面内存（环形 300 条），导航即清空；除被主动查询外不离开页面；
 *   - document_start 时读不到白名单，故全站包裹（数据不外发，泄露面为零）；
 *   - 响应体经 clone() 旁路读取，流式累积超上限即 cancel，不拖慢页面、不全量缓冲；
 *   - hook 全程 try/catch，绝不破坏原调用链；本包裹在最内层（最先执行），
 *     页面自身补丁与工具箱 helpers.js 的 B.NET 包在外层（B.NET 只记摘要，两处计数口径不同）。
 */
(function(){
  if (window.__BATB_NET__) return;

  var N = window.__BATB_NET__ = {
    ver: 1,
    recs: [],          // 环形缓冲：{id,t,src,kind,m,u,reqHdr,reqBody,s,resHdr,resBody,ms,note,pending}
    seq: 0,
    MAX: 300,          // 页面侧最大记录数
    BODY_MAX: 262144   // 单条响应体捕获上限（256KB 字符）
  };

  /* ---------- 小工具 ---------- */
  function now(){ return Date.now(); }
  function capText(s){
    s = String(s == null ? '' : s);
    return s.length > N.BODY_MAX ? s.slice(0, N.BODY_MAX) + '\n…[截断，共 ' + s.length + ' 字符]' : s;
  }
  function normUrl(u){ try { return decodeURI(String(u)); } catch(e){ return String(u); } }
  function absUrl(u){ try { return new URL(u, location.href).href; } catch(e){ return String(u || ''); } }

  /* 请求体序列化：能转文本的转文本，二进制只记 meta */
  function serBody(b){
    try {
      if (b == null) return null;
      if (typeof b === 'string') return capText(b);
      if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) return capText(b.toString());
      if (typeof FormData !== 'undefined' && b instanceof FormData) {
        var lines = [];
        b.forEach(function(v, k){ lines.push(k + '=' + (v instanceof File ? '[File ' + v.name + ' ' + v.size + 'B]' : String(v))); });
        return capText(lines.join('\n'));
      }
      if (typeof Blob !== 'undefined' && b instanceof Blob) return '[Blob ' + b.size + 'B ' + (b.type || '?') + ']';
      if (b instanceof ArrayBuffer) return '[ArrayBuffer ' + b.byteLength + 'B]';
      if (ArrayBuffer.isView && ArrayBuffer.isView(b)) return '[TypedArray ' + b.byteLength + 'B]';
      return capText(String(b));
    } catch(e){ return '[请求体序列化失败]'; }
  }

  /* Headers / 数组 / 对象 → [{k,v}] */
  function hdrList(h){
    var out = [];
    try {
      if (!h) return out;
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        h.forEach(function(v, k){ out.push({ k: k, v: v }); });
      } else if (Array.isArray(h)) {
        h.forEach(function(p){ out.push({ k: String(p[0]), v: String(p[1]) }); });
      } else if (typeof h === 'object') {
        Object.keys(h).forEach(function(k){ out.push({ k: k, v: String(h[k]) }); });
      }
    } catch(e){}
    return out;
  }

  function push(rec){
    rec.t = rec.t || now();
    N.recs.push(rec);
    if (N.recs.length > N.MAX) N.recs.splice(0, N.recs.length - N.MAX);
  }

  /* ---------- 日志捕获层（console / 异常 / 资源 / CSP，MAIN world） ----------
   * 与接口捕获层同构：document_start 先于页面脚本打补丁，缓冲只存页面内存，
   * 只有被 batb:logq 查询时才离开页面。时间同时给 t（epoch ms）/ iso / perf。
   * 所有 hook 全程 try/catch，绝不改变页面自身的 console 与错误处理行为。
   */
  var L = window.__BATB_LOG__ = {
    ver: 1,
    doc: 'd_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4),
    recs: [],
    seq: 0,
    MAX: 800,
    TEXT_MAX: 2048,
    STACK_MAX: 4096,
    last: null
  };

  function capLog(s, max){
    s = String(s == null ? '' : s);
    max = max || L.TEXT_MAX;
    return s.length > max ? s.slice(0, max) + '…[截断，共 ' + s.length + ' 字符]' : s;
  }
  function nowPerf(){ try { return performance.now(); } catch(e){ return 0; } }

  /* 带深度 / 键数 / 字符上限的序列化：大对象、循环引用、DOM 都不会拖慢页面 */
  function serLog(v, depth, seen){
    try {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      var t = typeof v;
      if (t === 'string') return capLog(v);
      if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
      if (t === 'symbol') return String(v);
      if (t === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
      if (v instanceof Date) return v.toISOString();
      if (v instanceof Error) return (v.name || 'Error') + ': ' + v.message;
      if (v && v.nodeType === 1) return '<' + String(v.tagName).toLowerCase() + (v.id ? '#' + v.id : '') + '>';
      if (depth > 3) return '[Object]';
      if (seen.indexOf(v) > -1) return '[Circular]';
      seen.push(v);
      var out;
      if (Array.isArray(v)) {
        var arr = v.slice(0, 50).map(function(x){ return serLog(x, depth + 1, seen); });
        if (v.length > 50) arr.push('…');
        out = '[' + arr.join(', ') + ']';
      } else {
        var keys = Object.keys(v);
        var kv = keys.slice(0, 30).map(function(k){ return k + ': ' + serLog(v[k], depth + 1, seen); });
        if (keys.length > 30) kv.push('…');
        out = '{' + kv.join(', ') + '}';
      }
      seen.pop();
      return out;
    } catch(e){ return '[无法序列化]'; }
  }

  function logPush(o){
    try {
      var t = Date.now(), text = capLog(o.text);
      var key = o.kind + '|' + o.level + '|' + text;
      // 1.5s 内同来源同文本合并计数，避免刷屏式日志撑爆缓冲区；时间保留首次发生时刻
      if (L.last && L.last.key === key && t - L.last.t < 1500) {
        L.last.rec.count++;
        L.last.t = t;
        return;
      }
      var r = {
        id: ++L.seq,
        t: t,
        iso: new Date(t).toISOString(),
        perf: Math.round(nowPerf()),
        kind: o.kind,
        level: o.level,
        text: text,
        url: o.url || null,
        line: o.line == null ? null : o.line,
        col: o.col == null ? null : o.col,
        stack: o.stack ? capLog(o.stack, L.STACK_MAX) : null,
        count: 1
      };
      L.recs.push(r);
      if (L.recs.length > L.MAX) L.recs.splice(0, L.recs.length - L.MAX);
      L.last = { key: key, t: t, rec: r };
    } catch(e){}
  }

  /* console.*：先记录再调用原方法；页面后续再包一层也会经过这里 */
  (function(){
    try {
      if (!window.console) return;
      ['log', 'info', 'warn', 'error', 'debug'].forEach(function(level){
        var orig = console[level];
        if (typeof orig !== 'function') return;
        console[level] = function(){
          try {
            var args = Array.prototype.slice.call(arguments);
            var text = args.map(function(a){ return serLog(a, 1, []); }).join(' ');
            var stack = (level === 'error' || level === 'warn') ? (new Error()).stack : null;
            logPush({ kind: 'console', level: level, text: text, stack: stack });
          } catch(e){}
          return orig.apply(console, arguments);
        };
      });
    } catch(e){}
  })();

  /* 未捕获异常 + 资源加载失败（捕获阶段；资源错误不冒泡，只能这样拿） */
  window.addEventListener('error', function(e){
    try {
      var tgt = e.target;
      if (tgt && tgt !== window && tgt.tagName) {
        var u = tgt.src || tgt.href || '';
        logPush({ kind: 'resource', level: 'error',
                  text: String(tgt.tagName).toLowerCase() + ' 加载失败' + (u ? '：' + u : ''),
                  url: u || null });
        return;
      }
      logPush({ kind: 'exception', level: 'error', text: e.message || '未捕获异常',
                url: e.filename || null, line: e.lineno, col: e.colno,
                stack: e.error && e.error.stack });
    } catch(x){}
  }, true);

  window.addEventListener('unhandledrejection', function(e){
    try {
      var r = e.reason;
      var msg = (r && r.message) ? r.message : serLog(r, 1, []);
      logPush({ kind: 'rejection', level: 'error', text: msg, stack: r && r.stack });
    } catch(x){}
  });

  /* CSP 拦截（MAIN world 能直接收到；不用 CDP 也能覆盖大部分场景） */
  try {
    document.addEventListener('securitypolicyviolation', function(e){
      try {
        logPush({ kind: 'csp', level: 'error',
                  text: 'CSP 拦截 ' + (e.violatedDirective || '?') + ' → ' + (e.blockedURI || '?'),
                  url: e.sourceFile || null, line: e.lineNumber, col: e.columnNumber });
      } catch(x){}
    });
  } catch(e){}

  function listArg(v){
    if (v == null || v === '') return [];
    var arr = Array.isArray(v) ? v : String(v).split(',');
    return arr.map(function(x){ return String(x).trim(); }).filter(Boolean);
  }

  /* 按游标取增量；doc 变化 = 页面导航过，缓冲已重置，从头返回 */
  function logList(p, since, on){
    var doc = p.doc ? String(p.doc) : '';
    var navigated = !!(doc && doc !== L.doc);
    var base = navigated ? 0 : (isFinite(since) ? Math.max(+since, 0) : 0);
    var kinds = listArg(p.kinds), levels = listArg(p.levels);
    var q = String(p.q || '').toLowerCase();
    var lim = Math.min(Math.max(+p.limit || 50, 1), 200);
    // 输出侧再收一刀：默认单条 600 字符，避免一次查询把过多文本塞进模型上下文
    var outMax = Math.min(Math.max(+p.text_max || 600, 100), 8192);
    function capOut(s, max){
      s = String(s == null ? '' : s);
      return s.length > max ? s.slice(0, max) + '…[截断，共 ' + s.length + ' 字符]' : s;
    }
    var matched = L.recs.filter(function(r){
      if (r.id <= base) return false;
      if (kinds.length && kinds.indexOf(r.kind) === -1) return false;
      if (levels.length && levels.indexOf(r.level) === -1) return false;
      if (q && (r.text || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var counts = { kind: {}, level: {} };
    matched.forEach(function(r){
      counts.kind[r.kind] = (counts.kind[r.kind] || 0) + 1;
      counts.level[r.level] = (counts.level[r.level] || 0) + 1;
    });
    var dropped = Math.max(0, matched.length - lim);
    var items = (dropped ? matched.slice(-lim) : matched).map(function(r){
      return { id: r.id, t: r.t, iso: r.iso, perf: r.perf, kind: r.kind, level: r.level,
               text: redactText(capOut(r.text, outMax), on), url: r.url, line: r.line, col: r.col,
               stack: redactText(capOut(r.stack, outMax), on), count: r.count };
    });
    return { ver: L.ver, doc: L.doc, cursor: L.seq, since: base, navigated: navigated,
             buffer: L.recs.length, total: matched.length, dropped: dropped,
             counts: counts, items: items };
  }

  /* ---------- logq 协议应答（content.js 转发 broker 的 {"action":"plog"} 命令） ---------- */
  window.addEventListener('batb:logq', function(ev){
    var d = ev.detail || {};
    var p = d.params || {};
    function respond(res){
      window.dispatchEvent(new CustomEvent('batb:logq:res', {
        detail: { id: d.id, ok: !!res.ok, data: res.data === undefined ? null : res.data, error: res.error || null }
      }));
    }
    try {
      var on = p.redact === undefined ? true : !!p.redact; // 脱敏默认开
      if (p.op === 'clear' || p.clear) {
        L.recs.length = 0;
        L.last = null;
        return respond({ ok: true, data: { doc: L.doc, cursor: L.seq, cleared: true } });
      }
      var waitMs = Math.min(Math.max(+p.wait_ms || 0, 0), 20000);
      var since = p.since != null ? +p.since : (waitMs ? L.seq : 0);
      if (!waitMs) return respond({ ok: true, data: logList(p, since, on) });
      var deadline = Date.now() + waitMs;
      (function poll(){
        try {
          var data = logList(p, since, on);
          if (data.items.length || data.navigated || Date.now() >= deadline) {
            return respond({ ok: true, data: data });
          }
        } catch(e){ return respond({ ok: false, error: String((e && e.message) || e) }); }
        setTimeout(poll, 200);
      })();
    } catch(e){ respond({ ok: false, error: String((e && e.message) || e) }); }
  });

  /* ---------- fetch hook ---------- */
  (function(){
    var of = window.fetch;
    if (!of) return;
    window.fetch = function(input, init){
      var rec, p;
      try {
        init = init || {};
        var reqObj = (input && typeof input === 'object' && !(input instanceof URL)) ? input : null;
        var u = reqObj ? String(reqObj.url) : String(input);
        var m = String(init.method || (reqObj && reqObj.method) || 'GET').toUpperCase();
        var hdr = hdrList(init.headers || (reqObj && reqObj.headers));
        var body = null;
        try { body = ('body' in init) ? serBody(init.body) : (reqObj ? serBody(reqObj.body) : null); } catch(e){}
        rec = { id: ++N.seq, t: now(), t0: performance.now(), src: 'page', kind: 'fetch', m: m, u: absUrl(u),
                reqHdr: hdr, reqBody: body, s: null, resHdr: null, resBody: null, ms: null, pending: true };
        p = rec; push(rec);
      } catch(e){}
      return of.apply(this, arguments).then(function(r){
        try {
          p.s = r.status;
          p.resHdr = hdrList(r.headers);
          p.ms = Math.round(performance.now() - p.t0);
          p.pending = true;
          readRespBody(r).then(function(rb){
            p.resBody = rb.text || null;
            p.note = rb.skip || (rb.trunc ? '响应体超上限已截断' : null);
            p.pending = false;
          });
        } catch(e){ p.pending = false; }
        return r;
      }, function(e){
        try { p.s = 'ERR'; p.note = String((e && e.message) || e); p.ms = Math.round(performance.now() - p.t0); p.pending = false; } catch(x){}
        throw e;
      });
    };
  })();

  /* 响应体旁路读取：clone() 后流式累积，超上限 cancel；SSE/二进制/opaque 只记 meta */
  function readRespBody(r){
    return new Promise(function(res){
      try {
        if (r.type === 'opaque') return res({ skip: 'no-cors opaque 响应不可读' });
        var ct = '';
        try { ct = r.headers.get('content-type') || ''; } catch(e){}
        if (/text\/event-stream/i.test(ct)) return res({ skip: 'SSE 流，不捕获响应体' });
        if (/^(image|video|audio|font)\//i.test(ct) || /octet-stream/i.test(ct)) return res({ skip: '二进制（' + ct.split(';')[0] + '）' });
        var cl = null;
        try { var v = r.headers.get('content-length'); if (v != null) cl = +v; } catch(e){}
        if (cl != null && cl > N.BODY_MAX * 4) return res({ skip: '响应体 ' + cl + 'B 超上限，未捕获' });
        var stream = null;
        try { stream = r.clone().body; } catch(e){}
        if (!stream || !stream.getReader) {
          r.clone().text().then(function(t){ res({ text: capText(t) }); },
                                function(){ res({ skip: '响应体读取失败' }); });
          return;
        }
        var reader = stream.getReader(), chunks = [], size = 0, fin = false;
        (function pump(){
          reader.read().then(function(c){
            if (c.done) { fin = true; return flush(); }
            chunks.push(c.value); size += c.value.byteLength;
            if (size >= N.BODY_MAX * 4) { try { reader.cancel(); } catch(e){} return flush(); }
            pump();
          }, function(){ flush(); });
        })();
        var flushed = false;
        function flush(){
          if (flushed) return; flushed = true;
          try {
            var total = 0; chunks.forEach(function(c){ total += c.byteLength; });
            var u8 = new Uint8Array(total), off = 0;
            chunks.forEach(function(c){ u8.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), off); off += c.byteLength; });
            var text = new TextDecoder('utf-8').decode(u8);
            res({ text: capText(text), trunc: !fin });
          } catch(e){ res({ skip: '响应体解码失败' }); }
        }
      } catch(e){ res({ skip: '响应体读取异常' }); }
    });
  }

  /* ---------- XHR hook（覆盖 axios 等基于 XMLHttpRequest 的请求，不影响 instanceof） ---------- */
  (function(){
    var pr = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!pr) return;
    var oOpen = pr.open, oSend = pr.send, oSH = pr.setRequestHeader;
    pr.open = function(method, url){
      try {
        this.__batbnet__ = { m: String(method || 'GET').toUpperCase(), u: absUrl(url || ''), h: [], t: now(), t0: performance.now() };
      } catch(e){}
      return oOpen.apply(this, arguments);
    };
    pr.setRequestHeader = function(k, v){
      try { this.__batbnet__ && this.__batbnet__.h.push({ k: String(k), v: String(v) }); } catch(e){}
      return oSH.apply(this, arguments);
    };
    pr.send = function(body){
      var self = this;
      try {
        var meta = self.__batbnet__;
        if (meta) {
          meta.rec = { id: ++N.seq, t: meta.t, src: 'page', kind: 'xhr', m: meta.m, u: meta.u,
                       reqHdr: meta.h, reqBody: serBody(body), s: null, resHdr: null, resBody: null, ms: null, pending: true };
          push(meta.rec);
        }
      } catch(e){}
      self.addEventListener('loadend', function(){
        try {
          var rec = self.__batbnet__ && self.__batbnet__.rec;
          if (!rec) return;
          rec.s = self.status || 'ERR';
          rec.ms = Math.round(performance.now() - self.__batbnet__.t0);
          try { rec.resHdr = hdrList(self.getAllResponseHeaders()); } catch(e){}
          var rt = self.responseType;
          if (!rt || rt === 'text') {
            try { rec.resBody = self.responseText != null ? capText(self.responseText) : null; } catch(e){ rec.note = '响应体不可读（' + rt + '）'; }
          } else if (rt === 'json') {
            try { rec.resBody = capText(JSON.stringify(self.response)); } catch(e){}
          } else {
            rec.note = 'responseType=' + rt + '，不捕获响应体';
          }
          rec.pending = false;
        } catch(e){}
      });
      return oSend.apply(this, arguments);
    };
  })();

  /* ---------- 脱敏（同 B.REDACT 口径；本文件加载早于工具箱，自带一份） ---------- */
  var HDR_SECRET = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|api_token|x-auth-token|x-csrf-token|csrf-token|token)$/i;
  var BODY_PAT = [
    [/\beyJ[\w-]{8,}\.[\w-]+\.[\w-]*/g, '[JWT]'],
    [/\b(sk|ghp|xoxb|rk)-[\w-]{10,}/g, '[TOKEN]'],
    [/\b1[3-9]\d{9}\b/g, '[PHONE]'],
    [/\b[\w.-]+@[\w.-]+\.\w+\b/g, '[EMAIL]']
  ];
  function redactHdrs(hs, on){
    if (!on || !hs) return hs;
    return hs.map(function(h){ return HDR_SECRET.test(h.k) ? { k: h.k, v: '«已脱敏»' } : h; });
  }
  function redactText(t, on){
    if (!on || !t) return t;
    return BODY_PAT.reduce(function(s, p){ return s.replace(p[0], p[1]); }, t);
  }

  /* ---------- 扩展桥：拉取 background 侧头部记录（与 feats/capture.js 的 bridge 同协议） ---------- */
  function bridge(action, params, timeoutMs){
    return new Promise(function(resolve, reject){
      var id = Math.random().toString(36).slice(2);
      var timer = setTimeout(function(){ cleanup(); reject(new Error('扩展桥无响应')); }, timeoutMs || 8000);
      function onRes(ev){
        var d = ev.detail;
        if (!d || d.id !== id) return;
        cleanup();
        if (d.ok) resolve(d.data); else reject(new Error(d.error || '扩展桥调用失败'));
      }
      function cleanup(){ clearTimeout(timer); window.removeEventListener('batb:bridge:res', onRes); }
      window.addEventListener('batb:bridge:res', onRes);
      window.dispatchEvent(new CustomEvent('batb:bridge', { detail: { id: id, action: action, params: params || {} } }));
    });
  }

  /* ---------- 合并：bg 头部记录（webRequest）→ 页面记录（consume-once，歧义不并） ---------- */
  var STATIC_URL = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif|css|js|mjs|map|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg)(?:[?#]|$)/i;
  var seenBg = {}; // bg requestId → 已消费
  function applyBg(rec, it){
    if (it.reqHdr && it.reqHdr.length) rec.reqHdr = it.reqHdr;   // bg 的请求头是全量（含浏览器自动加的 Cookie）
    if (!rec.reqBody && it.reqBody) rec.reqBody = it.reqBody;    // 页面原文优先，缺了用 bg 的 formData
    rec.resHdr = it.resHdr || rec.resHdr;
    if (rec.s == null || rec.s === 'ERR') rec.s = it.s;
    if (rec.ms == null) rec.ms = it.ms;
  }
  function sync(){
    return bridge('net', {}, 8000).then(function(items){
      (items || []).forEach(function(it){
        if (!it || !it.rid || seenBg[it.rid]) return;
        seenBg[it.rid] = true;
        var hit = null;
        for (var i = N.recs.length - 1; i >= 0; i--){
          var r = N.recs[i];
          if (r.src !== 'page') continue;               // 只并入纯页面记录：merged/net 的 bg 侧已消费
          if (r.m !== it.m || normUrl(r.u) !== normUrl(it.u)) continue;
          var dt = Math.abs(r.t - (it.t || 0));
          if (dt <= 8000 && (!hit || dt < hit.dt)) hit = { r: r, dt: dt };
        }
        if (hit) { hit.r.src = 'merged'; applyBg(hit.r, it); }
        /* 旧版本后台把图片 / CSS / JS 等静态资源也记成了「仅头」记录：无请求体且 URL 是静态资源后缀的丢弃 */
        else if (!(STATIC_URL.test(it.u || '') && !it.reqBody)) {
          push({ id: ++N.seq, t: it.t || now(), src: 'net', kind: 'net', m: it.m, u: it.u,
                 reqHdr: it.reqHdr || [], reqBody: it.reqBody || null,
                 s: it.s, resHdr: it.resHdr || [], resBody: null, ms: it.ms,
                 note: '仅网络层头部（响应体需页面经 fetch/XHR 发起才有）' });
        }
      });
      return N.recs;
    }).catch(function(){ return N.recs; }); // 扩展桥不可用（刚更新未刷新）时降级为纯页面记录
  }

  /* ---------- 调试文本 / cURL ---------- */
  function hdrBlock(title, hs){
    if (!hs || !hs.length) return '';
    return '◆ ' + title + '\n' + hs.map(function(h){ return '  ' + h.k + ': ' + h.v; }).join('\n') + '\n';
  }
  function fmt(rec, on){
    var L = [];
    L.push(rec.m + ' ' + rec.u);
    L.push(hdrBlock('请求头' + (on ? '（已脱敏）' : ''), redactHdrs(rec.reqHdr, on)));
    if (rec.reqBody) L.push('◆ 请求体\n' + redactText(rec.reqBody, on) + '\n');
    L.push('◆ 响应 ' + rec.s + (rec.ms != null ? '（' + rec.ms + 'ms）' : '') + (rec.note ? ' · ' + rec.note : '') + '\n');
    L.push(hdrBlock('响应头' + (on ? '（已脱敏）' : ''), redactHdrs(rec.resHdr, on)));
    if (rec.resBody) L.push('◆ 响应体\n' + redactText(rec.resBody, on));
    return L.filter(function(x){ return x !== ''; }).join('\n');
  }
  function curl(rec, on){
    var parts = ['curl -X ' + rec.m + ' ' + JSON.stringify(rec.u)];
    (redactHdrs(rec.reqHdr, on) || []).forEach(function(h){ parts.push('-H ' + JSON.stringify(h.k + ': ' + h.v)); });
    if (rec.reqBody && typeof rec.reqBody === 'string') parts.push('--data-raw ' + JSON.stringify(redactText(rec.reqBody, on)));
    return parts.join(' \\\n  ');
  }

  /* ---------- 对外 API（工具箱 apinet 与 netlog 协议共用） ---------- */
  function findRec(id){
    id = +id;
    for (var i = N.recs.length - 1; i >= 0; i--) if (N.recs[i].id === id) return N.recs[i];
    return null;
  }
  function full(rec, on, max){
    max = Math.min(Math.max(+max || 8192, 256), N.BODY_MAX);
    var cut = function(t){ t = String(t == null ? '' : t); return t.length > max ? t.slice(0, max) + '\n…[截断 ' + t.length + ' 字符]' : t; };
    var bodyOut = function(t){ return redactText(cut(redactText(t, on), max), on) || null; }; /* 先脱敏再截断，避免截断边界漏掉 token */
    return { ver: N.ver, id: rec.id, t: rec.t, src: rec.src, kind: rec.kind, m: rec.m, u: rec.u,
             s: rec.s, ms: rec.ms, note: rec.note || null, pending: !!rec.pending,
             reqHdr: redactHdrs(rec.reqHdr, on), reqBody: bodyOut(rec.reqBody),
             resHdr: redactHdrs(rec.resHdr, on), resBody: bodyOut(rec.resBody) };
  }
  function summ(rec){
    return { id: rec.id, t: rec.t, src: rec.src, kind: rec.kind, m: rec.m, u: rec.u,
             s: rec.s, ms: rec.ms, note: rec.note || null, pending: !!rec.pending,
             reqBody: !!rec.reqBody, resBody: !!rec.resBody }; // list 不含 body（协议约定）
  }

  N.sync = sync;             // 拉取并合并 bg 头部记录（幂等）
  N.find = findRec;
  N.summary = summ;
  N.full = full;
  N.fmt = fmt;
  N.curl = curl;
  N.redactHdrs = redactHdrs;
  N.redactText = redactText;
  N.clear = function(){ N.recs.length = 0; seenBg = {}; };

  /* ---------- netlog 协议应答（content.js 转发 broker 的 {"action":"netlog"} 命令） ---------- */
  window.addEventListener('batb:netq', function(ev){
    var d = ev.detail || {};
    var respond = function(res){
      window.dispatchEvent(new CustomEvent('batb:netq:res', {
        detail: { id: d.id, ok: !!res.ok, data: res.data === undefined ? null : res.data, error: res.error || null }
      }));
    };
    var p = d.params || {};
    var on = p.redact === undefined ? true : !!p.redact; // 脱敏默认开
    N.sync().then(function(){
      try {
        if (p.op === 'clear') {
          N.clear();
          // bg 侧头记录也要清，否则下次 sync 会以「仅头」记录复活
          return bridge('netclear', {}).then(function(){ N.clear(); }).catch(function(){}).then(function(){
            respond({ ok: true, data: 'ok' });
          });
        }
        if (p.op === 'list') {
          var q = String(p.q || '').toLowerCase();
          var lim = Math.min(Math.max(+p.limit || 30, 1), 200);
          var items = N.recs.filter(function(r){ return !q || r.u.toLowerCase().indexOf(q) > -1; })
                            .slice(-lim).reverse().map(summ);
          return respond({ ok: true, data: { ver: N.ver, count: items.length, redact: on, items: items } });
        }
        if (p.op === 'get') {
          var r = findRec(p.id);
          if (!r) return respond({ ok: false, error: 'record not found: ' + p.id });
          return respond({ ok: true, data: full(r, on, p.max) });
        }
        if (p.op === 'curl') {
          var r2 = findRec(p.id);
          if (!r2) return respond({ ok: false, error: 'record not found: ' + p.id });
          return respond({ ok: true, data: curl(r2, on) });
        }
        return respond({ ok: false, error: 'unknown op: ' + p.op + '（支持 list/get/curl/clear）' });
      } catch(e){ respond({ ok: false, error: String((e && e.message) || e) }); }
    });
  });
})();
