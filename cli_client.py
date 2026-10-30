"""外部 CLI/IDE 接入示例：发现 -> 校验 URL -> 接入 -> 操控。

零第三方依赖（纯标准库）。

用法:
  python cli_client.py list                       # 发现当前在线页面
  python cli_client.py watch                      # 订阅广播（page_up/down 事件流）
  python cli_client.py snap <pid或URL子串>         # 看某页快照
  python cli_client.py call <pid> <JSON命令>       # 单条命令
  python cli_client.py run "任务描述" --match github.com   # LLM 自动操控（需环境变量）
  python cli_client.py flow <flow.yaml> [--page 标记]      # 跑 YAML 测试流（CI 入口）
       [--var k=v ...] [--from-step s03] [--keep-going]     # 详见 docs/spec-flow.md
       环境变量: OPENAI_API_KEY / OPENAI_BASE_URL(可选) / BRIDGE_MODEL(可选)
"""
import argparse
import json
import os
import re
import sys
import urllib.request

BASE = os.environ.get("BRIDGE_URL", "http://127.0.0.1:8766")

SYSTEM_PROMPT = """你通过 JSON 指令操控一个浏览器页面。每次只输出一个 JSON 对象，格式:
{"action":"..."}
可用 action:
  snapshot                        获取页面状态（交互元素带 [bid] 编号 + 正文）
  click {"bid":3}                 点击（bid 也可用 CSS selector）
  type {"bid":5,"text":"..."}     输入（自动触发 React/Vue 事件）
  press {"key":"Enter"}           按键
  select {"bid":7,"value":"..."}  下拉选择
  scroll {"dy":600} | {"bid":3}   滚动
  nav {"url":"..."} / back / reload
  eval {"code":"..."}             页面内执行任意 JS（可 async）
  cookies {"op":"get"} | storage {"key":"..."} | wait {"ms":1000}
  netlog {"op":"list"|"get"|"curl"|"clear","q"?,"id"?,"redact"?,"max"?}
                                  查询页面捕获的接口记录（URL/请求体/响应/鉴权头）。
                                  list 先拿摘要（不含 body），get {"id":N} 再取完整记录；
                                  curl {"id":N} 返回可回放的 cURL；redact 默认脱敏鉴权字段，
                                  仅在用户明确要求真实值时置 false
  done {"summary":"..."}          任务完成
规则: 先 snapshot 了解页面，用 [bid] 编号定位元素；页面 text 是正文参考；
一步步操作，每步之间不需要等待；完成后输出 done。"""


def http(method, path, body=None, timeout=60):
    req = urllib.request.Request(
        BASE + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None


def list_pages():
    return http("GET", "/pages")


def find_page(query):
    """按 pid 或 URL 子串/正则查找页面，即『检查其网址是否适合』的一步。"""
    if not query:
        return None
    pages = list_pages()
    for p in pages:
        if p["id"] == query or re.search(query, p["url"]):
            return p
    return None


def call(pid, cmd, timeout=30):
    return http("POST", f"/call/{pid}?timeout={timeout}", body=cmd)


def watch():
    with urllib.request.urlopen(BASE + "/events", timeout=None) as r:
        print("[watch] 订阅广播中，Ctrl+C 退出")
        for line in r:
            if line.startswith(b"data: "):
                print(json.dumps(json.loads(line[6:]), ensure_ascii=False))


def llm(messages):
    base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    body = {
        "model": os.environ.get("BRIDGE_MODEL", "gpt-4o-mini"),
        "messages": messages,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        base + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        content = json.loads(r.read())["choices"][0]["message"]["content"]
    return json.loads(re.search(r"\{[\s\S]*\}", content).group(0))


def run(task, match=None, max_steps=25, wait_secs=60):
    """发现 -> 等 URL 匹配的页面上线 -> 接入 -> LLM 驱动循环。"""
    page = None
    waited = 0
    while page is None:
        page = find_page(match)
        if page:
            break
        if waited >= wait_secs:
            print(f"[run] {wait_secs}s 内未发现匹配页面 (match={match})")
            return 1
        print(f"[run] 等待匹配页面上线... ({waited}s)")
        waited += 5
        import time
        time.sleep(5)

    print(f"[run] 接入页面: {page['id']}  {page['url']}")
    history = [{"role": "system", "content": SYSTEM_PROMPT},
               {"role": "user", "content": f"任务: {task}\n\n请先 snapshot。"}]

    for step in range(max_steps):
        cmd = llm(history)
        if cmd.get("action") == "done":
            print(f"[run] 完成: {cmd.get('summary')}")
            return 0
        res = call(page["id"], cmd, timeout=60)
        print(f"[run] step{step} {json.dumps(cmd, ensure_ascii=False)} -> "
              f"{'ok' if res.get('ok') else res.get('error')}")
        feedback = json.dumps(res, ensure_ascii=False)[:6000]
        history += [{"role": "assistant", "content": json.dumps(cmd)},
                    {"role": "user", "content": f"执行结果: {feedback}\n请决定下一步。"}]
    print("[run] 步数上限")
    return 1


def flow(path, page=None, vars_list=None, from_step=None, keep_going=False):
    """跑 YAML 测试流：读文件 → POST /flows/run → 逐步打印 → 退出码 0/1（CI 用）。"""
    try:
        with open(path, encoding="utf-8") as f:
            yaml_text = f.read()
    except OSError as e:
        print(f"[flow] 读不到文件：{e}")
        return 2
    variables = {}
    for kv in vars_list or []:
        k, _, v = kv.partition("=")
        variables[k.strip()] = v
    body = {"yaml": yaml_text, "page": page,
            "vars": variables or None, "from_step": from_step,
            "stop_on_fail": not keep_going}
    try:
        report = http("POST", "/flows/run", body=body, timeout=900)
    except Exception as e:
        print(f"[flow] 执行失败：{e}（broker 在跑吗？）")
        return 2
    if report.get("error"):
        print(f"[flow] {report['error']}")
        return 2
    for s in report.get("steps", []):
        line = ("OK  " if s.get("ok") else "FAIL") + f" {s.get('id')} {s.get('do')}"
        if s.get("params"):
            line += f"  {s['params']}"
        if not s.get("ok"):
            line += f"\n     └─ {s.get('error')}"
        if s.get("path"):
            line += f"\n     └─ 截图: {s['path']}"
        print(line)
    print(f"[flow] {report.get('flow')}: 通过 {report.get('passed')}/{report.get('total')}"
          + ("" if report.get("ok") else "（有失败）"))
    if report.get("data_rows"):
        print(f"[flow] 数据组：{report.get('passed_rows')}/{report.get('data_rows')} 组通过")
    if report.get("report_path"):
        print(f"[flow] 报告: {report['report_path']}")
    return 0 if report.get("ok") else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sub.add_parser("watch")
    p_snap = sub.add_parser("snap"); p_snap.add_argument("page")
    p_call = sub.add_parser("call"); p_call.add_argument("page"); p_call.add_argument("json_cmd")
    p_run = sub.add_parser("run")
    p_run.add_argument("task")
    p_run.add_argument("--match", default=None, help="URL 子串/正则，用于校验是否接入")
    p_run.add_argument("--max-steps", type=int, default=25)
    p_flow = sub.add_parser("flow")
    p_flow.add_argument("path", help="flow YAML 文件路径")
    p_flow.add_argument("--page", default=None, help="页面标记 id 或 pid（只有一个在线页面时可省略）")
    p_flow.add_argument("--var", action="append", default=[], metavar="K=V", help="覆盖 ${vars.x}，可多次")
    p_flow.add_argument("--from-step", dest="from_step", default=None, help="从指定步骤 id 开始跑")
    p_flow.add_argument("--keep-going", action="store_true", help="失败不中断（步骤级 on_fail 仍生效）")
    args = ap.parse_args()

    if args.cmd == "list":
        for p in list_pages():
            em = p.get("eval_mode", "?")
            mark = {"userscript": "eval✓", "fallback": "eval~csp"}.get(em, f"eval?{em}")
            print(f"{p['id']}  [{p['mode']}]  ({mark})  {p['url']}  | {p.get('title','')}  ({p['ago']}s)")
    elif args.cmd == "watch":
        watch()
    elif args.cmd == "snap":
        page = find_page(args.page) or ({} if not list_pages() else sys.exit("page not found"))
        res = call(page["id"], {"action": "snapshot"})
        print(res.get("data") or res)
    elif args.cmd == "call":
        page = find_page(args.page) or sys.exit("page not found")
        print(json.dumps(call(page["id"], json.loads(args.json_cmd)), ensure_ascii=False, indent=2))
    elif args.cmd == "run":
        sys.exit(run(args.task, args.match, args.max_steps))
    elif args.cmd == "flow":
        sys.exit(flow(args.path, args.page, args.var, args.from_step, args.keep_going))


if __name__ == "__main__":
    main()
