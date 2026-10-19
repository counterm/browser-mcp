/* popup：当前页面白名单状态 + 一键加入/移出 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

  async function refresh() {
    const st = await send({ type: 'filter:status' });
    if (!st || !st.ok) return;
    const { url, domain, allowed, hit, record } = st;

    $('host').textContent = domain || url || '(未知页面)';
    try {
      $('favicon').src =
        `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=16`;
    } catch {}

    const badge = $('badge');
    if (allowed) {
      badge.textContent = '● 白名单';
      badge.className = 'badge b-white';
    } else {
      badge.textContent = '○ 不在白名单';
      badge.className = 'badge b-default';
    }

    $('hit').textContent = hit
      ? `命中${hit.kind === 'domain' ? '域名' : '正则'}: ${hit.value}`
      : '未命中任何规则，该页面不会接入 broker';
    renderButtons(st);
  }

  function renderButtons(st) {
    const box = $('btns');
    box.innerHTML = '';
    const mk = (text, cls, fn, danger) => {
      const b = document.createElement('button');
      b.textContent = text;
      if (cls) b.className = cls;
      if (danger) b.classList.add('danger');
      b.onclick = fn;
      box.appendChild(b);
      return b;
    };
    const { domain, record } = st;

    if (!domain) {
      mk('当前页面无域名（如 file://），无法一键添加', '', () => {}).disabled = true;
      return;
    }
    if (record) {
      mk('从白名单移除', '', async () => {
        await send({ type: 'filter:quickRemove' });
        refresh();
      }, true);
    } else {
      mk('加入白名单', 'primary', async () => {
        const r = await send({ type: 'filter:quickAdd' });
        if (r && !r.ok) $('msg').textContent = r.error || '';
        refresh();
      });
    }
  }

  refresh();
})();
