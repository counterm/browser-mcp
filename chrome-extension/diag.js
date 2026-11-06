/*
 * Page Bridge - 自检 / 自报 / 自记录（diag）
 * 所有「动作效果、失败取证、静态 lint、运行摘要」都收在这一个文件里；其它模块只留锚点：
 *   content.js  → wrapActions(ACTIONS)                一处，动作统一入口
 *   flowrun.js  → stepStart / stepEnd                  步骤边界
 *               → collectEvidence                     步骤失败
 *               → lintFlow / buildDiagnostics          报告组装
 *               → recordRun                           运行结束
 * 约束：本文件任何异常都必须自吞并降级成 warning，绝不能让自检本身把 flow 弄挂；
 *       自检只判 warning，不判 fail（严格模式后续再开）。加载顺序在 manifest 里必须早于 content.js。
 */
(() => {
  'use strict';
  if (globalThis.__batbDiag) return;

  const MAX_EVIDENCE = 8000;      // 单步证据上限（报告 / storage.session 都吃不消更大的）
  const MAX_LINT = 20;
  const MAX_WARN = 50;
  const OBSERVE_MS = 250;         // 点击后观察窗口：捕捉异步渲染 / 接口回调引起的 DOM 变化
  const REC_KEY = 'ba:tbx-records'; // 与工具箱操作记录同一 key / 同一 schema（同源 localStorage）
  const EFFECT_ACTIONS = new Set(['click', 'type', 'select']);

  let cur = null;   // 当前步骤：{ step, effects }
  let wrapped = false;

  const actions = () => (globalThis.__batbExec || {}).ACTIONS || null;

  function isVisible(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
  }

  function elText(el) {
    try {
      return String((el && (el.innerText || el.value ||
        (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))))) || '');
    } catch { return ''; }
  }

  function snap() {
    let dialogs = 0;
    try {
      for (const d of document.querySelectorAll('.el-dialog, [role="dialog"], .el-overlay')) {
        if (isVisible(d)) dialogs++;
      }
    } catch {}
    return { url: location.href, dialogs };
  }

  /* ============ 1. 动作效果自检（锚点：content.js 包一层 ACTIONS） ============ */

  function wrapActions(ACTIONS) {
    if (!ACTIONS || wrapped) return ACTIONS;
    wrapped = true;
    for (const name of Object.keys(ACTIONS)) {
      const fn = ACTIONS[name];
      if (typeof fn !== 'function' || !EFFECT_ACTIONS.has(name)) continue;
      // 就地替换：flowrun 拿到的 __batbExec.ACTIONS 是同一份对象，不需要各自动改
      ACTIONS[name] = function (p) { return withEffect(name, fn, this, p); };
    }
    return ACTIONS;
  }

  // 只有 flow 步骤内才采样（cur 非空）；手动 / LLM 的单次调用零开销、零行为变化
  async function withEffect(name, fn, self, p) {
    if (!cur) return fn.call(self, p);
    const before = snap();
    let muts = 0;
    let obs = null;
    if (name === 'click') {
      try {
        obs = new MutationObserver((rs) => { muts += rs.length; });
        obs.observe(document.documentElement, { childList: true, subtree: true });
      } catch {}
    }
    let out;
    let err = null;
    try { out = await fn.call(self, p); } catch (e) { err = e; }
    if (obs) {
      await new Promise((r) => setTimeout(r, OBSERVE_MS));
      try { muts += obs.takeRecords().length; } catch {}
      try { obs.disconnect(); } catch {}
    }
    const after = obs ? snap() : before;
    const eff = {
      action: name,
      changed: muts > 0 || after.url !== before.url || after.dialogs !== before.dialogs,
      err: err ? 1 : 0,
    };
    if (!err) {
      if (name === 'type') eff.mismatch = valueMismatch(p, p && p.text);
      if (name === 'select') eff.mismatch = valueMismatch(p, p && p.value);
    }
    if (cur.effects.length < 10) cur.effects.push(eff);
    if (err) throw err;
    return out;
  }

  // 回读控件值：受控组件 / 输入掩码会把写入值吞掉或改写，这是动作成功但实际没生效的常见来源
  function valueMismatch(p, want) {
    const wantStr = String(want == null ? '' : want);
    if (!wantStr) return '';
    try {
      const X = globalThis.__batbExec;
      const el = X && X.locate ? X.locate({ selector: p && p.selector, bid: p && p.bid }) : null;
      const got = el && typeof el.value === 'string' ? el.value : null;
      if (got == null || got === wantStr) return '';
      return `回读值「${got.slice(0, 40)}」≠ 期望「${wantStr.slice(0, 40)}」`;
    } catch { return ''; }
  }

  function stepStart(step) {
    cur = { step: step || null, effects: [] };
  }

  // 把本步的效果异常汇总成 entry.warnings（只告警，不改 ok / 不阻断流程）
  function stepEnd(entry) {
    try {
      const st = cur;
      cur = null;
      if (!st || !entry) return;
      const warns = [];
      for (const e of st.effects) {
        if (e.err) continue; // 失败的动作有 error 兜底，不额外加效果告警
        if (e.action === 'click' && !e.changed) {
          warns.push(`点击后 ${OBSERVE_MS}ms 内页面无变化（可能命中旧页面 / 隐藏节点，或该元素当前无响应）`);
        }
        if (e.mismatch) warns.push(`${e.action === 'type' ? '输入' : '选择'}未生效：${e.mismatch}`);
      }
      if (warns.length) entry.warnings = [...new Set(warns)].slice(0, 5);
    } catch {}
  }

  /* ============ 2. 失败取证（锚点：flowrun 失败分支） ============ */

  // 取证不能反过来拖慢失败步骤：DOM / 日志两条都是尽力而为，超时就放弃
  function timed(p, ms) {
    return Promise.race([
      Promise.resolve(p).catch(() => null),
      new Promise((r) => setTimeout(() => r(null), ms)),
    ]);
  }

  async function collectEvidence(step, err) {
    const out = {
      at: new Date().toISOString(),
      url: location.href.slice(0, 300),
      title: (document.title || '').slice(0, 120),
      error: String(err || '').slice(0, 300),
      target: {
        selector: String((step && step.selector) || '').slice(0, 200),
        text: String((step && step.text) || '').slice(0, 80),
      },
    };
    try {
      const ds = [...document.querySelectorAll('.el-dialog, [role="dialog"]')].filter(isVisible).slice(0, 3);
      out.dialogs = ds.map((d) => elText(d).replace(/\s+/g, ' ').trim().slice(0, 60));
    } catch {}
    const A = actions();
    if (A && A.dom) {
      try {
        const d = await timed(A.dom({ selector: String((step && step.selector) || 'body'), depth: 2, maxChars: 2500 }), 800);
        out.dom = d ? String(d.content || '').slice(0, 2500) : '（DOM 取证超时或不可用）';
      } catch (e) {
        out.dom = `取不到目标 DOM：${String((e && e.message) || e).slice(0, 100)}`;
      }
    }
    if (A && A.plog) {
      try {
        const L = await timed(A.plog({ wait_ms: 0, limit: 20, levels: 'warn,error' }), 1200);
        out.logs = ((L && L.items) || []).slice(-20)
          .map((i) => `[${i.level || 'log'}] ${String(i.text || '').slice(0, 120)}`);
      } catch {}
    }
    // 兜底裁剪：先砍 DOM，再砍日志，保证单步证据不超过上限（session.storage 有配额）
    while (JSON.stringify(out).length > MAX_EVIDENCE) {
      if (out.dom) { out.dom = out.dom.slice(0, Math.floor(out.dom.length / 2)); continue; }
      if (out.logs && out.logs.length > 5) { out.logs = out.logs.slice(-5); continue; }
      break;
    }
    return out;
  }

  /* ============ 3. 静态 lint（锚点：flowrun 组装报告时） ============ */

  const NAVISH = new Set(['nav', 'back', 'reload', 'click', 'press', 'tab_open', 'tab_activate']);

  function lintFlow(doc) {
    const out = [];
    const steps = (doc && doc.steps) || [];
    steps.forEach((s, i) => {
      const id = String((s && s.id) || i + 1);
      const sel = String((s && s.selector) || '');
      if (sel) {
        const hits = sel.match(/nth-of-type\((\d+)\)/g) || [];
        const big = hits.map((x) => Number(x.match(/\d+/)[0])).filter((n) => n >= 6);
        if (big.length) {
          out.push(`步骤 ${id}：选择器依赖 nth-of-type(${Math.max(...big)}) 这类大序号，页面结构一变就漂移`);
        }
        if (/el-overlay|el-dialog/.test(sel) && /nth-of-type/.test(sel)) {
          out.push(`步骤 ${id}：弹窗 / 遮罩用位置序号定位，弹窗数量一变就点不中，建议改用标题文本或 data-testid`);
        }
        if (s.do === 'click' && /nth-of-type/.test(sel) && !s.text) {
          out.push(`步骤 ${id}：点击步是纯位置选择器且没有 text，无法校验命中的是不是同一个按钮`);
        }
      }
      if (s.do === 'type' && sel && !/input|textarea|contenteditable|select/i.test(sel)) {
        out.push(`步骤 ${id}：type 的目标选择器不像输入框（${sel.slice(0, 60)}）`);
      }
      const prev = i > 0 ? steps[i - 1] : null;
      if (s && !s.expect && NAVISH.has(String(s.do)) && prev && NAVISH.has(String(prev.do))
        && Number(s.auto_wait_ms) === 0) {
        out.push(`步骤 ${id}：上一步是 ${prev.do}，本步又关掉了 auto_wait_ms，跨页 / 异步渲染会直接失败`);
      }
    });
    return out.slice(0, MAX_LINT);
  }

  /* ============ 4. 自报（报告汇总） ============ */

  function buildDiagnostics(rep, lint) {
    const warnings = [];
    ((rep && rep.steps) || []).forEach((s) => {
      ((s && s.warnings) || []).forEach((msg) => warnings.push({ id: s.id, msg }));
    });
    return { lint: (lint || []).slice(0, MAX_LINT), warnings: warnings.slice(0, MAX_WARN) };
  }

  /* ============ 5. 自记录（运行摘要写工具箱操作记录） ============ */

  function recordRun(rep) {
    try {
      if (!rep || !rep.flow) return;
      const dg = rep.diagnostics || {};
      const lines = [`${rep.ok ? 'PASS' : 'FAIL'} ${rep.passed || 0}/${rep.total || 0} 步` +
        (rep.data_rows ? `，数据组 ${rep.passed_rows}/${rep.data_rows}` : '')];
      ((rep.steps || []).filter((s) => !s.ok) || []).slice(0, 5)
        .forEach((s) => lines.push(`FAIL ${String(s.id || '')} ${String(s.do || '')} ${String(s.error || '').slice(0, 180)}`));
      (dg.warnings || []).forEach((w) => lines.push(`WARN ${w.id} ${w.msg}`));
      (dg.lint || []).forEach((w) => lines.push(`LINT ${w}`));
      lines.push(`URL ${String((rep.steps && rep.steps.length ? rep.steps[rep.steps.length - 1].url : '') || '')}`);
      const item = {
        ts: Date.now(),
        feat: 'flowrun',
        title: `flow ${rep.flow} · ${rep.ok ? 'OK' : 'FAIL'} ${rep.passed || 0}/${rep.total || 0}`,
        text: lines.join('\n').slice(0, 2000),
      };
      let arr = JSON.parse(localStorage.getItem(REC_KEY) || '[]');
      if (!Array.isArray(arr)) arr = [];
      arr.push(item);
      while (arr.length > 200) arr.shift();
      let s = JSON.stringify(arr);
      while (s.length > 102400 && arr.length > 1) { arr.shift(); s = JSON.stringify(arr); }
      localStorage.setItem(REC_KEY, s);
    } catch {}
  }

  globalThis.__batbDiag = { wrapActions, stepStart, stepEnd, collectEvidence, lintFlow, buildDiagnostics, recordRun };
})();
