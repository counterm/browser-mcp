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
  // 扩展重载后旧内容脚本的 runtime 上下文会失效（Extension context invalidated），
  // 静默丢弃后续消息，页面刷新后由新实例接管
  let ctxDead = false;
  const sendMsg = (m) => {
    if (ctxDead) return;
    try {
      chrome.runtime.sendMessage(m).catch(() => {});
    } catch {
      ctxDead = true;
      console.warn('[bridge] extension context invalidated, reload this page to reconnect');
    }
  };
  const pageInfo = () => ({
    url: location.href,
    title: document.title,
    viewport: `${W.innerWidth}x${W.innerHeight}`,
  });

  /* ============ 1. 元素索引与快照（LLM 的眼睛） ============ */

  const INTERACTIVE = [
    'a', 'button', 'input', 'select', 'textarea', 'summary',
    'label[for]', '[onclick]', '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="option"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const index = new Map(); // bid -> Element
  const SNAP_MAX = 300;    // 快照元素数默认上限，可用 snapshot{max} 调整

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }

  function reindex(max = SNAP_MAX) {
    document.querySelectorAll('[data-bid]').forEach((e) => e.removeAttribute('data-bid'));
    index.clear();
    const cap = Math.min(Math.max(+max || SNAP_MAX, 1), 1000);
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (!visible(el)) continue;
      // 无 href 也无任何文本的 <a> 多为装饰节点（如 el-link 图标壳），不进快照
      if (el.tagName === 'A' && !el.hasAttribute('href') && !el.getAttribute('aria-label')
          && !el.getAttribute('title') && !(el.innerText || '').trim()) continue;
      const bid = index.size;
      el.setAttribute('data-bid', bid);
      index.set(bid, el);
      if (index.size >= cap) break;
    }
  }

  function describe(bid, el) {
    const t = el.tagName.toLowerCase();
    let txt;
    if (t === 'input' || t === 'textarea' || t === 'select') {
      // 表单控件以当前值为准；无值时读包装容器文本——Element Plus el-select 等组件
      // 把选中文案放在 input 的兄弟节点里，只看 el.value 会永远显示为空
      txt = el.type === 'password' && el.value ? '***' : String(el.value ?? '');
      if (!txt) {
        const wrap = el.closest('.el-select, .el-input__wrapper, .el-input, .ant-select, label');
        txt = wrap ? (wrap.innerText || '').trim() : '';
        if (!txt) txt = el.placeholder || el.getAttribute('aria-label') || el.getAttribute('title') || '';
      }
      if (t === 'select') {
        const opt = el.selectedOptions && el.selectedOptions[0];
        if (opt && opt.text && opt.text !== el.value) txt = `${opt.text} (value=${el.value})`;
      }
    } else {
      txt = (el.innerText || el.value || el.placeholder
        || el.getAttribute('aria-label') || el.getAttribute('title') || el.alt || '');
    }
    txt = String(txt).trim().replace(/\s+/g, ' ').slice(0, 80);
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

  function buildSnapshot({ max = SNAP_MAX, text_max = 6000 } = {}) {
    reindex(max);
    const lines = [...index.entries()].map(([bid, el]) => describe(bid, el));
    const tmax = Math.min(Math.max(+text_max || 0, 0), 30000);
    return {
      ...pageInfo(),
      scroll: { y: Math.round(W.scrollY), height: document.documentElement.scrollHeight },
      elements: lines.join('\n') || '<EMPTY>',
      text: tmax > 0
        ? (document.body && document.body.innerText || '')
          .replace(/\n{3,}/g, '\n\n').slice(0, tmax)
        : '',
    };
  }

  /* ============ 1.1 精简 DOM（Pug 缩进树） ============
   * 面向调试/写选择器：保留层级与语义属性，按深度/节点/字符三重裁剪，
   * 连续同类兄弟超过阈值折叠为 ×N，避免整页 HTML 撑爆上下文。 */

  const DOM_ATTRS = ['name', 'type', 'href', 'src', 'placeholder', 'role',
    'aria-label', 'data-testid', 'data-test', 'data-cy', 'data-id'];
  const DOM_SKIP = { SCRIPT: 1, STYLE: 1, SVG: 1, NOSCRIPT: 1, LINK: 1, META: 1, TEMPLATE: 1 };
  const REDACT_RULES = [
    [/\b1[3-9]\d{9}\b/g, '[PHONE]'],
    [/\b\d{17}[\dXx]\b/g, '[ID]'],
    [/\b[\w.-]+@[\w.-]+\.\w+\b/g, '[EMAIL]'],
    [/\b(sk|ghp|xoxb)-[\w-]{10,}/g, '[TOKEN]'],
    [/\beyJ[\w-]{10,}\.[\w-]+/g, '[JWT]'],
  ];
  const redactText = (t) => REDACT_RULES.reduce((s, r) => s.replace(r[0], r[1]), t);

  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\s+/g, ' ').trim();
  }

  function pugLine(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (cls.length) s += cls.map((c) => '.' + c).join('');
    const attrs = [];
    for (const k of DOM_ATTRS) {
      const v = el.getAttribute(k);
      if (v != null) attrs.push(`${k}="${v.replace(/\s+/g, ' ').slice(0, 60).replace(/"/g, '&quot;')}"`);
    }
    if (el.hasAttribute('disabled')) attrs.push('disabled');
    if (el.hasAttribute('checked')) attrs.push('checked');
    if (attrs.length) s += `(${attrs.join(' ')})`;
    const txt = ownText(el);
    if (txt) s += ' ' + (txt.length > 60 ? txt.slice(0, 60) + '…' : txt);
    return s;
  }

  function pugDom(root, opts = {}) {
    const maxDepth = opts.depth > 0 ? opts.depth : 8;
    const maxNodes = opts.maxNodes > 0 ? opts.maxNodes : 1500;
    const maxChars = opts.maxChars > 0 ? opts.maxChars : 60000;
    const collapse = opts.collapse == null ? 3 : opts.collapse;
    const lines = [];
    let nodes = 0;
    let chars = 0;
    let stop = false;
    let truncated = false;
    const sig = (el) => el.tagName + '|' + (el.id || '') + '|' + (el.getAttribute('class') || '');
    const emit = (el, depth) => {
      if (stop) return;
      if (depth > maxDepth) { truncated = true; return; }
      if (nodes >= maxNodes) { stop = true; truncated = true; return; }
      const line = '  '.repeat(depth) + pugLine(el);
      chars += line.length + 1;
      if (chars > maxChars) { stop = true; truncated = true; return; }
      lines.push(line);
      nodes++;
      const kids = Array.from(el.children).filter((c) => !DOM_SKIP[c.tagName]);
      for (let i = 0; i < kids.length; i++) {
        let run = 1;
        while (collapse >= 2 && i + run < kids.length && sig(kids[i + run]) === sig(kids[i])) run++;
        if (collapse >= 2 && run >= collapse) {
          const at = lines.length;
          emit(kids[i], depth + 1);
          if (lines.length > at) lines[at] += ' ×' + run;
          i += run - 1;
        } else {
          emit(kids[i], depth + 1);
        }
      }
    };
    emit(root, 0);
    if (truncated) lines.push(`…（已截断：节点 ${nodes}，字符 ${chars}）`);
    return { content: lines.join('\n'), nodes, chars: lines.join('\n').length, truncated };
  }

  function resolve(ref) {
    if (ref == null) return null;
    const s = String(ref);
    if (/^\d+$/.test(s)) return index.get(+s) || document.querySelector(`[data-bid="${s}"]`);
    return document.querySelector(s); // 也接受 CSS selector
  }

  // CSS 选择器命中多个节点时优先取可见的那个：框架常把同名 aria-label 挂在隐藏节点上
  // （如 el-drawer 的关闭按钮排在 el-dialog 的关闭按钮之前），querySelector 只能拿到隐藏的，
  // 动作会「执行成功但毫无效果」。若录制时带了 x / y（页面绝对坐标），多个可见候选里取中心点
  // 最近的那个——可见元素仍可能同构重复（列表里每个「详情」按钮），只靠「第一个可见」会点错行。
  // 坐标换算统一用 getBoundingClientRect + scrollX / scrollY，回放时页面滚动到别处也不影响。
  // 全部不可见时退回首个命中，保持旧行为。带 text 时先按文本过滤候选：过滤后为空 → locate 抛
  // element not found → flowrun 的 auto-wait 继续轮询，等新页面渲染完再取，而不是点旧页面的同构位置。
  function selectorPick(sel, p) {
    const list = [...document.querySelectorAll(sel)].filter((el) => textHit(el, p && p.text));
    const vis = list.filter(isVisible);
    const pool = vis.length ? vis : list.slice(0, 1);
    const x = Number(p && p.x), y = Number(p && p.y);
    if (pool.length > 1 && isFinite(x) && isFinite(y)) {
      let best = pool[0], bestD = Infinity;
      for (const el of pool) {
        const r = el.getBoundingClientRect();
        const dx = r.left + r.width / 2 + (W.scrollX || 0) - x;
        const dy = r.top + r.height / 2 + (W.scrollY || 0) - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = el; }
      }
      return best;
    }
    return pool[0] || null;
  }

  // 命中的节点是否与录制时的可见文本一致。录制 click 时会把目标 innerText 前 40 字写进 text，
  // 回放时它就是「这是不是同一个按钮」的凭据：SPA 路由切换的瞬间旧页面节点还挂在 DOM 里，
  // 位置化选择器（nth-of-type）照样能命中旧页面的同构按钮（例：菜单管理页的「新增」抢在
  // 账号管理页的「新增用户」之前被点中），点下去弹的是旧页面的弹窗。归一化空白 + 忽略大小写 +
  // 包含匹配（录制侧截断到 40 字，不能全等）。
  function textHit(el, want) {
    if (want == null) return true;
    const w = String(want).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!w) return true;
    return elText(el).replace(/\s+/g, ' ').trim().toLowerCase().includes(w);
  }

  // 定位参数三选一：bid（快照元素编号）/ selector（CSS）/ text（按可见文本匹配）。
  // 快照没给 bid 的元素（自绘组件、动态插入等）用 text 也能点。
  const elText = (el) => ((el.innerText || el.value
    || el.getAttribute('aria-label') || el.getAttribute('title') || '') + '');

  // 元素是否真的可见：按 text 定位必须过这一关，否则会点到下拉菜单里同名的隐藏项
  // （例：点「修改」命中隐藏的「修改密码」，弹错窗口）
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.getClientRects().length === 0) return false;
    const st = W.getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  }

  function findByText(text) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const q = norm(text);
    if (!q) return null;
    const pool = index.size ? [...index.values()] : [...document.querySelectorAll(INTERACTIVE)];
    let partial = null, hiddenExact = null;
    for (const el of pool) {
      const t = norm(elText(el));
      if (!t) continue;
      const visible = isVisible(el);
      if (t === q) {
        if (visible) return el;
        if (!hiddenExact) hiddenExact = el;
        continue;
      }
      // 只允许「实际文本包含目标文本」：反方向 q.includes(t) 会让短标签（「新增」）顶替长标签
      // （「新增用户」），SPA 路由切换时就会点到旧页面同构按钮
      if (!partial && visible && t.includes(q)) partial = el;
    }
    return hiddenExact || partial;
  }

  /**
   * 按参数定位元素。required=false 时找不到/没给参数返回 null（如 scroll/press 的可选定位）。
   * 报错信息带上实际尝试过的参数，避免出现 "element not found: undefined" 这种无方向提示。
   */
  function locate(p, { required = true } = {}) {
    const tried = [];
    if (p && p.bid != null && p.bid !== '') {
      tried.push(`bid=${p.bid}`);
      const el = resolve(p.bid);
      if (el) return el;
    }
    if (p && p.selector) {
      tried.push(`selector=${p.selector}`);
      const el = /^\d+$/.test(String(p.selector)) ? resolve(p.selector) : selectorPick(p.selector, p);
      if (el) return el;
    }
    if (p && p.text != null && p.text !== '') {
      tried.push(`text="${p.text}"`);
      const el = findByText(p.text);
      if (el) return el;
    }
    if (!tried.length) {
      if (!required) return null;
      throw new Error('缺少定位参数：bid / selector / text 三选一'
        + '（bid 为快照元素编号，selector 为 CSS 选择器，text 按可见文本匹配）');
    }
    throw new Error(`element not found: ${tried.join(' / ')}（可先用 snapshot 或 dom 确认元素）`);
  }

  // 返回便于日志辨认的定位描述（如 "bid 3" / "selector .el-link" / 'text "删除"'）
  const refLabel = (p) => (p.bid != null && p.bid !== '' ? `bid ${p.bid}`
    : p.selector ? `selector ${p.selector}` : `text "${p.text}"`);

  /* ============ 2. 动作实现 ============ */

  const fireMouse = (el, type) => el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, view: W, button: 0 }));

  // React/Vue 受控组件必须走原生 setter + input/change 事件
  function setValue(el, text) {
    const inputable = el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName);
    if (!inputable) {
      // 选择器命中了非输入元素（常见于 el-id-xxx 这类框架自动 id 漂移），
      // 直接调 value setter 只会报无方向的 "Illegal invocation"
      const desc = el.tagName.toLowerCase()
        + (el.id ? `#${el.id}` : '') + (el.className ? `.${String(el.className).trim().split(/\s+/)[0]}` : '');
      throw new Error(`目标不可输入：<${desc}>，type 需要 input / textarea / contenteditable`
        + '（确认 selector 是否指向输入框，或改用 bid）');
    }
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
    // max / text_max：快照体积调节（元素条数 / 正文字符数，text_max=0 省略正文）
    snapshot: async (p = {}) => buildSnapshot(p),

    // 精简 DOM：Pug 缩进树，默认脱敏；depth / maxNodes / maxChars / collapse 三重裁剪
    // selector 传纯数字时按 bid 解析，也支持显式 bid 参数
    dom: async ({ selector = 'body', bid = null, depth = 8, maxNodes = 1500, maxChars = 60000,
      collapse = 3, redact = true } = {}) => {
      const ref = bid != null ? bid : (/^\d+$/.test(String(selector)) ? selector : null);
      const root = ref != null ? resolve(ref)
        : (selector === 'body' ? document.body : document.querySelector(selector));
      if (!root) throw new Error(`元素不存在：${ref != null ? 'bid ' + ref : selector}`);
      const r = pugDom(root, { depth, maxNodes, maxChars, collapse });
      return {
        selector: ref != null ? 'bid ' + ref : selector, nodes: r.nodes, chars: r.chars, truncated: r.truncated,
        content: redact ? redactText(r.content) : r.content,
      };
    },

    click: async (p) => {
      const el = locate(p);
      el.scrollIntoView({ block: 'center' });
      fireMouse(el, 'mouseover');
      fireMouse(el, 'mousedown');
      fireMouse(el, 'mouseup');
      el.click();
      await sleep(150);
      return `clicked [${refLabel(p)}]`;
    },

    type: async (p) => {
      const { text = '', clear = true } = p;
      // text 是输入值，不能同时当定位条件：选择器失效时会按"文本包含输入值"误命中别的元素
      const ref = { bid: p.bid, selector: p.selector };
      const el = locate(ref);
      el.scrollIntoView({ block: 'center' });
      el.focus();
      if (clear) setValue(el, '');
      if (text) setValue(el, text);
      await sleep(100);
      return `typed into [${refLabel(ref)}]`;
    },

    press: async ({ key, ...ref }) => {
      const el = (ref.bid != null || ref.selector || ref.text) ? locate(ref) : document.activeElement;
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

    select: async (p) => {
      const { value } = p;
      const el = locate(p);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return `selected ${value}`;
    },

    scroll: async (p = {}) => {
      const el = locate(p, { required: false });
      if (el) el.scrollIntoView({ block: 'center' });
      else W.scrollBy(0, p.dy == null ? 600 : p.dy);
      await sleep(120);
      return `scrolled, y=${Math.round(W.scrollY)}`;
    },

    hover: async (p) => {
      const el = locate(p);
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

    upload: async (p) => {
      const { files = [] } = p;
      const el = locate(p);
      const dt = new DataTransfer();
      for (const f of files) {
        dt.items.add(new File([f.content || ''], f.name,
          { type: f.mime || 'application/octet-stream' }));
      }
      el.files = dt.files;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return `uploaded ${files.length} file(s) to [${refLabel(p)}]`;
    },

    wait: async ({ ms = 1000 }) => { await sleep(Math.min(ms, 15000)); return `waited ${ms}ms`; },

    // flow 执行轨迹回显（broker flow runner 每步一条，见 docs/spec-flow.md）：
    // ISOLATED world 的 console 不经过 capture-main 的 hook（plog 抓不到），
    // 经 DOM 事件桥让 MAIN world 代打，DevTools 可见、plog 可用 q="[flow:" 过滤
    log: ({ prefix = '[flow]', text = '', level = 'log' }) => {
      W.dispatchEvent(new CustomEvent('batb:flowlog', { detail: { prefix, text, level } }));
      return 'ok';
    },

    // eval userScripts 通道的结果回传：USER_SCRIPT world 把结果写在 <html data-ba-eval-<id>>，
    // 与内容脚本共享 DOM；取到即清除，没取到返回 null（SW 会继续轮询）
    eval_result: async ({ evalId }) => {
      if (!evalId) return null;
      const el = document.documentElement;
      const attr = 'data-ba-eval-' + evalId;
      const v = el.getAttribute(attr);
      if (v != null) el.removeAttribute(attr);
      return v;
    },

    highlight: async (p) => {
      const el = locate(p);
      const old = el.style.cssText;
      el.style.cssText += ';outline:2px solid red !important;outline-offset:2px !important;';
      setTimeout(() => { el.style.cssText = old; }, 2000);
      return 'highlighted for 2s';
    },

    // 接口调用查询（LLM 查看协议 netlog，详见 docs/spec-net-protocol.md）：
    // 转发给页面主世界的捕获层 capture-main.js——eval 走 USER_SCRIPT/ISOLATED world，
    // 看不到 MAIN world 的 __BATB_NET__，必须经 DOM 事件桥（batb:bridge 的逆向）
    netlog: (params) => new Promise((resolve, reject) => {
      const qid = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('接口捕获层无响应（扩展更新后未刷新页面？请刷新后重试）'));
      }, 15000);
      function onRes(ev) {
        const d = ev.detail;
        if (!d || d.id !== qid) return;
        cleanup();
        if (d.ok) resolve(d.data); else reject(new Error(d.error || 'netlog 调用失败'));
      }
      function cleanup() { clearTimeout(timer); W.removeEventListener('batb:netq:res', onRes); }
      W.addEventListener('batb:netq:res', onRes);
      W.dispatchEvent(new CustomEvent('batb:netq', { detail: { id: qid, params: params || {} } }));
    }),

    // 页面日志/异常查询（console / 未捕获异常 / Promise 拒绝 / 资源加载失败 / CSP）：
    // 缓冲在页面 MAIN world 的 __BATB_LOG__，与 netlog 一样只能经 DOM 事件桥读取；
    // wait_ms > 0 时页面侧长轮询等待新记录，超时需覆盖等待时长
    plog: (params) => new Promise((resolve, reject) => {
      const qid = Math.random().toString(36).slice(2);
      const waitMs = Math.min(Math.max(Number(params && params.wait_ms) || 0, 0), 20000);
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('日志捕获层无响应（扩展更新后未刷新页面？请刷新后重试）'));
      }, waitMs + 5000);
      function onRes(ev) {
        const d = ev.detail;
        if (!d || d.id !== qid) return;
        cleanup();
        if (d.ok) resolve(d.data); else reject(new Error(d.error || 'plog 调用失败'));
      }
      function cleanup() { clearTimeout(timer); W.removeEventListener('batb:logq:res', onRes); }
      W.addEventListener('batb:logq:res', onRes);
      W.dispatchEvent(new CustomEvent('batb:logq', { detail: { id: qid, params: params || {} } }));
    }),
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

  // 自检挂载点：diag.js 先于本脚本加载，这里只把动作表交给它（就地包装，flowrun 拿到的
  // __batbExec.ACTIONS 是同一份对象）。diag 缺席时静默跳过，自检不能成为新的故障源。
  try { globalThis.__batbDiag?.wrapActions?.(ACTIONS); } catch {}

  // flowrun.js（独立内容脚本）复用同一套动作实现；同一隔离世界共享 globalThis
  globalThis.__batbExec = { ACTIONS, pageInfo, sleep, W, locate, serialize };

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

  /* ============ 5. 工具箱桥：MAIN world ↔ background（整页截图等扩展级能力） ============
   * 工具箱注入在页面主世界，收不到扩展消息；用 DOM 事件当桥：
   * batb:bridge（请求）→ runtime 消息 → background 执行 → batb:bridge:res（回传结果）。 */
  /* 全局配置广播：background 改了 chrome.storage.local 后推给所有已注入页面 */
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'tbxcfg') {
      window.dispatchEvent(new CustomEvent('batb:cfg', { detail: msg.cfg || {} }));
    }
  });
  window.addEventListener('batb:bridge', (ev) => {
    const { id, action, params } = ev.detail || {};
    if (id == null || !action) return;
    const respond = (res) => window.dispatchEvent(new CustomEvent('batb:bridge:res', {
      detail: res
        ? { id, ok: !!res.ok, data: res.data ?? null, error: res.error || null }
        : { id, ok: false, error: '扩展未响应，请刷新页面后重试' },
    }));
    try {
      chrome.runtime.sendMessage({ type: 'tb:' + action, ...params })
        .then(respond)
        .catch((e) => window.dispatchEvent(new CustomEvent('batb:bridge:res',
          { detail: { id, ok: false, error: String((e && e.message) || e) } })));
    } catch {
      // 扩展重载后旧 content.js 的 runtime 上下文失效
      window.dispatchEvent(new CustomEvent('batb:bridge:res',
        { detail: { id, ok: false, error: '扩展已重载，请刷新页面后重试' } }));
    }
  });
})();
