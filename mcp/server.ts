#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createStore } from "./store";
import { TOOLS } from "./tools/index";

/**
 * Grid Tile Editor MCP 서버 (stdio).
 *
 * 프로젝트는 `GRID_TILE_DATA_DIR`(기본 `./.grid-projects`) 아래 JSON 파일로 저장되며,
 * 그 파일은 편집기의 `JSON 불러오기` 로 그대로 열 수 있다.
 */
export function createGridMcpServer(dataDir?: string): McpServer {
  const store = createStore(dataDir);
  const server = new McpServer(
    { name: "grid-tile-editor", version: "0.1.0" },
    { instructions: `격자 배치도를 만들고 고친다. 프로젝트 파일 저장 위치: ${store.dir}` },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      async (args: unknown) => {
        try {
          const result = await tool.handler(args, store);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { isError: true, content: [{ type: "text" as const, text: message }] };
        }
      },
    );
  }

  return server;
}

async function main() {
  const dirArg = process.argv.indexOf("--dir");
  const dataDir = dirArg >= 0 ? process.argv[dirArg + 1] : undefined;
  const server = createGridMcpServer(dataDir);
  await server.connect(new StdioServerTransport());
}

// 직접 실행했을 때만 stdio 로 붙는다. 테스트에서 import 할 때는 붙지 않는다.
if (process.argv[1] && /mcp[\\/]server\.(ts|js)$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
