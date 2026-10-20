/* 演示页脚本 —— 不属于工具箱。
   1) 页面标记：__APP_VERSION__、给「导出订单」挂假 React fiber/props（技术栈/事件反查演示）
   2) 演示控制条：白名单开关 / 锁定滚动 / 固定导航 / 主题切换 / 弹窗 / 触发请求 / 禁右键禁复制 */

(function(){
/* ============ 模拟页标记：让技术栈检测有东西可检出 ============ */
window.__APP_VERSION__ = '3.14.2';
(function(){ // 给「导出订单」挂上假的 React fiber / props，供事件反查、组件名定位演示
  var b = document.getElementById('btn-export');
  b['__reactProps$abc123'] = { onClick: function handleExportClick(e){ fetch('/api/orders/export', {method:'POST'}); } };
  b['__reactFiber$abc123'] = { type: { name: 'ExportButton' } };
})();

/* ================= 演示控制条 ================= */
document.getElementById('d-wl').onclick = function(){
  var h = document.getElementById('ba-toolbox-host');
  var off = h.style.display === 'none';
  h.style.display = off ? '' : 'none';
  this.textContent = '白名单：' + (off ? '开（关=工具箱消失）' : '关（工具箱已隐藏）');
};
document.getElementById('d-lock').onclick = function(){
  document.body.classList.toggle('locked');
  this.textContent = document.body.classList.contains('locked') ? '解锁滚动' : '锁定滚动（弹窗同效）';
};
document.getElementById('d-nav').onclick = function(){
  var n = document.getElementById('nav'), hide = n.style.display !== 'none';
  n.style.display = hide ? 'none' : '';
  this.textContent = '固定导航：' + (hide ? '隐藏' : '显示');
};
document.getElementById('d-theme').onclick = function(){
  document.body.classList.toggle('dark');
  this.textContent = '主题：' + (document.body.classList.contains('dark') ? '深色' : '浅色');
};
document.getElementById('open-modal').onclick = function(){ document.getElementById('modal').classList.add('show'); document.body.classList.add('locked'); };
document.getElementById('close-modal').onclick = function(){ document.getElementById('modal').classList.remove('show'); document.body.classList.remove('locked'); };
document.getElementById('btn-fetch').onclick = function(){
  fetch('/api/orders?page=1&size=20').then(function(r){ return r.json(); }).catch(function(){});
};
document.getElementById('no-copy').addEventListener('contextmenu', function(e){ e.preventDefault(); });
document.getElementById('no-copy').addEventListener('copy', function(e){ e.preventDefault(); });
})();
