/**
 * `/api/live` App Router 라우트 — 실시간 현황판의 메시지 형식 프로필 · 이벤트 로그.
 *
 * 상시 서비스(`vinext start`)는 Vite 미들웨어를 태우지 않으므로 여기서 같은 API 를 제공한다.
 * 경로 규칙은 `server/liveRouter.ts` 하나를 둘이 함께 쓴다. `/api/lookup` 라우트와 같은 구조다.
 *
 * 이벤트 기록(브로커 구독)은 별도 프로세스 `scripts/live-logger.ts` 가 하고(데몬이 띄움), 여기서는 그 파일을 읽기만 한다.
 */

import type { LiveStore } from "../../../../server/liveRouter";
import { liveStatusOf, parseLivePath, routeLive } from "../../../../server/liveRouter";

const UNAVAILABLE = "실시간 현황판 서버 API 는 로컬 파일 폴더를 쓰기 때문에 이 서버에서는 쓸 수 없습니다.";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function dataDirFromModule(): string {
  const root = decodeURIComponent(new URL("../../../../", import.meta.url).pathname);
  const cleaned = /^\/[A-Za-z]:\//.test(root) ? root.slice(1) : root;
  return `${cleaned}.grid-projects`;
}

let storePromise: Promise<LiveStore | null> | null = null;

function loadStore(): Promise<LiveStore | null> {
  storePromise ??= (async () => {
    try {
      const { existsSync } = await import("node:fs");
      const { createLiveStore } = await import("../../../../server/liveApi");
      const dir = process.env.GRID_TILE_DATA_DIR || dataDirFromModule();
      if (!existsSync(dir)) return null;
      // 브로커 구독은 여기서 하지 않는다. 상시 서비스의 라우트는 Cloudflare 호환 런타임에서 돌아 `net` 이 없다.
      // 별도 프로세스 `scripts/live-logger.ts` 가 파일을 쓰고, 여기서는 그 파일만 읽는다.
      return createLiveStore(dir, { logger: false });
    } catch {
      return null;
    }
  })();
  return storePromise;
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = parseLivePath(url.pathname);
  if (!segments) return json(404, { ok: false, error: "없는 주소입니다." });

  const store = await loadStore();
  if (!store) return json(503, { ok: false, error: UNAVAILABLE });

  try {
    const { status, body } = await routeLive(store, {
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
    return json(liveStatusOf(error), { ok: false, error: message });
  }
}

export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
