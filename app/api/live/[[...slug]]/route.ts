/**
 * `/api/live` App Router 라우트 — 실시간 현황판의 메시지 형식 프로필.
 *
 * 상시 서비스(`vinext start`)는 Vite 미들웨어를 태우지 않으므로 여기서 같은 API 를 제공한다.
 * 경로 규칙은 `server/liveRouter.ts` 하나를 둘이 함께 쓴다. `/api/lookup` 라우트와 같은 구조다.
 */

import type { FormatStore } from "../../../../server/formatStore";
import { liveStatusOf, parseLivePath, routeLive } from "../../../../server/liveRouter";

const UNAVAILABLE = "메시지 형식 API 는 로컬 파일 폴더를 쓰기 때문에 이 서버에서는 쓸 수 없습니다.";

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

let storePromise: Promise<FormatStore | null> | null = null;

function loadStore(): Promise<FormatStore | null> {
  storePromise ??= (async () => {
    try {
      const { existsSync } = await import("node:fs");
      const { createFormatStore } = await import("../../../../server/formatStore");
      const dir = process.env.GRID_TILE_DATA_DIR || dataDirFromModule();
      if (!existsSync(dir)) return null;
      return createFormatStore(dir);
    } catch {
      return null;
    }
  })();
  return storePromise;
}

async function handle(request: Request): Promise<Response> {
  const segments = parseLivePath(new URL(request.url).pathname);
  if (!segments) return json(404, { ok: false, error: "없는 주소입니다." });

  const store = await loadStore();
  if (!store) return json(503, { ok: false, error: UNAVAILABLE });

  try {
    const { status, body } = await routeLive(store, {
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
    return json(liveStatusOf(error), { ok: false, error: message });
  }
}

export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
