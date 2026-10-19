/*
 * Page Bridge - MV3 Service Worker
 * 职责：为每个已注入的标签页维护一条到 broker 的 WebSocket；路由命令。
 *
 * 命令路由：
 *   - DOM 级动作 -> chrome.tabs.sendMessage 转发给 content.js 执行
 *   - 浏览器级动作（截图/标签管理） -> 本文件直接执行
 *
 * 与油猴版的差异：网络走 SW，不受页面 CSP 限制，无需长轮询回退；
 * 一个标签页一条 WS，跨导航存活；标签关闭自动广播 page_down。
 */
const CFG = { host: '127.0.0.1', port: 8766, hbMs: 5000 };

const CONTENT_ACTIONS = [
  'ping', 'snapshot', 'click', 'type', 'press', 'select', 'scroll', 'hover',
  'nav', 'back', 'reload', 'eval', 'cookies', 'storage', 'upload', 'wait', 'highlight',
];
const EXTRA_ACTIONS = ['screenshot', 'tab_list', 'tab_open', 'tab_close', 'tab_activate'];
const CAPS = [...CONTENT_ACTIONS, ...EXTRA_ACTIONS];

/** tabId -> {tabId,url,title,viewport,ws,pageId,fails,hb,retryTimer,closed} */
const tabs = new Map();

const log = (...a) => console.log('%c[bridge-sw]', 'color:#08f', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sendWS = (e, msg) => { if (e.ws && e.ws.readyState === 1) e.ws.send(JSON.stringify(msg)); };

/* ============ 标签页 <-> WS 生命周期 ============ */

function ensureEntry(tabId, info) {
  let e = tabs.get(tabId);
  if (!e) {
    e = { tabId, url: info.url, title: info.title, viewport: info.viewport || '',
          ws: null, pageId: null, fails: 0, hb: null, retryTimer: null, closed: false };
    tabs.set(tabId, e);
    connectWS(e);
  } else {
    e.url = info.url || e.url;
    e.title = info.title || e.title;
    e.viewport = info.viewport || e.viewport;
    const s = e.ws && e.ws.readyState;
    if (s === undefined || s === 2 || s === 3) connectWS(e);
    else if (s === 1) sendWS(e, { type: 'hb', url: e.url, title: e.title });
  }
  return e;
}

function dropEntry(tabId, reason) {
  const e = tabs.get(tabId);
  if (!e) return;
  e.closed = true;
  clearInterval(e.hb);
  clearTimeout(e.retryTimer);
  try { e.ws && e.ws.close(); } catch {}
  tabs.delete(tabId);
  log(`tab${tabId} dropped: ${reason}`);
}

function connectWS(e) {
  const s = e.ws && e.ws.readyState;
  if (s === 0 || s === 1) return;
  clearTimeout(e.retryTimer);
  let sock;
  try { sock = new WebSocket(`ws://${CFG.host}:${CFG.port}/page`); }
  catch { return scheduleRetry(e); }
  e.ws = sock;
  const kill = setTimeout(() => { if (sock.readyState !== 1) sock.close(); }, 4000);

  sock.onopen = () => {
    clearTimeout(kill);
    e.fails = 0;
    const hello = { type: 'hello', url: e.url, title: e.title, caps: CAPS };
    if (e.viewport) hello.viewport = e.viewport;
    sock.send(JSON.stringify(hello));
    clearInterval(e.hb);
    e.hb = setInterval(() => sendWS(e, { type: 'hb', url: e.url, title: e.title }), CFG.hbMs);
    log(`tab${e.tabId} WS connected: ${e.url}`);
  };
  sock.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg && msg.type === 'welcome') e.pageId = msg.page_id;
    else route(e, msg);
  };
  sock.onclose = () => {
    clearTimeout(kill);
    clearInterval(e.hb);
    e.ws = null;
    if (!e.closed) scheduleRetry(e);
  };
  sock.onerror = () => { try { sock.close(); } catch {} };
}

function scheduleRetry(e) {
  const delay = Math.min(30000, 2000 * Math.max(1, ++e.fails));
  e.retryTimer = setTimeout(() => { if (!e.closed) connectWS(e); }, delay);
}

/* ============ 命令路由 ============ */

async function route(e, cmd) {
  if (!cmd || cmd.id == null) return;
  const bg = BACKGROUND_ACTIONS[cmd.action];
  if (bg) {
    try {
      sendWS(e, { type: 'result', id: cmd.id, ok: true, data: (await bg(cmd, e)) ?? null });
    } catch (err) {
      sendWS(e, { type: 'result', id: cmd.id, ok: false, error: String((err && err.message) || err) });
    }
    return;
  }
  if (!CONTENT_ACTIONS.includes(cmd.action)) {
    sendWS(e, { type: 'result', id: cmd.id, ok: false, error: `unknown action: ${cmd.action}` });
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(e.tabId, { __bridge_cmd: cmd });
    sendWS(e, {
      type: 'result', id: cmd.id,
      ok: !!(res && res.ok),
      data: res ? res.data : null,
      error: res ? res.error : 'no response',
    });
  } catch (err) {
    sendWS(e, { type: 'result', id: cmd.id, ok: false,
                error: `content script unreachable (tab=${e.tabId}): ${err.message || err}` });
  }
}

/* ============ 浏览器级动作（油猴做不到的部分） ============ */

const pidToTab = () => {
  const m = {};
  for (const [tid, e] of tabs) if (e.pageId) m[e.pageId] = tid;
  return m;
};

const BACKGROUND_ACTIONS = {
  /** 截取指定页面的可视区域，返回 base64 PNG（dataUrl） */
  screenshot: async (_cmd, e) => {
    const tab = await chrome.tabs.get(e.tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(e.tabId, { active: true });
    await sleep(250);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { format: 'png', dataUrl };
  },

  tab_list: async () =>
    (await chrome.tabs.query({})).map((t) => ({
      tabId: t.id, url: t.url, title: t.title, active: t.active,
      pageId: (tabs.get(t.id) || {}).pageId || null,
    })),

  tab_open: async ({ url, active = true }) => {
    const t = await chrome.tabs.create({ url, active });
    await sleep(800); // 给内容脚本注入留时间
    return { tabId: t.id };
  },

  tab_close: async ({ tabId }) => {
    const tid = Number(pidToTab()[tabId] ?? tabId);
    await chrome.tabs.remove(tid);
    return `closed tab ${tid}`;
  },

  tab_activate: async ({ tabId }) => {
    const tid = Number(pidToTab()[tabId] ?? tabId);
    const t = await chrome.tabs.update(tid, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    await sleep(150);
    return `activated tab ${tid}`;
  },
};

/* ============ 内容脚本消息 & 标签页事件 ============ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) return;
  if (msg && msg.type === 'hello') {
    ensureEntry(tabId, msg);
    sendResponse({ ok: true });
    return;
  }
  if (msg && msg.type === 'event') {
    const e = tabs.get(tabId);
    if (e) {
      if (msg.name === 'nav' && msg.url) {
        e.url = msg.url;
        if (msg.title) e.title = msg.title;
        sendWS(e, { type: 'hb', url: e.url, title: e.title });
      }
      sendWS(e, { type: 'event', name: msg.name, url: msg.url });
    }
    sendResponse({ ok: true });
    return;
  }
  if (msg && msg.type === 'bye') {
    dropEntry(tabId, 'bye');
    sendResponse({ ok: true });
  }
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  const e = tabs.get(tabId);
  if (!e) return;
  if (change.url) e.url = change.url;
  if (change.title) e.title = change.title;
  if ((change.url || change.title) && e.ws && e.ws.readyState === 1) {
    sendWS(e, { type: 'hb', url: e.url, title: e.title });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => dropEntry(tabId, 'tab removed'));

log(`loaded, broker=ws://${CFG.host}:${CFG.port}`);
