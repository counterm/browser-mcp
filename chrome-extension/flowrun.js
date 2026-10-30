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

  // 由 background 执行的浏览器级动作（页面内脚本做不到）
  const BG_ACTIONS = new Set(['screenshot', 'tab_list', 'tab_open', 'tab_close', 'tab_activate', 'eval']);
  // 步骤控制键：不作为动作参数下发
  const CTRL = new Set(['id', 'do', 'desc', 'expect', 'max_wait_ms', 'on_fail', 'secret',
    'retry', 'retry_wait_ms']);
  const EXP_KEYS = new Set(['url_contains', 'url_is', 'text', 'selector']);
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

  function validate(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('flow 文档必须是映射');
    if (!NAME_RE.test(String(doc.flow || ''))) {
      throw new Error('flow 名非法（小写字母/数字/-/_，≤64 字符）：' + JSON.stringify(doc.flow));
    }
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
      for (const [k, hi] of [['retry', 10], ['retry_wait_ms', 60000], ['max_wait_ms', 30000]]) {
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

  function brief(step, secret) {
    const keys = ['bid', 'selector', 'text', 'url', 'value', 'key', 'dy', 'ms', 'code', 'op', 'area', 'name', 'tag', 'active'];
    const parts = [];
    for (const k of keys) {
      let v = step[k];
      if (v == null || v === '') continue;
      v = String(v);
      if (secret && (k === 'text' || k === 'value' || k === 'code')) v = '***';
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

  async function doAction(step, cmd) {
    const action = cmd.action;
    if (BG_ACTIONS.has(action)) {
      const r = await send({ type: 'flow_bg', action, params: cmd });
      if (!r || !r.ok) throw new Error((r && r.error) || `${action} 执行失败`);
      return r.data;
    }
    if (!ACTIONS[action]) throw new Error('不支持的动作：' + action);
    return await ACTIONS[action](cmd);
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
    const row = st.rows && st.rows.length ? st.rows[Math.min(st.row, st.rows.length - 1)] : null;
    return row ? { ...st.vars, ...row } : { ...st.vars };
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
    const where = `步骤 ${sid}` + (st.rows ? `（数据组 ${st.row + 1}）` : '');
    const entry = { id: sid, do: step.do, params: brief(step, !!step.secret), ok: false };
    if (st.rows) entry.row = st.row + 1;

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
    }

    entry.ms = Math.round(now() - t0);
    entry.url = location.href.slice(0, 300);
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
      doc, env: cmd.env || {}, vars: { ...(doc.vars || {}), ...(cmd.vars || {}) },
      rows, row: 0, idx, pending: null, results: [],
      stop_on_fail: cmd.stop_on_fail !== false,
      steps_total: (doc.steps.length - idx) * (rows ? rows.length : 1),
      started: Date.now(),
    };
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
