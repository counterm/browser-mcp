// ==UserScript==
// @name         Page Bridge
// @namespace    browser-agent
// @version      0.1.0
// @description  轻接入：油猴自动加载，把当前页面广播给本地 broker，供任意 CLI/IDE 发现并接入控制
// @match        *://*/*
// @match        file:///*
// @exclude      http://127.0.0.1:8766/*
// @exclude      http://localhost:8766/*
// @noframes
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

/*
 * 通道：优先 WebSocket；被页面 CSP 拦截时自动降级为 GM_xmlhttpRequest 长轮询（不受 CSP/CORS 限制）。
 * 协议（与 broker.py 对应）：
 *   上行  hello / hb / event(nav|dom_changed) / result / bye
 *   下行  {id, action, ...params}，回 {type:'result', id, ok, data|error}
 * 调试：window.__BRIDGE__ = { stop(), snapshot(), id }
 */
(() => {
  'use strict';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (W.__PAGE_BRIDGE__) return;
  W.__PAGE_BRIDGE__ = true;

  const CFG = {
    host: '127.0.0.1',
    port: 8766,
    hbMs: 5000,        // WS 心跳间隔
    snapMax: 300,      // 快照元素上限
    textMax: 6000,     // 正文截断
    // 页面侧白名单（正则字符串），null = 所有页面都广播
    // 例: '^https://(github|gitlab)\\.com/'
    urlFilter: null,
  };
  const BROKER = `http://${CFG.host}:${CFG.port}`;

  const log = (...a) => console.log('%c[bridge]', 'color:#090', ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let stopped = false;
  let mode = 'ws';
  let ws = null;
  let wsFails = 0;
  let pageId = null;
  let hbTimer = null;

  const pageInfo = () => ({
    url: location.href,
    title: document.title,
    viewport: `${W.innerWidth}x${W.innerHeight}`,
  });
  const hello = () => ({ type: 'hello', ...pageInfo(), caps: Object.keys(ACTIONS) });

  /* ============ 1. 元素索引与快照（LLM 的眼睛，借鉴 page-agent/browser-use） ============ */

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
      if (index.size >= CFG.snapMax) break;
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
    if ((el.type === 'checkbox' || el.type === 'radio')) a.push(`checked=${!!el.checked}`);
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') a.push('disabled');
    return `[${bid}] <${t}${a.length ? ' ' + a.join(' ') : ''}> ${txt}`;
  }

  function buildSnapshot() {
    reindex();
    const lines = [...index.entries()].map(([bid, el]) => describe(bid, el));
    return {
      ...pageInfo(),
      scroll: {
        y: Math.round(W.scrollY),
        height: document.documentElement.scrollHeight,
      },
      elements: lines.join('\n') || '<EMPTY>',
      text: (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, CFG.textMax),
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
        if (el.form?.requestSubmit) el.form.requestSubmit();
        else el.click?.();
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
        dt.items.add(new File([f.content ?? ''], f.name, { type: f.mime || 'application/octet-stream' }));
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
      }, 1)?.slice(0, 5000) ?? String(v);
    } catch { return String(v); }
  }

  /* ============ 3. 命令分发 ============ */

  async function onCommand(cmd) {
    if (!cmd || cmd.type !== undefined) return; // 忽略非命令消息
    const fn = ACTIONS[cmd.action];
    if (!fn) {
      send({ type: 'result', id: cmd.id, ok: false, error: `unknown action: ${cmd.action}` });
      return;
    }
    try {
      const data = await fn(cmd);
      send({ type: 'result', id: cmd.id, ok: true, data: data === undefined ? null : data });
    } catch (e) {
      send({ type: 'result', id: cmd.id, ok: false, error: String((e && e.message) || e) });
    }
  }

  /* ============ 4. 传输层：WS 优先，CSP 拦截则降级 GM 长轮询 ============ */

  function send(msg) {
    if (stopped) return;
    if (mode === 'ws' && ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return; }
    if (mode === 'lp' && pageId) {
      gmJSON('POST', `${BROKER}/lp/reply`, { sid: pageId, msg }).catch(() => {});
    }
  }

  function gmJSON(method, url, body, timeout = 35000) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url, timeout,
        headers: { 'Content-Type': 'application/json' },
        data: body === undefined ? undefined : JSON.stringify(body),
        responseType: 'text',
        onload: (r) => {
          try { resolve(r.responseText ? JSON.parse(r.responseText) : null); }
          catch (e) { reject(e); }
        },
        onerror: () => reject(new Error('gm request failed')),
        ontimeout: () => resolve(null),
      });
    });
  }

  function startWS() {
    if (stopped) return;
    let sock;
    try { sock = new WebSocket(`ws://${CFG.host}:${CFG.port}/page`); }
    catch { return wsFail(); }
    ws = sock;
    const kill = setTimeout(() => { if (sock.readyState !== 1) sock.close(); }, 4000);
    sock.onopen = () => {
      clearTimeout(kill);
      wsFails = 0;
      mode = 'ws';
      sock.send(JSON.stringify(hello()));
      clearInterval(hbTimer);
      hbTimer = setInterval(() => send({ type: 'hb', ...pageInfo() }), CFG.hbMs);
      log(`WS 已连接 broker(${CFG.host}:${CFG.port})`);
    };
    sock.onmessage = (e) => { try { onCommand(JSON.parse(e.data)); } catch {} };
    sock.onclose = () => { clearTimeout(kill); if (!stopped && mode === 'ws') wsFail(); };
    sock.onerror = () => { try { sock.close(); } catch {} };
  }

  function wsFail() {
    ws = null;
    if (++wsFails >= 2) {
      log('WS 不可达（可能被页面 CSP 拦截），降级为 HTTP 长轮询');
      startLP();
    } else {
      setTimeout(startWS, 2000);
    }
  }

  async function startLP() {
    mode = 'lp';
    while (!stopped) {
      try {
        const r = await gmJSON('POST', `${BROKER}/lp/register`, hello());
        if (r && r.sid) {
          pageId = r.sid;
          log(`长轮询已注册 sid=${pageId}`);
          pollLoop();
          return;
        }
      } catch {}
      await sleep(8000);
    }
  }

  async function pollLoop() {
    while (!stopped && mode === 'lp') {
      let r = null;
      try {
        r = await gmJSON('POST', `${BROKER}/lp/poll`, { sid: pageId }, 40000);
      } catch {
        await sleep(5000);
        try { pageId = (await gmJSON('POST', `${BROKER}/lp/register`, hello())).sid; } catch {}
        continue;
      }
      for (const cmd of (r && r.cmds) || []) onCommand(cmd);
    }
  }

  /* ============ 5. 启动：广播上线 + 页面变化事件 ============ */

  function start() {
    if (CFG.urlFilter && !new RegExp(CFG.urlFilter).test(location.href)) {
      log('URL 不匹配白名单，不广播');
      return;
    }
    startWS();

    W.addEventListener('beforeunload', () => { stopped = true; send({ type: 'bye' }); });

    // DOM 变化 → 重建索引 + 通知（防抖）
    let t;
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => { reindex(); send({ type: 'event', name: 'dom_changed' }); }, 600);
    }).observe(document.documentElement, { childList: true, subtree: true });

    // SPA 路由变化
    for (const m of ['pushState', 'replaceState']) {
      const orig = history[m];
      history[m] = function (...a) {
        const r = orig.apply(this, a);
        send({ type: 'event', name: 'nav', ...pageInfo() });
        return r;
      };
    }
    W.addEventListener('popstate', () => send({ type: 'event', name: 'nav', ...pageInfo() }));

    // 调试开关
    W.__BRIDGE__ = {
      get id() { return pageId; },
      snapshot: buildSnapshot,
      stop() {
        stopped = true;
        clearInterval(hbTimer);
        try { ws && ws.close(); } catch {}
        log('已停止');
      },
    };
    log(`已启动 → ${BROKER}`);
  }

  start();
})();
