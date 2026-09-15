/**
 * `/api/live` 경로 규칙 — 실시간 현황판의 메시지 형식 프로필. Vite 미들웨어와 App Router 라우트가 함께 쓴다.
 *
 *   GET    /api/live/format                 사업장별 프로필 { sites: {…}, errors: {…} } (없는 사업장 = 기본 v1)
 *   GET    /api/live/format/:site           한 사업장 (파일이 없으면 기본 프로필을 `isDefault:true` 로)
 *   PUT    /api/live/format/:site  {format, author}   저장(기본과 같으면 파일 삭제)
 *   DELETE /api/live/format/:site           기본으로 되돌리기
 */

import { defaultFormat, isDefaultFormat, MessageFormatError } from "../app/live/messageFormat";
import type { FormatStore } from "./formatStore";

export const LIVE_API_BASE = "/api/live";

export interface LiveRequest {
  method: string;
  segments: string[];
  body: () => Promise<unknown>;
}

export interface LiveResult {
  status: number;
  body: unknown;
}

export function parseLivePath(pathname: string): string[] | null {
  if (pathname !== LIVE_API_BASE && !pathname.startsWith(`${LIVE_API_BASE}/`)) return null;
  const rest = pathname.slice(LIVE_API_BASE.length).replace(/^\//, "");
  return rest ? rest.split("/").map((part) => decodeURIComponent(part)) : [];
}

const notFound = (): LiveResult => ({ status: 404, body: { ok: false, error: "없는 주소입니다." } });

export async function routeLive(store: FormatStore, request: LiveRequest): Promise<LiveResult> {
  const method = request.method.toUpperCase();
  const [area, site] = request.segments;
  if (area !== "format") return notFound();

  if (!site) {
    if (method !== "GET") return notFound();
    return { status: 200, body: { dir: store.dir, ...store.book() } };
  }

  if (method === "GET") {
    const format = store.get(site);
    return { status: 200, body: { format: format ?? defaultFormat(site), isDefault: format === null || isDefaultFormat(format) } };
  }
  if (method === "PUT") {
    const body = (await request.body()) as { format?: unknown; author?: string };
    const saved = store.save(site, body.format, typeof body.author === "string" ? body.author : "");
    return { status: 200, body: { ok: true, format: saved, isDefault: isDefaultFormat(saved) } };
  }
  if (method === "DELETE") {
    store.remove(site);
    return { status: 200, body: { ok: true, format: defaultFormat(site), isDefault: true } };
  }
  return notFound();
}

export function liveStatusOf(error: unknown): number {
  return error instanceof MessageFormatError ? 400 : 500;
}
