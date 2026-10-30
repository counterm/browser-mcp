"""Page Bridge Broker — 页面（Chrome 扩展）与外部 CLI/IDE 之间的本地注册 / 广播 / 转发中心。

依赖:  pip install aiohttp          (见 requirements.txt)
运行:  python broker.py
       BRIDGE_PORT=8766 BRIDGE_TOKEN=xxx python broker.py   # 可选端口与鉴权
       python broker.py --stdio      # MCP 客户端拉起：broker 与 stdio MCP 同进程启动

页面接入（Chrome 扩展自动完成）:
  WS  /page                    WebSocket 通道
  POST /lp/register|poll|reply HTTP 长轮询通道（早期油猴脚本版的 CSP 回退通道，现为兼容保留）

外部接入（任何 CLI / IDE，无需 SDK）:
  GET  /pages                    发现页面 -> [{id, url, title, viewport, mode, ago}]
  GET  /events        (SSE)      订阅广播: page_up / page_update / page_down / page_event
  POST /call/{page_id}           下发一条命令并等结果, body=命令JSON, ?timeout=30
  GET  /flows                    flow 库列表（YAML 测试流，见 docs/spec-flow.md）
  POST /flows/run                执行 flow: {name|yaml, page?, vars?, from_step?, stop_on_fail?}
  GET|PUT|DELETE /flow/{name}    读取 / 保存 / 删除 flow（PUT body {"yaml": "..."}）
  WS   /client                   长连接: 收广播 + attach 页面 + 双向命令流
  POST /mcp                       MCP 服务器（Streamable HTTP）
  GET  /sse + POST /messages      MCP 服务器（旧版 HTTP+SSE 传输）

命令格式（JSON，字段随动作）:
  ping | snapshot | click{bid} | type{bid,text,clear?} | press{key,bid?}
  | select{bid,value} | scroll{dy?,bid?} | hover{bid} | nav{url} | back | reload
  | eval{code} | cookies{op?,name?,value?} | storage{area?,key,value?}
  | upload{bid,files:[{name,mime,content}]} | wait{ms} | highlight{bid}
  | netlog{op,...} | plog{op?,since?,doc?,kinds?,levels?,q?,limit?,text_max?,wait_ms?,clear?,redact?}
  定位参数 bid / selector / text 三选一（bid=快照元素编号，selector=CSS，text=按可见文本匹配）。
  关联键为保留名 __mid；命令参数可合法使用 id（如 netlog get {"id":N}）。
"""
import asyncio
import base64
import csv
import io
import json
import os
import re
import sys
import time
import uuid

from aiohttp import web, WSMsgType

try:
    import yaml  # flow 功能需要（pip install pyyaml）；缺失时其余功能不受影响
except ImportError:
    yaml = None

TOKEN = os.environ.get("BRIDGE_TOKEN", "")
PORT = int(os.environ.get("BRIDGE_PORT", "8766"))
# stdio 模式：IDE 的 MCP 客户端用 command 拉起本进程，broker 与 MCP 同进程启动
STDIO = ("--stdio" in sys.argv) or os.environ.get("BRIDGE_MCP_STDIO") == "1"
_STDOUT = None   # stdio 模式下的 JSON-RPC 专用输出流（原始 stdout）

# MCP 截图落盘目录：page_call 拿到 dataUrl 时解码存这里并返回路径，避免 base64 撑爆上下文
SHOTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".screenshots")


def save_dataurl(dataurl, tag="page"):
    """把 data:image/...;base64,xxx 解码存盘，返回文件路径；失败返回 None。"""
    m = re.match(r"^data:image/(png|jpeg|webp);base64,", dataurl or "")
    if not m:
        return None
    try:
        os.makedirs(SHOTS_DIR, exist_ok=True)
        path = os.path.join(
            SHOTS_DIR, f"shot-{time.strftime('%Y%m%d-%H%M%S')}-{tag}-{uuid.uuid4().hex[:4]}.{m.group(1)}")
        with open(path, "wb") as f:
            f.write(base64.b64decode(dataurl.split(",", 1)[1]))
        return path
    except Exception:
        return None


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
  GET  /flows                 flow 库列表（YAML 测试流）
  POST /flows/run             执行 flow（body {name|yaml, page?, vars?, ...}）
  GET|PUT|DELETE /flow/{name} 读取 / 保存 / 删除 flow
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
    # 关联用保留键 __mid：命令参数里的 id 不再被覆盖（netlog get/curl 的 {"id":N} 此前会被
    # 传输层覆盖导致永远 record not found）；没带 id 时补一个兼容旧版页面端
    payload = {**cmd, "__mid": mid}
    if "id" not in cmd:
        payload["id"] = mid
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


# ---------------- Flow：HTTP 端点（CLI / 扩展桥 / 外部接入共用） ----------------

def _need_yaml():
    return None if yaml else web.json_response(
        {"error": "缺少依赖：pip install pyyaml（flow 功能需要）"}, status=500)


async def h_flows(request):
    if not authorized(request):
        return deny()
    if (err := _need_yaml()):
        return err
    return web.json_response(flow_list())


async def h_flow_run(request):
    """POST /flows/run  body {name|yaml, page?, vars?, from_step?, stop_on_fail?, mode?}"""
    if not authorized(request):
        return deny()
    if (err := _need_yaml()):
        return err
    try:
        body = await request.json()
    except ValueError:
        return web.json_response({"error": "bad json"}, status=400)
    doc, err = flow_doc_from(body if isinstance(body, dict) else {})
    if err:
        return web.json_response({"error": err}, status=400)
    page, err = resolve_page(body.get("page"))
    if err:
        return web.json_response({"error": err}, status=409)
    if body.get("mode") == "async":
        return web.json_response(flow_start_async(page, doc, body.get("vars"),
                                                  body.get("from_step"),
                                                  bool(body.get("stop_on_fail", True))))
    report = await flow_run(page, doc, body.get("vars"), body.get("from_step"),
                            bool(body.get("stop_on_fail", True)))
    return web.json_response(report)


async def h_flow_status(request):
    """GET /flows/status?run_id=xxx&wait_ms=0  异步运行进度轮询；done 时带完整报告。"""
    if not authorized(request):
        return deny()
    rid = request.query.get("run_id") or ""
    out, ok = await flow_status(rid, request.query.get("wait_ms", 0))
    if not ok:
        return web.json_response({"error": f"run_id 不存在：{rid}（done 超 1h 清理）"}, status=404)
    return web.json_response(out)


async def h_flow_get(request):
    if not authorized(request):
        return deny()
    if (err := _need_yaml()):
        return err
    text, err = flow_read(request.match_info["name"])
    if err:
        return web.json_response({"error": err}, status=404)
    return web.json_response({"name": request.match_info["name"], "yaml": text})


async def h_flow_save(request):
    if not authorized(request):
        return deny()
    if (err := _need_yaml()):
        return err
    try:
        body = await request.json()
    except ValueError:
        return web.json_response({"error": "bad json"}, status=400)
    text = body.get("yaml") if isinstance(body, dict) else None
    if not isinstance(text, str) or not text.strip():
        return web.json_response({"error": "需要 {\"yaml\": \"...\"}"}, status=400)
    try:
        doc = yaml.safe_load(text)
    except Exception as e:
        return web.json_response({"error": f"YAML 解析失败：{e}"}, status=400)
    doc, err = flow_validate(doc)
    if err:
        return web.json_response({"error": f"校验失败：{err}"}, status=400)
    p, err = flow_write(doc, text)
    if err:
        return web.json_response({"error": err}, status=500)
    return web.json_response({"ok": True, "path": p, "steps": len(doc["steps"])})


async def h_flow_delete(request):
    if not authorized(request):
        return deny()
    p = flow_path(request.match_info["name"])
    if not p or not os.path.isfile(p):
        return web.json_response({"error": f"flow 不存在：{request.match_info['name']}"}, status=404)
    os.remove(p)
    return web.json_response({"ok": True})


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
     "description": "读取指定页面的实时快照（交互元素带 bid 编号 + 正文），是操作页面前的“眼睛”。输出过大时可用 max（元素条数，默认 300）与 text_max（正文字符数，默认 6000，0 为省略正文）裁剪；只需局部 DOM 时改用 page_call {action:\"dom\"}。",
     "inputSchema": mcp_schema({
         "page": {"type": "string", "description": "页面标记 id 或 pid；只有一个在线页面时可省略"},
         "max": {"type": "number", "description": "交互元素条数上限，默认 300，最大 1000"},
         "text_max": {"type": "number", "description": "正文字符上限，默认 6000，最大 30000，0 省略正文"}})},
    {"name": "page_call",
     "description": "向指定页面下发一条命令并等待结果：click / type / press / select / scroll / hover / nav / back / reload / eval / dom / cookies / storage / upload / wait / highlight / screenshot / tab_* 等，参数同 README 命令表。元素定位参数 bid / selector / text 三选一（快照没给 bid 的元素用 text 按可见文本也能点）。screenshot 返回落盘路径 {format,path,bytes}（base64 已存到 .screenshots/ 目录，避免大输出被截断），用 Read 工具直接看图。",
     "inputSchema": mcp_schema({
         "page": {"type": "string", "description": "页面标记 id 或 pid；只有一个在线页面时可省略"},
         "action": {"type": "string", "description": "命令名，如 snapshot / click / nav / eval / dom / screenshot"},
         "timeout": {"type": "number", "description": "等待秒数，默认 30，上限 120"}},
         required=["action"])},
    {"name": "page_logs",
     "description": "页面运行日志与异常读取（仅扩展版）。用途：排查页面报错、白屏、点击/请求无反应，或操作后确认是否引入前端错误；数据来自页面 console、未捕获异常、Promise 拒绝、资源加载失败、CSP 拦截。用法：首次不带 since 取基线并记下返回的 doc 与 cursor → 执行操作（page_call）→ 再带 since+doc 和 wait_ms≤20000 取增量（有异常立即返回，无异常等满超时返回空）。返回 items 含 kind/level/text/url/line/col/stack 与发生时间 t（epoch ms）及重复次数 count；页面导航后 doc 变化会返回 navigated:true 并从 0 重新计数。",
     "inputSchema": mcp_schema({
         "page": {"type": "string", "description": "页面标记 id 或 pid；只有一个在线页面时可省略"},
         "since": {"type": "number", "description": "上次返回的 cursor，只取更新的记录"},
         "doc": {"type": "string", "description": "上次返回的 doc；页面导航后 token 变化，会返回 navigated:true 并从头给"},
         "kinds": {"type": "string", "description": "逗号分隔：console / exception / rejection / resource / csp，默认全部"},
         "levels": {"type": "string", "description": "逗号分隔：error / warn / info / log / debug，默认全部"},
         "q": {"type": "string", "description": "文本子串过滤"},
         "limit": {"type": "number", "description": "返回条数上限，默认 50，最大 200"},
         "text_max": {"type": "number", "description": "单条文本/堆栈输出字符上限，默认 600，最大 8192"},
         "wait_ms": {"type": "number", "description": "长轮询等待毫秒，0（默认）立即返回，最大 20000"},
         "clear": {"type": "boolean", "description": "先清空页面日志缓冲区"},
         "redact": {"type": "boolean", "description": "脱敏手机号 / 邮箱 / token 等（默认 true）"}})},
    {"name": "flow",
     "description": "YAML 测试流（schema 见 docs/spec-flow.md）：把页面操作序列编排成 YAML（每步唯一 id），逐步执行并汇总报告（每步 id/操作/值/OK/FAIL/耗时/URL），失败步自动附截图；步骤级 retry/retry_wait_ms 可重试。执行时页面 console 打 [flow:名] 前缀轨迹，可用 page_logs 的 q=\"[flow:\" 拉取。op=list 列出 flows/ 库；op=get {name} 取 YAML 文本；op=save {yaml} 校验并保存为 flows/<flow名>.yaml；op=delete {name}；op=run {name 或 yaml, page?, vars?, from_step?, stop_on_fail?, mode?}：mode=async 立即返回 run_id（长流推荐），默认同步等完（MCP 上限 115s）；op=status {run_id, wait_ms?} 轮询异步运行进度，done 时带完整报告。",
     "inputSchema": mcp_schema({
         "op": {"type": "string", "description": "list / get / save / delete / run / status"},
         "name": {"type": "string", "description": "flow 名（= 文件名，不含 .yaml）"},
         "yaml": {"type": "string", "description": "YAML 文本；save 保存用，run 也可直接传 yaml 免入库"},
         "page": {"type": "string", "description": "页面标记 id 或 pid；只有一个在线页面时可省略"},
         "vars": {"type": "object", "description": "覆盖/补充 ${vars.x} 变量"},
         "from_step": {"type": "string", "description": "从指定步骤 id 开始跑（失败重跑用）"},
         "stop_on_fail": {"type": "boolean", "description": "失败即停，默认 true；步骤级 on_fail: continue 可单独放行"},
         "mode": {"type": "string", "description": "run 模式：sync（默认，等完返回报告）/ async（返回 run_id，用 op=status 轮询）"},
         "run_id": {"type": "string", "description": "status 轮询的异步运行 id"},
         "wait_ms": {"type": "number", "description": "status 长轮询等待毫秒（0 立即返回，上限 60000）"}},
         required=["op"])},
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
        return None, "当前没有页面接入：确认 broker 在跑、Chrome 扩展已装、当前站点在白名单"
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


# ---------------- Flow：YAML 测试流（编排/执行/报告，见 docs/spec-flow.md） ----------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FLOWS_DIR = os.path.join(BASE_DIR, "flows")     # flow 库（真相源，Git 友好）
REPORTS_DIR = os.path.join(BASE_DIR, ".flows")  # 运行报告与失败截图存档

# do 白名单 = 页面端 ACTIONS 剔除 runner 内部用的 ping / snapshot / plog，
# 另有编排动作 flow（子流程：运行库里的另一个 flow，可嵌套 ≤5 层、禁循环引用）
FLOW_DO = {
    "click", "type", "press", "select", "scroll", "hover",
    "nav", "back", "reload", "eval", "cookies", "storage", "upload",
    "wait", "highlight", "dom", "screenshot",
    "tab_list", "tab_open", "tab_close", "tab_activate", "netlog",
    "flow",
}
# 步骤控制键：不作为命令参数下发
FLOW_CTRL = {"id", "do", "desc", "expect", "max_wait_ms", "on_fail", "secret",
             "retry", "retry_wait_ms"}
# 断言键；断言值支持 ${vars.x} / ${env.NAME}
FLOW_EXP_KEYS = {"url_contains", "url_is", "text", "selector"}
FLOW_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
FLOW_VAR_RE = re.compile(r"\$\{(vars|env)\.([A-Za-z0-9_.-]+)\}")


def flow_validate(doc):
    """校验并规整 flow 文档，返回 (doc, 错误信息)；错误时 doc 为 None。"""
    if yaml is None:
        return None, "缺少依赖：pip install pyyaml"
    if not isinstance(doc, dict):
        return None, "flow 文档必须是映射"
    name = doc.get("flow")
    if not isinstance(name, str) or not FLOW_NAME_RE.match(name):
        return None, f"flow 名非法（小写字母/数字/-/_，≤64 字符）：{name!r}"
    steps = doc.get("steps")
    if not isinstance(steps, list) or not steps:
        return None, "steps 必须是非空列表"
    seen = set()
    for i, s in enumerate(steps):
        where = f"steps[{i}]"
        if not isinstance(s, dict):
            return None, f"{where} 必须是映射"
        sid, do = s.get("id"), s.get("do")
        if not isinstance(sid, str) or not sid:
            return None, f"{where} 缺 id（字符串）"
        where = f"步骤 {sid}"
        if sid in seen:
            return None, f"步骤 id 重复：{sid}"
        seen.add(sid)
        if do not in FLOW_DO:
            return None, f"{where}: do「{do}」不在支持列表：{sorted(FLOW_DO)}"
        if do == "flow":
            sub_name = s.get("name")
            if not isinstance(sub_name, str) or not FLOW_NAME_RE.match(sub_name):
                return None, f"{where}: do=flow 需要合法的 name（子流程名，小写字母/数字/-/_）"
            if s.get("vars") is not None and not isinstance(s.get("vars"), dict):
                return None, f"{where}: vars 必须是映射"
        exp = s.get("expect")
        if exp is not None:
            for e in (exp if isinstance(exp, list) else [exp]):
                if not isinstance(e, dict) or not e or not set(e) <= FLOW_EXP_KEYS:
                    return None, f"{where}: expect 只支持 {sorted(FLOW_EXP_KEYS)}（单键映射或其列表）"
        if s.get("on_fail") not in (None, "continue", "abort"):
            return None, f"{where}: on_fail 只支持 continue / abort"
        for k2, hi in (("retry", 10), ("retry_wait_ms", 60000), ("max_wait_ms", 30000)):
            v2 = s.get(k2)
            if v2 is None:
                continue
            if not isinstance(v2, (int, float)) or isinstance(v2, bool) or v2 < 0 or v2 > hi:
                return None, f"{where}: {k2} 必须是 0~{hi} 的数字"
    if doc.get("vars") is not None and not isinstance(doc.get("vars"), dict):
        return None, "vars 必须是映射"
    # 数据驱动：data 内联列表 或 data_file（.json 数组 / .csv 首行表头），二选一；
    # data_file 相对 flows/ 目录解析，校验时即归一化为 doc["data"]（原文本保存不受影响）
    data, data_file = doc.get("data"), doc.get("data_file")
    if data is not None and data_file is not None:
        return None, "data 与 data_file 二选一"
    if data_file is not None:
        if not isinstance(data_file, str) or not data_file:
            return None, "data_file 必须是文件路径字符串"
        p = data_file if os.path.isabs(data_file) else os.path.join(FLOWS_DIR, data_file)
        if not os.path.isfile(p):
            return None, f"data_file 不存在：{p}（相对路径按 flows/ 目录解析）"
        try:
            if p.lower().endswith(".csv"):
                with open(p, encoding="utf-8-sig", newline="") as f:
                    rows = [{k: v for k, v in r.items() if k is not None} for r in csv.DictReader(f)]
            else:
                with open(p, encoding="utf-8") as f:
                    rows = json.load(f)
        except Exception as e:
            return None, f"data_file 解析失败：{e}"
        data = rows
    if data is not None:
        if not isinstance(data, list) or not data:
            return None, "data 必须是非空列表（每项一组变量映射）"
        if len(data) > 200:
            return None, "data 最多 200 组"
        for i, row in enumerate(data):
            if not isinstance(row, dict):
                return None, f"data[{i}] 必须是映射"
            for k, v in row.items():
                if not isinstance(v, (str, int, float, bool)):
                    return None, f"data[{i}].{k} 必须是标量（字符串/数字/布尔）"
        doc["data"] = data
    return doc, ""


def flow_sub(v, variables, where):
    """递归展开 ${vars.x} / ${env.NAME}；未定义的变量直接报错（fail fast）。"""
    if isinstance(v, str):
        def rep(m):
            src, key = m.group(1), m.group(2)
            if src == "env":
                val = os.environ.get(key)
                if val is None:
                    raise ValueError(f"{where}: 环境变量 {key} 未设置")
                return val
            if key not in variables:
                raise ValueError(f"{where}: 未定义变量 vars.{key}（写在 flow 的 vars 里或运行参数传入）")
            return str(variables[key])
        return FLOW_VAR_RE.sub(rep, v)
    if isinstance(v, dict):
        return {k: flow_sub(x, variables, where) for k, x in v.items()}
    if isinstance(v, list):
        return [flow_sub(x, variables, where) for x in v]
    return v


def flow_brief(step, secret):
    """步骤参数摘要（console 轨迹与报告用；secret 时 text/value/code 打码）。"""
    parts = []
    for k in ("bid", "selector", "text", "url", "value", "key", "dy", "ms",
              "code", "op", "area", "name", "tag", "active"):
        v = step.get(k)
        if v in (None, ""):
            continue
        v = str(v)
        if secret and k in ("text", "value", "code"):
            v = "***"
        elif len(v) > 80:
            v = v[:80] + "…"
        parts.append(f"{k}={v}")
    return " ".join(parts)


def flow_path(name):
    if not isinstance(name, str) or not FLOW_NAME_RE.match(name):
        return None
    return os.path.join(FLOWS_DIR, name + ".yaml")


def flow_list():
    if not os.path.isdir(FLOWS_DIR):
        return []
    out = []
    for fn in sorted(os.listdir(FLOWS_DIR)):
        if not fn.endswith(".yaml"):
            continue
        p = os.path.join(FLOWS_DIR, fn)
        meta = {"name": fn[:-5], "mtime": int(os.path.getmtime(p))}
        try:
            with open(p, encoding="utf-8") as f:
                doc = yaml.safe_load(f)
            meta["desc"] = doc.get("desc")
            meta["steps"] = len(doc.get("steps") or [])
        except Exception:
            meta["broken"] = True
        out.append(meta)
    return out


def flow_read(name):
    p = flow_path(name)
    if not p or not os.path.isfile(p):
        return None, f"flow 不存在：{name}（用 op=list 查看）"
    with open(p, encoding="utf-8") as f:
        return f.read(), ""


def flow_write(doc, text):
    os.makedirs(FLOWS_DIR, exist_ok=True)
    p = flow_path(doc["flow"])
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(text if text.endswith("\n") else text + "\n")
    return p, ""


def flow_doc_from(body):
    """从 {name|yaml} 取 flow 文档并校验，返回 (doc, 错误)。"""
    text = body.get("yaml")
    if text:
        try:
            doc = yaml.safe_load(text)
        except Exception as e:
            return None, f"YAML 解析失败：{e}"
    elif body.get("name"):
        text, err = flow_read(body["name"])
        if err:
            return None, err
        try:
            doc = yaml.safe_load(text)
        except Exception as e:
            return None, f"flow 库文件解析失败（{body['name']}）：{e}"
    else:
        return None, "需要 name 或 yaml 之一"
    return flow_validate(doc)


async def flow_ping(page):
    try:
        res = await call_page(page, {"action": "ping"}, 10)
        return res.get("data") or {}
    except (asyncio.TimeoutError, RuntimeError):
        return {}


async def flow_echo(page, prefix, text, level="log"):
    """每步轨迹：broker 控制台 + 页面 console（MAIN world 代打，plog 可查）。"""
    print(text)
    try:
        await call_page(page, {"action": "log", "prefix": prefix, "text": text, "level": level}, 5)
    except Exception:
        pass  # 回显失败不影响执行


async def flow_expect(page, exps, max_wait_ms):
    """断言轮询：全部条件同时满足才过；超时返回 (False, 原因)。"""
    deadline = time.monotonic() + min(max(float(max_wait_ms), 0), 30000) / 1000.0
    while True:
        ok_all, last_err, url = True, "", None
        for e in exps:
            key, want = next(iter(e.items()))
            want = str(want)
            if key in ("url_contains", "url_is"):
                if url is None:
                    url = (await flow_ping(page)).get("url") or ""
                if (url == want) if key == "url_is" else (want not in url):
                    ok_all, last_err = False, f"{key}: 期望「{want}」实际「{url}」"
            elif key == "text":
                res = await call_page(page, {"action": "snapshot", "max": 1, "text_max": 20000}, 15)
                got = (res.get("data") or {}).get("text") or ""
                if want not in got:
                    ok_all, last_err = False, f"text: 页面正文未包含「{want}」"
            else:  # selector
                res = await call_page(page, {"action": "dom", "selector": want,
                                             "maxNodes": 1, "maxChars": 1000}, 15)
                if not res.get("ok"):
                    ok_all, last_err = False, f"selector: {res.get('error') or ('不存在 ' + want)}"
        if ok_all:
            return True, ""
        if time.monotonic() >= deadline:
            return False, last_err + f"（等待 {max_wait_ms}ms 超时）"
        await asyncio.sleep(0.3)


FLOW_RUNS = {}  # run_id -> {flow,status,started,finished,steps_total,done,passed,failed,report,task}


async def flow_run(page, doc, variables=None, from_step=None, stop_on_fail=True, run_id=None, _chain=()):
    """执行一个 flow，返回报告 dict（同时落盘 .flows/）。

    run_id 给定时（异步模式）把实时进度写进 FLOW_RUNS[run_id]，供 op=status 轮询。
    _chain 为子流程调用链（祖先 flow 名元组），用于禁循环引用与限深。
    """
    name = doc["flow"]
    prefix = f"[flow:{name}]"
    run_id = run_id or (time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4])
    vars_all = {**(doc.get("vars") or {}), **(variables or {})}
    steps = doc["steps"]
    if from_step:
        idx = next((i for i, s in enumerate(steps) if s.get("id") == from_step), None)
        if idx is None:
            return {"ok": False, "error": f"from_step 不存在：{from_step}"}
        steps = steps[idx:]
    os.makedirs(REPORTS_DIR, exist_ok=True)
    rows = doc.get("data")
    n_rows = len(rows) if rows else 1
    results, row_summaries = [], None
    ok_all = True
    await flow_echo(page, prefix,
                    f"{prefix} ▶ {name} 开始执行（{len(steps)} 步" +
                    (f" × {n_rows} 组数据）" if rows else "）"))

    async def run_once(row_vars, row_no):
        """跑一遍全部步骤；results 为跨数据组共享的扁平列表（每组条目带 row 标记）。"""
        ok2 = True
        if row_no is not None:
            await flow_echo(page, prefix, f"{prefix} ▶ 数据组 {row_no}/{n_rows}")
        for s in steps:
            sid, do, secret = s.get("id"), s.get("do"), bool(s.get("secret"))
            where = f"步骤 {sid}" + (f"（数据组 {row_no}）" if row_no else "")
            t0 = time.monotonic()
            entry = {"id": sid, "do": do, "params": flow_brief(s, secret), "ok": False}
            if row_no is not None:
                entry["row"] = row_no
            try:  # 变量展开错误不重试，直接失败
                cmd = {"action": do, **flow_sub({k: v for k, v in s.items() if k not in FLOW_CTRL},
                                                row_vars, where)}
                exps = None
                if s.get("expect") is not None:
                    exps = flow_sub(s["expect"], row_vars, where)
                    exps = exps if isinstance(exps, list) else [exps]
            except (ValueError, TypeError) as e:
                cmd = exps = None
                entry["error"] = str(e)
            if cmd is not None:
                attempts = 1 + min(max(int(s.get("retry") or 0), 0), 10)
                rwait = max(int(s.get("retry_wait_ms") or 1000), 0) / 1000.0
                for att in range(attempts):
                    try:
                        if do == "flow":  # 子流程：从库加载 → 校验 → 递归执行（同一目标页）
                            sub_name = cmd.get("name")
                            chain = _chain + (name,)
                            if sub_name in chain:
                                raise ValueError(f"flow 循环引用：{' → '.join(chain + (sub_name,))}")
                            if len(chain) > 5:
                                raise ValueError(f"flow 嵌套超过 5 层：{' → '.join(chain)}")
                            sub_text, sub_err = flow_read(sub_name)
                            if sub_err:
                                raise ValueError(f"子流程加载失败：{sub_err}")
                            try:
                                sub_doc = yaml.safe_load(sub_text)
                            except Exception as e:
                                raise ValueError(f"子流程 YAML 解析失败（{sub_name}）：{e}")
                            sub_doc, sub_err = flow_validate(sub_doc)
                            if sub_err:
                                raise ValueError(f"子流程无效（{sub_name}）：{sub_err}")
                            child_vars = {**(sub_doc.get("vars") or {}), **(cmd.get("vars") or {})}
                            sub_rep = await flow_run(page, sub_doc, variables=child_vars,
                                                     stop_on_fail=True, _chain=chain)
                            entry["passed"] = sub_rep["passed"]
                            entry["failed"] = sub_rep["failed"]
                            entry["total"] = sub_rep["total"]
                            entry["steps"] = sub_rep["steps"]
                            if not sub_rep["ok"]:
                                raise ValueError(f"子流程 {sub_name} 有 {sub_rep['failed']} 步失败")
                        else:
                            res = await call_page(page, cmd, 30)
                            if not res.get("ok"):
                                raise ValueError(res.get("error") or "命令失败")
                            data = res.get("data")
                            # 截图步：base64 落盘换路径（同 page_call 的处理）
                            if isinstance(data, dict) and isinstance(data.get("dataUrl"), str):
                                p = save_dataurl(data["dataUrl"], tag=name)
                                data = {k: v for k, v in data.items() if k != "dataUrl"}
                                if p:
                                    entry["path"] = p
                            if do in ("nav", "back", "reload"):
                                await asyncio.sleep(0.5)  # 导航类动作后固定缓冲；真正等待就绪用 expect
                        if exps:
                            exp_ok, exp_err = await flow_expect(page, exps, s.get("max_wait_ms", 5000))
                            entry["expect"] = {"ok": exp_ok, "error": exp_err or None}
                            if not exp_ok:
                                raise ValueError(exp_err)
                        entry["url"] = ((await flow_ping(page)).get("url") or "")[:300]
                        entry["ok"] = True
                        entry.pop("error", None)  # 前几次尝试失败、本次成功时清掉残留错误
                        break
                    except (ValueError, asyncio.TimeoutError, RuntimeError) as e:
                        entry["error"] = str(e) or type(e).__name__
                        if att < attempts - 1:
                            await flow_echo(page, prefix,
                                            f"{prefix} {sid} {do} 第 {att + 1}/{attempts} 次尝试失败：{entry['error']}"
                                            f"（{int(rwait * 1000)}ms 后重试）", level="warn")
                            await asyncio.sleep(rwait)
            if not entry["ok"]:
                try:  # 最终失败自动截图（尽力而为）
                    res = await call_page(page, {"action": "screenshot"}, 20)
                    p = save_dataurl((res.get("data") or {}).get("dataUrl"),
                                     tag=f"{name}-{sid}-fail") if res.get("ok") else None
                    if p:
                        entry["path"] = p
                except Exception:
                    pass
            entry["ms"] = round((time.monotonic() - t0) * 1000)
            status = "OK" if entry["ok"] else f"FAIL: {entry.get('error', '')}"
            if do == "flow":
                status += f"（{entry.get('passed', 0)}/{entry.get('total', 0)}）"
            await flow_echo(page, prefix,
                            f"{prefix} {sid} {do} {entry['params'] or '-'} → {status} {entry['ms']}ms",
                            level="log" if entry["ok"] else "error")
            results.append(entry)
            if run_id in FLOW_RUNS:  # 异步模式：实时进度
                ent = FLOW_RUNS[run_id]
                ent["done"] = len(results)
                ent["passed"] = sum(1 for r in results if r["ok"])
                ent["failed"] = sum(1 for r in results if not r["ok"])
            if not entry["ok"]:
                ok2 = False
                if stop_on_fail and s.get("on_fail") != "continue":
                    break
        return ok2

    if rows:
        row_summaries = []
        for i, row in enumerate(rows, 1):
            mark = len(results)
            ok_i = await run_once({**vars_all, **row}, i)
            seg = results[mark:]
            row_summaries.append({"row": i, "ok": ok_i,
                                  "passed": sum(1 for r in seg if r["ok"]),
                                  "failed": sum(1 for r in seg if not r["ok"])})
            ok_all = ok_all and ok_i
    else:
        ok_all = await run_once(vars_all, None)

    report = {"flow": name, "run": run_id, "ok": ok_all,
              "total": len(results), "passed": sum(1 for r in results if r["ok"]),
              "failed": sum(1 for r in results if not r["ok"]), "steps": results}
    if rows:
        report["data_rows"] = len(rows)
        report["passed_rows"] = sum(1 for r in row_summaries if r["ok"])
        report["failed_rows"] = len(rows) - report["passed_rows"]
        report["rows"] = row_summaries
    try:
        report["report_path"] = os.path.join(REPORTS_DIR, f"{name}-{run_id}.json")
        with open(report["report_path"], "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
    except OSError:
        report.pop("report_path", None)
    tail = f"{prefix} ■ 执行结束：通过 {report['passed']}/{report['total']}"
    if rows:
        tail += f"，数据组 {report['passed_rows']}/{report['data_rows']}"
    await flow_echo(page, prefix, tail, level="log" if ok_all else "error")
    return report


def flow_start_async(page, doc, variables=None, from_step=None, stop_on_fail=True):
    """异步启动一次 flow 执行（asyncio 后台任务），立即返回 run_id；op=status / GET /flows/status 轮询。"""
    rid = "r" + uuid.uuid4().hex[:10]
    n_steps = len(doc["steps"]) * max(len(doc.get("data") or [1]), 1)  # 数据驱动时进度按 步×组 计
    FLOW_RUNS[rid] = {"flow": doc["flow"], "status": "running", "started": time.time(),
                      "finished": None, "steps_total": n_steps, "done": 0,
                      "passed": 0, "failed": 0, "report": None, "task": None}

    async def _bg():
        try:
            rep = await flow_run(page, doc, variables, from_step, stop_on_fail, run_id=rid)
        except Exception as e:  # 防御：runner 本身不应抛，兜底不挂死轮询方
            rep = {"ok": False, "error": str(e) or type(e).__name__}
        ent = FLOW_RUNS.get(rid)
        if ent is not None:
            ent["status"], ent["finished"], ent["report"] = "done", time.time(), rep
            ent["task"] = None
    FLOW_RUNS[rid]["task"] = asyncio.create_task(_bg())
    return {"run_id": rid, "status": "running", "steps_total": n_steps,
            "poll": f'flow {{"op":"status", "run_id":"{rid}"}}'}


async def flow_status(rid, wait_ms=0):
    """查询异步运行状态；wait_ms>0 时长轮询直到 done 或超时。返回 (out, 存在)。"""
    ent = FLOW_RUNS.get(rid)
    if not ent:
        return None, False
    deadline = time.monotonic() + min(max(float(wait_ms), 0), 60000) / 1000.0
    while ent.get("status") != "done" and time.monotonic() < deadline:
        await asyncio.sleep(0.3)
        ent = FLOW_RUNS.get(rid) or {}
    out = {k: ent.get(k) for k in ("flow", "status", "steps_total", "done", "passed", "failed")}
    if ent.get("status") == "done":
        out["report"] = ent.get("report")
    return out, True


async def flow_mcp(args):
    """MCP 工具 flow 的执行体，返回 (文本, 是否错误)。"""
    if yaml is None:
        return "缺少依赖：pip install pyyaml（flow 功能需要）", True
    op = args.get("op")
    if op == "list":
        return mcp_text(flow_list()), False
    if op == "get":
        text, err = flow_read(args.get("name"))
        return (text, False) if not err else (err, True)
    if op == "save":
        text = args.get("yaml") or ""
        try:
            doc = yaml.safe_load(text)
        except Exception as e:
            return f"YAML 解析失败：{e}", True
        doc, err = flow_validate(doc)
        if err:
            return f"校验失败：{err}", True
        p, err = flow_write(doc, text)
        if err:
            return err, True
        return f"已保存 {p}（{len(doc['steps'])} 步）", False
    if op == "delete":
        p = flow_path(args.get("name"))
        if not p or not os.path.isfile(p):
            return f"flow 不存在：{args.get('name')}", True
        os.remove(p)
        return f"已删除 {p}", False
    if op == "run":
        doc, err = flow_doc_from(args)
        if err:
            return err, True
        page, err = resolve_page(args.get("page"))
        if err:
            return err, True
        if args.get("mode") == "async":
            # 异步：后台任务执行，立即返回 run_id；op=status 轮询进度与报告
            return mcp_text(flow_start_async(page, doc, args.get("vars"), args.get("from_step"),
                                             bool(args.get("stop_on_fail", True)))), False
        report = await flow_run(page, doc, args.get("vars"), args.get("from_step"),
                                bool(args.get("stop_on_fail", True)))
        return mcp_text(report), not report.get("ok")
    if op == "status":
        rid = args.get("run_id") or ""
        out, ok = await flow_status(rid, args.get("wait_ms"))
        if not ok:
            return f"run_id 不存在：{rid}（异步运行记录只在 broker 内存里，done 超 1h 清理）", True
        return mcp_text(out), False
    return f"未知 op：{op}（list / get / save / delete / run / status）", True


async def mcp_tool(name, args):
    """执行一个 MCP 工具，返回 (文本, 是否错误)。"""
    args = args if isinstance(args, dict) else {}
    if name == "list_pages":
        return mcp_text([public(p) for p in PAGES.values()]), False
    if name == "list_marks":
        return mcp_text(marks_list()), False
    if name == "page_logs":
        page, err = resolve_page(args.get("page"))
        if err:
            return err, True
        cmd = {"action": "plog"}
        for k in ("since", "doc", "kinds", "levels", "q", "limit", "text_max", "wait_ms", "clear", "redact"):
            if args.get(k) is not None:
                cmd[k] = args[k]
        try:
            wait_ms = min(max(float(args.get("wait_ms") or 0), 0), 20000)
            res = await call_page(page, cmd, min(30 + wait_ms / 1000.0, 120))
        except asyncio.TimeoutError:
            return "页面响应超时（日志查询）", True
        except (RuntimeError, TypeError, ValueError) as e:
            return "日志查询下发失败：" + str(e), True
        out = {"ok": bool(res.get("ok")), "data": res.get("data"), "error": res.get("error")}
        return mcp_text(out), not out["ok"]
    if name == "flow":
        return await flow_mcp(args)
    if name not in ("page_snapshot", "page_call"):
        return "未知工具：" + str(name), True
    page, err = resolve_page(args.get("page"))
    if err:
        return err, True
    if name == "page_snapshot":
        cmd = {"action": "snapshot"}
        for k in ("max", "text_max"):
            if args.get(k) is not None:
                cmd[k] = args[k]
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
    data = res.get("data")
    # 截图：base64 落盘换路径，避免大输出被 MCP 客户端截断（失败时原样返回 dataUrl）
    if isinstance(data, dict) and isinstance(data.get("dataUrl"), str):
        path = save_dataurl(data["dataUrl"], tag=page["id"])
        if path:
            data = {k: v for k, v in data.items() if k != "dataUrl"}
            data["path"] = path
            data["bytes"] = os.path.getsize(path)
            res = {**res, "data": data}
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
            "instructions": "page-bridge：先 list_pages 发现页面，再用 page_snapshot 看快照、page_call 下发命令。排查前端异常/白屏/点击无反应：先 page_logs 取基线（记下 doc+cursor），执行操作后带 since+doc 与 wait_ms 再取增量；不需要日志时不要调用。测试流：flow 工具可保存/执行 YAML 编排的页面操作序列（每步唯一 id，报告含每步成功失败与截图），页面 console 有 [flow:名] 前缀轨迹可用 page_logs 的 q=\"[flow:\" 拉取。"}}
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
        # flow 异步运行记录：done 超 1h 清理；总量超 50 时清最旧（防内存无限涨）
        if FLOW_RUNS:
            for rid, ent in list(FLOW_RUNS.items()):
                if ent.get("status") == "done" and ent.get("finished") and now - ent["finished"] > 3600:
                    FLOW_RUNS.pop(rid, None)
            while len(FLOW_RUNS) > 50:
                FLOW_RUNS.pop(min(FLOW_RUNS, key=lambda r: FLOW_RUNS[r].get("started", 0)), None)


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
        web.get("/flows", h_flows),
        web.post("/flows/run", h_flow_run),
        web.get("/flows/status", h_flow_status),
        web.get("/flow/{name}", h_flow_get),
        web.put("/flow/{name}", h_flow_save),
        web.delete("/flow/{name}", h_flow_delete),
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
