"""Page Bridge Broker — 页面（油猴）与外部 CLI/IDE 之间的本地注册 / 广播 / 转发中心。

依赖:  pip install aiohttp          (见 requirements.txt)
运行:  python broker.py
       BRIDGE_PORT=8766 BRIDGE_TOKEN=xxx python broker.py   # 可选端口与鉴权
       python broker.py --stdio      # MCP 客户端拉起：broker 与 stdio MCP 同进程启动

页面接入（page-bridge.user.js 自动完成）:
  WS  /page                    WebSocket 通道
  POST /lp/register|poll|reply HTTP 长轮询回退通道（绕页面 CSP）

外部接入（任何 CLI / IDE，无需 SDK）:
  GET  /pages                    发现页面 -> [{id, url, title, viewport, mode, ago}]
  GET  /events        (SSE)      订阅广播: page_up / page_update / page_down / page_event
  POST /call/{page_id}           下发一条命令并等结果, body=命令JSON, ?timeout=30
  WS   /client                   长连接: 收广播 + attach 页面 + 双向命令流
  POST /mcp                       MCP 服务器（Streamable HTTP）
  GET  /sse + POST /messages      MCP 服务器（旧版 HTTP+SSE 传输）

命令格式（JSON，字段随动作）:
  ping | snapshot | click{bid} | type{bid,text,clear?} | press{key,bid?}
  | select{bid,value} | scroll{dy?,bid?} | hover{bid} | nav{url} | back | reload
  | eval{code} | cookies{op?,name?,value?} | storage{area?,key,value?}
  | upload{bid,files:[{name,mime,content}]} | wait{ms} | highlight{bid}
  bid 可用元素编号，也可直接给 CSS selector。
"""
import asyncio
import io
import json
import os
import sys
import time
import uuid

from aiohttp import web, WSMsgType

TOKEN = os.environ.get("BRIDGE_TOKEN", "")
PORT = int(os.environ.get("BRIDGE_PORT", "8766"))
# stdio 模式：IDE 的 MCP 客户端用 command 拉起本进程，broker 与 MCP 同进程启动
STDIO = ("--stdio" in sys.argv) or os.environ.get("BRIDGE_MCP_STDIO") == "1"
_STDOUT = None   # stdio 模式下的 JSON-RPC 专用输出流（原始 stdout）

PAGES = {}     # pid -> {'info': dict, 'ws': ws|None, 'queue': Queue|None, 'last_seen': float, 'mode': str}
MARKS = {}     # mark id -> {'pid': str, 'online': bool, 'info': dict, 'last_seen': float}
WAITERS = {}   # mid -> (Future, pid)
SSE = []       # 广播订阅者队列
CLIENTS = set()  # /client 长连接

HELP = """Page Bridge Broker

  GET  /pages                 页面列表（外部发现）
  GET  /events                SSE 广播（page_up/page_update/page_down/page_event）
  POST /call/{pid}            下发命令: {"action":"snapshot"} (?timeout=30)
  GET  /marks                页桥标记列表（mark -> pid/url 映射）
  GET  /mark/{mark}           按标记查页面（在线状态 + pid + url/title）
  POST /mark/{mark}           按标记下发命令（等价 /call/{pid}）
  POST /mcp                   MCP 服务器（Streamable HTTP，无状态）
  GET  /sse                   MCP 服务器（旧版 SSE：GET /sse + POST /messages）
  --stdio                     MCP 服务器（stdio）：由 MCP 客户端拉起，broker 同进程启动
  WS   /page                  页面接入        WS   /client                外部长连接
"""


def authorized(request) -> bool:
    return (not TOKEN
            or request.query.get("token") == TOKEN
            or request.headers.get("X-Bridge-Token") == TOKEN)


def deny():
    return web.json_response({"error": "unauthorized"}, status=401)


def public(page) -> dict:
    return {**page["info"], "id": page["id"], "mark": page["info"].get("mid"),
            "mode": page["mode"], "ago": round(time.time() - page["last_seen"], 1)}


async def ws_send(ws, obj):
    try:
        await ws.send_json(obj)
    except Exception:
        pass


def broadcast(evt: dict):
    evt = {"ts": round(time.time(), 3), **evt}
    for q in list(SSE):
        q.put_nowait(evt)
    for ws in list(CLIENTS):
        asyncio.ensure_future(ws_send(ws, evt))
    tag = evt.get("page", {}).get("url") or evt.get("page_id", "")
    print(f"[广播] {evt['type']}  {tag}")


def register_page(info: dict, ws=None) -> str:
    pid = uuid.uuid4().hex[:8]
    # 页桥标记：页面端 JS 生成（扩展 background 的 markId）优先；长轮询等未提供的由服务端补一个
    mid = info.get("mid") or ("pb_" + uuid.uuid4().hex[:10])
    info["mid"] = mid
    PAGES[pid] = {
        "id": pid, "info": info, "ws": ws, "mode": "ws" if ws else "lp",
        "queue": None if ws else asyncio.Queue(), "last_seen": time.time(),
    }
    MARKS[mid] = {"pid": pid, "online": True, "info": info, "last_seen": time.time()}
    broadcast({"type": "page_up", "page": public(PAGES[pid])})
    return pid


def drop_page(pid: str, reason="closed"):
    page = PAGES.pop(pid, None)
    if not page:
        return
    mid = page["info"].get("mid")
    if mid and mid in MARKS:
        # 标记不删除：保留最后一次 url/title，只置为离线，凭标记仍能查到"最后一次访问的页面"
        MARKS[mid]["online"] = False
        MARKS[mid]["last_seen"] = time.time()
        MARKS[mid]["info"] = page["info"]
    for wid, (fut, owner) in list(WAITERS.items()):
        if owner == pid:
            if not fut.done():
                fut.set_result({"ok": False, "error": f"page {reason}"})
            WAITERS.pop(wid, None)
    broadcast({"type": "page_down", "page_id": pid, "reason": reason})


async def call_page(page: dict, cmd: dict, timeout: float = 30.0) -> dict:
    """向页面下发命令并等待 result。"""
    mid = uuid.uuid4().hex[:8]
    fut = asyncio.get_running_loop().create_future()
    WAITERS[mid] = (fut, page["id"])
    payload = {**cmd, "id": mid}
    try:
        if page["ws"] is not None and not page["ws"].closed:
            await page["ws"].send_json(payload)
        elif page["queue"] is not None:
            page["queue"].put_nowait(payload)
        else:
            raise RuntimeError("page has no transport")
        return await asyncio.wait_for(fut, timeout)
    finally:
        WAITERS.pop(mid, None)


def handle_page_msg(pid: str, msg: dict):
    page = PAGES.get(pid)
    if not page:
        return
    page["last_seen"] = time.time()
    t = msg.get("type")
    if t == "hb":
        changed = (msg.get("url") != page["info"].get("url")
                   or msg.get("title") != page["info"].get("title")
                   or msg.get("eval_mode") != page["info"].get("eval_mode"))
        for k in ("url", "title", "viewport", "eval_mode"):
            if msg.get(k):
                page["info"][k] = msg[k]
        mid = page["info"].get("mid")
        if mid and mid in MARKS:
            MARKS[mid]["info"] = page["info"]
            MARKS[mid]["last_seen"] = time.time()
        if changed:
            broadcast({"type": "page_update", "page": public(page)})
    elif t == "result":
        entry = WAITERS.get(msg.get("id"))
        if entry and not entry[0].done():
            entry[0].set_result(msg)
    elif t == "event":
        broadcast({"type": "page_event", "page_id": pid, "event": msg})


# ---------------- 页面端：WebSocket ----------------

async def h_page_ws(request):
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    pid = None
    async for msg in ws:
        if msg.type != WSMsgType.TEXT:
            continue
        try:
            data = json.loads(msg.data)
        except ValueError:
            continue
        t = data.get("type")
        if t == "hello":
            info = {k: data.get(k) for k in ("url", "title", "viewport", "ua", "eval_mode", "mid") if data.get(k)}
            pid = register_page(info, ws=ws)
            await ws.send_json({"type": "welcome", "page_id": pid})
        elif t == "bye" and pid:
            drop_page(pid, "bye")
            pid = None
        elif pid:
            handle_page_msg(pid, data)
    if pid:
        drop_page(pid, "closed")
    return ws


# ---------------- 页面端：HTTP 长轮询回退（绕 CSP） ----------------

async def h_lp_register(request):
    try:
        data = await request.json()
    except ValueError:
        return web.json_response({"error": "bad json"}, status=400)
    info = {k: data.get(k) for k in ("url", "title", "viewport", "ua", "mid") if data.get(k)}
    return web.json_response({"sid": register_page(info, ws=None)})


async def h_lp_poll(request):
    try:
        body = await request.json()
    except ValueError:
        return web.json_response({"error": "bad json"}, status=400)
    page = PAGES.get(body.get("sid"))
    if not page:
        return web.json_response({"error": "unknown sid"}, status=404)
    page["last_seen"] = time.time()
    cmds = []
    try:
        limit = min(float(request.query.get("timeout", 25)), 30)
        cmds.append(await asyncio.wait_for(page["queue"].get(), timeout=limit))
        while len(cmds) < 8:
            cmds.append(page["queue"].get_nowait())
    except (asyncio.TimeoutError, asyncio.QueueEmpty):
        pass
    return web.json_response({"cmds": cmds})


async def h_lp_reply(request):
    try:
        body = await request.json()
    except ValueError:
        return web.json_response({"error": "bad json"}, status=400)
    page = PAGES.get(body.get("sid"))
    if not page:
        return web.json_response({"error": "unknown sid"}, status=404)
    handle_page_msg(page["id"], body.get("msg") or {})
    return web.json_response({"ok": True})


# ---------------- 外部端 ----------------

async def h_index(request):
    if not authorized(request):
        return deny()
    return web.Response(text=HELP, content_type="text/plain")


async def h_pages(request):
    if not authorized(request):
        return deny()
    return web.json_response([public(p) for p in PAGES.values()])


async def h_events(request):
    if not authorized(request):
        return deny()
    resp = web.StreamResponse(headers={
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache"})
    await resp.prepare(request)
    q = asyncio.Queue()
    SSE.append(q)
    try:
        await resp.write(b": connected\n\n")
        while True:
            try:
                evt = await asyncio.wait_for(q.get(), timeout=15)
                await resp.write(f"data: {json.dumps(evt, ensure_ascii=False)}\n\n".encode())
            except asyncio.TimeoutError:
                await resp.write(b": ping\n\n")
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        SSE.remove(q)
    return resp


async def forward(request, page):
    """把请求体当命令下发给页面并等结果（/call 与 /mark 共用）。"""
    try:
        cmd = await request.json()
    except ValueError:
        return web.json_response({"error": "bad json"}, status=400)
    timeout = min(float(request.query.get("timeout", 30)), 120)
    try:
        res = await call_page(page, cmd, timeout)
    except asyncio.TimeoutError:
        return web.json_response({"error": f"timeout after {timeout}s"}, status=504)
    except RuntimeError:
        return web.json_response({"error": "page has no live transport"}, status=409)
    return web.json_response({"ok": res.get("ok", False),
                              "data": res.get("data"), "error": res.get("error")})


async def h_call(request):
    if not authorized(request):
        return deny()
    page = PAGES.get(request.match_info["pid"])
    if not page:
        return web.json_response({"error": "page not found"}, status=404)
    return await forward(request, page)


async def h_marks(request):
    if not authorized(request):
        return deny()
    return web.json_response(marks_list())


async def h_mark(request):
    """按标记查页面：即使页面已离线，也返回最后一次的 url/title。"""
    if not authorized(request):
        return deny()
    mid = request.match_info["mid"]
    m = MARKS.get(mid)
    if not m:
        return web.json_response({"error": "mark not found", "mark": mid}, status=404)
    page = PAGES.get(m["pid"]) if m["online"] else None
    info = page["info"] if page else m["info"]
    body = {"mark": mid, "online": bool(page), "pid": m["pid"] if page else None,
            "url": info.get("url"), "title": info.get("title"),
            "ago": round(time.time() - (page["last_seen"] if page else m["last_seen"]), 1)}
    if page:
        body["usage"] = {
            "snapshot": f'POST /mark/{mid} {{"action":"snapshot"}}',
            "any": f'POST /mark/{mid} <命令 JSON>（同 /call/{m["pid"]}）',
        }
    return web.json_response(body)


async def h_mark_call(request):
    if not authorized(request):
        return deny()
    mid = request.match_info["mid"]
    m = MARKS.get(mid)
    if not m:
        return web.json_response({"error": "mark not found", "mark": mid}, status=404)
    page = PAGES.get(m["pid"]) if m["online"] else None
    if not page:
        return web.json_response({"error": "page offline", "mark": mid,
                                  "last_url": m["info"].get("url")}, status=409)
    return await forward(request, page)


async def h_client_ws(request):
    if not authorized(request):
        return deny()
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    CLIENTS.add(ws)
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except ValueError:
                continue
            if data.get("type") == "attach":
                page = PAGES.get(data.get("page_id"))
                await ws.send_json({"type": "attach_result", "ok": bool(page),
                                    "page": public(page) if page else None})
            elif data.get("type") == "cmd":
                page = PAGES.get(data.get("page_id"))
                if not page:
                    await ws_send(ws, {"type": "result", "ok": False, "error": "page not found"})
                    continue
                try:
                    res = await call_page(page, data.get("cmd") or {},
                                          float(data.get("timeout", 30)))
                except asyncio.TimeoutError:
                    res = {"ok": False, "error": "timeout"}
                except RuntimeError:
                    res = {"ok": False, "error": "page has no live transport"}
                await ws_send(ws, res)
    finally:
        CLIENTS.discard(ws)
    return ws


# ---------------- MCP：broker 兼做 MCP 服务器（同进程 / 同端口） ----------------
# 两种 HTTP 传输都支持，客户端按能力二选一：
#   Streamable HTTP: POST /mcp（无状态，直接回 JSON-RPC 响应）
#   旧版 HTTP+SSE:   GET /sse 拿 endpoint 事件 → POST /messages?sessionId=... 下发，响应走 SSE

MCP_SERVER_INFO = {"name": "page-bridge", "version": "1.0.0"}
MCP_SSE = {}   # sid -> asyncio.Queue（旧版 SSE 传输的回包队列）


def mcp_schema(props=None, required=None):
    s = {"type": "object", "properties": props or {}}
    if required:
        s["required"] = required
    return s


MCP_TOOLS = [
    {"name": "list_pages",
     "description": "列出当前接入 broker 的浏览器页面：id / mark / url / title / mode / ago（秒）。",
     "inputSchema": mcp_schema()},
    {"name": "list_marks",
     "description": "列出全部页桥标记及其在线状态；页面离线时仍返回最后一次的 url / title。",
     "inputSchema": mcp_schema()},
    {"name": "page_snapshot",
     "description": "读取指定页面的实时快照（交互元素带 bid 编号 + 正文），是操作页面前的“眼睛”。",
     "inputSchema": mcp_schema({
         "page": {"type": "string", "description": "页面标记 id 或 pid；只有一个在线页面时可省略"}})},
    {"name": "page_call",
     "description": "向指定页面下发一条命令并等待结果：click / type / press / select / scroll / hover / nav / back / reload / eval / dom / cookies / storage / upload / wait / highlight / screenshot / tab_* 等，参数同 README 命令表。",
     "inputSchema": mcp_schema({
         "page": {"type": "string", "description": "页面标记 id 或 pid；只有一个在线页面时可省略"},
         "action": {"type": "string", "description": "命令名，如 snapshot / click / nav / eval / dom / screenshot"},
         "timeout": {"type": "number", "description": "等待秒数，默认 30，上限 120"}},
         required=["action"])},
]


def mcp_text(obj) -> str:
    return obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False, indent=2)


def resolve_page(ref=None):
    """页面定位：pid 或标记 id；只给一处在线页面时无需指定。返回 (page, error)。"""
    if ref:
        if ref in PAGES:
            return PAGES[ref], None
        m = MARKS.get(ref)
        if m and m["pid"] in PAGES:
            return PAGES[m["pid"]], None
        return None, f"页面不存在或已离线：{ref}（用 list_pages / list_marks 查看当前可用页面）"
    if len(PAGES) == 1:
        return next(iter(PAGES.values())), None
    if not PAGES:
        return None, "当前没有页面接入：确认 broker 在跑、扩展（或油猴脚本）已装、当前站点在白名单"
    refs = "、".join(f"{p['info'].get('mid') or p['id']}({p['info'].get('url')})" for p in PAGES.values())
    return None, "有多个在线页面，请用 page 参数指定标记 id 或 pid：" + refs


def marks_list():
    out = []
    for mid, m in MARKS.items():
        info = m["info"]
        out.append({"mark": mid, "online": bool(m["online"] and m["pid"] in PAGES),
                    "pid": m["pid"], "url": info.get("url"), "title": info.get("title"),
                    "ago": round(time.time() - m["last_seen"], 1)})
    return sorted(out, key=lambda x: x["mark"])


async def mcp_tool(name, args):
    """执行一个 MCP 工具，返回 (文本, 是否错误)。"""
    args = args if isinstance(args, dict) else {}
    if name == "list_pages":
        return mcp_text([public(p) for p in PAGES.values()]), False
    if name == "list_marks":
        return mcp_text(marks_list()), False
    if name not in ("page_snapshot", "page_call"):
        return "未知工具：" + str(name), True
    page, err = resolve_page(args.get("page"))
    if err:
        return err, True
    if name == "page_snapshot":
        cmd = {"action": "snapshot"}
    else:
        cmd = dict(args.get("cmd") or {})
        for k, v in args.items():
            if k not in ("page", "cmd", "timeout"):
                cmd[k] = v
        if not cmd.get("action"):
            return "缺少 action 参数（如 snapshot / click / nav / eval / screenshot）", True
    try:
        timeout = min(float(args.get("timeout") or 30), 120)
        res = await call_page(page, cmd, timeout)
    except asyncio.TimeoutError:
        return "页面响应超时", True
    except (RuntimeError, TypeError, ValueError) as e:
        return "命令下发失败：" + str(e), True
    out = {"ok": bool(res.get("ok")), "data": res.get("data"), "error": res.get("error")}
    return mcp_text(out), not out["ok"]


async def mcp_rpc(msg):
    """处理一条 JSON-RPC 消息；通知（无 id）返回 None。"""
    if not isinstance(msg, dict):
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "invalid request"}}
    mid = msg.get("id")
    method = msg.get("method") or ""
    if mid is None:
        return None
    if method == "initialize":
        params = msg.get("params") or {}
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": params.get("protocolVersion") or "2025-03-26",
            "capabilities": {"tools": {}},
            "serverInfo": MCP_SERVER_INFO,
            "instructions": "page-bridge：先 list_pages 发现页面，再用 page_snapshot 看快照、page_call 下发命令。"}}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": mid, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": MCP_TOOLS}}
    if method == "tools/call":
        params = msg.get("params") or {}
        text, is_err = await mcp_tool(params.get("name") or "", params.get("arguments") or {})
        return {"jsonrpc": "2.0", "id": mid,
                "result": {"content": [{"type": "text", "text": text}], "isError": is_err}}
    return {"jsonrpc": "2.0", "id": mid,
            "error": {"code": -32601, "message": "method not found: " + method}}


async def h_mcp_post(request):
    """Streamable HTTP 传输：POST /mcp 直接收发 JSON-RPC。"""
    if not authorized(request):
        return deny()
    try:
        body = await request.json()
    except ValueError:
        return web.json_response({"jsonrpc": "2.0", "id": None,
                                 "error": {"code": -32700, "message": "parse error"}}, status=400)
    if isinstance(body, list):
        out = [r for r in [await mcp_rpc(m) for m in body] if r]
        if not out:
            return web.Response(status=202)
        return web.json_response(out)
    res = await mcp_rpc(body)
    if res is None:
        return web.Response(status=202)   # 通知类消息：已接收，不回包
    return web.json_response(res)


async def h_mcp_get(request):
    """无状态实现不提供服务器推送流，按规范返回 405。"""
    if not authorized(request):
        return deny()
    return web.json_response({"error": "GET /mcp 不提供推送流，请用 POST /mcp"},
                             status=405, headers={"Allow": "POST, DELETE"})


async def h_mcp_delete(request):
    if not authorized(request):
        return deny()
    return web.json_response({"ok": True})


async def h_mcp_sse(request):
    """旧版 HTTP+SSE 传输：GET /sse 建立事件流并下发 endpoint 地址。"""
    if not authorized(request):
        return deny()
    sid = uuid.uuid4().hex
    q = asyncio.Queue()
    MCP_SSE[sid] = q
    endpoint = "/messages?sessionId=" + sid
    token = request.query.get("token") or TOKEN
    if token:
        endpoint += "&token=" + token
    resp = web.StreamResponse(headers={"Content-Type": "text/event-stream",
                                       "Cache-Control": "no-cache"})
    await resp.prepare(request)
    try:
        await resp.write(f"event: endpoint\ndata: {endpoint}\n\n".encode())
        while True:
            try:
                out = await asyncio.wait_for(q.get(), timeout=15)
            except asyncio.TimeoutError:
                await resp.write(b": ping\n\n")
                continue
            await resp.write(f"event: message\ndata: {json.dumps(out, ensure_ascii=False)}\n\n".encode())
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        MCP_SSE.pop(sid, None)
    return resp


async def h_mcp_messages(request):
    """旧版 HTTP+SSE 传输：POST /messages 下发 JSON-RPC，响应经 SSE 回传。"""
    if not authorized(request):
        return deny()
    q = MCP_SSE.get(request.query.get("sessionId"))
    if q is None:
        return web.json_response({"error": "unknown session"}, status=404)
    try:
        body = await request.json()
    except ValueError:
        return web.json_response({"jsonrpc": "2.0", "id": None,
                                 "error": {"code": -32700, "message": "parse error"}}, status=400)
    for m in (body if isinstance(body, list) else [body]):
        res = await mcp_rpc(m)
        if res:
            q.put_nowait(res)
    return web.Response(status=202)


# ---------------- MCP stdio 传输：客户端拉起即启动 broker ----------------

async def mcp_stdio_loop():
    """每行一条 JSON-RPC；stdin 关闭（客户端断开）即结束，进程随之退出。"""
    stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, stdin.readline)
        if not line:
            return
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            res = {"jsonrpc": "2.0", "id": None,
                   "error": {"code": -32700, "message": "parse error"}}
        else:
            res = await mcp_rpc(msg)
        if res is not None:
            _STDOUT.write(json.dumps(res, ensure_ascii=False) + "\n")
            _STDOUT.flush()


async def run_stdio(app):
    """同进程起 aiohttp 中枢（页面连接用）并跑 stdio JSON-RPC（MCP 客户端用）。"""
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", PORT)
    try:
        await site.start()
    except OSError as e:
        print(f"[mcp] 监听 127.0.0.1:{PORT} 失败：{e}；同端口只允许一个 broker"
              f"（已有实例时，MCP 客户端请直接连 http://127.0.0.1:{PORT}/mcp）", file=sys.stderr)
        await runner.cleanup()
        raise SystemExit(1)
    print(f"[mcp] stdio 就绪；HTTP 中枢 http://127.0.0.1:{PORT}", file=sys.stderr)
    try:
        await mcp_stdio_loop()
    finally:
        await runner.cleanup()


# ---------------- 守护：清理失联页面 ----------------

async def janitor(_app):
    task = asyncio.create_task(_janitor_loop())
    yield
    task.cancel()


async def _janitor_loop():
    while True:
        await asyncio.sleep(5)
        now = time.time()
        for pid, p in list(PAGES.items()):
            live_ws = p["ws"] is not None and not p["ws"].closed
            if not live_ws and now - p["last_seen"] > 40:
                drop_page(pid, "timeout")
        # 离线标记保留 24h 供外部按标记回查最近一次页面，之后清掉避免无限增长
        for mid, m in list(MARKS.items()):
            if not m["online"] and now - m["last_seen"] > 86400:
                MARKS.pop(mid, None)


def main():
    app = web.Application()
    app.add_routes([
        web.get("/", h_index),
        web.get("/pages", h_pages),
        web.get("/events", h_events),
        web.post("/call/{pid}", h_call),
        web.get("/marks", h_marks),
        web.get("/mark/{mid}", h_mark),
        web.post("/mark/{mid}", h_mark_call),
        web.get("/page", h_page_ws),
        web.get("/client", h_client_ws),
        web.post("/mcp", h_mcp_post),
        web.get("/mcp", h_mcp_get),
        web.delete("/mcp", h_mcp_delete),
        web.get("/sse", h_mcp_sse),
        web.post("/messages", h_mcp_messages),
        web.post("/lp/register", h_lp_register),
        web.post("/lp/poll", h_lp_poll),
        web.post("/lp/reply", h_lp_reply),
    ])
    app.cleanup_ctx.append(janitor)
    if STDIO:
        global _STDOUT
        _STDOUT = sys.stdout
        try:
            # MCP stdio 协议按 UTF-8 收发；Windows 下管道默认 GBK，快照里出现 emoji 等
            # 非 GBK 字符时 write 会抛 UnicodeEncodeError，整个进程随之退出（表现为
            # 客户端 Connection closed、工具全部消失）。这里显式固定 UTF-8。
            _STDOUT.reconfigure(encoding="utf-8", errors="replace", newline="\n")
        except (AttributeError, ValueError):
            pass
        sys.stdout = sys.stderr   # stdout 只留给 JSON-RPC，日志一律走 stderr
        asyncio.run(run_stdio(app))
        return
    print(f"[broker] listening on http://127.0.0.1:{PORT}  (token={'on' if TOKEN else 'off'})")
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)


if __name__ == "__main__":
    main()
