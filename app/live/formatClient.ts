"use client";

/** `/api/live/format` 클라이언트. 실패하면 던진다 — 현황판은 기본 프로필(v1)로 계속 돈다. */

import type { FormatBook, MessageFormat } from "./messageFormat";

export const LIVE_API_BASE = "/api/live";

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json: payloadIn, ...rest } = init ?? {};
  const response = await fetch(path, {
    ...rest,
    ...(payloadIn !== undefined ? { body: JSON.stringify(payloadIn), headers: { "Content-Type": "application/json" } } : {}),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("메시지 형식 API 가 없습니다(개발·상시 서버에서만 됩니다).");
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `서버가 ${response.status} 로 답했습니다.`);
  return payload;
}

export function loadFormatBook(): Promise<FormatBook & { errors: Record<string, string> }> {
  return request(`${LIVE_API_BASE}/format`);
}

export function loadFormat(site: string): Promise<{ format: MessageFormat; isDefault: boolean }> {
  return request(`${LIVE_API_BASE}/format/${encodeURIComponent(site)}`);
}

export function saveFormat(site: string, format: unknown, author: string): Promise<{ ok: true; format: MessageFormat; isDefault: boolean }> {
  return request(`${LIVE_API_BASE}/format/${encodeURIComponent(site)}`, { method: "PUT", json: { format, author } });
}

export function resetFormat(site: string): Promise<{ ok: true; format: MessageFormat; isDefault: true }> {
  return request(`${LIVE_API_BASE}/format/${encodeURIComponent(site)}`, { method: "DELETE" });
}
