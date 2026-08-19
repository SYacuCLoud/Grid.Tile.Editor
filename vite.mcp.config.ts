import { defineConfig } from "vite";

/**
 * MCP 서버 전용 빌드.
 *
 * 앱 빌드(`vite.config.ts`)와 분리한다. Cloudflare · RSC 플러그인은 브라우저를
 * 전제로 하는데, MCP 서버는 Node 에서 stdio 로만 돈다.
 * 의존성은 그대로 두고(`ssr: true`) 소스만 한 파일로 묶는다.
 */
export default defineConfig({
  // 웹 앱의 public/ 자산은 MCP 번들과 상관없다.
  publicDir: false,
  build: {
    ssr: "mcp/server.ts",
    target: "node22",
    outDir: "dist-mcp",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: { entryFileNames: "server.js", format: "es" },
    },
  },
});
