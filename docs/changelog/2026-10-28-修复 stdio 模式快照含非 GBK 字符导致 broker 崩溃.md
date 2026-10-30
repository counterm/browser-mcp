# 2026-10-28 · 修复 stdio 模式快照含非 GBK 字符导致 broker 崩溃

- 现象：IDE 以 stdio 拉起 broker 后，`list_pages` 正常，但 `page_snapshot` 一旦返回含 emoji 等非 GBK 字符的快照，MCP 连接立即 `Connection closed`，此后所有工具报 `Tool not found`，进程消失、8766 端口只剩 TIME_WAIT
- 原因：stdio 写回沿用 Windows 管道的默认 GBK 编码，`json.dumps(ensure_ascii=False)` 的结果遇不可编码字符时抛 `UnicodeEncodeError`，`mcp_stdio_loop` 没有兜底，异常直接终结进程（同时工具描述里的中文也因此显示为乱码）
- 修复：`main()` 进入 stdio 模式时对专用输出流 `reconfigure(encoding="utf-8", errors="replace", newline="\n")`，与 MCP stdio 协议的 UTF-8 约定对齐
- 验证：脚本按 IDE 方式（stdio + UTF-8）拉起 `broker.py --stdio`，对「工作台 - 密评备案信息系统」做 `page_snapshot`，返回 3148 字节 UTF-8 内容、中文标题正常、进程存活
