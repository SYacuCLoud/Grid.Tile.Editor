/**
 * `/api/projects` App Router 라우트.
 *
 * 원래 이 API 는 Vite 개발 서버 미들웨어가 맡는다. 하지만 개발 서버가 오래
 * 켜져 있다가 설정이 바뀌면 그 미들웨어가 빠진 채로 남는 일이 있고, 그때
 * 요청이 여기까지 흘러온다. 그래서 **여기서도 같은 API 를 그대로 제공한다.**
 *
 * 다만 저장 폴더는 로컬 파일 시스템이다. 파일 시스템이 없는 자리(Cloudflare
 * Worker 배포본)에서는 저장소를 불러올 수 없으므로, 그때만 503 JSON 으로
 * 답한다. 어느 쪽이든 HTML 은 돌려주지 않는다 — 앱의 404 HTML 이 돌아가면
 * 클라이언트가 그것을 JSON 으로 읽다가 `Unexpected token '<'` 로 터진다.
 */

import { parsePath, routeProjects, statusOf } from "../../../../server/projectsRouter";

const UNAVAILABLE =
  "도면 공유 API 는 로컬 파일 폴더(.grid-projects)를 쓰기 때문에 이 서버에서는 쓸 수 없습니다. " +
  "`npm run dev` 로 띄운 로컬 개발 서버에서 열어 주십시오.";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * 파일 시스템을 쓰는 저장소를 실행 중에 불러온다.
 *
 * 정적으로 import 하면 Worker 번들에 `node:fs` 가 딸려 들어가 빌드가 깨진다.
 * 여기서 불러오면 Node 에서만 성공하고, 그 밖에서는 조용히 실패해 503 이 된다.
 */
/**
 * 저장 폴더 위치.
 *
 * 이 환경의 작업 폴더는 프로젝트 뿌리가 아니다(개발 서버에서는 `/bundle`).
 * 그래서 이 파일이 놓인 자리(`app/api/projects/[[...slug]]/`)에서 네 단계를
 * 거슬러 뿌리를 찾는다. 윈도에서는 `/C:/...` 처럼 앞에 슬래시가 붙어 오므로
 * 그것만 떼어 낸다. 윈도도 슬래시 경로를 받는다.
 */
function dataDirFromModule(): string {
  const root = decodeURIComponent(new URL("../../../../", import.meta.url).pathname);
  const cleaned = /^\/[A-Za-z]:\//.test(root) ? root.slice(1) : root;
  return `${cleaned}.grid-projects`;
}

async function loadStore() {
  try {
    const { existsSync } = await import("node:fs");
    const { createRevisionStore } = await import("../../../../server/revisions");

    const dir = process.env.GRID_TILE_DATA_DIR || dataDirFromModule();
    const store = createRevisionStore(dir);

    // 파일 시스템에 진짜로 닿는지 확인한다. Worker 런타임의 node:fs 는 번들만
    // 보는 가상 파일 시스템이라, 불러오기는 되면서 실제 폴더는 보이지 않는다.
    // 그대로 두면 "도면이 하나도 없다" 는 빈 목록을 내보내 더 헷갈린다.
    if (!existsSync(store.dir) && !existsSync(dir)) return null;

    return store;
  } catch {
    return null;
  }
}

async function handle(request: Request): Promise<Response> {
  const segments = parsePath(new URL(request.url).pathname);
  if (!segments) return json(404, { ok: false, error: "없는 주소입니다." });

  const store = await loadStore();
  if (!store) return json(503, { ok: false, error: UNAVAILABLE });

  try {
    const { status, body } = await routeProjects(store, {
      method: request.method,
      segments,
      body: async () => {
        const text = await request.text();
        if (!text) return {};
        try {
          return JSON.parse(text);
        } catch {
          return {};
        }
      },
    });
    return json(status, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(statusOf(error, message), { ok: false, error: message });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
