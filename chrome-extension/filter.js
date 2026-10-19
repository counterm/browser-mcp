/*
 * Page Bridge - 站点白名单核心
 * 职责：配置存储 / eTLD+1 主域名提取 / 匹配引擎。
 * SW（importScripts）、popup、options 共用同一份实现，保证三处判定一致。
 *
 * 模式：纯白名单。命中（域名或正则）=> 接入 broker；未命中 => 不注册/不广播。
 * 域名规则自动适应该主域名下所有子域名；正则规则匹配完整 URL。
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'urlFilterConfig';

  const DEFAULT_CONFIG = {
    version: 2,
    domains: [], // {id, host, enabled, note, source, createdAt}
    regexes: [], // {id, pattern, enabled, note, createdAt}
  };

  /* 多级公共后缀（精简表）：末两段命中则取末三段，否则取末两段。
   * 覆盖常见多级后缀；未覆盖的降级为末两段（x.y），UI 会标注。 */
  const MULTI_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'sch.uk', 'net.uk', 'me.uk',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'mil.cn',
    'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk', 'idv.hk',
    'com.tw', 'org.tw', 'net.tw', 'idv.tw', 'gov.tw', 'edu.tw',
    'com.mo', 'com.jp', 'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'lg.jp',
    'com.sg', 'com.my', 'co.kr', 'or.kr', 'ne.kr', 'go.kr',
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au', 'asn.au',
    'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
    'co.za', 'org.za', 'net.za', 'web.za',
    'com.br', 'net.br', 'org.br', 'gov.br',
    'com.ar', 'net.ar', 'org.ar', 'gov.ar',
    'com.mx', 'com.co', 'com.pe', 'com.ve', 'com.ec', 'com.bo', 'com.py', 'com.uy',
    'com.tr', 'com.ru', 'com.ua', 'com.by', 'com.kz', 'com.ge', 'com.az', 'com.am',
    'com.pl', 'com.gr', 'com.pt', 'com.es', 'com.at', 'co.at', 'or.at', 'ac.at',
    'com.hu', 'co.hu', 'com.cy', 'co.cy', 'com.mt',
    'com.in', 'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'ac.in', 'edu.in', 'gov.in', 'res.in',
    'co.id', 'co.th', 'com.ph', 'com.vn', 'com.bd', 'com.pk', 'com.np', 'com.lk',
    'com.eg', 'com.sa', 'com.qa', 'com.kw', 'com.bh', 'com.om', 'com.jo', 'com.lb', 'com.sy', 'com.ye',
    'com.ng', 'com.gh', 'co.ke', 'co.tz', 'co.ug', 'co.zw', 'com.et',
    'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il',
    'com.do', 'com.pr', 'com.tt', 'com.bb', 'com.bs', 'com.jm', 'com.ky', 'com.ag', 'com.vc',
    'com.dm', 'com.gd', 'com.lc', 'com.gt', 'com.sv', 'com.hn', 'com.ni', 'com.cr', 'com.pa',
    'co.uz', 'com.mm', 'com.kh', 'com.la', 'com.mn',
  ]);

  const genId = (p) => p + '_' + Math.random().toString(16).slice(2, 6);

  function isIPv4(h) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(h); }

  /** 从任意输入（URL / 带路径 / 裸域名）解析 hostname；失败返回 null */
  function parseHost(input) {
    let s = (input || '').trim();
    if (!s) return null;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = 'http://' + s;
    try { return new URL(s).hostname.toLowerCase(); } catch { return null; }
  }

  /** hostname -> eTLD+1 主域名；无法识别返回 null */
  function toRegistrableDomain(hostname) {
    const h = (hostname || '').trim().toLowerCase();
    if (!h) return null;
    if (h.startsWith('[')) return h;    // IPv6（URL.hostname 带方括号）
    if (isIPv4(h)) return h;            // IPv4
    const parts = h.split('.');
    if (parts.length <= 1) return h;    // localhost / 单段主机名
    if (MULTI_SUFFIXES.has(parts.slice(-2).join('.'))) {
      return parts.length <= 2 ? h : parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  }

  /** URL -> 主域名；file:// 等无主机返回 null */
  function urlToDomain(url) {
    if (!url) return null;
    try { return toRegistrableDomain(new URL(url).hostname); } catch { return null; }
  }

  /* ============ 配置读写 ============ */

  /** 归一化 + 旧 schema（黑白名单 v1）迁移：只保留白名单条目，丢弃黑名单条目 */
  function normalizeConfig(raw) {
    const cfg = raw && typeof raw === 'object' ? raw : {};
    const out = { version: DEFAULT_CONFIG.version, domains: [], regexes: [] };
    for (const d of Array.isArray(cfg.domains) ? cfg.domains : []) {
      if (d && d.list && d.list !== 'white') continue; // 旧黑名单条目不再生效
      const host = toRegistrableDomain(parseHost(d && d.host) || (d && d.host));
      if (!host) continue;
      out.domains.push({
        id: (d && d.id) || genId('d'),
        host,
        enabled: !(d && d.enabled === false),
        note: (d && d.note) || '',
        source: (d && d.source) || 'manual',
        createdAt: (d && d.createdAt) || Date.now(),
      });
    }
    for (const r of Array.isArray(cfg.regexes) ? cfg.regexes : []) {
      if (r && r.list && r.list !== 'white') continue;
      const pattern = r && typeof r.pattern === 'string' ? r.pattern : '';
      try { new RegExp(pattern); } catch { continue; } // 丢弃非法正则
      out.regexes.push({
        id: (r && r.id) || genId('r'),
        pattern,
        enabled: !(r && r.enabled === false),
        note: (r && r.note) || '',
        createdAt: (r && r.createdAt) || Date.now(),
      });
    }
    return out;
  }

  function loadConfig() {
    return new Promise((res) => chrome.storage.local.get(STORAGE_KEY,
      (d) => res(normalizeConfig(d && d[STORAGE_KEY]))));
  }

  function saveConfig(cfg) {
    const c = normalizeConfig(cfg);
    return new Promise((res) => chrome.storage.local.set({ [STORAGE_KEY]: c }, () => res(c)));
  }

  /* ============ 匹配引擎 ============ */

  /** 返回 {allowed, hit:{kind,value}|null}；域名或正则任一命中即放行 */
  function matchUrl(url, cfg) {
    const c = cfg || DEFAULT_CONFIG;
    const domain = urlToDomain(url);
    if (domain) {
      const d = c.domains.find((x) => x.enabled && x.host === domain);
      if (d) return { allowed: true, hit: { kind: 'domain', value: d.host } };
    }
    for (const r of c.regexes) {
      if (!r.enabled) continue;
      try { if (new RegExp(r.pattern).test(url)) return { allowed: true, hit: { kind: 'regex', value: r.pattern } }; } catch {}
    }
    return { allowed: false, hit: null };
  }

  const isBlocked = (url, cfg) => !matchUrl(url, cfg).allowed;

  /* ============ 配置变更（纯函数：入参 cfg，返回 {config, error, ...}） ============ */

  function addDomain(cfg, hostOrUrl, source) {
    const host = toRegistrableDomain(parseHost(hostOrUrl) || hostOrUrl);
    if (!host) return { error: '无法解析出有效域名' };
    const c = normalizeConfig(cfg);
    if (c.domains.some((d) => d.host === host)) return { config: c, error: '已在白名单中' };
    c.domains.push({ id: genId('d'), host, enabled: true, note: '',
      source: source || 'manual', createdAt: Date.now() });
    return { config: c };
  }

  function removeDomain(cfg, host) {
    const c = normalizeConfig(cfg);
    c.domains = c.domains.filter((d) => d.host !== host);
    return { config: c };
  }

  function updateDomain(cfg, id, patch) {
    const c = normalizeConfig(cfg);
    const d = c.domains.find((x) => x.id === id);
    if (!d) return { error: '记录不存在' };
    if (patch.enabled !== undefined) d.enabled = !!patch.enabled;
    if (patch.note !== undefined) d.note = String(patch.note || '').slice(0, 200);
    return { config: c };
  }

  function addRegex(cfg, pattern) {
    if (!pattern || typeof pattern !== 'string') return { error: '正则不能为空' };
    try { new RegExp(pattern); } catch (e) { return { error: `非法正则: ${e.message}` }; }
    const c = normalizeConfig(cfg);
    c.regexes.push({ id: genId('r'), pattern, enabled: true, note: '', createdAt: Date.now() });
    return { config: c };
  }

  function updateRegex(cfg, id, patch) {
    const c = normalizeConfig(cfg);
    const r = c.regexes.find((x) => x.id === id);
    if (!r) return { error: '记录不存在' };
    if (patch.pattern !== undefined) {
      try { new RegExp(patch.pattern); } catch (e) { return { error: `非法正则: ${e.message}` }; }
      r.pattern = patch.pattern;
    }
    if (patch.enabled !== undefined) r.enabled = !!patch.enabled;
    if (patch.note !== undefined) r.note = String(patch.note || '').slice(0, 200);
    return { config: c };
  }

  function removeRegex(cfg, id) {
    const c = normalizeConfig(cfg);
    c.regexes = c.regexes.filter((r) => r.id !== id);
    return { config: c };
  }

  /** 导入：JSON（schema 同 storage）或纯文本（每行一个域名或以 / 包裹的正则）；返回 {config, skipped} */
  function importConfig(currentCfg, text) {
    let items = [];
    try {
      const parsed = normalizeConfig(JSON.parse(text));
      items = [...parsed.domains.map((d) => ({ host: d.host })),
               ...parsed.regexes.map((r) => ({ regex: r.pattern }))];
    } catch {
      items = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        .map((l) => (/^\/.*\/[a-z]*$/.test(l) ? { regex: l } : { host: l }));
    }
    let c = normalizeConfig(currentCfg);
    const skipped = [];
    const seen = new Set(); // 文件内去重
    for (const it of items) {
      const key = it.regex ? `r:${it.regex}` : `d:${it.host}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (it.regex) {
        const r = addRegex(c, it.regex);
        if (r.error) { skipped.push(`${it.regex}: ${r.error}`); continue; }
        c = r.config;
      } else {
        const r = addDomain(c, it.host, 'import');
        if (r.error) { skipped.push(`${it.host}: ${r.error}`); continue; }
        c = r.config;
      }
    }
    return { config: c, skipped };
  }

  global.URLFilter = {
    STORAGE_KEY, DEFAULT_CONFIG, genId,
    parseHost, toRegistrableDomain, urlToDomain,
    normalizeConfig, loadConfig, saveConfig,
    matchUrl, isBlocked,
    addDomain, removeDomain, updateDomain,
    addRegex, updateRegex, removeRegex, importConfig,
  };
})(typeof self !== 'undefined' ? self : window);
