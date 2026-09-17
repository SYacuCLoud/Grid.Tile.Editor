/**
 * `/api/live` 경로 규칙 — 실시간 현황판의 서버 쪽 일. Vite 미들웨어와 App Router 라우트가 함께 쓴다.
 *
 * 메시지 형식 프로필
 *   GET    /api/live/format                 사업장별 프로필 { sites, errors } (없는 사업장 = 기본 v1)
 *   GET    /api/live/format/:site           한 사업장 (파일이 없으면 기본 프로필을 `isDefault:true` 로)
 *   PUT    /api/live/format/:site  {format, author}   저장(기본과 같으면 파일 삭제)
 *   DELETE /api/live/format/:site           기본으로 되돌리기
 *
 * 이벤트 로그 (서버가 브로커를 구독해 쌓은 등장 · 제거)
 *   GET    /api/live/events?site=&key=&hours=24&before=<ms>&limit=200   최신부터. `before` 로 이전 구간을 이어 받는다
 *                                                                        `since=<ms>` 를 주면 그 시각부터(`hours` 대신 — 화면의 "오늘")
 *   GET    /api/live/events/status          기록기 상태(접속 · 건수 · 파일)
 *   GET    /api/live/events/ghosts?site=&hours=24   리더마다 마지막 이벤트가 제거인 것 — 새로 켠 화면이 잔상을 되살린다
 */

import { join } from "node:path";

import { defaultFormat, isDefaultFormat, MessageFormatError } from "../app/live/messageFormat";
import { type EventLog, lastRemovals, MAX_QUERY_LIMIT } from "./eventLog";
import { type EventLoggerHandle, readLoggerStatusFile } from "./eventLogger";
import type { FormatStore } from "./formatStore";

export const LIVE_API_BASE = "/api/live";
/** 한 번에 조회하는 기본 범위(시간). */
export const DEFAULT_EVENT_HOURS = 24;
export const MAX_EVENT_HOURS = 24 * 31;

export interface LiveStore {
  formats: FormatStore;
  events: EventLog;
  /** 브로커 구독 기록기. 켜지 못한 자리(시험 · Worker)에서는 null. */
  logger: EventLoggerHandle | null;
}

export interface LiveRequest {
  method: string;
  segments: string[];
  query: URLSearchParams;
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

function num(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function routeLive(store: LiveStore, request: LiveRequest, now: () => number = () => Date.now()): Promise<LiveResult> {
  const method = request.method.toUpperCase();
  const [area, second] = request.segments;

  if (area === "format") {
    const site = second;
    if (!site) {
      if (method !== "GET") return notFound();
      return { status: 200, body: { dir: store.formats.dir, ...store.formats.book() } };
    }
    if (method === "GET") {
      const format = store.formats.get(site);
      return { status: 200, body: { format: format ?? defaultFormat(site), isDefault: format === null || isDefaultFormat(format) } };
    }
    if (method === "PUT") {
      const body = (await request.body()) as { format?: unknown; author?: string };
      const saved = store.formats.save(site, body.format, typeof body.author === "string" ? body.author : "");
      return { status: 200, body: { ok: true, format: saved, isDefault: isDefaultFormat(saved) } };
    }
    if (method === "DELETE") {
      store.formats.remove(site);
      return { status: 200, body: { ok: true, format: defaultFormat(site), isDefault: true } };
    }
    return notFound();
  }

  if (area === "events" && method === "GET") {
    if (second === "status") {
      // 기록기가 이 프로세스에 없으면(상시 서비스) 별도 프로세스가 남긴 상태 파일을 읽는다.
      const logger = store.logger?.status() ?? readLoggerStatusFile(join(store.events.dir, "logger-status.json"), now());
      return { status: 200, body: { log: store.events.status(), logger, external: !store.logger } };
    }
    if (second === "ghosts") {
      // 잔상 되살리기: 유지 시간(hours) 안의 이벤트를 훑어 리더별 마지막이 제거인 것만 돌려준다.
      const q = request.query;
      const toMs = now();
      const hours = Math.min(MAX_EVENT_HOURS, Math.max(1 / 60, num(q.get("hours"), DEFAULT_EVENT_HOURS)));
      const result = store.events.query({ site: q.get("site")?.trim() || undefined, fromMs: toMs - hours * 3_600_000, toMs, limit: MAX_QUERY_LIMIT });
      return { status: 200, body: { ghosts: lastRemovals(result.events), fromMs: result.fromMs, toMs, truncated: result.truncated } };
    }
    if (second) return notFound();
    const q = request.query;
    const toMs = num(q.get("before"), now());
    // 범위는 `since`(그 시각부터 — 화면이 "오늘 0시" 를 자기 시간대로 계산해 보낸다) 가 우선, 없으면 `hours`.
    // 어느 쪽이든 최대 폭 안으로 자른다.
    const since = num(q.get("since"), Number.NaN);
    const requested = Number.isFinite(since) ? Math.max(1 / 3600, (toMs - since) / 3_600_000) : Math.max(1, num(q.get("hours"), DEFAULT_EVENT_HOURS));
    const hours = Math.min(MAX_EVENT_HOURS, requested);
    const fromMs = toMs - hours * 3_600_000;
    const result = store.events.query({
      site: q.get("site")?.trim() || undefined,
      key: q.get("key")?.trim() || undefined,
      fromMs,
      toMs,
      limit: num(q.get("limit"), 200),
    });
    return { status: 200, body: { ...result, hours } };
  }

  return notFound();
}

export function liveStatusOf(error: unknown): number {
  return error instanceof MessageFormatError ? 400 : 500;
}
