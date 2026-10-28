/* 工具箱 · widgets —— 结果组件：codeBox / kv / note / btn / badge / scoreBadge / toast。
   通过 B.w.* 供各功能文件使用；toast 连同其 DOM 在本模块自持。 */
(function(B){
if(!B || B.w) return; // 防重复注入
var el = B.u.el, copyText = B.u.copyText, I = B.I, t = B.t;

var toastEl = el('div', 'toast');
B.shadow.appendChild(toastEl);

function toast(msg){
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastEl._t); toastEl._t = setTimeout(function(){ toastEl.classList.remove('show'); }, 1900);
}

B.w = {
  toast: toast,
  codeBox: function(code, maxH){
    var box = el('div');
    box.style.position = 'relative';
    var pre = el('pre'); pre.textContent = code; if(maxH) pre.style.maxHeight = maxH + 'px';
    var cp = el('button', 'btn2', I('copy', 11) + ' ' + t('复制', 'Copy'));
    cp.style.cssText = 'position:absolute;top:6px;right:6px;padding:2px 8px;font-size:10px';
    cp.onclick = function(){ copyText(code).then(function(){ toast(t('已复制到剪贴板', 'Copied to clipboard')); }); };
    box.appendChild(pre); box.appendChild(cp);
    return box;
  },
  kv: function(rows){
    var d = el('dl', 'kv');
    rows.forEach(function(r){ var dt = el('dt'); dt.textContent = r[0]; var dd = el('dd'); dd.innerHTML = r[1]; d.appendChild(dt); d.appendChild(dd); });
    return d;
  },
  note: function(t){ return el('div', 'note', t); },
  btn: function(label, fn, cls){ var b = el('button', 'btn2 ' + (cls || ''), label); b.onclick = fn; return b; },
  badge: function(t, k){ return '<span class="bdg ' + (k || 'b') + '">' + t + '</span>'; },
  scoreBadge: function(s){
    return B.w.badge(s.score + t(' 分', ' pts'), s.score >= 80 ? 'g' : s.score >= 50 ? 'y' : 'r') + ' <span style="font-size:10.5px;color:#64748b">' + s.why + '</span>';
  }
};
})(window.BATB);
