/* 工具箱 · feats/capture —— 「采集」分类：网址二维码 / 整页截图。
   整页截图走扩展桥：页面主世界（本文件）→ DOM 事件 batb:bridge → content.js →
   chrome.runtime.sendMessage（tb:shot）→ background captureVisibleTab → 原路回传 batb:bridge:res。
   滚动编排、拼接、下载全部在页面侧完成。 */
(function(B){
if(!B) return;
var el = B.u.el, esc = B.u.esc, $$ = B.u.$$;
var kv = B.w.kv, note = B.w.note, toast = B.w.toast;

var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };

/* ---------- 扩展桥：单次请求/响应（content.js 监听 batb:bridge 转发 background） ---------- */
function bridge(action, params, timeoutMs){
  return new Promise(function(resolve, reject){
    var id = Math.random().toString(36).slice(2);
    var timer = setTimeout(function(){
      cleanup();
      reject(new Error('扩展桥无响应（扩展未就绪或刚更新过，请刷新页面后重试）'));
    }, timeoutMs || 15000);
    function onRes(ev){
      var d = ev.detail;
      if(!d || d.id !== id) return;
      cleanup();
      if(d.ok) resolve(d.data);
      else reject(new Error(d.error || '扩展桥调用失败'));
    }
    function cleanup(){ clearTimeout(timer); window.removeEventListener('batb:bridge:res', onRes); }
    window.addEventListener('batb:bridge:res', onRes);
    window.dispatchEvent(new CustomEvent('batb:bridge', { detail: { id: id, action: action, params: params || {} } }));
  });
}

/* 单屏截取（规避 captureVisibleTab 每秒限额：失败退避重试一次） */
function shot(){
  return bridge('shot', {}, 12000).catch(function(e){
    if(/CAPTURE_VISIBLE_TAB|MAX_CAPTURE|per second/i.test(String(e.message))){
      return sleep(700).then(function(){ return bridge('shot', {}, 12000); });
    }
    throw e;
  });
}

function loadImg(url){
  return new Promise(function(res, rej){
    var im = new Image();
    im.onload = function(){ res(im); };
    im.onerror = function(){ rej(new Error('截图数据解码失败')); };
    im.src = url;
  });
}

function downloadCanvas(cv, name){
  cv.toBlob(function(blob){
    if(!blob){ toast('PNG 编码失败'); return; }
    var u = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(u); }, 5000);
    toast('已下载 ' + name);
  }, 'image/png');
}

function safeName(s){ return (s || 'page').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'page'; }

/* 结果预览图 + 输出信息（fullshot / elshot 共用） */
function showResult(b, cv, rows, extraNotes){
  var pv = el('div');
  pv.style.cssText = 'border:1px solid rgba(255,255,255,.14);border-radius:10px;overflow:hidden;margin:6px 0;max-height:170px';
  cv.style.cssText = 'display:block;width:100%;height:auto';
  pv.appendChild(cv);
  b.appendChild(pv);
  b.appendChild(kv(rows));
  (extraNotes || []).forEach(function(t){ b.appendChild(note(t)); });
}
function stampName(prefix){
  var d = new Date(), p2 = function(n){ return (n < 10 ? '0' : '') + n; };
  return prefix + '-' + safeName(location.hostname) + '-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + '.png';
}

/* ---------- 浮动元素处理：fixed 每屏重复、sticky 吸顶重复，截图期间临时处理、完成后还原 ---------- */
/* fixed 为脱离文档流，隐藏不影响布局；sticky 占据常规流位置，转 static 后只在原位出现一次 */
function markFloating(scroller){
  var n = 0, m = 0;
  $$('body *').forEach(function(e){
    if(e === B.host || B.host.contains(e)) return; /* 工具箱自身（已隐藏）不处理 */
    if(scroller && (e === scroller || e.contains(scroller))) return; /* 滚动容器自身与其祖先不动，避免目标被藏掉 */
    var p = getComputedStyle(e).position;
    if(p === 'fixed'){ e.setAttribute('data-ba-fx', ''); n++; }
    else if(p === 'sticky'){ e.setAttribute('data-ba-stk', ''); m++; }
  });
  B.dlog('capture', 'floating fixed=' + n + ' sticky=' + m);
  B.style.pageStyle('ba-nofloat', '[data-ba-fx]{display:none!important}[data-ba-stk]{position:static!important}');
  return { fixed: n, sticky: m };
}
function unmarkFloating(){
  B.style.pageStyle('ba-nofloat', null);
  $$('[data-ba-fx],[data-ba-stk]').forEach(function(e){ e.removeAttribute('data-ba-fx'); e.removeAttribute('data-ba-stk'); });
}

/* ---------- 容器截图：拾取滚动容器，只截它内部的滚动范围 ---------- */
/* 最近可滚动祖先（含自身）；页面级滚动返回 document.scrollingElement */
function scrollParent(e){
  var de = document.scrollingElement || document.documentElement;
  var n = e;
  while(n && n.nodeType === 1 && n !== de){
    var cs = getComputedStyle(n);
    if(/(auto|scroll|overlay)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
    n = n.parentElement;
  }
  return de;
}

function runElshot(b, target){
  (async function(){
    var de = document.scrollingElement || document.documentElement;
    var sc = scrollParent(target);
    var page = sc === de; /* 无内部滚动区：退化为区域截图（当前可见部分） */
    B.dlog('elshot', 'enter target=' + target.tagName.toLowerCase() + (target.id ? '#' + target.id : '') +
      ' mode=' + (page ? 'page-region' : 'container') + ' scroller=' + sc.tagName.toLowerCase() + (sc.id ? '#' + sc.id : ''));
    var dpr = window.devicePixelRatio || 1;
    var vw = window.innerWidth, vh = window.innerHeight;
    var prevDisp = B.host.style.display;
    var prevTop = sc.scrollTop, prevPageY = window.scrollY;

    /* 先隐藏工具箱与滚动条，再尽量把容器带入视口，最后才测量——避免布局变化导致裁剪坐标漂移 */
    B.host.style.display = 'none';
    sc.setAttribute('data-ba-nosb', '');
    B.style.pageStyle('ba-elnosb', '[data-ba-nosb]{scrollbar-width:none!important}[data-ba-nosb]::-webkit-scrollbar{display:none!important}');
    await sleep(60);
    if(!page) sc.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    await sleep(140);

    var tiles = [];
    try{
      var fl = markFloating(page ? null : sc); /* fixed 隐藏 / sticky 取消吸附（容器祖先除外），测量前处理保证矩形准确 */
      var r = sc.getBoundingClientRect();
      var visTop = Math.max(r.top, 0), visBottom = Math.min(r.bottom, vh);
      var cropX = Math.max(r.left, 0), cropRight = Math.min(r.right, vw);
      var sliceH = visBottom - visTop, cropW = cropRight - cropX;
      if(sliceH < 4 || cropW < 4) throw new Error('目标区域几乎不在视口内，无法截取');
      var sx = Math.round(cropX * dpr), sy = Math.round(visTop * dpr);
      var sw = Math.round(cropW * dpr), sh = Math.round(sliceH * dpr);
      /* 可见切片在容器内容坐标里的起点；页面级滚动时画布即从切片顶开始 */
      var sliceTop = page ? 0 : Math.round(visTop - r.top);
      /* 步长必须取可视切片高度：容器比视口高时按 clientHeight 步进会漏屏 */
      var step = Math.max(Math.round(sliceH), 1);
      var maxScroll = page ? 0 : Math.max(sc.scrollHeight - sc.clientHeight, 0);
      var pos = [];
      for(var y = 0; y <= maxScroll; y += step) pos.push(y);
      if(pos[pos.length - 1] !== maxScroll) pos.push(maxScroll); /* 末屏不足一整步，补截贴底位置 */
      B.dlog('elshot', 'plan rect=' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + 'x' + Math.round(r.height) +
        ' slice=' + Math.round(sliceH) + 'x' + Math.round(cropW) + ' scrollRange=' + maxScroll + ' steps=' + pos.length);

      toast((page ? '开始区域截图…' : '开始容器截图（' + pos.length + ' 屏）') + '，请保持页面在前台…');
      await sleep(900);

      for(var i = 0; i < pos.length; i++){
        if(!page) sc.scrollTop = pos[i]; /* 页面级滚动模式绝不改 scrollTop，否则页面跳顶、裁剪区错位 */
        await sleep(620); /* 等滚动/懒加载稳定，同时规避每秒截取限额 */
        var cur = page ? 0 : Math.round(sc.scrollTop);
        if(tiles.length && cur <= tiles[tiles.length - 1].y) continue; /* 已贴底，重复位置跳过 */
        var res = await shot();
        tiles.push({ y: cur, url: res.dataUrl });
        B.dlog('elshot', 'tile ' + tiles.length + '@' + cur + ' ok');
      }
      if(!tiles.length) throw new Error('未截取到任何画面');

      /* 拼接：每屏裁出容器矩形，按容器内容坐标（scrollTop + 切片偏移）定位，天然无重叠错位 */
      var imgs = await Promise.all(tiles.map(function(t){ return loadImg(t.url); }));
      var outH = Math.round((maxScroll + sliceTop + sliceH) * dpr);
      var H = Math.min(outH, 32767); /* canvas 高度硬上限 */
      var cv = document.createElement('canvas');
      cv.width = sw; cv.height = H;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sw, H);
      tiles.forEach(function(t, k){ ctx.drawImage(imgs[k], sx, sy, sw, sh, 0, Math.round((t.y + sliceTop) * dpr), sw, sh); });

      var name = stampName(page ? 'region' : 'container');
      downloadCanvas(cv, name);

      var desc = sc.tagName.toLowerCase() + (sc.id ? '#' + sc.id : '') + (sc.className && typeof sc.className === 'string' ? '.' + sc.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
      var notes = [];
      if(fl.fixed || fl.sticky) notes.push('截图期间已自动隐藏 ' + fl.fixed + ' 个 fixed 元素、取消 ' + fl.sticky + ' 个 sticky 吸附（现已还原）。');
      notes.push('截图期间请勿滚动页面或该容器。');
      if(page) notes.push('目标无可滚动祖先，已按区域截图处理（仅当前可见部分）。');
      var clipped = sc.clientHeight - sliceH; /* 被视口上下裁掉、物理上无法截取的内容高度 */
      if(!page && clipped > 2) notes.push('容器有约 ' + clipped + 'px 内容被视口裁住（顶部/底部露出不全），该部分无法截取——可缩小页面缩放后再试。');
      if(r.left < 0 || r.right > vw) notes.push('横向超出视口的部分未截取。');
      showResult(b, cv, [
        ['目标', esc(desc)],
        ['输出', sw + '×' + H + ' px PNG' + (outH > H ? '（超出 32767px，已截断）' : '')],
        [page ? '模式' : '拼接', page ? '区域截图 · 当前可见部分' : tiles.length + ' 屏 · DPR ' + dpr]
      ], notes);
    } finally {
      B.dlog('elshot', 'finally tiles=' + tiles.length);
      unmarkFloating();
      B.style.pageStyle('ba-elnosb', null);
      sc.removeAttribute('data-ba-nosb');
      sc.scrollTop = prevTop;
      window.scrollTo({ top: prevPageY, behavior: 'instant' });
      B.host.style.display = prevDisp;
    }
  })().catch(function(e){ B.dlog('elshot', 'error ' + String(e && e.message || e)); toast('容器截图失败'); b.appendChild(note('失败：' + esc(String(e.message || e)))); });
}

B.register([
{ id:'qr', cat:'capture', name:'网址二维码', icon:'qr', star:2, desc:'当前网址纯本地生成二维码，手机扫码直达',
  run:function(b){
    var url = location.href;
    if(!B.QR){ b.appendChild(note('二维码模块（qr.js）未加载，请检查扩展注入清单。')); return; }
    var box = el('div');
    box.style.cssText = 'display:flex;justify-content:center;background:#fff;border-radius:12px;padding:10px;margin:4px 0 8px';
    var cv = document.createElement('canvas');
    box.appendChild(cv);
    b.appendChild(box);
    try{
      var qr = B.QR.make(url);
      var n = qr.getModuleCount(), quiet = 4;
      var cell = Math.max(2, Math.floor(196 / (n + quiet * 2)));
      var size = (n + quiet * 2) * cell;
      cv.width = size; cv.height = size;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#111';
      for(var r = 0; r < n; r++) for(var c = 0; c < n; c++)
        if(qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
      cv.style.cssText = 'width:' + size + 'px;max-width:100%;height:auto;image-rendering:pixelated;display:block';
      b.appendChild(kv([['网址', esc(url)], ['规格', n + '×' + n + ' 模块 · EC 级别 M']]));
      b.appendChild(el('div', 'row2',
        '<button class="btn2" data-a="dl">下载 PNG</button><button class="btn2" data-a="cp">复制链接</button>'));
      b.querySelector('[data-a="dl"]').onclick = function(){ downloadCanvas(cv, 'qr-' + safeName(location.hostname) + '.png'); };
      b.querySelector('[data-a="cp"]').onclick = function(){ B.u.copyText(url).then(function(){ toast('已复制到剪贴板'); }); };
    }catch(e){
      box.style.display = 'none';
      b.appendChild(note('生成失败：' + esc(String(e.message || e)) + '（网址过长超出 v40 容量上限）'));
    }
    b.appendChild(note('纯本地生成，网址不会发往任何服务。用微信 / 系统相机扫码即可在手机打开本页。'));
  }},
{ id:'fullshot', cat:'capture', name:'整页截图', icon:'image', star:3, desc:'滚动逐屏截取拼接为长图，自动下载 PNG',
  run:function(b){
    var prevDisp = B.host.style.display;
    var prevScroll = window.scrollY;

    (async function(){
      var de = document.documentElement;
      var dpr = window.devicePixelRatio || 1;
      var vh = window.innerHeight;
      var total = Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0);
      if(!(total > 0)) throw new Error('页面高度为 0，无可截取内容');

      var pos = [];
      for(var y = 0; y < total; y += vh) pos.push(Math.min(y, total - vh));

      toast('开始整页截图（' + pos.length + ' 屏），请保持页面在前台…');
      await sleep(900);

      /* 隐藏工具箱与页面滚动条，避免截进画面 */
      B.host.style.display = 'none';
      B.style.pageStyle('ba-nosb', 'html{scrollbar-width:none!important}html::-webkit-scrollbar{display:none!important}body{scrollbar-width:none!important}body::-webkit-scrollbar{display:none!important}');
      var tiles = [], fl = { fixed: 0, sticky: 0 };
      try{
        fl = markFloating(null); /* fixed 隐藏 / sticky 取消吸附，避免每屏重复；完成后 finally 还原 */
        for(var i = 0; i < pos.length; i++){
          window.scrollTo({ top: pos[i], behavior: 'instant' });
          await sleep(620); /* 等滚动/懒加载稳定，同时规避每秒截取限额 */
          var sy = Math.round(window.scrollY);
          if(tiles.length && sy <= tiles[tiles.length - 1].y) continue; /* 已贴底，重复位置跳过 */
          var res = await shot();
          tiles.push({ y: sy, url: res.dataUrl });
        }
      } finally {
        unmarkFloating();
        B.host.style.display = prevDisp;
        B.style.pageStyle('ba-nosb', null);
        window.scrollTo({ top: prevScroll, behavior: 'instant' });
      }
      if(!tiles.length) throw new Error('未截取到任何画面');

      /* 拼接：按实际 scrollY × dpr 定位每屏，规避累积误差 */
      var imgs = await Promise.all(tiles.map(function(t){ return loadImg(t.url); }));
      var w = imgs[0].naturalWidth;
      var fullH = Math.round(total * dpr);
      var H = Math.min(fullH, 32767); /* canvas 高度硬上限 */
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = H;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, H);
      imgs.forEach(function(im, k){ ctx.drawImage(im, 0, Math.round(tiles[k].y * dpr)); });

      var name = stampName('fullpage');
      downloadCanvas(cv, name);

      var shotNotes = [];
      if(fl.fixed || fl.sticky) shotNotes.push('截图期间已自动隐藏 ' + fl.fixed + ' 个 fixed 元素、取消 ' + fl.sticky + ' 个 sticky 吸附（现已还原）。');
      if(pos.length === 1) shotNotes.push('本次仅截到一屏：当前文档自身不可滚动，滚动可能发生在某个内部容器——如需截取内部滚动范围，请改用「容器截图」。');
      shotNotes.push('横向超出视口的部分不会截取；截图期间请勿滚动或切走页面。');
      showResult(b, cv, [
        ['输出', w + '×' + H + ' px PNG' + (fullH > H ? '（超出 32767px，已截断）' : '')],
        ['拼接', tiles.length + ' 屏 · DPR ' + dpr],
        ['文件', esc(name)]
      ], shotNotes);
    })().catch(function(e){ toast('整页截图失败'); b.appendChild(note('失败：' + esc(String(e.message || e)))); });
  }},
{ id:'elshot', cat:'capture', name:'容器截图', icon:'crop', star:3, desc:'拾取滚动容器，只截它内部的完整滚动范围',
  run:function(b){
    B.dlog('elshot', 'opened');
    b.appendChild(note('在页面上点击要截取的滚动容器（或其中任一元素，自动向上定位滚动区）：内部逐屏滚动截取、按容器矩形裁剪拼接为长图；无可滚动祖先时退化为区域截图。Esc 取消。'));
    toast('请在页面上点击要截取的容器');
    B.pick().then(function(t){ if(t) runElshot(b, t); });
  }},
{ id:'apinet', cat:'capture', name:'接口调用', icon:'share', star:3, desc:'捕获页面请求：URL/请求体/响应/鉴权头，一键复制给 LLM',
  run:function(b){
    var N = window.__BATB_NET__;
    if(!N){
      b.appendChild(note('接口捕获层（capture-main.js）未加载——扩展刚更新过的话，请到 chrome://extensions 重载扩展并刷新本页后重试。'));
      return;
    }
    var copyText = B.u.copyText;
    var redOn = localStorage.getItem('ba:netredact') !== '0'; /* 脱敏默认开 */

    /* 顶部操作行 */
    var bar = el('div', 'row2',
      '<button class="btn2" data-a="red">脱敏：开</button><button class="btn2" data-a="clr">清空记录</button>');
    b.appendChild(bar);
    var setRedBtn = function(){ bar.querySelector('[data-a="red"]').textContent = '脱敏：' + (redOn ? '开' : '关'); };
    setRedBtn();
    bar.querySelector('[data-a="red"]').onclick = function(){
      redOn = !redOn;
      localStorage.setItem('ba:netredact', redOn ? '1' : '0');
      setRedBtn();
      if(view.mode === 'detail') showDetail(view.id); else render();
    };
    bar.querySelector('[data-a="clr"]').onclick = function(){
      N.clear();
      /* bg 侧头记录一并清（失败不打断）；清两次：防清除期间轮询 sync 把 bg 记录以「仅头」复活 */
      bridge('netclear', {}).then(function(){ N.clear(); if(view.mode === 'list') render(); }).catch(function(){});
      if(view.mode === 'detail'){ view.mode = 'list'; view.id = null; }
      render();
      toast('已清空');
    };

    var d = el('div', 'lst');
    b.appendChild(d);
    var view = { mode: 'list', id: null }; /* 列表/详情在同一详情浮层内切换 */

    var timeStr = function(t){
      var x = new Date(t || 0), p2 = function(n){ return (n < 10 ? '0' : '') + n; };
      return p2(x.getHours()) + ':' + p2(x.getMinutes()) + ':' + p2(x.getSeconds());
    };
    var stCls = function(s){ return s === 200 ? 'g' : s === 'ERR' ? 'r' : 'y'; };
    var SRC_LBL = { page: '页面', merged: '合并', net: '仅头' };

    function render(){
      d.innerHTML = '';
      var recs = N.recs.slice().reverse();
      if(!recs.length){
        d.appendChild(el('div', 'note', '暂无请求。本页 document_start 起的 fetch/XHR（含 axios）与网络层请求都会记录；打开本面板后刷新或操作页面即可看到新请求。'));
        return;
      }
      recs.forEach(function(r){
        var li = el('div', 'li',
          '<span class="m">' + esc(r.m) + '</span><span class="u" title="' + esc(r.u) + '">' + esc(r.u) + '</span>' +
          '<span class="c"><span class="bdg ' + stCls(r.s) + '">' + esc(r.s == null ? '…' : String(r.s)) + '</span>' +
          (r.src !== 'page' ? ' <span style="color:#475569">' + SRC_LBL[r.src] + '</span>' : '') +
          (r.pending ? ' <span style="color:#475569">读体中</span>' : '') +
          ' <span style="color:#475569">' + timeStr(r.t) + '</span></span>');
        li.style.cursor = 'pointer';
        li.onclick = function(){ showDetail(r.id); };
        d.appendChild(li);
      });
    }

    function hdrDom(title, hs){
      var wrap = el('div');
      wrap.appendChild(el('div', 'grp-h', title));
      if(!hs || !hs.length){ wrap.appendChild(el('div', 'note', '（无）')); return wrap; }
      hs.forEach(function(h){
        wrap.appendChild(el('div', 'li', '<span class="u" style="word-break:break-all;white-space:normal;overflow:visible;text-overflow:clip">' + esc(h.k) + ': ' + esc(h.v) + '</span>'));
      });
      return wrap;
    }

    function showDetail(id){
      view.mode = 'detail'; view.id = id;
      d.innerHTML = '';
      var r = N.find(id);
      var back = el('div', 'row2', '<button class="btn2" data-a="back">← 返回列表</button>');
      back.querySelector('[data-a="back"]').onclick = function(){ view.mode = 'list'; view.id = null; render(); };
      d.appendChild(back);
      if(!r){ d.appendChild(el('div', 'note', '记录已不存在（缓冲滚动或已清空）。')); return; }

      var srcLbl = SRC_LBL[r.src] || r.src;
      d.appendChild(kv([
        ['方法', esc(r.m)],
        ['URL', '<span style="word-break:break-all">' + esc(r.u) + '</span>'],
        ['状态', esc(r.s == null ? '…' : String(r.s)) + (r.ms != null ? ' · ' + r.ms + 'ms' : '') + ' · ' + esc(srcLbl)],
        ['时间', timeStr(r.t)]
      ]));
      if(r.note) d.appendChild(note(esc(r.note)));

      d.appendChild(hdrDom('请求头' + (redOn ? '（已脱敏）' : ''), N.redactHdrs(r.reqHdr, redOn)));
      if(r.reqBody){
        d.appendChild(el('div', 'grp-h', '请求体' + (redOn ? '（已脱敏）' : '')));
        d.appendChild(B.w.codeBox(N.redactText(r.reqBody, redOn), 200));
      }
      d.appendChild(hdrDom('响应头' + (redOn ? '（已脱敏）' : ''), N.redactHdrs(r.resHdr, redOn)));
      d.appendChild(el('div', 'grp-h', '响应体'));
      if(r.pending) d.appendChild(el('div', 'note', '响应体读取中…（稍后返回列表再进即可看到）'));
      else if(r.resBody) d.appendChild(B.w.codeBox(N.redactText(r.resBody, redOn), 260));
      else d.appendChild(el('div', 'note', r.s === 'ERR' ? '请求失败，无响应体。' : '（未捕获：非 fetch/XHR 发起、SSE/二进制，或响应超上限）'));

      var btns = el('div', 'row2',
        '<button class="btn2" data-a="fmt">复制调试文本</button><button class="btn2" data-a="curl">复制 cURL</button>');
      btns.querySelector('[data-a="fmt"]').onclick = function(){ copyText(N.fmt(r, redOn)).then(function(){ toast('调试文本已复制，可粘贴给 LLM'); }); };
      btns.querySelector('[data-a="curl"]').onclick = function(){ copyText(N.curl(r, redOn)).then(function(){ toast('cURL 已复制'); }); };
      d.appendChild(btns);
    }

    render();
    N.sync().then(function(){ if(view.mode === 'list') render(); }); /* 打开即合并 bg 头记录 */
    B.ui.detailTimer = setInterval(function(){ if(view.mode === 'list') render(); }, 1500); /* 清理由 ui.clearDetail 统一负责 */
    b.appendChild(note('双层捕获：页面 hook 抓请求/响应体，扩展 webRequest 抓全量请求头（含 Cookie/Authorization），按 URL+时间合并——「仅头」= 整页跳转后只剩网络层记录（无响应体）。默认脱敏鉴权字段，需真实值再手动关。也可让 LLM 经 broker 的 netlog 命令自行查询（见 README）。'));
  }}
]);
})(window.BATB);
