# 2026-10-28 · 文档：README 以 MCP 为主线重组，扩展安装措辞对齐 Chrome 实际按钮

- README（中英同步）把 broker 明确定位为 **MCP 服务器**：简介与架构图改为「MCP 客户端（IDE / Agent / CLI）」视角，「MCP 接入」升为推荐接入章节并前移，stdio 自动拉起标为推荐方式，配置示例直接引用仓库根目录的 `.mcp.json`（本机生效）与 `.mcp.example.json`（可复制模板），补充 Trae / Claude Desktop 等客户端配置位置说明
- 原「外部怎么接入」章节清理为「HTTP API（不走 MCP 的直接接入）」：定位为 MCP 工具的底层接口，端点表中 `/mcp`、`/sse` 两行并入 MCP 传输表，不再重复
- 文件说明表补 `.mcp.json` / `.mcp.example.json` 两行；快速开始步骤 1 注明「只用 MCP stdio 时可跳过手动启动 broker」
- 扩展安装措辞对齐 Chrome 实际按钮：统一为「**加载未打包的扩展程序**」（Load unpacked）并强调选择本仓库的 `chrome-extension` 目录，替换原「加载已解压的扩展程序」表述
