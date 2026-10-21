/* 工具箱 · feats/capture —— 「采集」分类：网址二维码 / 整页截图。
   整页截图走扩展桥：页面主世界（本文件）→ DOM 事件 batb:bridge → content.js →
   chrome.runtime.sendMessage（tb:shot）→ background captureVisibleTab → 原路回传 batb:bridge:res。
   滚动编排、拼接、下载全部在页面侧完成。 */
(function(B){
if(!B) return;
var el = B.u.el, esc = B.u.esc;
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
      var tiles = [];
      try{
        for(var i = 0; i < pos.length; i++){
          window.scrollTo({ top: pos[i], behavior: 'instant' });
          await sleep(620); /* 等滚动/懒加载稳定，同时规避每秒截取限额 */
          var sy = Math.round(window.scrollY);
          if(tiles.length && sy <= tiles[tiles.length - 1].y) continue; /* 已贴底，重复位置跳过 */
          var res = await shot();
          tiles.push({ y: sy, url: res.dataUrl });
        }
      } finally {
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

      var d = new Date(), p2 = function(n){ return (n < 10 ? '0' : '') + n; };
      var name = 'fullpage-' + safeName(location.hostname) + '-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + '.png';
      downloadCanvas(cv, name);

      var pv = el('div');
      pv.style.cssText = 'border:1px solid rgba(255,255,255,.14);border-radius:10px;overflow:hidden;margin:6px 0;max-height:170px';
      cv.style.cssText = 'display:block;width:100%;height:auto';
      pv.appendChild(cv);
      b.appendChild(pv);
      b.appendChild(kv([
        ['输出', w + '×' + H + ' px PNG' + (fullH > H ? '（超出 32767px，已截断）' : '')],
        ['拼接', tiles.length + ' 屏 · DPR ' + dpr],
        ['文件', esc(name)]
      ]));
      b.appendChild(note('固定定位（fixed/sticky）元素会在每屏重复出现——可先用「移除 fixed 浮层」再截。横向超出视口的部分不会截取；截图期间请勿滚动或切走页面。'));
    })().catch(function(e){ toast('整页截图失败'); b.appendChild(note('失败：' + esc(String(e.message || e)))); });
  }}
]);
})(window.BATB);
