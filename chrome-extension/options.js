/* options：白名单管理（域名 + 正则的增删改查、导入导出、测试面板） */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const hint = (node, text, kind) => { node.textContent = text; node.className = `hint ${kind || ''}`; };
  const fmtTime = (t) => new Date(t).toLocaleDateString();
  const sourceLabel = (s) => (s === 'quick-add' ? '快捷添加' : s === 'import' ? '导入' : '手动');

  let cfg = null;

  async function load() {
    cfg = await URLFilter.loadConfig();
    renderDomains();
    renderRegexes();
  }

  async function save(next) {
    cfg = await URLFilter.saveConfig(next); // 写入 storage，SW 经 onChanged 热生效
    renderDomains();
    renderRegexes();
  }

  /* ============ Tab 切换 ============ */
  function showTab(name) {
    $('tab-domains').classList.toggle('on', name === 'domains');
    $('tab-regex').classList.toggle('on', name === 'regex');
    $('p-domains').classList.toggle('on', name === 'domains');
    $('p-regex').classList.toggle('on', name === 'regex');
  }
  $('tab-domains').onclick = () => showTab('domains');
  $('tab-regex').onclick = () => showTab('regex');
  if (location.hash === '#regex') showTab('regex');

  /* ============ 域名列表 ============ */

  function visibleDomains() {
    const q = $('d-search').value.trim().toLowerCase();
    return cfg.domains.filter((d) =>
      !q || d.host.includes(q) || (d.note || '').toLowerCase().includes(q));
  }

  function renderDomains() {
    const body = $('d-body');
    body.innerHTML = '';
    const rows = visibleDomains();
    $('d-count').textContent = `共 ${rows.length} / ${cfg.domains.length} 条`;
    $('d-empty').style.display = rows.length ? 'none' : '';
    for (const d of rows) {
      const tr = el('tr');

      tr.appendChild(el('td', 'host', d.host));

      const tdOn = el('td');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = d.enabled;
      cb.onchange = () => save(URLFilter.updateDomain(cfg, d.id, { enabled: cb.checked }).config);
      tdOn.appendChild(cb);
      tr.appendChild(tdOn);

      const tdNote = el('td');
      const note = el('input');
      note.type = 'text';
      note.value = d.note || '';
      note.placeholder = '点击填写备注';
      note.onchange = () => save(URLFilter.updateDomain(cfg, d.id, { note: note.value }).config);
      tdNote.appendChild(note);
      tr.appendChild(tdNote);

      tr.appendChild(el('td', '', `${sourceLabel(d.source)} · ${fmtTime(d.createdAt)}`));

      const tdOp = el('td');
      const del = el('button', 'danger', '删除');
      del.onclick = () => {
        const removed = cfg.domains.find((x) => x.id === d.id);
        save(URLFilter.removeDomain(cfg, d.host).config);
        const node = $('d-hint');
        hint(node, `已删除 ${d.host}，`, 'ok');
        const undo = el('a', '', '撤销');
        undo.href = 'javascript:void(0)';
        undo.style.cssText = 'color:#1a73e8;text-decoration:underline;margin-left:4px';
        undo.onclick = () => { save({ ...cfg, domains: [...cfg.domains, removed] }); hint(node, '已撤销', 'ok'); };
        node.appendChild(undo);
        const tip = `已删除 ${d.host}，`;
        setTimeout(() => { if (node.textContent === tip) hint(node, '', ''); }, 3000);
      };
      tdOp.appendChild(del);
      tr.appendChild(tdOp);
      body.appendChild(tr);
    }
  }

  $('d-search').oninput = renderDomains;

  /* 添加：实时归一化预览 + 重复提示 */
  $('d-input').oninput = () => {
    const host = URLFilter.urlToDomain(URLFilter.parseHost($('d-input').value) || '');
    const input = $('d-input');
    input.classList.toggle('bad', false);
    if (!$('d-input').value.trim()) { hint($('d-hint'), '', ''); return; }
    if (!host) { input.classList.add('bad'); hint($('d-hint'), '无法解析出有效域名', 'err'); return; }
    if (cfg.domains.some((d) => d.host === host)) {
      hint($('d-hint'), `⚠ 归一为主域名 ${host}，已在白名单中`, 'err');
    } else {
      hint($('d-hint'), `归一为主域名: ${host}`, 'ok');
    }
  };

  $('d-add').onclick = () => {
    const r = URLFilter.addDomain(cfg, $('d-input').value, 'manual');
    if (r.error) { hint($('d-hint'), r.error, 'err'); return; }
    $('d-input').value = '';
    hint($('d-hint'), '已添加', 'ok');
    save(r.config);
  };

  /* 导入导出 */
  const dump = () => JSON.stringify({ version: 2, domains: cfg.domains, regexes: cfg.regexes }, null, 2);
  $('d-export-btn').onclick = () => download(`url-whitelist-${Date.now()}.json`, dump());
  $('g-export').onclick = () => download(`url-whitelist-${Date.now()}.json`, dump());
  $('d-import-btn').onclick = () => $('d-import-file').click();
  $('d-import-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const r = URLFilter.importConfig(cfg, text);
    save(r.config);
    hint($('d-hint'), r.skipped.length ? `导入完成，跳过 ${r.skipped.length} 条：${r.skipped.slice(0, 3).join('；')}` : '导入完成', r.skipped.length ? 'err' : 'ok');
    e.target.value = '';
  };

  /* ============ 正则规则 ============ */

  function renderRegexes() {
    const body = $('r-body');
    body.innerHTML = '';
    $('r-empty').style.display = cfg.regexes.length ? 'none' : '';
    cfg.regexes.forEach((r) => {
      const tr = el('tr');

      const tdPat = el('td');
      const pat = el('input');
      pat.type = 'text';
      pat.value = r.pattern;
      pat.onchange = () => {
        const res = URLFilter.updateRegex(cfg, r.id, { pattern: pat.value });
        if (res.error) { hint($('r-hint'), res.error, 'err'); renderRegexes(); return; }
        hint($('r-hint'), '', '');
        save(res.config);
      };
      tdPat.appendChild(pat);
      tr.appendChild(tdPat);

      const tdOn = el('td');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = r.enabled;
      cb.onchange = () => save(URLFilter.updateRegex(cfg, r.id, { enabled: cb.checked }).config);
      tdOn.appendChild(cb);
      tr.appendChild(tdOn);

      const tdNote = el('td');
      const note = el('input');
      note.type = 'text';
      note.value = r.note || '';
      note.placeholder = '备注';
      note.onchange = () => save(URLFilter.updateRegex(cfg, r.id, { note: note.value }).config);
      tdNote.appendChild(note);
      tr.appendChild(tdNote);

      const tdOp = el('td');
      const del = el('button', 'danger', '删除');
      del.onclick = () => save(URLFilter.removeRegex(cfg, r.id).config);
      tdOp.appendChild(del);
      tr.appendChild(tdOp);

      body.appendChild(tr);
    });
    runRegexTest();
  }

  $('r-add').onclick = () => {
    const r = URLFilter.addRegex(cfg, $('r-input').value.trim());
    if (r.error) { hint($('r-hint'), r.error, 'err'); return; }
    $('r-input').value = '';
    hint($('r-hint'), '已添加', 'ok');
    save(r.config);
  };

  $('r-gen').onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) { hint($('r-hint'), '取不到当前页面 URL', 'err'); return; }
    const escaped = tab.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    $('r-input').value = `^${escaped}`;
    hint($('r-hint'), '已按当前页面 URL 生成前缀正则（可再编辑）', 'ok');
  };

  /* 测试面板：实时复用 matchUrl */
  function runRegexTest() {
    const url = $('r-test').value.trim();
    const out = $('r-test-out');
    if (!url) { out.textContent = ''; return; }
    const v = URLFilter.matchUrl(url, cfg);
    const esc = (s) => String(s).replace(/</g, '&lt;');
    out.innerHTML = v.allowed
      ? `判定: <b style="color:#2e7d32">放行</b>（命中${v.hit.kind === 'domain' ? '域名' : '正则'}: ${esc(v.hit.value)}）`
      : '判定: <b style="color:#c62828">拦截</b>（未命中白名单）';
  }
  $('r-test').oninput = runRegexTest;

  /* ============ 公共操作 ============ */

  $('g-reset').onclick = () => {
    if (!confirm('确定清空全部域名与正则规则？')) return;
    save(URLFilter.normalizeConfig(null));
    hint($('g-hint'), '已清空', 'ok');
  };

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* 其他入口（popup）改了配置时同步刷新 */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[URLFilter.STORAGE_KEY]) load();
  });

  load();
})();
