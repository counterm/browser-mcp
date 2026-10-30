/* 工具箱 · feats/build —— 「开发产物」分类：能跑起来的脚本 / 指令（Playwright / 油猴 / 爬虫 / 录制步骤）。 */
(function(B){
var el = B.u.el, esc = B.u.esc;
var note = B.w.note, codeBox = B.w.codeBox, scoreBadge = B.w.scoreBadge, btn = B.w.btn, toast = B.w.toast, copyText = B.u.copyText, $$ = B.u.$$;
var bestSelector = B.sel.bestSelector, xpathOf = B.sel.xpathOf, scoreSelector = B.sel.scoreSelector;
var ensurePicked = B.ensurePicked, t = B.t;

/* ---------- flow 录制引擎（模块级：面板关开不影响录制；扩展版跨页由 background 续存，见 docs/spec-flow.md） ---------- */
var REC = { on:false, paused:false, name:'', desc:'', vars:{}, steps:[], url:location.href };
var recBound = false, recListEl = null, recStatusEl = null, recPrevEl = null, recRender = null;
var hasExt = false;
try { hasExt = !!(window.chrome && chrome.runtime && chrome.runtime.id); } catch(e){}

function flowBridge(action, params, timeoutMs){
  return new Promise(function(resolve, reject){
    var id = Math.random().toString(36).slice(2);
    var timer = setTimeout(function(){
      cleanup();
      reject(new Error(t('扩展桥无响应（扩展未就绪或刚更新过，请刷新页面后重试）', 'Extension bridge not responding (extension not ready or just updated — refresh the page and retry)')));
    }, timeoutMs || 15000);
    function onRes(ev){
      var d = ev.detail;
      if(!d || d.id !== id) return;
      cleanup();
      if(d.ok) resolve(d.data);
      else reject(new Error(d.error || t('扩展桥调用失败', 'Extension bridge call failed')));
    }
    function cleanup(){ clearTimeout(timer); window.removeEventListener('batb:bridge:res', onRes); }
    window.addEventListener('batb:bridge:res', onRes);
    window.dispatchEvent(new CustomEvent('batb:bridge', { detail:{ id:id, action:action, params:params || {} } }));
  });
}
function recTarget(e){
  var path = e.composedPath ? e.composedPath() : null, i;
  if(path) for(i = 0; i < path.length; i++) if(path[i] === B.host) return null; // 工具箱自身 DOM 不录
  var x = e.target;
  if(!x || x.nodeType !== 1 || !x.closest || x.closest('#ba-toolbox-host')) return null;
  return x;
}
function recNextId(){
  var mx = 0;
  REC.steps.forEach(function(s){ var m = /^s(\d+)$/.exec(s.id || ''); if(m) mx = Math.max(mx, +m[1]); });
  var n = mx + 1;
  return 's' + (n < 10 ? '0' + n : n);
}
function recAdd(st){
  if(!REC.on) return;
  var full = { id: recNextId() };
  for(var k in st) full[k] = st[k];
  REC.steps.push(full);
  recSync();
  recPaint();
}
function recOnClick(e){
  var x = recTarget(e); if(!x) return;
  var tgt = x.closest('a,button,summary,[onclick],[role="button"],[role="tab"],[role="menuitem"]');
  if(!tgt || /^label$|^option$|^input$|^textarea$|^select$/i.test(tgt.tagName)) return;
  // input/textarea/select 的点击是聚焦噪音，由 change 统一记录；label/option 由其目标元素记录
  recAdd({ do:'click', selector:B.sel.bestSelector(tgt), text:(tgt.innerText || '').trim().slice(0, 40) });
}
function recOnChange(e){
  var x = recTarget(e); if(!x) return;
  var tgt = x.closest('input,textarea,select'); if(!tgt) return;
  var ty = (tgt.type || '').toLowerCase();
  if(ty === 'checkbox'){ recAdd({ do:'click', selector:B.sel.bestSelector(tgt) }); return; }
  if(ty === 'radio' || ty === 'file' || ty === 'hidden') return;
  if(tgt.tagName === 'SELECT'){ recAdd({ do:'select', selector:B.sel.bestSelector(tgt), value:tgt.value }); return; }
  var st = { do:'type', selector:B.sel.bestSelector(tgt), text:tgt.value };
  if(ty === 'password'){ st.text = '${env.PWD}'; st.secret = true; } // 密码不落明文，运行时从环境变量取
  recAdd(st);
}
function recOnKey(e){
  if(e.key !== 'Enter') return;
  var x = recTarget(e); if(!x) return;
  var tgt = x.closest('input,textarea'); if(!tgt || tgt.tagName === 'TEXTAREA') return;
  recAdd({ do:'press', key:'Enter' });
}
function recBind(on){
  if(on === recBound) return;
  var fn = on ? 'addEventListener' : 'removeEventListener';
  document[fn]('click', recOnClick, true);
  document[fn]('change', recOnChange, true);
  document[fn]('keydown', recOnKey, true);
  recBound = on;
}
function recSync(){
  if(hasExt) flowBridge('flowrec', { op:'set', state:REC }, 8000).catch(function(){});
}
function recDefaultName(){
  return 'flow-' + String(location.hostname || 'page').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase().slice(0, 24) +
    '-' + new Date().toTimeString().slice(0, 8).replace(/:/g, '');
}
function recDoc(){
  return { flow:(REC.name || recDefaultName()).toLowerCase(), desc:REC.desc, vars:REC.vars, steps:REC.steps };
}
function stepsYaml(doc){
  var L = ['flow: ' + doc.flow];
  if(doc.desc) L.push('desc: ' + JSON.stringify(doc.desc));
  var vk = Object.keys(doc.vars || {});
  if(vk.length){
    L.push('vars:');
    vk.forEach(function(k){ L.push('  ' + k + ': ' + JSON.stringify(String(doc.vars[k]))); });
  }
  L.push('steps:');
  doc.steps.forEach(function(s){
    L.push('  - id: ' + s.id);
    Object.keys(s).forEach(function(k){
      if(k === 'id') return;
      var v = s[k];
      if(v === undefined || v === null || v === '') return;
      L.push('    ' + k + ': ' + ((v === true || v === false) ? v : JSON.stringify(String(v))));
    });
  });
  return L.join('\n') + '\n';
}
/* ---------- flow 库 / 运行（录制详情与「运行 flow」磁贴共用） ---------- */
function runFlowReq(body, out){
  out.innerHTML = '';
  var prog = note(t('启动中 …', 'Starting …'));
  out.appendChild(prog);
  try{ out.scrollIntoView({ block:'nearest' }); }catch(e){}
  function paintReport(rep){
    out.innerHTML = '';
    out.appendChild(el('div', 'd', '<b>' + (rep.ok ? 'OK' : 'FAIL') + '</b> ' + esc(rep.flow || '') +
      ' · ' + (rep.passed || 0) + '/' + (rep.total || 0) + t(' 步通过', ' steps passed')));
    if(rep.data_rows) out.appendChild(note(t('数据组 ' + rep.passed_rows + '/' + rep.data_rows + ' 通过',
      rep.passed_rows + '/' + rep.data_rows + ' data rows passed')));
    (rep.steps || []).forEach(function(s){
      var r3 = el('div');
      r3.style.cssText = 'font-size:11px;padding:2px 0;border-bottom:1px dashed rgba(127,127,127,.25)';
      r3.innerHTML = '<b style="color:' + (s.ok ? '#0a7d4e' : '#dc2626') + '">' + (s.ok ? 'OK  ' : 'FAIL') + '</b> ' +
        esc(s.id + ' ' + s.do) +
        (s.params ? ' <span style="color:#64748b">' + esc(s.params) + '</span>' : '') +
        ' <span style="color:#64748b">' + s.ms + 'ms</span>' +
        (s.ok ? '' : '<div style="color:#dc2626">' + esc(s.error || '') + '</div>');
      if(s.dataUrl) r3.innerHTML += '<div><img src="' + s.dataUrl + '" style="max-width:100%;border:1px solid rgba(127,127,127,.3);border-radius:4px;margin-top:4px"></div>';
      out.appendChild(r3);
    });
    if(rep.error) out.appendChild(note(t('失败：', 'Failed: ') + rep.error));
  }
  // 异步执行：run 返回 run_id 后轮询 status（wait_ms 长轮询），进度实时刷新，长流不再受单次请求超时限制
  flowBridge('pinfo', {}, 8000).then(function(pi){
    if(!pi || !pi.mark) throw new Error(t('本页没有页桥标记（页面未接入白名单？）', 'No page-bridge mark on this page (not allowlisted?)'));
    prog.textContent = t('启动中（页桥 ' + pi.mark + '）…', 'Starting (mark ' + pi.mark + ') …');
    function poll(rid){
      flowBridge('flow', { op:'status', run_id:rid, wait_ms:20000 }, 45000).then(function(st){
        if(st && st.error) throw new Error(st.error);
        if(!st || st.status !== 'done'){
          prog.textContent = t('运行中：', 'Running: ') +
            ((st && st.done) || 0) + '/' + ((st && st.steps_total) || '?') + t(' 步', ' steps');
          poll(rid);
          return;
        }
        paintReport(st.report || { ok:false, total:0, passed:0, error:'no report' });
      }).catch(function(e3){
        out.innerHTML = '';
        out.appendChild(note(t('运行失败：', 'Run failed: ') + String(e3.message || e3)));
      });
    }
    var req = { op:'run', mark:pi.mark, stop_on_fail: body.stop_on_fail !== false };
    if(body.name) req.name = body.name;
    if(body.yaml) req.yaml = body.yaml;
    flowBridge('flow', req, 60000).then(function(r){
      if(!r || !r.run_id) throw new Error(t('broker 未返回 run_id（版本过旧？请重启 broker）', 'No run_id from broker (old version? restart the broker)'));
      poll(r.run_id);
    }).catch(function(e3){
      out.innerHTML = '';
      out.appendChild(note(t('运行失败：', 'Run failed: ') + String(e3.message || e3)));
    });
  }).catch(function(e3){
    out.innerHTML = '';
    out.appendChild(note(t('运行失败：', 'Run failed: ') + String(e3.message || e3)));
  });
}
function runFlow(name, out){ runFlowReq({ name:name }, out); }
function paintFlowLib(lib, out, refresh){
  lib.innerHTML = '';
  lib.appendChild(note(t('读取中…', 'Loading…')));
  flowBridge('flow', { op:'list' }, 15000).then(function(items){
    lib.innerHTML = '';
    if(!items || !items.length){ lib.appendChild(note(t('库为空。先在「操作录制 → flow」里保存入库、导入，或直接粘贴运行。', 'Library is empty. Save a recording, import YAML, or paste-and-run in "Record → Flow".'))); return; }
    items.forEach(function(f){
      var row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;padding:2px 0';
      row.innerHTML = '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(f.name) +
        ' <span style="color:#64748b">' + (f.steps == null ? '?' : f.steps) + t(' 步', ' steps') +
        (f.broken ? ' · ' + t('解析失败', 'broken') : '') + '</span></span>';
      row.appendChild(btn(t('运行', 'Run'), function(){ runFlow(f.name, out); }));
      row.appendChild(btn('YAML', function(){
        flowBridge('flow', { op:'get', name:f.name }, 15000).then(function(r){
          out.innerHTML = '';
          out.appendChild(codeBox(r.yaml, 220));
          try{ out.scrollIntoView({ block:'nearest' }); }catch(e){}
        }).catch(function(e3){ toast(String(e3.message || e3)); });
      }));
      row.appendChild(btn('×', function(){
        flowBridge('flow', { op:'delete', name:f.name }, 15000).then(function(){
          toast(t('已删除 ', 'Deleted ') + f.name); refresh();
        }).catch(function(e3){ toast(String(e3.message || e3)); });
      }));
      lib.appendChild(row);
    });
  }).catch(function(e3){
    lib.innerHTML = '';
    lib.appendChild(note(t('库读取失败（扩展更新后需刷新页面）：', 'Library read failed (refresh the page after an extension update): ') + String(e3.message || e3)));
  });
}
function recPaint(){
  if(recStatusEl && recStatusEl.isConnected){
    recStatusEl.innerHTML = REC.on
      ? '<span style="color:#dc2626">●</span> ' + (REC.paused ? t('已暂停 · ', 'Paused · ') : t('录制中 · ', 'Recording · ')) + REC.steps.length + t(' 步（跨页面自动续录）', ' steps (auto-resumes across pages)')
      : t('未在录制', 'Not recording') + (REC.steps.length ? ' · ' + REC.steps.length + t(' 步待导出', ' steps pending export') : '');
  }
  if(recListEl && recListEl.isConnected){
    recListEl.innerHTML = '';
    if(!REC.steps.length){
      recListEl.appendChild(note(t('还没有步骤。点「开始录制」后正常操作页面即可。', 'No steps yet. Click "Start recording" and just use the page normally.')));
    } else {
      REC.steps.forEach(function(s){
        var val = s.text !== undefined ? s.text : (s.value !== undefined ? s.value : '');
        var disp = s.do + '  ' + (s.selector || s.url || s.key || '') +
          (val !== '' && val != null ? '  = ' + String(val).slice(0, 24) : '') + (s.secret ? '  (*** )' : '');
        var row = el('div', null, '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          esc(s.id + '  ' + disp) + '</span>');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;padding:2px 0';
        var isVar = !s.secret && /^\$\{/.test(String(s.text !== undefined ? s.text : (s.value !== undefined ? s.value : '')));
        if(!s.secret && !isVar && (s.text !== undefined || s.value !== undefined)){
          row.appendChild(btn(t('⇄变量', '⇄Var'), function(){
            var k2 = s.text !== undefined ? 'text' : 'value';
            var vn = 'v' + (Object.keys(REC.vars).length + 1);
            REC.vars[vn] = s[k2];
            s[k2] = '${vars.' + vn + '}';
            recSync(); recPaint();
          }));
        }
        row.appendChild(btn('×', function(){
          var i2 = REC.steps.indexOf(s);
          if(i2 > -1) REC.steps.splice(i2, 1);
          recSync(); recPaint();
        }));
        recListEl.appendChild(row);
      });
    }
  }
  if(recPrevEl && recPrevEl.isConnected){
    var pre = recPrevEl.querySelector('pre');
    if(pre) pre.textContent = stepsYaml(recDoc());
  }
}
function recStart(){
  REC.on = true; REC.paused = false; REC.url = location.href;
  if(!REC.steps.length) REC.steps.push({ id: recNextId(), do:'nav', url:location.href }); // 起始页固定为第一步
  recBind(true); recSync(); recPaint();
  /* 录制期间收起三层弹窗，FAB 换成「暂停 / 停止」HUD */
  if(B.ui && B.ui.beginRecord) B.ui.beginRecord({ paused:false, onPause:recTogglePause, onStop:recStop });
}
function recTogglePause(){
  if(!REC.on) return;
  REC.paused = !REC.paused;
  /* 暂停期间换页：恢复时补一条 nav，保证 flow 仍然连贯 */
  if(!REC.paused && REC.url !== location.href) REC.steps.push({ id: recNextId(), do:'nav', url:location.href });
  REC.url = location.href;
  recBind(!REC.paused); recSync(); recPaint();
  if(B.ui && B.ui.setRecordPaused) B.ui.setRecordPaused(REC.paused);
}
/* 停止：结果自动进剪贴板，再恢复之前的三层弹窗（详情内容同步重绘） */
function recStop(){
  if(!REC.on) return;
  REC.on = false; REC.paused = false;
  recBind(false); recSync(); recPaint();
  var yaml = stepsYaml(recDoc());
  function done(copied){
    if(recRender && recStatusEl && recStatusEl.isConnected) recRender();
    if(B.ui && B.ui.endRecord) B.ui.endRecord();
    toast(copied
      ? t('录制已停止，YAML 已复制到剪贴板', 'Recording stopped — YAML copied to the clipboard')
      : t('录制已停止；自动复制失败，请在面板中点「复制 YAML」', 'Recording stopped; auto-copy failed — use "Copy YAML" in the panel'));
  }
  try{ copyText(yaml).then(function(){ done(true); }, function(){ done(false); }); }
  catch(e){ done(false); }
}
function recReset(){
  REC.on = false; REC.paused = false; recBind(false);
  if(B.ui && B.ui.endRecord) B.ui.endRecord();
  REC.name = ''; REC.desc = ''; REC.vars = {}; REC.steps = []; REC.url = location.href;
  if(hasExt) flowBridge('flowrec', { op:'clear' }, 8000).catch(function(){});
  recPaint();
}
/* 跨页续录：工具箱每次注入问一次 background；换页且未暂停时由 background 自动补一条 nav 步骤 */
if(hasExt) flowBridge('flowrec', { op:'get', url:location.href }, 8000).then(function(st){
  if(st && st.on){
    REC.on = true; REC.paused = !!st.paused; REC.name = st.name || ''; REC.desc = st.desc || '';
    REC.vars = st.vars || {}; REC.steps = st.steps || []; REC.url = st.url || location.href;
    recBind(!REC.paused);
    if(B.ui && B.ui.beginRecord) B.ui.beginRecord({ paused:REC.paused, onPause:recTogglePause, onStop:recStop });
    setTimeout(function(){ B.w.toast(t('流程录制已恢复（' + REC.steps.length + ' 步）', 'Flow recording resumed (' + REC.steps.length + ' steps)')); }, 600);
  }
}).catch(function(){});

B.register([
{ id:'pwcode', cat:'build', name:'生成 Playwright 代码', icon:'filecode', star:3, desc:'直接产出可运行定位 / 操作片段',
  en:{ name:'Playwright Code Generator', desc:'Instantly produce runnable locator / action snippets' },
  run:function(b){
    ensurePicked().then(function(e){
      if(!e) return;
      var sel = bestSelector(e), xp = xpathOf(e);
      var code =
'// Playwright\n' +
"const btn = page.locator('" + sel + "');\nawait btn.click();\n\n" +
t('// 或按角色定位（更稳）\n', '// Or locate by role (more robust)\n') +
"await page.getByRole('button', { name: '" + (e.textContent || '').trim().slice(0, 20) + "' }).click();\n\n" +
'// Puppeteer\n' +
"const el = await page.waitForSelector('" + sel + "');\nawait el.click();\n\n" +
t('// XPath 兜底\n', '// XPath fallback\n') +
"page.locator('xpath=" + xp + "')";
      b.appendChild(codeBox(code));
      b.appendChild(el('div', null, t('稳定性：', 'Stability: ') + scoreBadge(scoreSelector(sel))));
    });
  }},
{ id:'userscript', cat:'build', name:'生成油猴脚本骨架', icon:'filecode', star:3, desc:'@match 填当前域名 + 稳定 selector',
  en:{ name:'Tampermonkey Script Skeleton', desc:'@match for the current domain + a stable selector' },
  run:function(b){
    ensurePicked().then(function(e){
      if(!e) return;
      var host2 = location.hostname || 'example.com';
      var code =
'// ==UserScript==\n' +
t('// @name         工具箱助手 · ' + host2, '// @name         Toolbox Helper · ' + host2) + '\n' +
'// @match        https://' + host2 + '/*\n' +
'// @grant        none\n' +
'// ==/UserScript==\n' +
"(function () {\n  'use strict';\n  const SEL = '" + bestSelector(e) + "';\n" +
t('  // 1. 等元素出现\n', '  // 1. Wait for the element to appear\n') +
"  const el = document.querySelector(SEL);\n  if (!el) return;\n" +
t('  // 2. 你的逻辑\n', '  // 2. Your logic here\n') + '})();';
      b.appendChild(codeBox(code));
    });
  }},
{ id:'crawler', cat:'build', name:'爬虫代码生成', icon:'code', star:2, desc:'表格 / 列表 → Python 提取脚本（自动识别 SPA）',
  en:{ name:'Scraper Code Generator', desc:'Table / list → Python extraction script (auto-detects SPAs)' },
  run:function(b){
    var tb = document.getElementById('orders');
    var sel = tb ? bestSelector(tb) : 'table';
    var url = location.origin + location.pathname;
    var code =
'import requests\nfrom bs4 import BeautifulSoup\n\n' +
'URL = "' + url + '"\n' +
'html = requests.get(URL, timeout=10, headers={"User-Agent": "..."}).text\n' +
'soup = BeautifulSoup(html, "html.parser")\n\n' +
'rows = []\n' +
"for tr in soup.select('" + sel + " tbody tr'):\n" +
"    cells = [td.get_text(strip=True) for td in tr.find_all('td')]\n" +
'    if cells:\n        rows.append(cells)\n\n' +
t('print(rows)  # 或 csv.writer 落盘', 'print(rows)  # or write to disk with csv.writer');
    b.appendChild(codeBox(code));

    var stack = (B.detectStack && B.detectStack()) || {};
    var fw = Object.keys(stack).filter(function(k){ return stack[k] && /React|Vue|Angular|Svelte|Next|Nuxt/.test(k); });
    if(fw.length){
      var pw =
'from playwright.sync_api import sync_playwright\n\n' +
'URL = "' + url + '"\n' +
'rows = []\n' +
'with sync_playwright() as p:\n' +
'    b = p.chromium.launch(headless=True)\n' +
'    pg = b.new_page()\n' +
'    pg.goto(URL, wait_until="networkidle")\n' +
"    for tr in pg.query_selector_all('" + sel + " tbody tr'):\n" +
'        cells = [c.inner_text() for c in tr.query_selector_all("td")]\n' +
'        if cells: rows.append(cells)\n' +
'    b.close()\n' +
'print(rows)';
      b.appendChild(el('div', 'grp-h', t('客户端渲染（' + fw.join('/') + '）· 推荐 Playwright', 'Client-side rendered (' + fw.join('/') + ') · Playwright recommended')));
      b.appendChild(codeBox(pw));
      b.appendChild(note(t('检测到 ' + fw.join('/') + '：页面为客户端渲染，requests 拉到的 HTML 是空壳、抓不到表格数据。上面这份 Playwright 脚本会真正执行 JS 后再读 DOM，才能取到渲染后的内容。',
        'Detected ' + fw.join('/') + ': the page is client-side rendered, so requests only fetches an empty shell and cannot read the table data. The Playwright script above actually executes JS before reading the DOM, so it can capture the rendered content.')));
    } else {
      b.appendChild(note(t('选择器由页面表格自动推导；接入真实站点后可按「元素拾取器」的结果替换。',
        'The selector is derived automatically from the page table; on a real site, replace it with the Element Picker result.')));
    }
  }},
{ id:'record', cat:'build', name:'操作录制 → flow', icon:'clock', star:3, desc:'录制页面操作生成 YAML 测试流；导入 / 库管理 / 一键运行', adv:true,
  en:{ name:'Record → Flow', desc:'Record page actions into YAML test flows; import / library / one-click run' },
  run:function(b){
    function render(){
      b.innerHTML = '';
      if(!hasExt) b.appendChild(note(t('当前为原型环境（无扩展桥）：录制与复制 / 下载可用；保存入库、库管理与运行需扩展版。', 'Prototype environment (no extension bridge): recording and copy/download work; library save / management / run need the extension build.')));

      /* ---- 录制控制 ---- */
      var ctl = el('div');
      ctl.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px';
      var nameIn = el('input');
      nameIn.value = REC.name; nameIn.placeholder = t('flow 名（留空自动生成）', 'flow name (auto if empty)');
      nameIn.style.cssText = 'flex:1 1 130px;min-width:120px;padding:3px 6px;font-size:11px';
      nameIn.onchange = function(){ REC.name = nameIn.value.trim(); recSync(); recPaint(); };
      var descIn = el('input');
      descIn.value = REC.desc; descIn.placeholder = t('描述（可选）', 'description (optional)');
      descIn.style.cssText = 'flex:1 1 130px;min-width:120px;padding:3px 6px;font-size:11px';
      descIn.onchange = function(){ REC.desc = descIn.value.trim(); recSync(); recPaint(); };
      ctl.appendChild(nameIn); ctl.appendChild(descIn);
      b.appendChild(ctl);

      var status = el('div', 'd');
      recStatusEl = status; recPaint();
      b.appendChild(status);

      var acts = el('div');
      acts.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px';
      acts.appendChild(btn(REC.on ? t('停止录制', 'Stop recording') : t('开始录制', 'Start recording'), function(){
        if(REC.on) recStop(); else recStart();
        render();
      }));
      if(REC.steps.length){
        acts.appendChild(btn(t('复制 YAML', 'Copy YAML'), function(){
          copyText(stepsYaml(recDoc())).then(function(){ toast(t('已复制到剪贴板', 'Copied to clipboard')); });
        }));
        acts.appendChild(btn(t('下载 .yaml', 'Download .yaml'), function(){
          var doc = recDoc();
          var blob = new Blob([stepsYaml(doc)], { type:'text/yaml' });
          var u = URL.createObjectURL(blob);
          var a2 = document.createElement('a');
          a2.href = u; a2.download = doc.flow + '.yaml'; a2.click();
          setTimeout(function(){ URL.revokeObjectURL(u); }, 3000);
        }));
        if(hasExt) acts.appendChild(btn(t('保存入库', 'Save to library'), function(){
          var doc = recDoc();
          flowBridge('flow', { op:'save', name:doc.flow, yaml:stepsYaml(doc) }, 30000).then(function(r){
            toast(t('已保存：', 'Saved: ') + ((r && r.name) || ''));
            render();
          }).catch(function(e3){ toast(t('保存失败：', 'Save failed: ') + e3.message); });
        }));
        acts.appendChild(btn(t('清空', 'Clear'), function(){ recReset(); render(); }));
      }
      b.appendChild(acts);

      /* ---- 步骤列表 ---- */
      b.appendChild(el('div', 'grp-h', t('步骤', 'Steps')));
      var list = el('div');
      recListEl = list; recPaint();
      b.appendChild(list);
      b.appendChild(note(t('输入在失焦(change)时记录；下拉记 value；勾选框记点击；密码记为 ${env.PWD}（运行时注入）；点击链接跳转后自动补 nav 步骤并续录；「⇄变量」把录制值转为运行时变量。', 'Inputs are captured on change (blur); selects record value; checkboxes as clicks; passwords become ${env.PWD} (injected at runtime); link navigation appends a nav step and resumes; "⇄Var" turns a recorded value into a runtime variable.')));

      /* ---- YAML 预览 ---- */
      if(REC.steps.length){
        b.appendChild(el('div', 'grp-h', t('YAML 预览', 'YAML preview')));
        recPrevEl = codeBox(stepsYaml(recDoc()), 170);
        b.appendChild(recPrevEl);
      }

      /* ---- 导入 ---- */
      b.appendChild(el('div', 'grp-h', t('导入', 'Import')));
      var ta = el('textarea');
      ta.placeholder = t('粘贴 flow YAML（导出的或手写的）后点「导入保存」；保存前扩展会做 schema 校验。', 'Paste flow YAML (exported or hand-written) then "Import & save"; the extension validates the schema before saving.');
      ta.style.cssText = 'width:100%;min-height:64px;padding:5px;font-size:11px;font-family:monospace;margin-bottom:6px';
      b.appendChild(ta);
      var runOut = el('div');
      if(hasExt) b.appendChild(btn(t('导入保存', 'Import & save'), function(){
        var y3 = ta.value.trim();
        if(!y3){ toast(t('先粘贴 YAML', 'Paste YAML first')); return; }
        flowBridge('flow', { op:'save', yaml:y3 }, 30000).then(function(r){
          toast(t('已保存：', 'Saved: ') + ((r && r.name) || ''));
          render();
        }).catch(function(e3){ toast(t('保存失败：', 'Save failed: ') + e3.message); });
      }));
      if(hasExt) b.appendChild(btn(t('直接运行（不保存）', 'Run without saving'), function(){
        var y4 = ta.value.trim();
        if(!y4){ toast(t('先粘贴 YAML', 'Paste YAML first')); return; }
        runFlowReq({ yaml:y4 }, runOut);
      }));
      else b.appendChild(note(t('导入需要扩展版。', 'Import needs the extension build.')));
      if(hasExt) b.appendChild(runOut);

      /* ---- flow 库 ---- */
      if(hasExt){
        b.appendChild(el('div', 'grp-h', t('flow 库（浏览器本地）', 'Flow library (browser-local)')));
        var lib = el('div');
        b.appendChild(lib);
        var out = el('div');
        b.appendChild(out);
        paintFlowLib(lib, out, render);
      }
    }
    recRender = render;
    render();
  }},
{ id:'runflow', cat:'build', name:'运行 flow', icon:'play', star:2, desc:'在当前离线页面执行 flow，实时进度与逐步报告',
  en:{ name:'Run Flow', desc:'Run a flow on the current page with live progress and per-step reports' },
  run:function(b){
    function render(){
      b.innerHTML = '';
      if(!hasExt){
        b.appendChild(note(t('原型环境（无扩展桥）：请用 CLI 执行 —— python cli_client.py flow <本地.yaml> --page <标记>；扩展版可直接在此运行。',
          'Prototype environment (no extension bridge): run via CLI — python cli_client.py flow <local.yaml> --page <mark>; the extension build can run here directly.')));
        return;
      }
      b.appendChild(note(t('使用当前页的页桥标记执行；页面需已接入白名单。', 'Runs with the current page mark; the page must be allowlisted.')));
      var out = el('div');
      b.appendChild(out);
      b.appendChild(el('div', 'grp-h', t('flow 库（浏览器本地）', 'Flow library (browser-local)')));
      var lib = el('div');
      b.appendChild(lib);
      paintFlowLib(lib, out, render);
    }
    render();
  }},
{ id:'formkit', cat:'build', name:'表单保存与填充', icon:'save', star:3, desc:'按站点保存/回填表单值；随机假数据一键填充',
  en:{ name:'Save & Fill Forms', desc:'Save / restore form values per site; one-click random mock data' },
  run:function(b){
    /* ---------- 存储：localStorage['ba:formkit'] = { [host]: {ts, fields:[{s,l,t,v}]} } ---------- */
    var HOST = location.hostname || ('file:' + (location.pathname || '/'));
    function load(){ try{ return JSON.parse(localStorage.getItem('ba:formkit') || '{}'); }catch(e){ return {}; } }
    function store(all){ try{ localStorage.setItem('ba:formkit', JSON.stringify(all)); }catch(e){} }
    function kind(e){
      if(e.tagName === 'SELECT') return 'select';
      if(e.tagName === 'TEXTAREA') return 'textarea';
      return (e.type || 'text').toLowerCase();
    }
    function fields(){
      return $$('input,select,textarea').filter(function(e){
        if(/^(hidden|submit|button|reset|image|file|checkbox|radio)$/.test((e.type || '').toLowerCase())) return false;
        if(e.disabled || e.readOnly) return false;
        return e.getClientRects().length > 0;
      });
    }
    function label(e){
      var lg = e.labels && e.labels[0];
      return (lg && lg.textContent.trim()) || e.placeholder || e.getAttribute('aria-label') || e.name || e.id ||
        (e.tagName === 'SELECT' ? t('下拉框', 'Dropdown') : kind(e));
    }
    /* 原生 setter + input/change，兼容 React/Vue 受控组件 */
    function setVal(e, v){
      var proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
        : e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      var d = Object.getOwnPropertyDescriptor(proto, 'value');
      try{ if(d && d.set) d.set.call(e, v); else e.value = v; }catch(x){ e.value = v; }
      try{
        e.dispatchEvent(new Event('input', { bubbles:true }));
        e.dispatchEvent(new Event('change', { bubbles:true }));
      }catch(x){}
    }

    /* ---------- 随机假数据 ---------- */
    function pick(a){ return a[Math.floor(Math.random() * a.length)]; }
    function str(n){ var s = '', p = 'abcdefghjkmnpqrstuvwxyz'; for(var i = 0; i < n; i++) s += p[Math.floor(Math.random() * p.length)]; return s; }
    function dig(n){ var s = ''; for(var i = 0; i < n; i++) s += Math.floor(Math.random() * 10); return s; }
    var PROV = ['北京市','上海市','广东省','浙江省','江苏省','四川省','湖北省','山东省','福建省','湖南省'];
    var CITY = ['杭州市','宁波市','苏州市','南京市','成都市','武汉市','青岛市','厦门市','广州市','长沙市'];
    var DIST = ['西湖区','滨江区','南山区','高新区','鼓楼区','江汉区','越秀区','天河区','静安区','浦东新区'];
    function cname(){ return pick('赵钱孙李周吴郑王冯陈蒋沈韩杨朱秦许何吕张孔曹严华金魏陶姜'.split('')) +
      pick(['伟','芳','娜','敏','静','磊','军','洋','勇','艳','杰','涛','明','超','霞','平','雪','彤','轩','然','涵','萱','俊','欣','怡','远','东','华']); }
    function region(k){ return k === 'p' ? pick(PROV) : k === 'c' ? pick(CITY) : k === 'd' ? pick(DIST) : pick(PROV) + pick(CITY) + pick(DIST); }
    /* 按 name / id / placeholder / label / autocomplete 猜字段语义 */
    function guess(e){
      var t = (e.type || '').toLowerCase(), ml = e.maxLength > 0 ? e.maxLength : 100;
      var key = ((e.name || '') + ' ' + (e.id || '') + ' ' + (e.placeholder || '') + ' ' + label(e) + ' ' +
        (e.getAttribute('autocomplete') || '')).toLowerCase();
      function cut(s){ return s.length > ml ? s.slice(0, ml) : s; }
      if(t === 'email' || /e-?mail|邮箱/.test(key)) return cut(str(6) + dig(3) + '@example.com');
      if(t === 'tel' || /phone|mobile|tel|手机|电话|号码|联系/.test(key)) return cut(pick(['13','15','17','18','19']) + dig(9));
      if(/邮编|zip|postal/.test(key)) return cut(dig(6));
      if(/验证码|captcha|短信/.test(key)) return cut(dig(6));
      if(/身份证|sfz|idcard/.test(key)) return cut(dig(17) + pick(['0','1','2','3','4','5','6','7','8','9','X']));
      if(t === 'password') return cut(str(6) + dig(3) + 'A1');
      if(/user|账号|帐号|昵称|nick/.test(key)) return cut(str(8));
      if(/姓名|名字|称呼|name/.test(key)) return cut(cname());
      if(/地址|address|addr|省.*市|所在地|地区/.test(key)) return cut(region());
      if(/省|province/.test(key)) return cut(region('p'));
      if(/市|city/.test(key)) return cut(region('c'));
      if(/区|region|区域/.test(key)) return cut(region('d'));
      if(t === 'url' || /url|网址|网站|site|主页|博客|blog|链接|link/.test(key)) return cut('https://' + str(7) + '.com');
      if(/(^|\W)qq(\W|$)/.test(key)) return cut(dig(9));
      if(/微信|wechat|wx|vx/.test(key)) return cut(str(5) + dig(4));
      if(t === 'date' || /日期|birthday|出生/.test(key)) return cut('19' + dig(2) + '-' + ('0' + (1 + Math.floor(Math.random() * 12))).slice(-2) + '-' + ('0' + (1 + Math.floor(Math.random() * 28))).slice(-2));
      if(t === 'number' || /年龄|age|数量|qty|quantity/.test(key)) return cut(dig(2));
      return cut(str(8)); /* 其余随便填字母 */
    }
    function randOption(e){
      var opts = $$('option', e).filter(function(o){
        var s = (o.value || '').trim() + ' ' + o.textContent.trim();
        return s.trim() && !/请选择|全部|不限|select/i.test(s);
      });
      if(!opts.length) return false;
      var o = pick(opts);
      setVal(e, o.value || o.textContent.trim());
      return true;
    }

    /* ---------- 渲染 ---------- */
    var out = el('div');
    var status = el('div', 'note');
    function showRows(title, rows){
      out.innerHTML = '';
      out.appendChild(el('div', 'grp-h', esc(title)));
      var d = el('div', 'lst');
      rows.forEach(function(r){
        d.appendChild(el('div', 'li',
          '<span class="m">' + esc(r[0]) + '</span>' +
          '<span class="u" title="' + esc(r[1]) + '">' + esc(r[1]) + '</span>' +
          '<span class="c" style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(r[2]) + '">' + esc(r[2]) + '</span>'));
      });
      out.appendChild(d);
    }
    function refresh(){
      var rec = load()[HOST];
      var n = rec && rec.fields ? rec.fields.length : 0;
      status.innerHTML = n
        ? t('当前站点已保存 <b style="color:#cbd5e1">' + n + '</b> 个字段 · ' + new Date(rec.ts).toLocaleTimeString(),
            '<b style="color:#cbd5e1">' + n + '</b> fields saved for this site · ' + new Date(rec.ts).toLocaleTimeString())
        : t('当前站点还没有保存的表单：先在页面上手填一遍 → 「保存表单」，下次即可一键回填。',
            'No saved form for this site yet: fill the page once → "Save Form", then restore it in one click next time.');
    }
    function undoable(prev){
      B.ui.pushUndo({ restore:function(){ prev.forEach(function(p){ try{ setVal(p[0], p[1]); }catch(x){} }); } });
    }
    /* 「填充已保存」与「粘贴」共用同一套匹配逻辑：先按选择器，结构变了按顺序兜底 */
    function applyFields(list, prefix, prefixEn){
      var cur = fields(), prev = [], rows = [], miss = 0;
      list.forEach(function(f, i){
        var e = null;
        if(f.s){ try{ var m = document.querySelector(f.s); if(m && kind(m) === f.t && cur.indexOf(m) > -1) e = m; }catch(x){} }
        if(!e && cur[i] && kind(cur[i]) === f.t) e = cur[i]; /* 结构变化时按顺序兜底 */
        if(!e){ miss++; return; }
        if(e.tagName === 'SELECT'){
          var hit = $$('option', e).filter(function(o){ return o.value === f.v || o.textContent.trim() === f.v; })[0];
          if(!hit){ miss++; return; }
        }
        prev.push([e, e.value]);
        setVal(e, e.tagName === 'SELECT' ? hit.value : f.v);
        rows.push([kind(e), label(e), e.value]);
      });
      if(!rows.length){ toast(t('没找到匹配的表单字段（页面结构可能变了）', 'No matching form fields found (the page structure may have changed)')); return 0; }
      undoable(prev);
      showRows(t(prefix + rows.length + ' 个字段' + (miss ? ' · ' + miss + ' 个未匹配' : ''),
        prefixEn + rows.length + ' fields' + (miss ? ' · ' + miss + ' unmatched' : '')), rows);
      return rows.length;
    }
    /* 导入：剪贴板 JSON 兼容三种形态（本站导出、全部站点备份、纯字段数组） */
    function unpack(text){
      var o = null;
      try{ o = JSON.parse(String(text || '').trim()); }catch(x){ return null; }
      if(Array.isArray(o)) return o;
      if(o && Array.isArray(o.fields)) return o.fields;
      if(o && o[HOST] && Array.isArray(o[HOST].fields)) return o[HOST].fields;
      if(o){ var k = Object.keys(o)[0]; if(k && o[k] && Array.isArray(o[k].fields)) return o[k].fields; }
      return null;
    }
    function readClip(){
      if(navigator.clipboard && navigator.clipboard.readText)
        return navigator.clipboard.readText().catch(manualPaste);
      return manualPaste();
    }
    function manualPaste(){
      var v = window.prompt(t('无法读取剪贴板，请把表单 JSON 粘贴到这里：', 'Unable to read the clipboard — paste the form JSON here:'), '');
      return Promise.resolve(v || '');
    }

    var row = el('div', 'row2');
    row.appendChild(btn(t('保存表单', 'Save Form'), function(){
      var rows = [], pwd = 0;
      fields().forEach(function(e){
        if(e.tagName === 'INPUT' && e.type === 'password'){ if(e.value) pwd++; return; } /* 密码不入库 */
        var v = e.tagName === 'SELECT' ? (e.value || (e.selectedOptions && e.selectedOptions[0] ? e.selectedOptions[0].textContent.trim() : '')) : e.value;
        if(!v) return;
        var s = ''; try{ s = bestSelector(e); }catch(x){}
        rows.push({ s:s, l:label(e), t:kind(e), v:v });
      });
      if(!rows.length){ toast(t('没有已填写的字段可保存', 'No filled fields to save')); return; }
      var all = load();
      all[HOST] = { ts: Date.now(), fields: rows };
      store(all);
      showRows(t('已保存 ' + rows.length + ' 个字段', 'Saved ' + rows.length + ' fields'), rows.map(function(r){ return [r.t, r.l, r.v]; }));
      refresh();
      toast(t('已保存 ' + rows.length + ' 个字段' + (pwd ? '（密码字段出于安全已跳过）' : ''),
        'Saved ' + rows.length + ' fields' + (pwd ? ' (password fields skipped for security)' : '')));
    }));
    row.appendChild(btn(t('填充已保存', 'Fill Saved'), function(){
      var rec = load()[HOST];
      if(!rec || !rec.fields || !rec.fields.length){ toast(t('当前站点还没有保存的表单，先「保存表单」', 'No saved form for this site yet — use "Save Form" first')); return; }
      var n = applyFields(rec.fields, '已回填 ', 'Filled ');
      if(n) toast(t('已回填 ' + n + ' 个字段', 'Filled ' + n + ' fields'));
    }));
    row.appendChild(btn(t('复制', 'Copy'), function(){
      var rec = load()[HOST];
      if(!rec || !rec.fields || !rec.fields.length){ toast(t('当前站点还没有保存的表单，先「保存表单」', 'No saved form for this site yet — use "Save Form" first')); return; }
      var text = JSON.stringify({ _v:1, host:HOST, ts:rec.ts, fields:rec.fields });
      copyText(text).then(function(){ toast(t('已导出 ' + rec.fields.length + ' 个字段，可到其它页面「粘贴」', 'Exported ' + rec.fields.length + ' fields — paste them on another page')); },
        function(){ window.prompt(t('复制失败，请手动复制以下内容：', 'Copy failed — please copy the following manually:'), text); });
    }));
    row.appendChild(btn(t('粘贴', 'Paste'), function(){
      readClip().then(function(text){
        var list = unpack(text);
        if(!list || !list.length){ toast(t('剪贴板里没有可用的表单 JSON', 'No usable form JSON in the clipboard')); return; }
        var n = applyFields(list, '已粘贴填充 ', 'Pasted and filled ');
        if(n) toast(t('已粘贴填充 ' + n + ' 个字段，误填可撤销', 'Pasted and filled ' + n + ' fields — undo available'));
      });
    }));
    row.appendChild(btn(t('随机填充', 'Random Fill'), function(){
      var fs = fields(), prev = [], rows = [];
      fs.forEach(function(e){
        var old = e.value, ok;
        if(e.tagName === 'SELECT') ok = randOption(e);
        else { var v = guess(e); ok = !!v; if(ok) setVal(e, v); }
        if(!ok) return;
        prev.push([e, old]);
        rows.push([kind(e), label(e), e.value]);
      });
      if(!rows.length){ toast(t('没有可填充的表单字段', 'No fillable form fields')); return; }
      undoable(prev);
      showRows(t('随机填充 ' + rows.length + ' 个字段', 'Random-filled ' + rows.length + ' fields'), rows);
      toast(t('已随机填充 ' + rows.length + ' 个字段，误填可撤销', 'Random-filled ' + rows.length + ' fields — undo available'));
    }, 'pri'));
    row.appendChild(btn(t('清除', 'Clear'), function(){
      var all = load(); delete all[HOST]; store(all);
      refresh(); toast(t('已清除当前站点保存的表单', 'Cleared the saved form for this site'));
    }, 'warn'));
    b.appendChild(row);
    b.appendChild(status);
    b.appendChild(out);
    refresh();
    b.appendChild(note(t('随机填充按 name / placeholder / label / autocomplete 猜语义：邮箱 / 手机号 / 邮编 / 验证码 / 身份证给格式化假数据，姓名给中文随机名，省市地址给地区名，下拉框随机选非占位项，其余填随机字母；尊重 maxlength。保存按站点存于 localStorage["ba:formkit"]，密码字段跳过。填充走原生 setter + input/change 事件（兼容 React / Vue），误填可从撤销条恢复。「复制」把本站已保存表单导出为 JSON 到剪贴板，「粘贴」把剪贴板里的 JSON 直接填进当前页面（与「填充已保存」同一套匹配逻辑，跨站点按顺序兜底）。',
      'Random fill guesses field semantics from name / placeholder / label / autocomplete: email / phone / postal code / captcha / ID get formatted fake data, names get a random Chinese name, province/city addresses get a region name, selects pick a random non-placeholder option, and everything else gets random letters; maxlength is respected. Saved per site in localStorage["ba:formkit"]; password fields are skipped. Filling uses the native setter with input/change events (React / Vue compatible), and mis-fills can be reverted from the undo bar. "Copy" exports the saved form for this site as JSON to the clipboard; "Paste" fills clipboard JSON into the current page (same matching logic as "Fill Saved", with order-based fallback across sites).')));
  }}
]);
})(window.BATB);
