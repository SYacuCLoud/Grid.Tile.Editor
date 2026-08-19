import type { Plugin } from "vite";

import { createProjectsApi } from "./projectsApi";

/**
 * 도면 공유 API 를 개발 서버와 미리보기 서버에 붙이는 Vite 플러그인.
 *
 * 앱 라우트가 아니라 미들웨어로 두는 이유는 저장 폴더가 로컬 파일 시스템이기
 * 때문이다. 앱은 Cloudflare Worker 로도 도는데 거기에는 파일 시스템이 없다.
 */
export function gridProjectsApi(dir?: string): Plugin {
  const handler = createProjectsApi(dir);

  return {
    name: "grid-projects-api",
    // 앱 라우터(catch-all)보다 먼저 잡아야 한다. 뒤로 밀리면 앱의 404 HTML 이
    // 돌아가고, 그것을 JSON 으로 읽으려다 터진다.
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
