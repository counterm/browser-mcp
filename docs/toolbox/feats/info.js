/* 工具箱 · feats/info —— 「提示」分类：技术栈 / 环境 / 健康度 / 接口 / SDK。
   追加功能：往 B.register([...]) 数组里插一个 {id, cat, name, icon, star, desc, run} 对象即可。 */
(function(B){
var $$ = B.u.$$, el = B.u.el, esc = B.u.esc, t = B.t;
var kv = B.w.kv, note = B.w.note, badge = B.w.badge;
var detectStack = B.detectStack, maxDepth = B.maxDepth, NET = B.NET;

B.register([
{ id:'stack', cat:'info', name:'技术栈指纹', en:{ name:'Tech Stack Fingerprint', desc:'Detect React / Vue / Angular and meta-frameworks like Next / Nuxt' }, icon:'gauge', star:3, desc:'识别 React / Vue / Angular 及 Next、Nuxt 等元框架',
  run:function(b){
    var s = detectStack(), hits = Object.keys(s).filter(function(k){ return s[k]; });
    b.appendChild(kv(hits.length
      ? [[t('检出框架', 'Frameworks Detected'), hits.map(function(h){ return badge(h, 'g'); }).join(' ')],
         [t('判定依据', 'Basis'), t(hits.join('、') + ' 的全局钩子 / 标记属性', hits.join(', ') + ' global hooks / marker attributes')],
         ['jQuery', window.jQuery ? 'v' + window.jQuery.fn.jquery : '—']]
      : [[t('检出框架', 'Frameworks Detected'), badge(t('纯静态页面', 'Static Page'), 'y')], [t('说明', 'Note'), t('未发现主流框架的全局钩子或标记属性', 'No global hooks or marker attributes of mainstream frameworks found')]]));
    b.appendChild(note(t('检测依据：__REACT_DEVTOOLS_GLOBAL_HOOK__ / data-reactroot / __vue__ / [ng-version] / __NEXT_DATA__ / __NUXT__ / svelte- 类名 / jQuery。原型页在 <main> 上打了 data-reactroot 标记，故检出 React。',
      'Detection signals: __REACT_DEVTOOLS_GLOBAL_HOOK__ / data-reactroot / __vue__ / [ng-version] / __NEXT_DATA__ / __NUXT__ / svelte- class names / jQuery. The prototype page marks <main> with data-reactroot, hence React is detected.')));
  }},
{ id:'env', cat:'info', name:'环境判定', en:{ name:'Environment', desc:'Detect dev / staging / prod and read the site version' }, icon:'globe', star:2, desc:'dev / staging / prod 判定与站点版本号',
  run:function(b){
    var h = location.hostname || t('(file:// 本地文件)', '(file:// local file)');
    var env = /^(localhost|127\.|192\.168\.|0\.0\.0\.0)/.test(h) ? 'dev'
      : /(staging|stage|test|pre|uat)/i.test(h) ? 'staging' : 'prod';
    b.appendChild(kv([
      [t('地址', 'URL'), esc(h + location.pathname)],
      [t('环境判定', 'Environment'), badge(env, env === 'prod' ? 'g' : 'y')],
      [t('版本号', 'Version'), esc(window.__APP_VERSION__ || t('—（window.__APP_VERSION__ 未定义）', '— (window.__APP_VERSION__ is not defined)'))],
      [t('元框架', 'Meta-framework'), (window.__NEXT_DATA__ ? 'Next.js ' : '') + (window.__NUXT__ ? 'Nuxt ' : '') || '—']
    ]));
  }},
{ id:'health', cat:'info', name:'页面健康度', en:{ name:'Page Health', desc:'DOM size, nesting depth, FCP/LCP, memory usage' }, icon:'activity', star:2, desc:'DOM 规模、嵌套深度、FCP/LCP、内存占用',
  run:function(b){
    var paint = performance.getEntriesByType('paint');
    var fcp = paint.filter(function(p){ return p.name === 'first-contentful-paint'; })[0];
    var mem = performance.memory;
    var txt = (document.body.innerText || '').length, depth = maxDepth(document.body);
    b.appendChild(kv([
      [t('DOM 节点数', 'DOM Nodes'), $$('*').length],
      [t('正文文本量', 'Text Content'), t(txt + ' 字符', txt + ' chars')],
      [t('最深嵌套', 'Max Depth'), t(depth + ' 层', depth + ' levels')],
      ['FCP', fcp ? Math.round(fcp.startTime) + ' ms' : '—'],
      ['LCP', t('需 PerformanceObserver 常驻监听', 'Requires a persistent PerformanceObserver')],
      [t('JS 堆内存', 'JS Heap Memory'), mem ? (mem.usedJSHeapSize / 1048576).toFixed(1) + ' MB' : t('—（浏览器不支持）', '— (not supported by browser)')],
      [t('事件监听器数', 'Event Listeners'), t('—（仅 DevTools getEventListeners 可查）', '— (only visible via DevTools getEventListeners)')]
    ]));
  }},
{ id:'net', cat:'info', name:'接口清单', en:{ name:'Network Requests', desc:'Capture fetch/XHR from the page: URL, status code, duration' }, icon:'share', star:3, desc:'抓取页面发出的 fetch/XHR：URL、状态码、耗时',
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
          (n.seed ? '<span class="bdg mock">' + t('演示', 'Demo') + '</span>' : '') + '</span>'));
      });
      if(!NET.length) d.appendChild(el('div', 'note', t('暂无请求。点模拟页「触发一次请求」试试。', 'No requests yet. Try "Trigger a Request" on the demo page.')));
    }
    render();
    B.ui.detailTimer = setInterval(render, 1200); /* 清理由 ui.clearDetail 统一负责 */
    b.appendChild(note(t('前 2 条为演示数据；工具箱加载后发出的真实 fetch/XHR 会实时追加。', 'The first 2 entries are demo data; real fetch/XHR issued after the toolbox loads are appended in real time.')));
  }},
{ id:'sdk', cat:'info', name:'第三方 SDK 盘点', en:{ name:'Third-party SDK Audit', desc:'Analytics / monitoring scripts + frontend dependency fingerprints (Vue / Element Plus, etc.)' }, icon:'package', star:1, desc:'埋点/监控脚本 + 前端依赖指纹（Vue/Element Plus 等）',
  run:function(b){
    /* 1) 已知埋点/监控/客服 SDK：扫描带 src 的 <script> 域名 */
    var KNOWN = { 'google-analytics':t('GA 埋点', 'GA Analytics'), 'googletagmanager':'GTM', sentry:t('Sentry 监控', 'Sentry Monitoring'), 'sentry-cdn':t('Sentry 监控', 'Sentry Monitoring'), segment:'Segment', hotjar:t('Hotjar 录屏', 'Hotjar Recording'), clarity:t('Clarity 录屏', 'Clarity Recording'), growingio:'GrowingIO', sensorsdata:t('神策数据', 'Sensors Analytics'), mixpanel:'Mixpanel', amplitude:'Amplitude', bugsnag:'Bugsnag', datadog:'Datadog RUM', intercom:t('Intercom 客服', 'Intercom Support'), zhichi:t('智齿客服', 'Zhichi Support') };
    var trackers = [];
    $$('script[src]').forEach(function(s){
      var h = (function(){ try{ return new URL(s.src).hostname; }catch(e){ return s.src; } })();
      Object.keys(KNOWN).forEach(function(k){ if(h.indexOf(k) > -1) trackers.push([KNOWN[k], h]); });
    });
    if(trackers.length){
      b.appendChild(el('div', 'grp-h', t('埋点 / 监控 / 客服', 'Analytics / Monitoring / Support')));
      var d1 = el('div', 'lst');
      trackers.forEach(function(f){ d1.appendChild(el('div', 'li', '<span class="u">' + esc(f[0]) + '</span><span class="c" style="color:#475569">' + esc(f[1]) + '</span>')); });
      b.appendChild(d1);
    }

    /* 2) 前端依赖指纹：DOM 标记 + 全局变量（适用于打包后的 SPA，如 sz-admin） */
    var LIBS = [
      { n:'Vue 3', t:function(){ return !!(window.Vue || (B.detectStack && B.detectStack().Vue3)); } },
      { n:'Element Plus', t:function(){ return !!(window.ElementPlus || document.querySelector('.el-button,.el-table,.el-menu,.el-input,.el-dialog,.el-form')); } },
      { n:'Element UI (Vue2)', t:function(){ return !!window.ELEMENT; } },
      { n:'Ant Design Vue', t:function(){ return !!document.querySelector('.ant-btn,.ant-table,.ant-menu,.ant-input'); } },
      { n:'Pinia', t:function(){ return !!(window.Pinia || window.__pinia); } },
      { n:'Vue Router', t:function(){ return !!window.__vue_router__; } },
      { n:'Axios', t:function(){ return !!window.axios; } },
      { n:'ECharts', t:function(){ return !!(window.echarts || document.querySelector('[class*="echarts"],.echarts-canvas,canvas[data-zr-dom-id]')); } },
      { n:'Lodash', t:function(){ return !!window._; } },
      { n:'Day.js / Moment', t:function(){ return !!(window.dayjs || window.moment); } },
      { n:'Swiper', t:function(){ return !!window.Swiper; } },
      { n:'TinyMCE', t:function(){ return !!window.tinymce; } }
    ];
    var libs = LIBS.filter(function(l){ try{ return l.t(); }catch(e){ return false; } });
    if(libs.length){
      b.appendChild(el('div', 'grp-h', t('前端依赖指纹', 'Frontend Dependency Fingerprints')));
      var d2 = el('div', 'lst');
      libs.forEach(function(l){ d2.appendChild(el('div', 'li', '<span class="u">' + esc(l.n) + '</span><span class="c" style="color:#475569">' + t('推断（DOM/全局标记）', 'Inferred (DOM / global markers)') + '</span>')); });
      b.appendChild(d2);
    }

    if(!trackers.length && !libs.length) b.appendChild(el('div', 'note', t('未发现已知第三方 SDK，也未识别到常见前端依赖指纹。', 'No known third-party SDKs found, and no common frontend dependency fingerprints detected.')));
    b.appendChild(note(t('原型页引入了 2 个带 src 的脚本标签（google-analytics / example-cdn）用于演示识别；依赖指纹基于 DOM 标记与全局变量推断（打包后的库默认不上 window，可能漏检）。',
      'The prototype page includes 2 script tags with src (google-analytics / example-cdn) for demo detection; dependency fingerprints are inferred from DOM markers and globals (bundled libraries are not exposed on window by default, so some may be missed).')));
  }}
]);
})(window.BATB);
