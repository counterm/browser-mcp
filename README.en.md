# Browser Agent

[简体中文](./README.md) ｜ **English**

A lightweight system that exposes browser pages to any CLI / IDE / Agent over a local channel.
Pages are turned into text (no screenshot-dependent multimodality); the LLM locates elements by their numeric IDs, which suits browser automation orchestration.

Current version: **v0.1.16** (kept in sync between `chrome-extension/manifest.json` and `page-bridge.user.js`)

```
            Browser (N tabs)                   Local machine                   Any external tool
┌──────────────────────────┐         ┌────────────────────────┐        ┌─────────────────────────┐
│ extension / userscript   │         │ broker.py              │        │ CLI / IDE / MCP / curl  │
│ · hello broadcast        │  WS/   │ · page registry        │ HTTP   │ · GET /pages            │
│ · snapshot / actions     │────────▶│ · forward + await      │──────▶│ · POST /call            │
│ · eval                   │◀────────│ · up/down broadcast    │◀───────│ · WS /client            │
└──────────────────────────┘         └────────────────────────┘        └─────────────────────────┘
```

### Directory and files

| File | Purpose |
|---|---|
| `broker.py` | Local registry / broadcast / forwarding hub. Keeps the online-page table, forwards external commands to the right page and waits for results. **The only process that must stay running** |
| `requirements.txt` | Python dependencies for the broker (aiohttp only) |
| `cli_client.py` | Reference external CLI client (stdlib only): discover → validate URL → attach → LLM-driven loop |
| `chrome-extension/` | Connector option A (recommended): Chrome extension MV3 |
| ├ `manifest.json` | Extension manifest: permissions, injection rules (`<all_urls>`, excluding the broker's own port), action popup, options page |
| ├ `background.js` | Service worker: one WebSocket per tab to the broker; command routing (DOM actions go to content, screenshots/tab management run here); site allowlist filtering; webRequest observational capture of API calls (URL/request headers/request body/response headers) |
| ├ `filter.js` | Allowlist core: config storage, eTLD+1 registrable-domain extraction, matching engine (shared by SW / popup / options) |
| ├ `popup.html` / `popup.js` | Toolbar popup: master switch, allowlist status of the current page, one-click add/remove |
| ├ `options.html` / `options.js` | Full settings page: CRUD for domain list and regex rules, import/export, live regex tester |
| ├ `capture-main.js` | Page capture layer (injected into MAIN world at `document_start`): wraps fetch/XHR to capture request/response bodies and merges them with header records from the bg webRequest layer; also hooks `console` / uncaught exceptions / failed resource loads / CSP and writes to `__BATB_LOG__` for `plog` queries. The API part is shared by the "API Calls" tool and the `netlog` protocol (see `docs/spec-net-protocol.md`) |
| ├ `content.js` | Content script: one instance per tab, responsible for DOM snapshots and action execution (click/type/eval, etc.); also relays extension-bridge messages for the in-page toolbox (`batb:bridge` → background) and forwards LLM `netlog` / `plog` queries to the page capture layer |
| └ `toolbox/` | In-page toolbox (production build of the design prototype in `docs/toolbox/`): 14 zero-build modules injected into the page MAIN world by background according to the allowlist; six categories, 36 features (Info / Find / Style & Blocking / Send to LLM / Dev Artifacts / Capture) |
| `page-bridge.user.js` | Connector option B: userscript version. Mutually exclusive with the extension; falls back to GM long-polling when blocked by page CSP |
| `docs/research/1.md` | Early research notes (how console injection works and where it hurts) |

> The extension and the userscript overlap in functionality — **do not install both**, or a single tab will register twice in the broker.
> The extension is stronger: not subject to page CSP, cross-tab actions, and screenshots.

### Quick start

#### 1. Start the broker (resident on the local machine)

```powershell
pip install -r requirements.txt
python broker.py
# Optional environment variables:
#   BRIDGE_PORT=8766          change the port
#   BRIDGE_TOKEN=xxx          auth for the API (external requests need ?token=xxx or an X-Bridge-Token header)
```

#### 2. Connect a browser (pick one)

**Option A: Chrome extension (recommended)**

1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode" in the top-right corner
3. Click "Load unpacked" → select the `chrome-extension` directory
4. Open any web page; it broadcasts itself online automatically

> To drive local `file://` pages, enable "Allow access to file URLs" on the extension's details page.

**Option B: Userscript**

1. Install the Tampermonkey extension
2. Tampermonkey dashboard → Add a new script → paste the whole `page-bridge.user.js` → Save
3. Open any web page; it works automatically with no further steps

#### 3. Verify

```powershell
curl http://127.0.0.1:8766/pages
# [{"id":"a1b2c3d4","url":"https://github.com","title":"GitHub","mode":"ws","ago":1.2}, ...]
```

Open a few tabs and each one shows up as a record. The list updates automatically when pages close or navigate.

### Installing and updating the extension

Only "Load unpacked" is supported — load the `chrome-extension` directory directly (see Quick start → Connect a browser). No zip / `.crx` / store distribution.

- **After changing extension code**: `chrome://extensions` → click "Reload" on the extension card → refresh the target page (only then does `content.js` run the latest logic)
- **To drive local `file://` pages**: enable "Allow access to file URLs" on the extension details page
- **Uninstall / reinstall**: an unpacked extension has no fixed key, so its ID derives from the directory path; just reopen the target pages to reconnect

### External integration (any CLI / IDE, no SDK)

| Endpoint | Purpose |
|---|---|
| `GET /pages` | Discover: list of online pages (id / url / title / mode / ago / eval_mode) |
| `GET /events` | Subscribe to broadcasts (SSE): `page_up` / `page_update` / `page_down` / `page_event` |
| `POST /call/{pid}` | Attach and execute one command: body is the command JSON, `?timeout=30` controls the wait |
| `GET /marks` | List all page-bridge marks: `mark` / `online` / `pid` / `url` / `title` |
| `GET /mark/{mark}` | Look up a page by mark: returns online state, `pid`, URL, title (last known URL when offline) |
| `POST /mark/{mark}` | Execute a command by mark (body same as `/call/{pid}`, e.g. `{"action":"snapshot"}`) |
| `WS /client` | Long-lived connection: broadcasts + attach + bidirectional command stream (good for a resident IDE agent session) |
| `POST /mcp` | **MCP server** (Streamable HTTP, stateless): `initialize` / `tools/list` / `tools/call` |
| `GET /sse` + `POST /messages` | **MCP server** (legacy HTTP+SSE transport) for clients that only support SSE |

```powershell
# Discover and validate URLs (whether a page is "suitable" is up to the external client, e.g. regex on the domain)
curl http://127.0.0.1:8766/pages

# View a page snapshot (the LLM's eyes: interactive elements carry [bid] numbers plus body text)
curl -X POST http://127.0.0.1:8766/call/a1b2c3d4 -d "{\"action\":\"snapshot\"}"

# Click element #3
curl -X POST http://127.0.0.1:8766/call/a1b2c3d4 -d "{\"action\":\"click\",\"bid\":3}"

# Screenshot (extension only, returns base64 PNG)
curl -X POST http://127.0.0.1:8766/call/a1b2c3d4 -d "{\"action\":\"screenshot\"}"
```

### MCP (built into the broker, one process)

`broker.py` serves MCP directly (HTTP shares the broker's port; stdio is launched by the MCP client): page connections, CLI calls and MCP clients all share this one process — no separate MCP service and no extra dependencies.

| Transport | Address / command | Notes |
|---|---|---|
| Streamable HTTP (recommended) | `http://127.0.0.1:8766/mcp` | Stateless; `POST` returns a JSON-RPC response directly; `GET /mcp` returns 405 per the spec |
| Legacy HTTP+SSE | `http://127.0.0.1:8766/sse` | `GET /sse` emits an endpoint event → `POST /messages?sessionId=...`; responses go over SSE |
| stdio | `python broker.py --stdio` | Launched by the MCP client; **the broker starts together with MCP**, no need to run `start-broker.bat` first |

**Option 1: connect to a running broker** (start `start-broker.bat` first; if `BRIDGE_TOKEN` is set, append `?token=<token>` to the URL):

```json
{
  "mcpServers": {
    "page-bridge": { "url": "http://127.0.0.1:8766/mcp" }
  }
}
```

**Option 2: let the MCP client launch it (stdio, the process is the broker)**:

```json
{
  "mcpServers": {
    "page-bridge": {
      "command": "python",
      "args": ["E:\\WORK\\PROJECT\\TOOLS\\browser-agent\\broker.py", "--stdio"]
    }
  }
}
```

- Use absolute paths; with the project virtualenv, set `command` to `…\\browser-agent\\.venv\\Scripts\\python.exe`
- The process runs both stdio JSON-RPC and the `127.0.0.1:8766` hub, so pages connect as usual; stdout carries only JSON-RPC, all logs go to stderr
- When the client disconnects (stdin EOF) the process exits automatically and frees the port
- Only one instance may use a port: if a broker is already running, the stdio instance exits with an error — use option 1 in that case
- Do not configure `start-broker.bat` as the stdio `command` — the bat file's echo would pollute stdout

MCP tools:

| Tool | Parameters | Purpose |
|---|---|---|
| `list_pages` | - | Discover currently connected pages (id / mark / url / title / ago) |
| `list_marks` | - | List marks (offline pages still report their last URL) |
| `page_snapshot` | `page?, max?, text_max?` | Live snapshot (interactive elements with bid numbers plus body text). Trim oversized output with `max` (element count, default 300) / `text_max` (body text chars, default 6000, 0 omits text) |
| `page_call` | `page?, action, timeout?, ...` | Dispatch any command; parameters match the command table below (click / type / nav / eval / dom / screenshot…). Locate elements via bid / selector / text; `screenshot` returns a saved-file path `{format, path, bytes}` — view it with the Read tool |
| `page_logs` | `page?, since?, doc?, kinds?, levels?, q?, limit?, text_max?, wait_ms?, clear?, redact?` | **Extension only**: read page runtime logs and errors (console / uncaught exceptions / promise rejections / failed resources / CSP), with `t / iso / perf` timestamps, line/column numbers and stacks. Pull incrementally with the `since` + `doc` cursors; with `wait_ms>0` the page long-polls for new errors (≤20s), handy for confirming whether an action threw |

`page` accepts a mark id or pid; it can be omitted when only one page is online. Tool calls share the same forwarding path as `/call`, with the same 120s timeout ceiling.

### Commands

Locate an element by one of three params: `bid` = element number from a snapshot, `selector` = CSS selector, `text` = visible-text match (elements without a bid in the snapshot — e.g. custom widgets — can be clicked via `text`).

| action | Parameters | Notes |
|---|---|---|
| `ping` | - | Liveness check, returns page info |
| `snapshot` | `max?, text_max?` | Page snapshot: url/title/viewport/scroll position/element list/body text; `max` caps elements (default 300, max 1000), `text_max` caps body text chars (default 6000, 0 omits text) |
| `dom` | `selector?, bid?, depth?, maxNodes?, maxChars?, collapse?, redact?` | Condensed DOM: **Pug-style indented tree** (`tag.class#id(attr) text`), preserving hierarchy and semantic attributes. Defaults: `selector=body`, depth 8, 1500 nodes, 60k chars, runs of ≥3 identical siblings collapsed to `×N`, `redact=true`. Pass `bid` (or a bare number as `selector`) to output only that element and its descendants; returns `{selector, nodes, chars, truncated, content}` |
| `click` | `bid / selector / text` | Scroll into view and click (with a full mouse event sequence) |
| `type` | `bid / selector / text, text, clear?` | Type text using the native setter, works with controlled React/Vue components |
| `press` | `key, bid?` | Press a key (Enter submits the form / clicks automatically) |
| `select` | `bid / selector / text, value` | Choose a dropdown option |
| `scroll` | `dy?` or `bid / selector / text` | Scroll the page or scroll to an element |
| `hover` | `bid / selector / text` | Hover |
| `nav` | `url` | Navigate the page |
| `back` / `reload` | - | Back / reload |
| `eval` | `code` | Execute arbitrary JS in the page (async/await supported). The extension prefers the userScripts channel to bypass CSP; the userscript version or a disabled toggle goes through the content script and is bound by page CSP. See "eval and CSP" below |
| `cookies` | `op?, name?, value?` | Read/write cookies (op=get/set) |
| `storage` | `area?, key, value?` | Read/write localStorage / sessionStorage |
| `upload` | `bid / selector / text, files:[{name,mime,content}]` | Feed files into an `<input type=file>` |
| `wait` | `ms` | Wait (max 15s) |
| `highlight` | `bid / selector / text` | Outline the element in red for 2 seconds (debugging) |
| `netlog` | `op, q?, id?, limit?, max?, redact?` | **Extension only**: query captured API records (URL/request body/response/auth headers). `op=list` gives summaries (bodies omitted) → `op=get {"id":N}` fetches a full record → `op=curl {"id":N}` returns a replayable cURL; `op=clear` empties the buffer. **`redact` masks auth fields by default**; set it to false only when necessary. See `docs/spec-net-protocol.md` |
| `plog` | `op?, since?, doc?, kinds?, levels?, q?, limit?, text_max?, wait_ms?, clear?, redact?` | **Extension only**: query page logs and errors. `kinds` accepts `console / exception / rejection / resource / csp`; `levels` accepts `error / warn / info / log / debug`; returns `{doc, cursor, navigated, counts, items}`. Pass the previous `cursor` as `since` for incremental pulls; `doc` identifies the document and changes after navigation with `navigated:true`; `wait_ms>0` long-polls on the page for new errors (max 20s); `text_max` defaults to 600 chars per entry; `clear` empties the buffer; `redact` defaults to on |
| `screenshot` | - | **Extension only**: screenshot. Via MCP `page_call` the base64 is saved under the broker's `.screenshots/` dir and the result is `{format:"png", path, bytes}` (view it with the Read tool); CLI `/call` still returns `{format:"png", dataUrl}` |
| `tab_list` | - | **Extension only**: list all tabs |
| `tab_open` | `url, active?` | **Extension only**: open a new tab |
| `tab_close` | `tabId` | **Extension only**: close a tab (accepts a pageId) |
| `tab_activate` | `tabId` | **Extension only**: switch to a tab (accepts a pageId) |

### cli_client.py (a ready-made orchestration example)

```powershell
python cli_client.py list                          # discover currently online pages
python cli_client.py watch                         # subscribe to the broadcast event stream
python cli_client.py snap github.com               # find a page by URL substring and view its snapshot
python cli_client.py call <pid> "{\"action\":\"snapshot\"}"

# All in one: discover → validate URL via --match → attach → LLM-driven loop until done
# Environment variables: OPENAI_API_KEY (required) OPENAI_BASE_URL (optional, compatible APIs) BRIDGE_MODEL (optional)
python cli_client.py run "search for playwright in the search box and open the first result" --match github.com
```

The `run` loop is exactly "snapshot → LLM decides on one JSON command → POST /call → feed the result back → repeat";
your IDE/Agent only needs to replicate this loop (or call `/call` directly) to plug into any orchestration framework.

### Site allowlist

Pure allowlist mode: **only pages on the allowlist connect to the broker** (a matching domain or regex lets a page through); all other pages never register or broadcast.

- **Master switch (enabled or not)**: the popup and the settings page title bar each have an "Enabled" toggle, which **takes precedence over all rules** — when off, every page disconnects from the broker and stops registering (`/pages` becomes empty), and turning it back on restores all matching pages automatically; the state is represented only by the switch itself, and when off the toolbar icon shows a grey `OFF` badge
- **Entry point**: click the toolbar icon to open the popup — shows whether the current page is allowlisted (including what matched: domain/regex) and offers one-click add/remove
- **Domain list**: stores only eTLD+1 registrable domains (e.g. `github.com` automatically covers all subdomains such as `gist.github.com`; multi-level suffixes like `bbc.co.uk` are handled correctly), with CRUD, search and import/export (JSON/plain text)
- **Regex rules**: matched against the full URL, validated before saving, with a live tester panel
- **Takes effect immediately**: after config changes, registered pages disconnect/reconnect under the new rules without a refresh; the toolbar icon shows a `W` badge when the current tab matches the allowlist
- Detailed requirements and design: `docs/spec-url-filter.md`

### In-page toolbox

An in-page tool panel injected according to the allowlist; the design prototype lives in `docs/toolbox/` (architecture map: `docs/toolbox-proto-map.md`):

- **Injection**: once a page matches the allowlist, background injects the 14 modules under `chrome-extension/toolbox/` into the **page MAIN world** via `chrome.scripting` — React fiber lookups, fetch interception and `window.__BA_*` are only visible in the page context; injection is not limited by page CSP
- **Gating takes effect immediately**: after allowlist changes, injected pages show/hide in sync via the DOM event `batb:gate` — leaving the allowlist hides the toolbox instantly, matching again restores it; matching pages that were never injected get injected on the fly
- **Entry point**: circular FAB at the bottom-right (draggable, position remembered, `Alt+Shift+D` to toggle); six categories, 36 features (Info / Find / Style & Blocking / Send to LLM / Dev Artifacts / Capture)
- **Bilingual (Chinese / English)**: the "EN / 中文" button at the bottom of the panel switches languages with one click; Chinese is the default and the choice is stored in `localStorage` across reloads. Categories, feature names and descriptions, result cards and prompts all have English versions
- **Capture**: "URL QR Code" generates a QR code for the current URL entirely locally (scan to open on your phone, download as PNG / copy the link; embeds a trimmed MIT build of [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)); "Full-page Screenshot" scrolls and captures screen by screen, stitches a long image and downloads it as PNG; "Container Screenshot" picks any element — for a scrollable container it captures the container's entire scroll range (locating the scrolling ancestor, clipping and stitching screen by screen), for a plain element it captures the currently visible area — both screenshot modes handle floating elements automatically (fixed elements are temporarily hidden, sticky elements temporarily unstick, then restored) to avoid repeats on every screen; "API Calls" captures requests in two layers — the page capture layer (`capture-main.js`, wrapping fetch/XHR at document_start) grabs request/response bodies while the webRequest observational mode grabs all request headers (including Cookie/Authorization), merged by URL + time; open a list item to **copy debug text / copy cURL** for the LLM (auth fields such as Cookie/token are masked by default, and this can be turned off). Both screenshot features go through the **extension bridge** (content.js relays `batb:bridge` → background `captureVisibleTab`), so content.js must match the extension version (refresh the page after updating the extension)
- **LLM viewing channel for API calls**: the LLM sends the `netlog` command through the broker to query captured records on its own (`list` summaries → `get` details / `curl` replay, no manual clicking); the protocol and its limits are documented in `docs/spec-net-protocol.md`
- **Storage channel for Send to LLM**: results are written to `localStorage["ba:ctx"]` / `["ba:el"]`, and the LLM reads them through the broker's `storage` action (`window.__BA_*` is only visible in the page MAIN world; use storage for cross-process reads). "Copy page-bridge mark" copies the **page id** (generated in JS when the extension attaches the page, stored per tab in `chrome.storage.session`, reported with hello/hb); the LLM can use `GET /mark/<id>` to look up the URL and online state, and `POST /mark/<id> {"action":"snapshot"}` to get a live snapshot and continue
- Adding/removing features: just edit the `B.register([...])` array in `toolbox/feats/<category>.js`; see the prototype map for the module list and load order

### eval and CSP (extension)

When `eval` runs in the content script it is bound by **page CSP**: strict `script-src 'self'` sites such as GitHub or Tencent Yuanbao reject it outright with an
`unsafe-eval` error. The extension offers a userScripts channel to bypass this (Chrome ≥ 135):

1. `chrome://extensions` → Page Bridge → **Details** → enable the "**Allow user scripts**" toggle
2. **Reload the extension**: the toggle only takes effect after a Service Worker restart (a persistent SW cannot pick up `chrome.userScripts` while running), then refresh the target page

**How clients can tell** (required reading for LLM orchestration):

- Every page in `GET /pages` carries an `eval_mode` field:
  - `"userscript"` — toggle enabled; eval is not limited by CSP and works on any page
  - `"fallback"` — toggle disabled; eval goes through the content script and fails on strict-CSP sites
- The `ping` response also carries `eval_mode`
- When `eval` fails on a restricted page, the `error` includes enabling instructions and a risk warning that the LLM can relay to the user verbatim

**Risk warning (please relay to the user)**: with "Allow user scripts" enabled, the agent can execute arbitrary JS on any page (read/write page data, send requests on your behalf, etc.).
Enable it only in a browser you control; never enable it when connecting an untrusted orchestrator.

### Security

- The broker binds only to `127.0.0.1` and is invisible on the LAN; always set `BRIDGE_TOKEN` on a public-facing machine
- `eval` hands full page privileges to the caller — **enable it only in a browser you control**
- `netlog` masks Cookie/Authorization/token-like fields by default; `redact:false` returns real credential values, use it only on demand in a controlled environment (see `docs/spec-net-protocol.md`)
- The userscript version can restrict broadcasting to specific sites with `CFG.urlFilter` (regex allowlist); the extension version uses the "site filter" config allow/deny list (see above)
- Do not use it on unauthorized websites or on someone else's session

### Known limitations

- Content inside cross-origin iframes is unreachable (same-origin policy; true of every page-injection approach)
- Browser downloads and multi-window management are not covered (requires CDP)
- The userscript version falls back to long-polling on strict-CSP pages, with slightly higher latency; the extension version has no such issue
- On pages with Trusted Types enabled and no default policy (some Google sites), the toolbox UI may fail to mount (innerHTML is blocked)

### Troubleshooting

| Symptom | What to check |
|---|---|
| `/pages` is always empty | Is the broker running? Extension installed but no regular web page opened yet? **Is the master switch off?** (click the toolbar icon and check "Connection enabled") Check the Service Worker errors on the extension details page |
| The page is listed but commands time out | The tab was discarded/suspended by the browser — switch to it to wake it up; or a command was left unfinished before the page closed |
| The userscript cannot connect on some pages | Check the `[bridge]` logs in the console; if it says "falling back to HTTP long-polling" it was blocked by CSP, which is expected; or switch to the extension |
| `file://` pages do not come online | Enable "Allow access to file URLs" on the extension details page; for the userscript, allow file access in its settings |
| No toolbox FAB at the bottom-right of the page | Is the page allowlisted (check the popup for a match)? Check Service Worker errors on the extension details page; `file://` requires "Allow access to file URLs" |
| The toolbox "Full-page Screenshot" says the extension bridge is not responding | The extension was just updated and the page still runs an old content.js (without the bridge) — refresh the page; or check Service Worker errors on the extension details page |
| The toolbox FAB appears and then disappears on its own | The site rewrote the whole document (`document.open()/write()/close()`, e.g. Playcode preview runtime; or `createRoot(document.body)` wiping the body), removing the host node along with it. core.js remounts it within 1s, preserving UI state and allowlist visibility; if it never comes back, refresh the page and check the `mount` entries in `localStorage["ba:diaglog"]` |
| The FAB is there but clicks do nothing / the panel will not open | The second half of the same scenario: rewriting the whole document also wipes the document (including the Shadow DOM) and **all event listeners on window**; nodes and styles remain but listeners are gone. core.js self-checks listeners every 1s via the custom event `batb:probe` and rebinds as soon as it detects this (`rebind` entries appear in `ba:diaglog`); if it still does not respond, refresh the page and report the output of `copy(localStorage.getItem('ba:diaglog'))` |
| The toolbox "API Calls" says the capture layer is not loaded / `netlog` times out | The extension was just updated: reload the extension + refresh the page (the page capture layer `capture-main.js` is injected as the page loads); check whether the page is allowlisted (bg records requests only for allowlisted pages) |
| `eval` reports a CSP / unsafe-eval error | Expected (page CSP restriction). Enable the extension's "Allow user scripts" toggle as described in "eval and CSP" (**reload the extension afterwards**); or use other DOM actions |
| `eval_mode` in `/pages` is always `fallback` | userScripts requires Chrome ≥ 135 plus the "Allow user scripts" toggle (find it under `chrome://extensions` → Page Bridge → Details); after enabling, **reload the extension** and refresh the page |
| Page response timeout / `ping` gets no reply | The background tab was frozen (throttled) by the browser. `tab_activate` the tab first; or exclude the broker address from power saving. Tab-sleeping extensions cause this too |
| `element not found: bid=3` | The page DOM changed (navigation / re-render) — take a fresh `snapshot` for new numbers; for custom widgets locate by `text` or `selector` |
