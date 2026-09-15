/**
 * `/api/lookup` App Router 라우트 — 실시간 현황판의 기준정보 스냅샷 · 설정.
 *
 * 개발 서버에서는 Vite 미들웨어(`server/lookupApi.ts`)가 같은 주소를 먼저 잡는다.
 * 상시 서비스(`vinext start`)는 그 미들웨어를 태우지 않으므로 **여기서 같은 API 를 그대로 제공한다.**
 * 경로 규칙은 `server/lookupRouter.ts` 하나를 둘이 함께 쓴다. `/api/projects` 라우트와 같은 구조다.
 *
 * 저장소는 서버 프로세스에 하나만 두고(모듈 변수) 첫 요청에 만들어 주기 갱신을 시작한다.
 * DB 드라이버와 파일 시스템은 Node 에서만 있으므로 실행 중에 불러오고, 없는 자리(Worker)에서는 503 JSON 으로 답한다.
 */

import type { LookupStore } from "../../../../server/lookupStore";
import { lookupStatusOf, parseLookupPath, routeLookup } from "../../../../server/lookupRouter";

const UNAVAILABLE = "기준정보 조회 API 는 로컬 파일 폴더와 SQL 드라이버를 쓰기 때문에 이 서버에서는 쓸 수 없습니다.";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** 저장 폴더. `/api/projects` 라우트와 같은 규칙 — 이 파일에서 네 단계 위가 프로젝트 뿌리다. */
function dataDirFromModule(): string {
  const root = decodeURIComponent(new URL("../../../../", import.meta.url).pathname);
  const cleaned = /^\/[A-Za-z]:\//.test(root) ? root.slice(1) : root;
  return `${cleaned}.grid-projects`;
}

let storePromise: Promise<LookupStore | null> | null = null;

function loadStore(): Promise<LookupStore | null> {
  storePromise ??= (async () => {
    try {
      const { existsSync } = await import("node:fs");
      const { createLookupStore } = await import("../../../../server/lookupStore");
      const dir = process.env.GRID_TILE_DATA_DIR || dataDirFromModule();
      if (!existsSync(dir)) return null;
      const store = createLookupStore(dir);
      store.start();
      return store;
    } catch {
      return null;
    }
  })();
  return storePromise;
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = parseLookupPath(url.pathname);
  if (!segments) return json(404, { ok: false, error: "없는 주소입니다." });

  const store = await loadStore();
  if (!store) return json(503, { ok: false, error: UNAVAILABLE });

  try {
    const { status, body } = await routeLookup(store, {
      method: request.method,
      segments,
      query: url.searchParams,
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
    return json(lookupStatusOf(error), { ok: false, error: message });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
