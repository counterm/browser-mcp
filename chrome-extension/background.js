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

/* ============ eval 能力探测（userScripts 通道，绕页面 CSP） ============
 * eval_mode:
 *   'userscript'  - userScripts API 可用（用户已开启「允许用户脚本」），eval 走 USER_SCRIPT world，不受页面 CSP 限制
 *   'fallback'    - 走内容脚本 eval，受页面 CSP 约束（GitHub 等严格站点会被拦）
 * 该状态随 hello/hb 广播给 broker，客户端在 /pages 里可直接看到；LLM 据此提示用户开启开关。
 */
const EVAL_HINT =
  ' 页面 CSP 禁止 eval。可开启绕过：chrome://extensions → Page Bridge → 详情 → 打开「允许用户脚本」(Allow user scripts)。'
  + '⚠️ 开启后本代理可在页面执行任意 JS，仅在你自己可控的浏览器上开启。';

function userScriptsReady() {
  try {
    chrome.userScripts; // 属性访问：权限缺失/版本过低时抛错
    chrome.userScripts.getScripts(); // 调用：用户未开启「允许用户脚本」时抛错
    return !!(chrome.userScripts.execute && chrome.userScripts.configureWorld);
  } catch { return false; }
}

const evalMode = () => (userScriptsReady() ? 'userscript' : 'fallback');

const pendingEval = new Map(); // evalId -> { resolve, reject, timer }
let worldConfigured = false;

/** 注入到 USER_SCRIPT world 执行的函数体（eval 不受页面 CSP 限制），结果经 runtime 消息回传 */
function __bridgeUserEval(code, evalId) {
  (async () => {
    const ser = (v, d = 0) => {
      if (v === undefined) return 'undefined';
      if (v instanceof Element) return v.outerHTML.slice(0, 2000);
      if (typeof v === 'function') return String(v).slice(0, 300);
      if (v === null || typeof v !== 'object') return String(v);
      if (d > 3) return '[depth-limit]';
      try {
        return JSON.stringify(v, (k, x) => {
          if (typeof x === 'bigint') return String(x);
          if (x instanceof Element) return x.outerHTML.slice(0, 300);
          return x;
        }, 1) || String(v);
      } catch { return String(v); }
    };
    try {
      const r = await eval(code);
      chrome.runtime.sendMessage({ __bridge_eval: evalId, ok: true, data: ser(r) });
    } catch (err) {
      chrome.runtime.sendMessage({ __bridge_eval: evalId, ok: false, error: String((err && err.message) || err) });
    }
  })();
}

async function evalViaUserScripts(e, code) {
  if (!worldConfigured) {
    try { chrome.userScripts.configureWorld({ messaging: true }); worldConfigured = true; } catch {}
  }
  const evalId = crypto.randomUUID();
  const p = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingEval.delete(evalId);
      reject(new Error('eval timeout (userscript, 25s)'));
    }, 25000);
    pendingEval.set(evalId, { resolve, reject, timer });
  });
  const wrapper = `(${__bridgeUserEval})(${JSON.stringify(code)},${JSON.stringify(evalId)})`;
  try {
    await chrome.userScripts.execute({
      target: { tabId: e.tabId },
      world: 'USER_SCRIPT',
      injectImmediately: true,
      js: [{ code: wrapper }],
    });
  } catch (err) {
    const pe = pendingEval.get(evalId);
    if (pe) { clearTimeout(pe.timer); pendingEval.delete(evalId); }
    throw new Error(`userScripts.execute failed: ${err.message || err}`);
  }
  return p;
}

/** eval 总入口：优先 userScripts；不可用或失败时回落内容脚本（可能被 CSP 拦，此时返回带开启指引的错误） */
async function doEval(e, code) {
  if (evalMode() === 'userscript') {
    try { return await evalViaUserScripts(e, code); } catch (err) { log(err.message || err); }
  }
  const res = await chrome.tabs.sendMessage(e.tabId, { __bridge_cmd: { action: 'eval', code } });
  if (res && res.ok) return res.data;
  const raw = (res && res.error) || 'no response';
  const csp = /Content Security Policy|unsafe-eval/i.test(raw);
  throw new Error(raw + (csp ? EVAL_HINT : ''));
}

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
    else if (s === 1) sendWS(e, { type: 'hb', url: e.url, title: e.title, eval_mode: evalMode() });
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
    const hello = { type: 'hello', url: e.url, title: e.title, caps: CAPS, eval_mode: evalMode() };
    if (e.viewport) hello.viewport = e.viewport;
    sock.send(JSON.stringify(hello));
    clearInterval(e.hb);
    e.hb = setInterval(() => sendWS(e, { type: 'hb', url: e.url, title: e.title, eval_mode: evalMode() }), CFG.hbMs);
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
  if (cmd.action === 'eval') {
    try {
      sendWS(e, { type: 'result', id: cmd.id, ok: true, data: (await doEval(e, cmd.code || '')) ?? null });
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
    if (cmd.action === 'ping' && res && res.ok && res.data) res.data.eval_mode = evalMode();
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
  if (msg && msg.__bridge_eval) {
    // USER_SCRIPT world 的 eval 结果回传
    const pe = pendingEval.get(msg.__bridge_eval);
    if (pe) {
      clearTimeout(pe.timer);
      pendingEval.delete(msg.__bridge_eval);
      msg.ok ? pe.resolve(msg.data) : pe.reject(new Error(msg.error || 'eval failed'));
    }
    sendResponse({ ok: true });
    return;
  }
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
