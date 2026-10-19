"""Page Bridge Broker — 页面（油猴）与外部 CLI/IDE 之间的本地注册 / 广播 / 转发中心。

依赖:  pip install aiohttp          (见 requirements.txt)
运行:  python broker.py
       BRIDGE_PORT=8766 BRIDGE_TOKEN=xxx python broker.py   # 可选端口与鉴权

页面接入（page-bridge.user.js 自动完成）:
  WS  /page                    WebSocket 通道
  POST /lp/register|poll|reply HTTP 长轮询回退通道（绕页面 CSP）

外部接入（任何 CLI / IDE，无需 SDK）:
  GET  /pages                    发现页面 -> [{id, url, title, viewport, mode, ago}]
  GET  /events        (SSE)      订阅广播: page_up / page_update / page_down / page_event
  POST /call/{page_id}           下发一条命令并等结果, body=命令JSON, ?timeout=30
  WS   /client                   长连接: 收广播 + attach 页面 + 双向命令流

命令格式（JSON，字段随动作）:
  ping | snapshot | click{bid} | type{bid,text,clear?} | press{key,bid?}
  | select{bid,value} | scroll{dy?,bid?} | hover{bid} | nav{url} | back | reload
  | eval{code} | cookies{op?,name?,value?} | storage{area?,key,value?}
  | upload{bid,files:[{name,mime,content}]} | wait{ms} | highlight{bid}
  bid 可用元素编号，也可直接给 CSS selector。
"""
import asyncio
import json
import os
import time
import uuid

from aiohttp import web, WSMsgType

TOKEN = os.environ.get("BRIDGE_TOKEN", "")
PORT = int(os.environ.get("BRIDGE_PORT", "8766"))

PAGES = {}     # pid -> {'info': dict, 'ws': ws|None, 'queue': Queue|None, 'last_seen': float, 'mode': str}
WAITERS = {}   # mid -> (Future, pid)
SSE = []       # 广播订阅者队列
CLIENTS = set()  # /client 长连接

HELP = """Page Bridge Broker

  GET  /pages                 页面列表（外部发现）
  GET  /events                SSE 广播（page_up/page_update/page_down/page_event）
  POST /call/{pid}            下发命令: {"action":"snapshot"} (?timeout=30)
  WS   /page                  页面接入        WS   /client                外部长连接
"""


def authorized(request) -> bool:
    return (not TOKEN
            or request.query.get("token") == TOKEN
            or request.headers.get("X-Bridge-Token") == TOKEN)


def deny():
    return web.json_response({"error": "unauthorized"}, status=401)


def public(page) -> dict:
    return {**page["info"], "id": page["id"], "mode": page["mode"],
            "ago": round(time.time() - page["last_seen"], 1)}


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
    PAGES[pid] = {
        "id": pid, "info": info, "ws": ws, "mode": "ws" if ws else "lp",
        "queue": None if ws else asyncio.Queue(), "last_seen": time.time(),
    }
    broadcast({"type": "page_up", "page": public(PAGES[pid])})
    return pid


def drop_page(pid: str, reason="closed"):
    page = PAGES.pop(pid, None)
    if not page:
        return
    for mid, (fut, owner) in list(WAITERS.items()):
        if owner == pid:
            if not fut.done():
                fut.set_result({"ok": False, "error": f"page {reason}"})
            WAITERS.pop(mid, None)
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
            info = {k: data.get(k) for k in ("url", "title", "viewport", "ua", "eval_mode") if data.get(k)}
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
    info = {k: data.get(k) for k in ("url", "title", "viewport", "ua") if data.get(k)}
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


async def h_call(request):
    if not authorized(request):
        return deny()
    page = PAGES.get(request.match_info["pid"])
    if not page:
        return web.json_response({"error": "page not found"}, status=404)
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


def main():
    app = web.Application()
    app.add_routes([
        web.get("/", h_index),
        web.get("/pages", h_pages),
        web.get("/events", h_events),
        web.post("/call/{pid}", h_call),
        web.get("/page", h_page_ws),
        web.get("/client", h_client_ws),
        web.post("/lp/register", h_lp_register),
        web.post("/lp/poll", h_lp_poll),
        web.post("/lp/reply", h_lp_reply),
    ])
    app.cleanup_ctx.append(janitor)
    print(f"[broker] listening on http://127.0.0.1:{PORT}  (token={'on' if TOKEN else 'off'})")
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)


if __name__ == "__main__":
    main()
