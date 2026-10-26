# AGENTS.md — Page Bridge / Browser Agent

Exposes browser pages to any CLI/IDE/Agent over a local channel. `README.md`
is authoritative and thorough (in Chinese); this file covers only the gotchas
an agent would otherwise miss.

## Commands

- **Broker** (only ever-running process, aiohttp): `python broker.py`
  - Env: `BRIDGE_PORT` (default `8766`), `BRIDGE_TOKEN` (optional auth;
    external calls send `?token=` or `X-Bridge-Token`). Binds `127.0.0.1` only.
- **CLI client** (pure stdlib, no deps):
  `python cli_client.py list|watch|snap <url-substr>|call <pid> <json>|run "<task>" --match <regex>`
  - `run` needs `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`, `BRIDGE_MODEL`).
- **Extension packaging**:
  - zip: `Compress-Archive -Path chrome-extension\* -DestinationPath <out>.zip`
  - `.crx`: `node build\make-test-key.mjs` then `chrome --pack-extension=... --pack-extension-key=build\debug-extension.pem`

## Verification reality — read before running anything

- **There is no test suite, linter, formatter, typecheck, codegen, build
  step, or CI.** No `package.json` / `pyproject.toml` / Makefile exists. Do not
  hunt for `npm test` / `pytest` — they are not there.
- The only static check is **`node --check <file.js>`** (Node has no project
  deps; the `.mjs` script uses built-in modules only). This is the team's
  stated verification step (see `docs/changelog.md`). Use it after editing any
  JS. `broker.py` / `cli_client.py` have no test harness.

## Toolbox: two trees that MUST stay in sync (biggest gotcha)

The in-page toolbox has **two parallel implementations**:

- `docs/toolbox/` — design prototype, 12 modules, opens over `file://`.
- `chrome-extension/toolbox/` — production, 14 modules (adds `qr.js` +
  `feats/capture.js`; `capture` category is extension-only, needs the
  extension bridge). Injected into the page **MAIN world** via
  `chrome.scripting` when a page hits the whitelist; all DOM in a Shadow Root.

**The convention (stated in `docs/toolbox-proto-map.md` and every changelog
entry) is: change the prototype AND the production copy together.** Editing one
tree and not the other is the most likely mistake. `docs/toolbox-proto-map.md`
is the authoritative "where do I change X" map — read it before editing toolbox
code.

Toolbox conventions:
- **Load order is fixed and load-bearing** (do not reorder):
  `core → cats → widgets → ui → picker → helpers → [qr] → feats/{info,find,style,llm,build[,capture]} → boot`.
  `core` first, `boot` last. Plain `<script>` sharing one `window.BATB`
  namespace (not ES modules); cross-module calls always via `B.*`.
- **Add/remove a feature** by editing the `B.register([...])` array in
  `feats/<category>.js`. After any add/remove, **also update the feature/category
  counts** in the README toolbox section and in `docs/toolbox-proto-map.md`
  (changelog entries track these as "34→33" etc.).

## Architecture boundaries (not obvious from filenames)

- `broker.py` is the sole hub: page registry + broadcast + command forward.
  Pages connect over WS `/page` (extension) or HTTP long-poll `/lp/*`
  (userscript CSP fallback). Externals use `/pages`, `/events` (SSE),
  `POST /call/{pid}`, or WS `/client`. There is no shared SDK — replicate
  `cli_client.py`'s snapshot→decide→/call loop.
- **Extension (`chrome-extension/`) and userscript (`page-bridge.user.js`) are
  mutually exclusive — never install both**, or a tab double-registers.
  Extension is stronger (CSP-immune, cross-tab, screenshots).
- Toolbox runs in MAIN world so it **cannot receive `chrome.*` messages**;
  screenshots/extension features relay through `content.js` via the DOM event
  bridge `batb:bridge` (MAIN→ISOLATED). After updating the extension you must
  **reload the page** so `content.js` has the bridge.

## Browser version constraints

- `eval` from a content script is blocked by page CSP; the extension bypasses
  it via the userScripts channel which needs **Chrome ≥ 135** with the manual
  "Allow user scripts" toggle (`manifest.minimum_chrome_version` is 120).
  `/pages` exposes `eval_mode` = `userscript` | `fallback` for awareness.
- Extension **ID is derived from the private key**; `make-test-key.mjs`
  refuses to overwrite an existing `.pem` (new key = new ID).

## Conventions

- **Docs, code comments, and user-facing strings are Chinese**; identifiers,
  commands, and storage keys are English. Match this when editing.
- Whitelist is pure allow-list (eTLD+1 + regex). Detailed spec lives in
  `docs/spec-url-filter.md`; shared matching engine is `chrome-extension/filter.js`.
- When logging a feature/fix, append a dated entry to `docs/changelog.md`
  ("Keep a Changelog" format, newest first; commits use conventional `feat:`/`fix:`).
