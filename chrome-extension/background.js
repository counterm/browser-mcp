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

importScripts('filter.js'); // 站点过滤核心（与 popup/options 共用）

const CONTENT_ACTIONS = [
  'ping', 'snapshot', 'dom', 'click', 'type', 'press', 'select', 'scroll', 'hover',
  'nav', 'back', 'reload', 'eval', 'cookies', 'storage', 'upload', 'wait', 'highlight', 'netlog',
];
const EXTRA_ACTIONS = ['screenshot', 'tab_list', 'tab_open', 'tab_close', 'tab_activate'];
const CAPS = [...CONTENT_ACTIONS, ...EXTRA_ACTIONS];

/** tabId -> {tabId,url,title,viewport,ws,pageId,mark,fails,hb,retryTimer,closed} */
const tabs = new Map();

const log = (...a) => console.log('%c[bridge-sw]', 'color:#08f', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sendWS = (e, msg) => { if (e.ws && e.ws.readyState === 1) e.ws.send(JSON.stringify(msg)); };

/* ============ 页桥标记（mark） ============
 * 每个接入的网页在「标记」时由本扩展 JS 生成一个 id（pb_xxxxxxxxxx），存在 chrome.storage.session
 * （按 tab 持久化，SW 休眠/重启不变；tab 关闭即清）。id 随 hello/hb 上报 broker，broker 侧保存
 * id → url/title 映射，LLM 只凭 id 即可 GET /mark/<id> 找回网页。
 */
async function markFor(tabId) {
  const key = 'mark:' + tabId;
  try {
    const got = await chrome.storage.session.get(key);
    if (got && got[key]) return got[key];
  } catch {}
  const hex = [...crypto.getRandomValues(new Uint8Array(5))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const mid = 'pb_' + hex;
  chrome.storage.session.set({ [key]: mid }).catch(() => {});
  return mid;
}

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

/* ============ 站点过滤（白名单） ============
 * 规则：域名（自动含全部子域名）或正则命中 => 接入 broker；未命中 => 不注册/不广播。
 * 配置由 options/popup 写入 storage，这里经 onChanged 热生效（≤1s）。
 */
let filterCfg = URLFilter.normalizeConfig(null);

async function reloadFilterCfg() {
  filterCfg = await URLFilter.loadConfig();
  applyFilterChange();
  updateBadge();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[URLFilter.STORAGE_KEY]) {
    filterCfg = URLFilter.normalizeConfig(changes[URLFilter.STORAGE_KEY].newValue);
    applyFilterChange();
    updateBadge();
  }
});

/** 配置变更后重算：不再命中的断开；新命中的补注册（含存量页面）；工具箱同步注入/显隐 */
async function applyFilterChange() {
  for (const [tabId, e] of [...tabs]) {
    if (URLFilter.isBlocked(e.url, filterCfg)) dropEntry(tabId, 'filter: not in whitelist');
  }
  const all = await chrome.tabs.query({});
  for (const t of all) {
    if (!t.id || !t.url || !/^https?:/i.test(t.url) || tabs.has(t.id)) continue;
    if (URLFilter.isBlocked(t.url, filterCfg)) continue;
    ensureEntry(t.id, { url: t.url, title: t.title || '' });
  }
  for (const t of all) {
    if (t.id && (t.url || t.pendingUrl)) syncToolbox(t.id, t.url || t.pendingUrl);
  }
}

/** 当前 tab 命中白名单显示 W；总开关关闭显示 OFF（灰底），未命中留空 */
async function updateBadge() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/i.test(tab.url || '')) { await chrome.action.setBadgeText({ text: '' }); return; }
    const v = URLFilter.matchUrl(tab.url, filterCfg);
    if (v.allowed) {
      await chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' });
      await chrome.action.setBadgeText({ text: 'W' });
    } else if (v.off) {
      await chrome.action.setBadgeBackgroundColor({ color: '#9e9e9e' });
      await chrome.action.setBadgeText({ text: 'OFF' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {}
}

/** popup 消息接口：配置单点写入，全部经 SW，避免并发写冲突 */
async function handleFilterMessage(msg, sendResponse) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || '';
  const domain = URLFilter.urlToDomain(url);
  const verdict = () => URLFilter.matchUrl(url, filterCfg);

  switch (msg.type) {
    case 'filter:status':
      sendResponse({
        ok: true, url, domain, verdict: verdict(),
        allowed: verdict().allowed,
        hit: verdict().hit,
        record: filterCfg.domains.find((d) => d.host === domain) || null,
        enabled: filterCfg.enabled !== false,
      });
      return;

    case 'filter:setEnabled': {
      const r = URLFilter.setEnabled(filterCfg, msg.enabled);
      filterCfg = await URLFilter.saveConfig(r.config); // onChanged 会断开/恢复全部页面
      sendResponse({ ok: true, enabled: filterCfg.enabled !== false });
      return;
    }

    case 'filter:quickAdd': {
      if (!domain) {
        sendResponse({ ok: false, error: '当前页面无域名（如 file://），无法一键添加，可在选项页用正则规则匹配' });
        return;
      }
      const r = URLFilter.addDomain(filterCfg, domain, 'quick-add');
      if (r.error) { sendResponse({ ok: false, error: r.error }); return; }
      filterCfg = await URLFilter.saveConfig(r.config);
      sendResponse({ ok: true, verdict: verdict() });
      return;
    }

    case 'filter:quickRemove': {
      if (!domain) { sendResponse({ ok: false, error: '当前页面无域名' }); return; }
      filterCfg = await URLFilter.saveConfig(URLFilter.removeDomain(filterCfg, domain).config);
      sendResponse({ ok: true, verdict: verdict() });
      return;
    }
  }
}

/* ============ 接口捕获层（webRequest 观察模式，MV3 无需 blocking） ============
 * 与页面 MAIN world 的 capture-main.js 双层合并：本侧抓 URL/method/全量请求头（含浏览器自动加的
 * Cookie，必须 extraHeaders，否则 Chrome 72+ 会隐去）/请求体/响应头与状态码；响应体 webRequest
 * 拿不到（MV2 起即如此），由页面侧 hook fetch/XHR 捕获。
 * 只记录 tabs Map 已注册（=白名单命中）的 tab。SW 可能被随时杀掉：定稿记录必须落
 * chrome.storage.session（随浏览器会话存活），不能只放全局变量；页面侧内存 Map 丢了只是
 * 少拼几条半成品，可接受。详见 docs/spec-net-protocol.md。
 */
const NET_TAB_MAX = 150;      // 每 tab 环形上限（条）
const NET_TAB_BYTES = 2e6;    // 每 tab 序列化体积上限（session 总配额 10MB，后台侧不存响应体）
const NET_BODY_MAX = 16384;   // 请求体截断上限（字符）
// 只记接口类请求；image / stylesheet / script / font / media 等静态资源跳过。
// 文档（DevTools 里显示为 doc）在 webRequest 里是 main_frame（当前页面）/ sub_frame（iframe），一并记录。
const NET_TYPES = new Set(['xmlhttprequest', 'other', 'websocket', 'ping', 'main_frame', 'sub_frame']);
const netPend = new Map();    // requestId -> 半成品（onBeforeRequest 起，onCompleted/onErrorOccurred 定稿）
const netBuf = new Map();     // tabId -> 待写数组（防抖 800ms 批量落盘）
const netFlush = new Map();   // tabId -> 防抖 timer

const netAllowed = (tabId) => tabs.has(tabId);

function netReqBody(rb) {
  try {
    if (!rb) return null;
    if (rb.formData) {
      return Object.keys(rb.formData).map((k) => k + '=' + rb.formData[k].join('&')).join('\n');
    }
    if (rb.raw && rb.raw.length) {
      const total = rb.raw.reduce((n, x) => n + (x.bytes ? x.bytes.byteLength : 0), 0);
      const u8 = new Uint8Array(total);
      let off = 0;
      rb.raw.forEach((x) => { if (x.bytes) { u8.set(new Uint8Array(x.bytes), off); off += x.bytes.byteLength; } });
      return new TextDecoder('utf-8').decode(u8);
    }
  } catch {}
  return null;
}
const netTrim = (s) => {
  s = String(s == null ? '' : s);
  return s.length > NET_BODY_MAX ? s.slice(0, NET_BODY_MAX) + '…[截断]' : s;
};

chrome.webRequest.onBeforeRequest.addListener((det) => {
  try {
    if (!/^https?:/i.test(det.url) || !netAllowed(det.tabId)) return;
    if (!NET_TYPES.has(det.type)) return; // 图片 / CSS / JS / 字体等静态资源不是接口调用，不入库
    netPend.set(det.requestId, {
      rid: det.requestId, tabId: det.tabId, t: det.timeStamp,
      m: det.method, u: det.url, reqBody: netTrim(netReqBody(det.requestBody)),
    });
  } catch {}
}, { urls: ['<all_urls>'] }, ['requestBody']);

chrome.webRequest.onSendHeaders.addListener((det) => {
  const p = netPend.get(det.requestId);
  if (!p) return;
  p.reqHdr = (det.requestHeaders || []).map((h) => ({ k: h.name, v: h.value || '' }));
}, { urls: ['<all_urls>'] }, ['requestHeaders', 'extraHeaders']);

chrome.webRequest.onHeadersReceived.addListener((det) => {
  const p = netPend.get(det.requestId);
  if (!p) return;
  p.resHdr = (det.responseHeaders || []).map((h) => ({ k: h.name, v: h.value || '' }));
  p.s = det.statusCode;
}, { urls: ['<all_urls>'] }, ['responseHeaders', 'extraHeaders']);

chrome.webRequest.onCompleted.addListener((det) => {
  const p = netPend.get(det.requestId);
  if (!p) return;
  netPend.delete(det.requestId);
  p.s = det.statusCode;
  p.ms = det.timeStamp - p.t;
  netStore(p);
}, { urls: ['<all_urls>'] });

chrome.webRequest.onErrorOccurred.addListener((det) => {
  const p = netPend.get(det.requestId);
  if (!p) return;
  netPend.delete(det.requestId);
  p.s = 'ERR';
  p.ms = det.timeStamp - p.t;
  p.note = det.error;
  netStore(p);
}, { urls: ['<all_urls>'] });

/** 定稿记录入队（防抖批量写，避免高频请求打爆 storage 写入） */
function netStore(p) {
  const arr = netBuf.get(p.tabId) || [];
  arr.push(p);
  netBuf.set(p.tabId, arr);
  if (netFlush.has(p.tabId)) return;
  netFlush.set(p.tabId, setTimeout(() => {
    netFlush.delete(p.tabId);
    const buf = netBuf.get(p.tabId) || [];
    netBuf.delete(p.tabId);
    netWrite(p.tabId, buf);
  }, 800));
}

async function netWrite(tabId, items) {
  try {
    const key = 'neth:' + tabId;
    const cur = (await chrome.storage.session.get(key))[key] || [];
    let recs = cur.concat(items.map((p) => ({
      rid: p.rid, t: p.t, m: p.m, u: p.u,
      reqHdr: p.reqHdr || [], reqBody: p.reqBody || null,
      resHdr: p.resHdr || [], s: p.s == null ? null : p.s, ms: p.ms == null ? null : Math.round(p.ms),
    }))).slice(-NET_TAB_MAX);
    // 配额护栏：超体积丢最旧（头集合可能很大，尤其 Cookie）
    const est = () => recs.reduce((n, r) => n + JSON.stringify(r).length, 0);
    while (recs.length > 1 && est() > NET_TAB_BYTES) recs = recs.slice(1);
    await chrome.storage.session.set({ [key]: recs });
  } catch (err) {
    log(`netWrite tab${tabId} failed: ${(err && err.message) || err}`); // 超限等场景宁丢不崩
  }
}

/** 孤儿 GC：>60s 未定稿的半成品丢弃（SW 重启后 Map 清空，这里兜陈年残留） */
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [id, p] of netPend) if (p.t < cutoff) netPend.delete(id);
}, 60000);

/* ============ 页面工具箱（docs/toolbox 原型的扩展落地） ============
 * 白名单门控注入：页面命中白名单后，经 chrome.scripting 把 toolbox/ 下 14 个模块
 * 注入页面主世界（MAIN world —— React fiber、fetch 拦截、window.__BA_* 都在页面上下文才可见），
 * 不受页面 CSP 限制。MAIN world 收不到扩展消息，显隐经 DOM 事件 batb:gate 同步（core.js 监听）。
 */
const TOOLBOX_FILES = [
  'toolbox/core.js', 'toolbox/cats.js', 'toolbox/widgets.js', 'toolbox/ui.js',
  'toolbox/picker.js', 'toolbox/helpers.js', 'toolbox/qr.js',
  'toolbox/feats/info.js', 'toolbox/feats/find.js', 'toolbox/feats/style.js',
  'toolbox/feats/llm.js', 'toolbox/feats/build.js', 'toolbox/feats/capture.js', 'toolbox/boot.js',
];

const isToolboxUrl = (u) =>
  /^(https?|file):/i.test(u || '') && !/^https?:\/\/(127\.0\.0\.1|localhost):8766/i.test(u);

/** 探测页面主世界：2=已注入 1=可注入(body 就绪) 0=DOM 未就绪 -1=不可注入（chrome:// 等） */
async function toolboxProbe(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: () => (window.BATB && window.BATB.ui) ? 2 : (document.body ? 1 : 0),
    });
    return (r && r.result) || 0;
  } catch { return -1; }
}

/** 按白名单同步某 tab 的工具箱：未注入则注入；已注入则同步显隐（配置变更即时生效） */
async function syncToolbox(tabId, url) {
  if (!isToolboxUrl(url)) return;
  try {
    const st = await toolboxProbe(tabId);
    if (st === -1 || st === 0) return;
    const allowed = !URLFilter.isBlocked(url, filterCfg);
    if (st === 2) {
      await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN',
        func: (a) => window.dispatchEvent(new CustomEvent('batb:gate', { detail: { allowed: a } })),
        args: [allowed],
      });
    } else if (allowed) {
      await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: TOOLBOX_FILES });
      log(`toolbox injected tab${tabId}: ${url}`);
    }
  } catch (err) {
    log(`toolbox sync tab${tabId} failed: ${(err && err.message) || err}`);
  }
}

/* ============ 标签页 <-> WS 生命周期 ============ */

function ensureEntry(tabId, info) {
  if (info.url && URLFilter.isBlocked(info.url, filterCfg)) {
    log(`tab${tabId} 不在白名单，不接入: ${info.url}`);
    return null;
  }
  let e = tabs.get(tabId);
  if (!e) {
    e = { tabId, url: info.url, title: info.title, viewport: info.viewport || '',
          ws: null, pageId: null, mark: '', fails: 0, hb: null, retryTimer: null, closed: false };
    tabs.set(tabId, e);
    connectWS(e);
  } else {
    e.url = info.url || e.url;
    e.title = info.title || e.title;
    e.viewport = info.viewport || e.viewport;
    const s = e.ws && e.ws.readyState;
    if (s === undefined || s === 2 || s === 3) connectWS(e);
    else if (s === 1) sendWS(e, { type: 'hb', url: e.url, title: e.title, mid: e.mark, eval_mode: evalMode() });
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
  chrome.storage.session.remove(['neth:' + tabId, 'mark:' + tabId]).catch(() => {}); // 接口捕获/页桥标记：tab 没了记录一并清
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

  sock.onopen = async () => {
    clearTimeout(kill);
    e.fails = 0;
    e.mark = await markFor(e.tabId); // 标记 id 在接入时生成/取回，随 hello 交给 broker 存档
    const hello = { type: 'hello', url: e.url, title: e.title, mid: e.mark, caps: CAPS, eval_mode: evalMode() };
    if (e.viewport) hello.viewport = e.viewport;
    sock.send(JSON.stringify(hello));
    clearInterval(e.hb);
    e.hb = setInterval(() => sendWS(e, { type: 'hb', url: e.url, title: e.title, mid: e.mark, eval_mode: evalMode() }), CFG.hbMs);
    log(`tab${e.tabId} WS connected: ${e.url} [${e.mark}]`);
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
  if (msg && msg.type === 'tb:shot') {
    // 工具箱桥「整页截图」：单屏截取（页面侧负责滚动编排与拼接）；结果必须包在 data 字段（桥协议只透传 data）
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ ok: true, data: { dataUrl } }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  if (msg && msg.type === 'tb:net') {
    // 工具箱桥「接口调用」：取本 tab 的 webRequest 头部记录（capture-main.js 拉回页面侧做合并）
    const ntab = sender.tab && sender.tab.id;
    chrome.storage.session.get('neth:' + ntab)
      .then((o) => sendResponse({ ok: true, data: o['neth:' + ntab] || [] }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  if (msg && msg.type === 'tb:netclear') {
    const ctab = sender.tab && sender.tab.id;
    chrome.storage.session.remove('neth:' + ctab)
      .then(() => sendResponse({ ok: true, data: 'ok' }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  if (msg && msg.type === 'tb:pinfo') {
    // 工具箱桥「页桥标记」：返回本 tab 的标记 id（接入时生成并已上报 broker）
    const ptab = sender.tab && sender.tab.id;
    const ent = ptab == null ? null : tabs.get(ptab);
    Promise.resolve(ent == null ? '' : (ent.mark || markFor(ptab))).then((mid) => {
      sendResponse({ ok: true, data: {
        mark: mid || '',
        pageId: (ent && ent.pageId) || null,
        port: CFG.port,
        url: (ent && ent.url) || '',
        title: (ent && ent.title) || ''
      } });
    });
    return true;
  }
  if (typeof msg.type === 'string' && msg.type.startsWith('filter:')) {
    handleFilterMessage(msg, sendResponse); // 异步 sendResponse
    return true;
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
        if (URLFilter.isBlocked(e.url, filterCfg)) {
          dropEntry(tabId, 'filter: not in whitelist (nav)');
          sendResponse({ ok: true });
          return;
        }
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
  if (change.url && e && URLFilter.isBlocked(change.url, filterCfg)) {
    dropEntry(tabId, 'filter: not in whitelist');
    return;
  }
  if (!e) return;
  if (change.url) e.url = change.url;
  if (change.title) e.title = change.title;
  if ((change.url || change.title) && e.ws && e.ws.readyState === 1) {
    sendWS(e, { type: 'hb', url: e.url, title: e.title });
  }
});

/* 工具箱：页面加载完成 / SPA 路由变化时按白名单同步（注入或显隐） */
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  const url = change.url || (change.status === 'complete' && tab && tab.url);
  if (url) syncToolbox(tabId, url);
});

chrome.tabs.onActivated.addListener(() => updateBadge());

chrome.tabs.onRemoved.addListener((tabId) => dropEntry(tabId, 'tab removed'));

reloadFilterCfg().then(() => log(`whitelist loaded: ${filterCfg.enabled === false ? 'disabled' : 'enabled'}, domains=${filterCfg.domains.length}, regexes=${filterCfg.regexes.length}`));
log(`loaded, broker=ws://${CFG.host}:${CFG.port}`);
