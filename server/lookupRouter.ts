/**
 * `/api/lookup` 경로 규칙 한 벌. Vite 미들웨어(개발 서버)와 App Router 라우트(상시 서비스)가 같은 코드를 쓴다.
 *
 *   GET  /api/lookup                              사업장별 스냅샷 전부  { sites: { default: {...} } }
 *   GET  /api/lookup/_meta/connections            접속 이름 목록(비밀 없음)
 *   GET  /api/lookup/_meta/tables?connection=     그 접속 DB 의 표 · 뷰
 *   GET  /api/lookup/_meta/columns?connection=&table=   표의 열
 *   GET  /api/lookup/:site                        한 사업장의 스냅샷
 *   GET  /api/lookup/:site/config                 화면용 설정(env 경로 · 자유 WHERE 는 감춤)
 *   PUT  /api/lookup/:site/config  {config, author}   저장 → 바로 읽어 스냅샷까지 돌려준다
 *   POST /api/lookup/:site/preview {config}       초안으로 몇 행만 읽어 보기(저장 안 함)
 *   POST /api/lookup/:site/refresh                지금 다시 읽기(설정 파일도 다시 훑는다)
 *
 * 접속(비밀)은 파일 `.lookup/connections.json` 로만 관리한다. 여기에는 그것을 바꾸는 주소가 없다.
 */

import { LookupConfigError, publicConfig } from "../app/live/lookup";
import type { LookupStore } from "./lookupStore";

export const LOOKUP_API_BASE = "/api/lookup";

export interface LookupRequest {
  method: string;
  segments: string[];
  query: URLSearchParams;
  body: () => Promise<unknown>;
}

export interface LookupResult {
  status: number;
  body: unknown;
}

export function parseLookupPath(pathname: string): string[] | null {
  if (pathname !== LOOKUP_API_BASE && !pathname.startsWith(`${LOOKUP_API_BASE}/`)) return null;
  const rest = pathname.slice(LOOKUP_API_BASE.length).replace(/^\//, "");
  return rest ? rest.split("/").map((part) => decodeURIComponent(part)) : [];
}

function notFound(message = "없는 주소입니다."): LookupResult {
  return { status: 404, body: { ok: false, error: message } };
}

function requireParam(query: URLSearchParams, name: string): string {
  const value = query.get(name)?.trim();
  if (!value) throw new LookupConfigError(`${name} 이 필요합니다.`);
  return value;
}

export async function routeLookup(store: LookupStore, request: LookupRequest): Promise<LookupResult> {
  const method = request.method.toUpperCase();
  const { segments, query } = request;

  if (segments.length === 0 && method === "GET") return { status: 200, body: { dir: store.dir, sites: store.all() } };

  const [first, action] = segments;

  if (first === "_meta" && method === "GET") {
    if (action === "connections") return { status: 200, body: { connections: store.connections() } };
    if (action === "tables") return { status: 200, body: { tables: await store.tables(requireParam(query, "connection")) } };
    if (action === "columns") {
      return { status: 200, body: { columns: await store.columns(requireParam(query, "connection"), requireParam(query, "table")) } };
    }
    return notFound();
  }

  const site = first;
  if (!site) return notFound();

  if (segments.length === 1 && method === "GET") {
    const snapshot = store.get(site);
    return snapshot ? { status: 200, body: snapshot } : notFound(`사업장 ${JSON.stringify(site)} 의 조회 설정이 없습니다.`);
  }

  if (segments.length === 2 && action === "config" && method === "GET") {
    const config = store.config(site);
    return config ? { status: 200, body: { config: publicConfig(config) } } : notFound(`사업장 ${JSON.stringify(site)} 의 조회 설정이 없습니다.`);
  }

  if (segments.length === 2 && action === "config" && method === "PUT") {
    const body = (await request.body()) as { config?: unknown; author?: string };
    const { config, snapshot } = await store.save(site, body.config, typeof body.author === "string" ? body.author : "");
    return { status: 200, body: { ok: true, config: publicConfig(config), snapshot } };
  }

  if (segments.length === 2 && action === "preview" && method === "POST") {
    const body = (await request.body()) as { config?: unknown };
    return { status: 200, body: await store.preview(site, body.config) };
  }

  if (segments.length === 2 && action === "refresh" && method === "POST") return { status: 200, body: await store.refresh(site) };

  return notFound();
}

/** 저장소가 던지는 오류 → HTTP 코드. 설정 · 입력 잘못은 400 계열, DB 쪽 실패는 502(우리 서버 잘못이 아니다). */
export function lookupStatusOf(error: unknown): number {
  if (error instanceof LookupConfigError) return /(사업장|접속) ".*?" (의 조회 설정이|이) 없습니다/.test(error.message) ? 404 : 400;
  return 502;
}
