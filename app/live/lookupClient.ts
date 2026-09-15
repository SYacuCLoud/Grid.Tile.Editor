"use client";

/**
 * `/api/lookup` 클라이언트. 서버가 없는 자리(정적 배포)에서는 실패하고, 그때 현황판은
 * 이름 없이 UID 만 보여 주면 된다 — 그래서 여기서는 오류를 삼키지 않고 그대로 던진다.
 */

import type { ColumnInfo, ConnectionInfo, LookupBook, LookupConfig, LookupPreview, LookupSnapshot, TableInfo } from "./lookup";

export const LOOKUP_API_BASE = "/api/lookup";

/** 서버가 화면에 내주는 설정. env 파일은 이름만, 자유 WHERE 는 있다는 사실만. */
export type PublicLookupConfig = LookupConfig & { envFile?: string; hasWhere: boolean };

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json: payloadIn, ...rest } = init ?? {};
  const response = await fetch(path, {
    ...rest,
    ...(payloadIn !== undefined ? { body: JSON.stringify(payloadIn), headers: { "Content-Type": "application/json" } } : {}),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("기준정보 API 가 없습니다(개발·상시 서버에서만 됩니다).");
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `서버가 ${response.status} 로 답했습니다.`);
  return payload;
}

const site = (s: string) => encodeURIComponent(s);

export function loadLookupBook(): Promise<LookupBook & { dir: string }> {
  return request(LOOKUP_API_BASE);
}

export function refreshLookup(s: string): Promise<LookupSnapshot> {
  return request(`${LOOKUP_API_BASE}/${site(s)}/refresh`, { method: "POST" });
}

export function loadLookupConfig(s: string): Promise<{ config: PublicLookupConfig }> {
  return request(`${LOOKUP_API_BASE}/${site(s)}/config`);
}

export function saveLookupConfig(s: string, config: unknown, author: string): Promise<{ ok: true; config: PublicLookupConfig; snapshot: LookupSnapshot }> {
  return request(`${LOOKUP_API_BASE}/${site(s)}/config`, { method: "PUT", json: { config, author } });
}

export function previewLookup(s: string, config: unknown): Promise<LookupPreview> {
  return request(`${LOOKUP_API_BASE}/${site(s)}/preview`, { method: "POST", json: { config } });
}

export function loadConnections(): Promise<{ connections: ConnectionInfo[] }> {
  return request(`${LOOKUP_API_BASE}/_meta/connections`);
}

export function loadTables(connection: string): Promise<{ tables: TableInfo[] }> {
  return request(`${LOOKUP_API_BASE}/_meta/tables?connection=${encodeURIComponent(connection)}`);
}

export function loadColumns(connection: string, table: string): Promise<{ columns: ColumnInfo[] }> {
  return request(`${LOOKUP_API_BASE}/_meta/columns?connection=${encodeURIComponent(connection)}&table=${encodeURIComponent(table)}`);
}
