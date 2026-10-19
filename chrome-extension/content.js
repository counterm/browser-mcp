/*
 * Page Bridge - content script（每个标签页一个实例）
 * 职责：DOM 快照 + 动作执行。所有网络通信都由 background.js 代理。
 * 自愈：定期向 SW 重发 hello（消息会唤醒 SW），SW 重启后自动重建通道。
 */
(() => {
  'use strict';
  if (window.__PAGE_BRIDGE_CONTENT__) return;
  window.__PAGE_BRIDGE_CONTENT__ = true;

  const W = window;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sendMsg = (m) => chrome.runtime.sendMessage(m).catch(() => {});
  const pageInfo = () => ({
    url: location.href,
    title: document.title,
    viewport: `${W.innerWidth}x${W.innerHeight}`,
  });

  /* ============ 1. 元素索引与快照（LLM 的眼睛） ============ */

  const INTERACTIVE = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    'label[for]', '[onclick]', '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="option"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const index = new Map(); // bid -> Element

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }

  function reindex() {
    document.querySelectorAll('[data-bid]').forEach((e) => e.removeAttribute('data-bid'));
    index.clear();
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (!visible(el)) continue;
      const bid = index.size;
      el.setAttribute('data-bid', bid);
      index.set(bid, el);
      if (index.size >= 300) break;
    }
  }

  function describe(bid, el) {
    const t = el.tagName.toLowerCase();
    const txt = (el.innerText || el.value || el.placeholder
      || el.getAttribute('aria-label') || el.getAttribute('title') || el.alt || '')
      .trim().replace(/\s+/g, ' ').slice(0, 80);
    const a = [];
    if (el.id) a.push(`#${el.id}`);
    if (el.name) a.push(`name=${el.name}`);
    if (el.type) a.push(`type=${el.type}`);
    const role = el.getAttribute('role');
    if (role) a.push(`role=${role}`);
    const href = el.getAttribute('href');
    if (href && href !== '#') a.push(`href=${href.slice(0, 60)}`);
    if (el.type === 'checkbox' || el.type === 'radio') a.push(`checked=${!!el.checked}`);
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') a.push('disabled');
    return `[${bid}] <${t}${a.length ? ' ' + a.join(' ') : ''}> ${txt}`;
  }

  function buildSnapshot() {
    reindex();
    const lines = [...index.entries()].map(([bid, el]) => describe(bid, el));
    return {
      ...pageInfo(),
      scroll: { y: Math.round(W.scrollY), height: document.documentElement.scrollHeight },
      elements: lines.join('\n') || '<EMPTY>',
      text: (document.body && document.body.innerText || '')
        .replace(/\n{3,}/g, '\n\n').slice(0, 6000),
    };
  }

  function resolve(ref) {
    if (ref == null) return null;
    const s = String(ref);
    if (/^\d+$/.test(s)) return index.get(+s) || document.querySelector(`[data-bid="${s}"]`);
    return document.querySelector(s); // 也接受 CSS selector
  }
  const need = (ref) => {
    const el = resolve(ref);
    if (!el) throw new Error(`element not found: ${ref}`);
    return el;
  };

  /* ============ 2. 动作实现 ============ */

  const fireMouse = (el, type) => el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, view: W, button: 0 }));

  // React/Vue 受控组件必须走原生 setter + input/change 事件
  function setValue(el, text) {
    el.focus();
    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return;
    }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const ACTIONS = {
    ping: async () => ({ pong: true, ...pageInfo() }),
    snapshot: async () => buildSnapshot(),

    click: async ({ bid }) => {
      const el = need(bid);
      el.scrollIntoView({ block: 'center' });
      fireMouse(el, 'mouseover');
      fireMouse(el, 'mousedown');
      fireMouse(el, 'mouseup');
      el.click();
      await sleep(150);
      return `clicked [${bid}]`;
    },

    type: async ({ bid, text = '', clear = true }) => {
      const el = need(bid);
      el.scrollIntoView({ block: 'center' });
      el.focus();
      if (clear) setValue(el, '');
      if (text) setValue(el, text);
      await sleep(100);
      return `typed into [${bid}]`;
    },

    press: async ({ key, bid }) => {
      const el = bid != null ? need(bid) : document.activeElement;
      const init = { key, code: key, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
      if (key === 'Enter') {
        if (el.form && el.form.requestSubmit) el.form.requestSubmit();
        else if (el.click) el.click();
      }
      await sleep(150);
      return `pressed ${key}`;
    },

    select: async ({ bid, value }) => {
      const el = need(bid);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return `selected ${value}`;
    },

    scroll: async ({ dy = 600, bid }) => {
      if (bid != null) need(bid).scrollIntoView({ block: 'center' });
      else W.scrollBy(0, dy);
      await sleep(120);
      return `scrolled, y=${Math.round(W.scrollY)}`;
    },

    hover: async ({ bid }) => {
      const el = need(bid);
      el.scrollIntoView({ block: 'center' });
      fireMouse(el, 'mouseover');
      fireMouse(el, 'mousemove');
      return 'hovered';
    },

    nav: async ({ url }) => {
      setTimeout(() => { location.href = url; }, 50);
      return 'navigating';
    },
    back: async () => { history.back(); return 'back'; },
    reload: async () => { setTimeout(() => location.reload(), 50); return 'reloading'; },

    // 全方位权限核心：页面内任意 JS（支持 async/await）
    eval: async ({ code }) => {
      const r = await (async () => eval(code))();
      return serialize(r);
    },

    cookies: async ({ op = 'get', name, value }) => {
      if (op === 'set') {
        document.cookie = `${name}=${encodeURIComponent(value)}; path=/`;
        return 'ok';
      }
      const out = {};
      document.cookie.split(';').forEach((p) => {
        const i = p.indexOf('=');
        if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
      });
      return name ? out[name] : out;
    },

    storage: async ({ area = 'local', key, value }) => {
      const s = area === 'session' ? sessionStorage : localStorage;
      if (value === undefined) return key ? s.getItem(key) : JSON.stringify({ ...s });
      s.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      return 'ok';
    },

    upload: async ({ bid, files = [] }) => {
      const el = need(bid);
      const dt = new DataTransfer();
      for (const f of files) {
        dt.items.add(new File([f.content || ''], f.name,
          { type: f.mime || 'application/octet-stream' }));
      }
      el.files = dt.files;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return `uploaded ${files.length} file(s) to [${bid}]`;
    },

    wait: async ({ ms = 1000 }) => { await sleep(Math.min(ms, 15000)); return `waited ${ms}ms`; },

    highlight: async ({ bid }) => {
      const el = need(bid);
      const old = el.style.cssText;
      el.style.cssText += ';outline:2px solid red !important;outline-offset:2px !important;';
      setTimeout(() => { el.style.cssText = old; }, 2000);
      return 'highlighted for 2s';
    },
  };

  function serialize(v, depth = 0) {
    if (v === undefined) return 'undefined';
    if (v instanceof Element) return v.outerHTML.slice(0, 2000);
    if (typeof v === 'function') return String(v).slice(0, 300);
    if (v === null || typeof v !== 'object') return String(v);
    if (depth > 3) return '[depth-limit]';
    try {
      return JSON.stringify(v, (k, x) => {
        if (typeof x === 'bigint') return String(x);
        if (x instanceof Element) return x.outerHTML.slice(0, 300);
        return x;
      }, 1) || String(v);
    } catch { return String(v); }
  }

  /* ============ 3. 命令入口（来自 background） ============ */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const cmd = msg && msg.__bridge_cmd;
    if (!cmd) return;
    (async () => {
      const fn = ACTIONS[cmd.action];
      if (!fn) {
        sendResponse({ ok: false, error: `unknown action: ${cmd.action}` });
        return;
      }
      try {
        sendResponse({ ok: true, data: (await fn(cmd)) ?? null });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true; // 异步 sendResponse
  });

  /* ============ 4. 上线广播 + 自愈 ============ */

  let acked = false;

  // hello 会唤醒 SW；SW 重启后 Map 清空，重发 hello 即重建通道
  async function helloLoop() {
    for (let i = 0; i < 12 && !acked; i++) {
      try {
        const r = await chrome.runtime.sendMessage({ type: 'hello', ...pageInfo() });
        if (r && r.ok) { acked = true; return; }
      } catch {}
      await sleep(5000);
    }
  }
  helloLoop();
  setInterval(() => { acked = false; helloLoop(); }, 20000);

  // DOM 变化（防抖）
  let t;
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => { reindex(); sendMsg({ type: 'event', name: 'dom_changed' }); }, 600);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // SPA 路由变化
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) {
      const r = orig.apply(this, a);
      sendMsg({ type: 'event', name: 'nav', ...pageInfo() });
      return r;
    };
  }
  W.addEventListener('popstate', () => sendMsg({ type: 'event', name: 'nav', ...pageInfo() }));
  W.addEventListener('beforeunload', () => sendMsg({ type: 'bye' }));
})();
