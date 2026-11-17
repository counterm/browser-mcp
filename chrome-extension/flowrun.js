/*
 * Page Bridge - flowrun（YAML 测试流执行器，内容脚本）
 * 职责：在页面内解析并逐步执行 flow YAML；进度 / 报告经 background 上报 broker。
 * 跨页面续跑：每步之前把运行状态写入 chrome.storage.session（key flowrun:<tabId>，由 background 落盘），
 * 页面跳转后新实例向 background 取回状态并从当前步继续。broker 只做传输，不解析 YAML。
 * schema 见 docs/spec-flow.md。
 */
(() => {
  'use strict';
  if (window.__PAGE_BRIDGE_FLOWRUN__) return;
  window.__PAGE_BRIDGE_FLOWRUN__ = true;

  const X = globalThis.__batbExec;
  if (!X || !X.ACTIONS) return; // content.js 未就绪：页面刷新后由新实例接管
  const { ACTIONS, sleep } = X;
  const D = globalThis.__batbDiag || null; // 自检/取证/记录（diag.js）；缺席时整条链路静默跳过

  // 由 background 执行的浏览器级动作（页面内脚本做不到）
  const BG_ACTIONS = new Set(['screenshot', 'tab_list', 'tab_open', 'tab_close', 'tab_activate', 'eval']);
  // 步骤控制键：不作为动作参数下发
  const CTRL = new Set(['id', 'do', 'desc', 'expect', 'max_wait_ms', 'on_fail', 'secret',
    'retry', 'retry_wait_ms', 'auto_wait_ms']);
  const EXP_KEYS = new Set(['url_contains', 'url_is', 'text', 'selector']);
  const FIX_SRC = ['gen', 'pick', 'dict', 'ref', 'env', 'template', 'const'];
  const GEN_NAMES = new Set(['username', 'phone', 'email', 'cn_idcard', 'date', 'number',
    'uuid', 'seq', 'pattern', 'string', 'bool']);
  const FIX_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  const VAR_RE = /\$\{(vars|env)\.([A-Za-z0-9_.-]+)\}/g;
  const MAX_STEPS_TOTAL = 2000; // 防御：步 × 数据组 上限

  let RUN = null;      // 当前运行状态（内存）
  let RESUME_DONE = false;

  function send(m) {
    try {
      return chrome.runtime.sendMessage(m).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
    } catch (e) {
      return Promise.resolve({ ok: false, error: String(e && e.message || e) });
    }
  }
  // 截图 dataUrl 可到几百 KB，全部塞进 storage 会撑爆 session 配额；续存时剔除，最终报告仍带原图
  function stripShots(st) {
    return { ...st, results: st.results.map((r) => { const c = { ...r }; delete c.dataUrl; return c; }) };
  }
  const persist = (st) => send({ type: 'flow_save', state: stripShots(st) });
  const clearPersist = () => send({ type: 'flow_clear' });
  const now = () => performance.now();

  /* ============ YAML 校验（与 background / broker 同一规则的最小集） ============ */

  function validateFixtures(fixtures) {
    if (!fixtures || typeof fixtures !== 'object' || Array.isArray(fixtures)) throw new Error('fixtures 必须是映射');
    const keys = Object.keys(fixtures);
    if (!keys.length) throw new Error('fixtures 不能为空');
    for (const k of keys) {
      if (!FIX_NAME_RE.test(k)) throw new Error(`fixtures 键名非法：${k}`);
      const s = fixtures[k];
      if (s == null || typeof s !== 'object') continue; // 标量 = 常量
      if (Array.isArray(s)) throw new Error(`fixtures.${k} 不能是列表（用 pick / values）`);
      const srcs = FIX_SRC.filter((x) => x !== 'pick' && x in s);
      const pickOnly = 'pick' in s && !srcs.length;
      if (!pickOnly && srcs.length !== 1) {
        throw new Error(`fixtures.${k} 需要 ${FIX_SRC.join(' / ')} 中恰好一个（dict 可额外带 pick）`);
      }
      if ('pick' in s && !('dict' in s)) {
        if (srcs.length) throw new Error(`fixtures.${k}: pick 不能和 ${srcs.join(' / ')} 同时使用`);
        if (!Array.isArray(s.pick)) throw new Error(`fixtures.${k}: 单独使用 pick 时必须是列表`);
      }
      if (s.gen != null && !GEN_NAMES.has(String(s.gen))) throw new Error(`fixtures.${k}: 不支持的 gen「${s.gen}」`);
      if (s.pick != null && !Array.isArray(s.pick) && !['first', 'last', 'random'].includes(s.pick)) {
        throw new Error(`fixtures.${k}: pick 必须是列表或 first / last / random`);
      }
      if (Array.isArray(s.pick) && !s.pick.length) throw new Error(`fixtures.${k}: pick 不能为空`);
      if (s.dict != null && (!Array.isArray(s.values) || !s.values.length)) {
        throw new Error(`fixtures.${k}: dict 需要 values（设计期把字典值解析后内联）`);
      }
      if (s.dict != null && Array.isArray(s.pick)) {
        throw new Error(`fixtures.${k}: dict 的 pick 只能是 first / last / random`);
      }
      if (s.ref != null && !FIX_NAME_RE.test(String(s.ref))) throw new Error(`fixtures.${k}: ref 必须是 fixtures 键名`);
      if (s.pattern != null) {
        try { new RegExp(String(s.pattern)); } catch (e) { throw new Error(`fixtures.${k}: pattern 非法`); }
      }
      for (const [nk, lo, hi] of [['min', 0, 100000], ['max', 0, 100000], ['length', 0, 100000],
        ['offset', -100000, 100000], ['start', -1e9, 1e9], ['step', -1e9, 1e9]]) {
        const v = s[nk];
        if (v == null) continue;
        if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) throw new Error(`fixtures.${k}: ${nk} 超出范围`);
      }
      if (s.unique != null && typeof s.unique !== 'boolean') throw new Error(`fixtures.${k}: unique 必须是布尔`);
      if (s.secret != null && typeof s.secret !== 'boolean') throw new Error(`fixtures.${k}: secret 必须是布尔`);
    }
  }

  function validate(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('flow 文档必须是映射');
    if (!NAME_RE.test(String(doc.flow || ''))) {
      throw new Error('flow 名非法（小写字母/数字/-/_，≤64 字符）：' + JSON.stringify(doc.flow));
    }
    if (doc.version != null && doc.version !== 1 && doc.version !== 2) throw new Error('version 只支持 1 / 2');
    if (doc.seed != null && typeof doc.seed !== 'string' && typeof doc.seed !== 'number') {
      throw new Error('seed 必须是字符串或数字');
    }
    if (doc.fixtures != null) validateFixtures(doc.fixtures);
    const steps = doc.steps;
    if (!Array.isArray(steps) || !steps.length) throw new Error('steps 必须是非空列表');
    const seen = new Set();
    steps.forEach((s, i) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`steps[${i}] 必须是映射`);
      const sid = s.id;
      if (typeof sid !== 'string' || !sid) throw new Error(`steps[${i}] 缺 id（字符串）`);
      if (seen.has(sid)) throw new Error('步骤 id 重复：' + sid);
      seen.add(sid);
      if (typeof s.do !== 'string' || !s.do) throw new Error(`步骤 ${sid} 缺 do`);
      const exp = s.expect;
      if (exp != null) {
        for (const e of (Array.isArray(exp) ? exp : [exp])) {
          if (!e || typeof e !== 'object' || Array.isArray(e) || !Object.keys(e).length) {
            throw new Error(`步骤 ${sid}: expect 必须是非空映射`);
          }
          for (const k of Object.keys(e)) {
            if (!EXP_KEYS.has(k)) throw new Error(`步骤 ${sid}: expect 不支持键「${k}」（仅 ${[...EXP_KEYS].join(' / ')}）`);
          }
        }
      }
      if (s.on_fail != null && s.on_fail !== 'continue' && s.on_fail !== 'abort') {
        throw new Error(`步骤 ${sid}: on_fail 只支持 continue / abort`);
      }
      for (const [k, hi] of [['retry', 10], ['retry_wait_ms', 60000], ['max_wait_ms', 30000],
        ['auto_wait_ms', 30000]]) {
        const v = s[k];
        if (v == null) continue;
        if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > hi) throw new Error(`步骤 ${sid}: ${k} 必须是 0~${hi} 的数字`);
      }
    });
    if (doc.vars != null && (typeof doc.vars !== 'object' || Array.isArray(doc.vars))) throw new Error('vars 必须是映射');
    if (doc.data_file != null) throw new Error('浏览器内执行不支持 data_file（请把数据内联到 data）');
    if (doc.data != null) {
      if (!Array.isArray(doc.data) || !doc.data.length) throw new Error('data 必须是非空列表（每项一组变量映射）');
      if (doc.data.length > 200) throw new Error('data 最多 200 组');
      doc.data.forEach((row, i) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`data[${i}] 必须是映射`);
      });
      if (steps.length * doc.data.length > MAX_STEPS_TOTAL) throw new Error(`步数过多（${steps.length} × ${doc.data.length}）`);
    }
    return doc;
  }

  /* ============ 变量展开 ============ */

  function subst(v, vars, where, env) {
    if (typeof v === 'string') {
      return v.replace(VAR_RE, (_m, src, key) => {
        if (src === 'env') {
          const val = env && env[key];
          if (val == null || val === '') throw new Error(`${where}: 环境变量 ${key} 未设置（在扩展设置里配置 flowenv）`);
          return String(val);
        }
        if (!(key in vars)) throw new Error(`${where}: 未定义变量 vars.${key}（写在 flow 的 vars 里或运行参数传入）`);
        return String(vars[key]);
      });
    }
    if (Array.isArray(v)) return v.map((x) => subst(x, vars, where, env));
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) o[k] = subst(v[k], vars, where, env);
      return o;
    }
    return v;
  }

  /* ============ fixtures（v2 声明式数据生成） ============ */

  function hash32(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // 固定 seed 时同一次运行可复现；不写 seed 时用 run_id，保证每次运行不同
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const pad = (n, w) => String(n).padStart(w, '0');
  const pickOne = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

  function digits(rnd, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(rnd() * 10);
    return s;
  }

  function alnum(rnd, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += ALNUM[Math.floor(rnd() * ALNUM.length)];
    return s;
  }

  function runToken(runId, row) {
    return (hash32(runId + ':' + row) >>> 0).toString(36).padStart(6, '0').slice(-6);
  }

  function cnIdChecksum(body17) {
    const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const codes = '10X98765432';
    let sum = 0;
    for (let i = 0; i < 17; i++) sum += Number(body17[i]) * w[i];
    return codes[sum % 11];
  }

  // 只支持契约里常见的正则子集：字面量、\d \w \s、字符类、分组、{n,m} * + ?
  // 遇到断言 / 反向引用等复杂语法会退化为字面量，生成后仍由 checkPattern 兜底校验
  function genPattern(pattern, rnd) {
    const src = String(pattern).replace(/^\^/, '').replace(/\$$/, '');
    let i = 0;

    function pickFromClass(cls) {
      const chars = [];
      for (let j = 0; j < cls.length; j++) {
        if (cls[j] === '\\') {
          const e = cls[++j];
          if (e === 'd') for (let d = 0; d <= 9; d++) chars.push(String(d));
          else if (e === 'w') chars.push(...ALNUM.split(''), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ_'.split(''));
          else if (e === 's') chars.push(' ');
          else if (e) chars.push(e);
        } else if (cls[j + 1] === '-' && j + 2 < cls.length) {
          const a = cls.charCodeAt(j);
          const b = cls.charCodeAt(j + 2);
          for (let c = Math.min(a, b); c <= Math.max(a, b); c++) chars.push(String.fromCharCode(c));
          j += 2;
        } else {
          chars.push(cls[j]);
        }
      }
      return chars.length ? pickOne(rnd, chars) : '';
    }

    function readAtom() {
      if (i >= src.length) return null;
      const ch = src[i++];
      if (ch === '\\') {
        const e = src[i++];
        if (e === 'd') return () => String(Math.floor(rnd() * 10));
        if (e === 'w') return () => pickOne(rnd, (ALNUM + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_').split(''));
        if (e === 's') return () => ' ';
        return () => e || '';
      }
      if (ch === '[') {
        let cls = '';
        let neg = false;
        if (src[i] === '^') { neg = true; i++; }
        for (; i < src.length && src[i] !== ']'; i++) {
          if (src[i] === '\\') { cls += src[i] + src[i + 1]; i++; } else cls += src[i];
        }
        i++;
        if (neg) {
          const re = new RegExp('^[' + cls + ']$');
          const pool = (ALNUM + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_').split('');
          for (let n = 0; n < 100; n++) {
            const c = pickOne(rnd, pool);
            if (!re.test(c)) return () => c;
          }
          return () => '_';
        }
        return () => pickFromClass(cls);
      }
      if (ch === '(') {
        let depth = 1;
        let body = '';
        for (; i < src.length && depth; i++) {
          if (src[i] === '(') depth++;
          else if (src[i] === ')') { depth--; if (!depth) break; }
          if (depth) body += src[i];
        }
        i++;
        const alts = [];
        let cur = '';
        let d2 = 0;
        for (const c of body) {
          if (c === '(') d2++;
          if (c === ')') d2--;
          if (c === '|' && !d2) { alts.push(cur); cur = ''; } else cur += c;
        }
        alts.push(cur);
        const chosen = pickOne(rnd, alts);
        return () => genPattern(chosen, rnd);
      }
      if (ch === '.') return () => pickOne(rnd, ALNUM.split(''));
      return () => ch;
    }

    function readQuant() {
      if (src[i] === '{') {
        const end = src.indexOf('}', i);
        if (end < 0) return [1, 1];
        const body = src.slice(i + 1, end);
        i = end + 1;
        const m = body.match(/^(\d+)(?:,(\d*))?$/);
        if (!m) return [1, 1];
        const lo = Number(m[1]);
        const hi = m[2] === undefined ? lo : (m[2] === '' ? lo + 8 : Number(m[2]));
        return [lo, Math.max(lo, hi)];
      }
      if (src[i] === '+') { i++; return [1, 9]; }
      if (src[i] === '*') { i++; return [0, 8]; }
      if (src[i] === '?') { i++; return [0, 1]; }
      return [1, 1];
    }

    let out = '';
    while (i < src.length) {
      const atom = readAtom();
      if (!atom) break;
      const [lo, hi] = readQuant();
      const n = lo + Math.floor(rnd() * (hi - lo + 1));
      for (let k = 0; k < n; k++) out += atom();
    }
    return out;
  }

  function checkPattern(value, spec, key) {
    if (spec.pattern == null) return;
    if (!new RegExp('^(?:' + String(spec.pattern) + ')$').test(String(value))) {
      throw new Error(`fixtures.${key}: 生成值「${value}」不满足 pattern ${spec.pattern}`);
    }
  }

  function uniqueValue(value, spec, ctx) {
    if (!spec.unique) return value;
    const key = String(value);
    if (!ctx.used.has(key)) { ctx.used.add(key); return value; }
    const tok = runToken(ctx.runId, ctx.row);
    const at = key.indexOf('@');
    const v = at >= 0 ? key.slice(0, at) + '+' + tok + key.slice(at) : key + '_' + tok;
    ctx.used.add(v);
    return v;
  }

  function generateOne(spec, ctx) {
    const { rnd, out, env, doc, row, runId, runVars } = ctx;
    let v;
    if ('const' in spec) v = spec.const;
    else if ('ref' in spec) {
      if (!(spec.ref in out)) throw new Error(`fixtures.${ctx.key}: ref 指向的 ${spec.ref} 尚未生成（按声明顺序物化）`);
      v = out[spec.ref];
    } else if ('env' in spec) {
      const val = env && env[spec.env];
      if (val == null || val === '') throw new Error(`fixtures.${ctx.key}: 环境变量 ${spec.env} 未设置`);
      v = val;
    } else if ('template' in spec) {
      v = subst(String(spec.template), { ...(doc.vars || {}), ...out, ...(runVars || {}) },
        `fixtures.${ctx.key}`, env || {});
    } else if ('dict' in spec) {
      const vals = spec.values;
      const mode = spec.pick || 'random';
      v = mode === 'first' ? vals[0] : mode === 'last' ? vals[vals.length - 1] : pickOne(rnd, vals);
    } else if ('pick' in spec) {
      if (!Array.isArray(spec.pick)) throw new Error(`fixtures.${ctx.key}: pick 需要是列表`);
      v = pickOne(rnd, spec.pick);
    } else {
      const gen = String(spec.gen || '');
      if (gen === 'username') {
        const prefix = spec.prefix != null ? String(spec.prefix) : 'e2e_';
        let s = prefix + runToken(runId, row);
        if (spec.min && s.length < spec.min) s += alnum(rnd, spec.min - s.length);
        if (spec.max && s.length > spec.max) s = s.slice(0, spec.max);
        if (spec.length) s = (s + alnum(rnd, spec.length)).slice(0, spec.length);
        v = s;
      } else if (gen === 'phone') {
        const head = spec.prefix != null ? String(spec.prefix) : '1';
        const second = pickOne(rnd, '3456789'.split(''));
        const tail = spec.unique
          ? String(hash32(runId + ':p:' + row) % 1000000000).padStart(9, '0')
          : digits(rnd, 9);
        v = head + second + tail;
      } else if (gen === 'email') {
        const local = (spec.prefix != null ? String(spec.prefix) : 'e2e_') + runToken(runId, row);
        v = local + '@' + (spec.domain || 'example.com');
      } else if (gen === 'cn_idcard') {
        const area = String(spec.area || '110101');
        const y = 1980 + Math.floor(rnd() * 30);
        const m = 1 + Math.floor(rnd() * 12);
        const d = 1 + Math.floor(rnd() * 28);
        const body = area + y + pad(m, 2) + pad(d, 2) + String(1 + Math.floor(rnd() * 999)).padStart(3, '0');
        v = body + cnIdChecksum(body);
      } else if (gen === 'date') {
        const offset = Number(spec.offset || 0);
        const dt = new Date(Date.now() + offset * 86400000);
        const fmt = spec.format || 'YYYY-MM-DD';
        v = fmt.replace(/YYYY/g, dt.getFullYear()).replace(/MM/g, pad(dt.getMonth() + 1, 2))
          .replace(/DD/g, pad(dt.getDate(), 2));
      } else if (gen === 'number') {
        const lo = spec.min != null ? Number(spec.min) : 0;
        const hi = spec.max != null ? Number(spec.max) : 999999;
        v = Math.floor(lo + rnd() * (hi - lo + 1));
      } else if (gen === 'uuid') {
        v = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.floor(rnd() * 16);
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
          });
      } else if (gen === 'seq') {
        const start = spec.start != null ? Number(spec.start) : 1;
        const step = spec.step != null ? Number(spec.step) : 1;
        v = start + row * step;
      } else if (gen === 'pattern') {
        v = genPattern(spec.pattern || '^\\w+$', rnd);
      } else if (gen === 'string') {
        const len = Number(spec.length || spec.max || 12);
        const prefix = spec.prefix != null ? String(spec.prefix) : '';
        const suffix = spec.suffix != null ? String(spec.suffix) : '';
        v = prefix + alnum(rnd, Math.max(0, len - prefix.length - suffix.length)) + suffix;
      } else if (gen === 'bool') {
        v = rnd() < 0.5;
      } else {
        throw new Error(`fixtures.${ctx.key}: 不支持的 gen「${gen}」`);
      }
    }
    v = uniqueValue(v, spec, ctx);
    checkPattern(v, spec, ctx.key);
    return v;
  }

  function materializeFixtures(st, rowIdx) {
    const doc = st.doc;
    const rnd = mulberry32(hash32(`${doc.seed != null ? doc.seed : st.run_id}:${rowIdx}`));
    const out = {};
    const used = new Set();
    const secret = [];
    for (const key of Object.keys(doc.fixtures)) {
      const spec = doc.fixtures[key];
      let value;
      if (spec == null || typeof spec !== 'object') value = spec;
      else {
        value = generateOne(spec, { key, rnd, out, env: st.env || {}, doc, row: rowIdx,
          runId: st.run_id, runVars: st.run_vars || {}, used });
        if (spec.secret) secret.push(key);
      }
      out[key] = value;
    }
    return { values: out, secret };
  }

  // 每个数据组单独物化；结果缓存进运行状态，跨页续跑时不会重新生成
  function ensureFixtures(st) {
    if (!st.doc.fixtures) return {};
    const rowIdx = st.row || 0;
    if (!st.fx || st.fx.row !== rowIdx) {
      const m = materializeFixtures(st, rowIdx);
      st.fx = { row: rowIdx, values: m.values, secret: m.secret };
      const pub = {};
      for (const k of Object.keys(m.values)) pub[k] = m.secret.includes(k) ? '***' : String(m.values[k]);
      st.fixture_public = pub;
    }
    return st.fx.values;
  }

  function brief(step, secret, secretVals) {
    const keys = ['bid', 'selector', 'text', 'x', 'y', 'url', 'value', 'key', 'dy', 'ms', 'code', 'op', 'area', 'name', 'tag', 'active'];
    const parts = [];
    for (const k of keys) {
      let v = step[k];
      if (v == null || v === '') continue;
      v = String(v);
      if (secret && (k === 'text' || k === 'value' || k === 'code')) v = '***';
      else if (secretVals && secretVals.has(v)) v = '***';
      else if (v.length > 80) v = v.slice(0, 80) + '…';
      parts.push(`${k}=${v}`);
    }
    return parts.join(' ');
  }

  function trace(name, text, level) {
    const prefix = `[flow:${name}]`;
    try { ACTIONS.log({ prefix, text, level: level || 'log' }); } catch {}
  }

  /* ============ 断言 ============ */

  async function checkExpect(exps) {
    let last = '';
    for (const e of exps) {
      const k = Object.keys(e)[0];
      const want = String(e[k]);
      if (k === 'url_contains' || k === 'url_is') {
        const got = location.href;
        if (k === 'url_is' ? got !== want : !got.includes(want)) {
          last = `${k}: 期望「${want}」实际「${got}」`;
        }
      } else if (k === 'text') {
        const got = (document.body && document.body.innerText) || '';
        if (!got.includes(want)) last = `text: 页面正文未包含「${want}」`;
      } else if (k === 'selector') {
        if (!document.querySelector(want)) last = `selector: 不存在 ${want}`;
      }
    }
    return last;
  }

  async function waitExpect(exps, maxWaitMs) {
    const limit = Math.min(Math.max(Number(maxWaitMs) || 5000, 0), 30000);
    const deadline = now() + limit;
    while (true) {
      const err = await checkExpect(exps);
      if (!err) return [true, ''];
      if (now() >= deadline) return [false, `${err}（等待 ${limit}ms 超时）`];
      await sleep(300);
    }
  }

  /* ============ 动作执行 ============ */

  // 定位类动作常跑在数据渲染之前：点菜单后路由切换、表格异步加载 1s+，flow ~600ms 就冲到点行步骤，
  // 元素此刻不存在不等于步骤失败（录制器只记稳态选择器、不生成等待）。找不到时在 auto_wait_ms
  // 窗口内每 0.3s 重试定位（Playwright 式 auto-wait）；默认 5s，step 级可覆盖，0 关闭。
  // 只对「element not found」生效，其余报错立即失败；显式等待语义仍推荐 expect。
  const LOCATOR_ACTIONS = new Set(['click', 'type', 'select', 'hover', 'press']);
  const AUTO_WAIT_DEFAULT = 5000;

  async function doAction(step, cmd) {
    const action = cmd.action;
    if (BG_ACTIONS.has(action)) {
      const r = await send({ type: 'flow_bg', action, params: cmd });
      if (!r || !r.ok) throw new Error((r && r.error) || `${action} 执行失败`);
      return r.data;
    }
    if (!ACTIONS[action]) throw new Error('不支持的动作：' + action);
    const waitMs = Math.min(Math.max(
      step.auto_wait_ms != null ? Number(step.auto_wait_ms) : AUTO_WAIT_DEFAULT, 0), 30000);
    const deadline = now() + waitMs;
    for (;;) {
      try {
        return await ACTIONS[action](cmd);
      } catch (e) {
        const msg = String((e && e.message) || e);
        const miss = LOCATOR_ACTIONS.has(action) && msg.startsWith('element not found');
        if (!miss || now() >= deadline) {
          throw miss && waitMs > 0 ? new Error(`${msg}（auto-wait ${waitMs}ms 内元素未出现）`) : e;
        }
        await sleep(300);
      }
    }
  }

  async function loadFlow(name) {
    const r = await send({ type: 'flow_lib', op: 'get', name });
    if (!r || !r.ok) throw new Error(`子流程加载失败：${(r && r.error) || name}`);
    let doc;
    try { doc = jsyaml.load((r.data && r.data.yaml) || ''); } catch (e) { throw new Error(`子流程 YAML 解析失败（${name}）：${e.message || e}`); }
    return validate(doc);
  }

  /* 子流程：同一页内递归执行（嵌套 ≤5 层，禁循环引用）；与顶层步骤同样的变量 / 断言 / 重试语义 */
  async function runSub(doc, vars, chain, env) {
    if (chain.includes(doc.flow)) throw new Error(`flow 循环引用：${[...chain, doc.flow].join(' → ')}`);
    if (chain.length >= 5) throw new Error(`flow 嵌套超过 5 层：${[...chain, doc.flow].join(' → ')}`);
    const nextChain = [...chain, doc.flow];
    const steps = doc.steps;
    const results = [];
    let okAll = true;
    for (const s of steps) {
      const sid = s.id;
      const entry = { id: sid, do: s.do, params: brief(s, !!s.secret), ok: false };
      const t0 = now();
      // 变量展开错误不重试；动作报错与断言不过按步骤 retry 重试
      let exps = null;
      let cmd = null;
      let prepErr = null;
      try {
        if (s.expect != null) {
          const e = subst(s.expect, vars, `步骤 ${sid}`, env || {});
          exps = Array.isArray(e) ? e : [e];
        }
        if (s.do !== 'flow') {
          const params = {};
          for (const k of Object.keys(s)) if (!CTRL.has(k)) params[k] = subst(s[k], vars, `步骤 ${sid}`, env || {});
          cmd = { action: s.do, ...params };
        }
      } catch (e) {
        prepErr = String((e && e.message) || e);
      }
      const attempts = 1 + Math.min(Math.max(Number(s.retry) || 0, 0), 10);
      const rwait = Math.max(Number(s.retry_wait_ms) || 1000, 0);
      if (!prepErr) {
        for (let att = 0; att < attempts; att++) {
          try {
            if (s.do === 'flow') {
              const subName = subst(s.name || '', vars, `步骤 ${sid}`, env || {});
              const subVars = s.vars ? subst(s.vars, vars, `步骤 ${sid}`, env || {}) : {};
              const subDoc = await loadFlow(subName);
              const childVars = { ...(subDoc.vars || {}), ...subVars };
              const sub = await runSub(subDoc, childVars, nextChain, env || {});
              entry.passed = sub.passed;
              entry.failed = sub.failed;
              entry.total = sub.total;
              entry.steps = sub.steps;
              if (!sub.ok) throw new Error(`子流程 ${subName} 有 ${sub.failed} 步失败`);
            } else {
              await doAction(s, cmd);
            }
            if (exps) {
              const [expOk, expErr] = await waitExpect(exps, s.max_wait_ms);
              entry.expect = { ok: expOk, error: expErr || null };
              if (!expOk) throw new Error(expErr);
            }
            entry.ok = true;
            delete entry.error;
            break;
          } catch (e) {
            entry.error = String((e && e.message) || e);
            if (att < attempts - 1) {
              trace(doc.flow, `${sid} ${s.do} 第 ${att + 1}/${attempts} 次失败：${entry.error}（${rwait}ms 后重试）`, 'warn');
              await sleep(rwait);
            }
          }
        }
      } else {
        entry.error = prepErr;
      }
      entry.ms = Math.round(now() - t0);
      results.push(entry);
      trace(doc.flow, `${sid} ${s.do} ${entry.params || '-'} → ${entry.ok ? 'OK' : 'FAIL'} ${entry.ms}ms`,
        entry.ok ? 'log' : 'error');
      if (!entry.ok) {
        okAll = false;
        if (s.on_fail !== 'continue') break;
      }
    }
    return { ok: okAll, total: results.length, passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length, steps: results };
  }

  /* ============ 顶层执行（带跨页续跑） ============ */

  function rowVars(st) {
    const fx = ensureFixtures(st);
    const row = st.rows && st.rows.length ? st.rows[Math.min(st.row, st.rows.length - 1)] : null;
    return { ...(st.vars || {}), ...fx, ...(st.run_vars || {}), ...(row || {}) };
  }

  function progress(st) {
    return {
      run_id: st.run_id,
      done: st.results.length,
      passed: st.results.filter((r) => r.ok).length,
      failed: st.results.filter((r) => !r.ok).length,
      steps_total: st.steps_total,
    };
  }

  async function execStep(st) {
    const steps = st.doc.steps;
    const step = steps[st.idx];
    const sid = step.id;
    const vars = rowVars(st);
    const env = st.env || {};
    const secretVals = new Set();
    if (st.fx && st.fx.secret) for (const k of st.fx.secret) secretVals.add(String(st.fx.values[k]));
    const where = `步骤 ${sid}` + (st.rows ? `（数据组 ${st.row + 1}）` : '');
    const entry = { id: sid, do: step.do, params: brief(step, !!step.secret, secretVals), ok: false };
    if (st.rows) entry.row = st.row + 1;
    try { D?.stepStart?.(step); } catch {}

    // 续跑判定：上一实例写了 pending 后页面被重建，才可能在当前文档里读到它。
    // nav/back/reload 本身就是跳转（URL 可能不变，如 reload），click/press 等按 URL 是否变化判定。
    const pend = st.pending;
    const NAVISH = new Set(['nav', 'back', 'reload', 'click', 'press', 'hover', 'tab_open', 'tab_activate']);
    const resumed = !!pend && NAVISH.has(pend.action)
      && (location.href !== pend.url || ['nav', 'back', 'reload'].includes(pend.action));
    st.pending = null;

    let exps = null;
    let cmd = null;
    let prepErr = null;
    try {
      if (step.expect != null) {
        const e = subst(step.expect, vars, where, env);
        exps = Array.isArray(e) ? e : [e];
      }
      if (!resumed && step.do !== 'flow') {
        const params = {};
        for (const k of Object.keys(step)) if (!CTRL.has(k)) params[k] = subst(step[k], vars, where, env);
        cmd = { action: step.do, ...params };
      }
    } catch (e) {
      prepErr = String((e && e.message) || e);
    }

    const attempts = 1 + Math.min(Math.max(Number(step.retry) || 0, 0), 10);
    const rwait = Math.max(Number(step.retry_wait_ms) || 1000, 0);
    let actionSkipped = resumed;
    const t0 = now();

    if (!prepErr) {
      for (let att = 0; att < attempts; att++) {
        try {
          if (step.do === 'flow') {
            const subName = subst(step.name || '', vars, where, env);
            const subVars = step.vars ? subst(step.vars, vars, where, env) : {};
            const subDoc = await loadFlow(subName);
            const childVars = { ...(subDoc.vars || {}), ...subVars };
            const sub = await runSub(subDoc, childVars, [st.doc.flow], env);
            entry.passed = sub.passed;
            entry.failed = sub.failed;
            entry.total = sub.total;
            entry.steps = sub.steps;
            if (!sub.ok) throw new Error(`子流程 ${subName} 有 ${sub.failed} 步失败`);
          } else if (!actionSkipped) {
            // 先落盘 pending：动作可能触发跳转，新页面实例据此判定该步已完成
            st.pending = { action: step.do, url: location.href };
            await persist(st);
            const data = await doAction(step, cmd);
            if (data && typeof data === 'object' && typeof data.dataUrl === 'string') entry.dataUrl = data.dataUrl;
            if (step.do === 'nav' || step.do === 'back' || step.do === 'reload') await sleep(500);
          }
          if (exps) {
            const [expOk, expErr] = await waitExpect(exps, step.max_wait_ms);
            entry.expect = { ok: expOk, error: expErr || null };
            if (!expOk) throw new Error(expErr);
          }
          entry.ok = true;
          delete entry.error;
          break;
        } catch (e) {
          entry.error = String((e && e.message) || e);
          if (att < attempts - 1) {
            trace(st.doc.flow, `${sid} ${step.do} 第 ${att + 1}/${attempts} 次失败：${entry.error}（${rwait}ms 后重试）`, 'warn');
            await sleep(rwait);
            actionSkipped = false;
            st.pending = null;
          }
        }
      }
    } else {
      entry.error = prepErr;
    }

    if (!entry.ok) {
      // 失败自动截图（尽力而为；浏览器级动作）
      try {
        const r = await send({ type: 'flow_bg', action: 'screenshot', params: {} });
        if (r && r.ok && r.data && r.data.dataUrl) entry.dataUrl = r.data.dataUrl;
      } catch {}
      // 失败取证：目标 DOM 片段 + 页面日志尾部 + 当前弹窗标题，写进报告，免去人工复现
      try { entry.evidence = await D?.collectEvidence?.(step, entry.error); } catch {}
    }

    entry.ms = Math.round(now() - t0);
    entry.url = location.href.slice(0, 300);
    try { D?.stepEnd?.(entry); } catch {}
    const status = entry.ok ? 'OK'
      : `FAIL: ${entry.error || ''}` + (step.do === 'flow' ? `（${entry.passed || 0}/${entry.total || 0}）` : '');
    trace(st.doc.flow, `${sid} ${step.do} ${entry.params || '-'} → ${status} ${entry.ms}ms`,
      entry.ok ? 'log' : 'error');

    st.results.push(entry);
    st.idx += 1;
    st.pending = null;
    await persist(st);
    send({ type: 'flow_progress', progress: progress(st) });
    return entry.ok;
  }

  function buildReport(st) {
    const results = st.results;
    const rep = {
      flow: st.doc.flow, run: st.run_id, ok: results.every((r) => r.ok),
      total: results.length, passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length, steps: results,
    };
    if (st.doc.version != null) rep.version = st.doc.version;
    if (st.doc.seed != null) rep.seed = st.doc.seed;
    if (st.fixture_public) rep.fixtures = st.fixture_public;
    if (st.rows) {
      const rows = [];
      for (let i = 0; i < st.rows.length; i++) {
        const seg = results.filter((r) => r.row === i + 1);
        if (!seg.length) continue; // 中途中断：未跑到的数据组不统计
        rows.push({ row: i + 1, ok: seg.every((r) => r.ok), passed: seg.filter((r) => r.ok).length,
          failed: seg.filter((r) => !r.ok).length });
      }
      rep.data_rows = st.rows.length;
      rep.passed_rows = rows.filter((r) => r.ok).length;
      rep.failed_rows = rows.length - rep.passed_rows;
      rep.rows = rows;
    }
    try { rep.diagnostics = D?.buildDiagnostics?.(rep, D?.lintFlow?.(st.doc)); } catch {}
    return rep;
  }

  async function loop(st) {
    const steps = st.doc.steps;
    let stop = false;
    while (!stop) {
      if (st.idx >= steps.length) {
        if (st.rows && st.row + 1 < st.rows.length) {
          st.row += 1;
          st.idx = 0;
          st.pending = null;
          st.fx = null;
          st.fixture_public = null;
          await persist(st);
          trace(st.doc.flow, `▶ 数据组 ${st.row + 1}/${st.rows.length}`);
          continue;
        }
        break;
      }
      const ok = await execStep(st);
      const step = steps[st.idx - 1] || {};
      if (!ok && st.stop_on_fail !== false && step.on_fail !== 'continue') stop = true;
    }
    const rep = buildReport(st);
    send({ type: 'flow_report', run_id: st.run_id, report: rep });
    // 自记录：运行摘要写入页面同源 localStorage（工具箱「操作记录」同一 key），不依赖 broker 常驻内存
    try { D?.recordRun?.(rep); } catch {}
    await clearPersist();
    trace(st.doc.flow, `■ 执行结束：通过 ${rep.passed}/${rep.total}` +
      (st.rows ? `，数据组 ${rep.passed_rows}/${rep.data_rows}` : ''), rep.ok ? 'log' : 'error');
    RUN = null;
  }

  async function startFlow(cmd) {
    if (RUN) return { run_id: RUN.run_id, flow: RUN.doc.flow, steps_total: RUN.steps_total, already: true };
    let text = cmd.yaml;
    if (!text && cmd.name) {
      const r = await send({ type: 'flow_lib', op: 'get', name: cmd.name });
      if (!r || !r.ok) throw new Error((r && r.error) || `flow 不存在：${cmd.name}`);
      text = (r.data && r.data.yaml) || '';
    }
    if (!text || typeof text !== 'string') throw new Error('需要 name 或 yaml 之一');
    let doc;
    try { doc = jsyaml.load(text); } catch (e) { throw new Error('YAML 解析失败：' + ((e && e.message) || e)); }
    validate(doc);
    let idx = 0;
    if (cmd.from_step) {
      const i = doc.steps.findIndex((s) => s.id === cmd.from_step);
      if (i < 0) throw new Error('from_step 不存在：' + cmd.from_step);
      idx = i;
    }
    const rows = doc.data || null;
    const st = {
      run_id: 'r' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
      doc, env: cmd.env || {}, vars: { ...(doc.vars || {}) }, run_vars: { ...(cmd.vars || {}) },
      rows, row: 0, idx, pending: null, results: [], fx: null, fixture_public: null,
      stop_on_fail: cmd.stop_on_fail !== false,
      steps_total: (doc.steps.length - idx) * (rows ? rows.length : 1),
      started: Date.now(),
    };
    ensureFixtures(st); // 提前物化一次，生成器/pattern 错误在启动时就暴露
    RUN = st;
    await persist(st);
    trace(doc.flow, `▶ ${doc.flow} 开始执行（${doc.steps.length} 步` + (rows ? ` × ${rows.length} 组数据）` : '）'));
    setTimeout(() => { loop(st).catch((e) => {
      send({ type: 'flow_report', run_id: st.run_id,
        report: { flow: st.doc.flow, run: st.run_id, ok: false, total: st.results.length, steps: st.results, error: String((e && e.message) || e) } });
      RUN = null;
    }); }, 0);
    return { run_id: st.run_id, flow: doc.flow, steps_total: st.steps_total };
  }

  /* ============ 消息入口 ============ */

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    const c = msg && msg.__flow_cmd;
    if (!c) return;
    (async () => {
      try {
        if (c.action === 'start') respond({ ok: true, data: await startFlow(c) });
        else if (c.action === 'stop') {
          RUN = null;
          await clearPersist();
          respond({ ok: true, data: 'stopped' });
        } else respond({ ok: false, error: 'unknown flow cmd: ' + c.action });
      } catch (e) {
        respond({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  });

  /* 页面加载后询问是否有未完成的运行（跨页续跑） */
  if (!RESUME_DONE) {
    RESUME_DONE = true;
    setTimeout(async () => {
      try {
        const r = await send({ type: 'flow_resume' });
        if (!r || !r.ok || !r.data || RUN) return;
        RUN = r.data;
        trace(RUN.doc.flow, `▶ 页面跳转后继续执行（第 ${RUN.idx + 1}/${RUN.doc.steps.length} 步）`);
        await loop(RUN);
      } catch {}
    }, 800);
  }
})();
