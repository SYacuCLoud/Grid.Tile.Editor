"use client";

/** `/api/live/events` 클라이언트 — 서버가 쌓아 둔 등장 · 제거 이벤트를 읽는다. */

import type { LoggedEvent } from "../../server/eventLog";
import type { GhostSeed } from "./liveState";

export type { LoggedEvent };

export interface EventPage {
  events: LoggedEvent[];
  fromMs: number;
  toMs: number;
  truncated: boolean;
  files: number;
  hours: number;
}

export interface EventsStatus {
  log: { dir: string; instance: string; appended: number; todayBytes: number; files: number; retentionDays: number };
  logger: {
    enabled: boolean;
    broker: string;
    topic: string;
    connected: boolean;
    received: number;
    logged: number;
    lastError: string | null;
    lastMessageAt: string | null;
    startedAt: string;
  } | null;
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("이벤트 로그 API 가 없습니다(개발·상시 서버에서만 됩니다).");
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `서버가 ${response.status} 로 답했습니다.`);
  return payload;
}

/**
 * 리더 하나(`key`) 또는 사업장 전체(`key` 없음)의 이벤트. `site` 도 비우면 모든 사업장.
 * 시간 범위는 `hours`(끝에서 n시간 전까지) 또는 `since`(그 시각(ms)부터) — `since` 가 있으면 `hours` 는 무시된다.
 */
export function loadReaderEvents(input: { site?: string; key?: string; hours?: number; since?: number; before?: number; limit?: number }): Promise<EventPage> {
  const p = new URLSearchParams();
  if (input.site) p.set("site", input.site);
  if (input.key) p.set("key", input.key);
  if (input.hours) p.set("hours", String(input.hours));
  if (input.since) p.set("since", String(input.since));
  if (input.before) p.set("before", String(input.before));
  if (input.limit) p.set("limit", String(input.limit));
  return request(`/api/live/events?${p.toString()}`);
}

/**
 * 잔상 씨앗 — 유지 시간(`hours`) 안에서 리더마다 마지막 이벤트가 제거인 것. 리더 id(`site/key`) → 씨앗.
 * 새로 켠 화면이 retained 상태만으로는 알 수 없는 "마지막에 무엇이 있었나" 를 서버 로그에서 되찾는다.
 */
export async function loadGhostSeeds(input: { site?: string; hours: number }): Promise<Record<string, GhostSeed>> {
  const p = new URLSearchParams();
  if (input.site) p.set("site", input.site);
  p.set("hours", String(input.hours));
  const body = await request<{ ghosts: LoggedEvent[] }>(`/api/live/events/ghosts?${p.toString()}`);
  const out: Record<string, GhostSeed> = {};
  for (const e of body.ghosts) out[`${e.site}/${e.key}`] = { uid: e.uid, at: e.time, seenAt: e.receivedAt };
  return out;
}

export function loadEventsStatus(): Promise<EventsStatus> {
  return request("/api/live/events/status");
}
