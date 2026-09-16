"use client";

/** `/api/live/events` 클라이언트 — 서버가 쌓아 둔 등장 · 제거 이벤트를 읽는다. */

import type { LoggedEvent } from "../../server/eventLog";

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

/** 리더 하나(`key`) 또는 사업장 전체(`key` 없음)의 이벤트. `site` 도 비우면 모든 사업장. */
export function loadReaderEvents(input: { site?: string; key?: string; hours?: number; before?: number; limit?: number }): Promise<EventPage> {
  const p = new URLSearchParams();
  if (input.site) p.set("site", input.site);
  if (input.key) p.set("key", input.key);
  if (input.hours) p.set("hours", String(input.hours));
  if (input.before) p.set("before", String(input.before));
  if (input.limit) p.set("limit", String(input.limit));
  return request(`/api/live/events?${p.toString()}`);
}

export function loadEventsStatus(): Promise<EventsStatus> {
  return request("/api/live/events/status");
}
