import type { Plugin } from "vite";

import { createLiveApi } from "./liveApi";
import { createLookupApi } from "./lookupApi";
import { createProjectsApi } from "./projectsApi";

/**
 * 도면 공유 API 와 기준정보 조회 API 를 개발 서버와 미리보기 서버에 붙이는 Vite 플러그인.
 *
 * 앱 라우트가 아니라 미들웨어로 두는 이유는 저장 폴더가 로컬 파일 시스템이기
 * 때문이다. 앱은 Cloudflare Worker 로도 도는데 거기에는 파일 시스템이 없다.
 * 기준정보 조회(`/api/lookup`)도 같은 폴더의 설정과 SQL 드라이버를 쓰므로 여기 함께 둔다.
 */
export function gridProjectsApi(dir?: string): Plugin {
  const handler = createProjectsApi(dir);
  let lookup: ReturnType<typeof createLookupApi> | null = null;
  const lookupHandler = () => (lookup ??= createLookupApi(dir)).middleware;
  let live: ReturnType<typeof createLiveApi> | null = null;
  const liveHandler = () => (live ??= createLiveApi(dir)).middleware;

  return {
    name: "grid-projects-api",
    // 앱 라우터(catch-all)보다 먼저 잡아야 한다. 뒤로 밀리면 앱의 404 HTML 이
    // 돌아가고, 그것을 JSON 으로 읽으려다 터진다.
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(handler);
      server.middlewares.use(lookupHandler());
      server.middlewares.use(liveHandler());
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
      server.middlewares.use(lookupHandler());
      server.middlewares.use(liveHandler());
    },
  };
}
