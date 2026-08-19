"use client";

import type { ProjectDoc } from "../doc";

/**
 * 도면 공유 API 클라이언트.
 *
 * 서버가 없는 자리(정적 배포 · Worker)에서는 호출이 실패한다. 그때는 화면에서
 * 서버 기능만 접히고, 브라우저 자동 저장과 JSON 내보내기는 그대로 쓸 수 있어야
 * 한다. 그래서 오류를 삼키지 않고 그대로 던지되, 목록 조회만 실패를 알린다.
 */

export const API_BASE = "/api/projects";

export interface ProjectListEntry {
  id: string;
  title: string;
  pages: number;
  revision: number;
  savedAt: string | null;
  author: string | null;
}

export interface LoadedProject {
  id: string;
  project: ProjectDoc;
  revision: number;
  savedAt: string | null;
  author: string | null;
  externalChange: boolean;
}

export interface RevisionMeta {
  revision: number;
  savedAt: string;
  author: string;
  title: string;
  pages: number;
}

export interface SaveSuccess {
  ok: true;
  id: string;
  revision: number;
  savedAt: string;
  author: string;
  copied: boolean;
}

export interface SaveConflict {
  ok: false;
  reason: "conflict";
  revision: number;
  savedAt: string | null;
  author: string | null;
  externalChange: boolean;
  message: string;
}

export type SaveResult = SaveSuccess | SaveConflict;
export type SaveMode = "save" | "overwrite" | "copy";

/** 이 자리에 공유 API 가 없다는 뜻. 화면에서 서버 기능을 접는 신호로 쓴다. */
export class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiUnavailableError";
  }
}

const NO_API =
  "도면 공유 API 를 찾을 수 없습니다. `npm run dev` 로 띄운 개발 서버에서만 쓸 수 있고, " +
  "개발 서버가 켜져 있다면 한 번 다시 시작해 주십시오.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  // 앱의 404·500 HTML 이 돌아올 수 있다. 그대로 JSON.parse 하면
  // `Unexpected token '<'` 로 터져 무슨 일인지 알 수 없다.
  if (!contentType.includes("application/json")) {
    throw new ApiUnavailableError(NO_API);
  }

  let payload: T & { error?: string };
  try {
    payload = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string });
  } catch {
    throw new ApiUnavailableError("서버가 보낸 답을 읽지 못했습니다. 개발 서버를 다시 시작해 주십시오.");
  }

  // 서버가 스스로 "여기엔 API 가 없다" 고 알린 경우(안전망 라우트).
  if (response.status === 503) throw new ApiUnavailableError(payload.error || NO_API);

  // 충돌(409)은 오류가 아니라 사용자가 고를 일이다. 그대로 돌려준다.
  if (!response.ok && response.status !== 409) {
    throw new Error(payload.error || `서버가 ${response.status} 로 답했습니다.`);
  }
  return payload;
}

export function listProjects(): Promise<{ dir: string; projects: ProjectListEntry[] }> {
  return request(API_BASE);
}

export function loadProject(id: string): Promise<LoadedProject> {
  return request(`${API_BASE}/${encodeURIComponent(id)}`);
}

export function createProject(title: string, author: string): Promise<SaveSuccess & { project: ProjectDoc }> {
  return request(API_BASE, { method: "POST", body: JSON.stringify({ title, author }) });
}

export function saveProject(input: {
  id: string;
  project: ProjectDoc;
  baseRevision: number;
  author: string;
  mode?: SaveMode;
}): Promise<SaveResult> {
  return request(`${API_BASE}/${encodeURIComponent(input.id)}`, {
    method: "POST",
    body: JSON.stringify({
      project: input.project,
      baseRevision: input.baseRevision,
      author: input.author,
      mode: input.mode ?? "save",
    }),
  });
}

export function loadHistory(id: string): Promise<{ id: string; revisions: RevisionMeta[] }> {
  return request(`${API_BASE}/${encodeURIComponent(id)}/history`);
}

export function restoreRevision(id: string, revision: number, author: string): Promise<SaveSuccess> {
  return request(`${API_BASE}/${encodeURIComponent(id)}/restore/${revision}`, {
    method: "POST",
    body: JSON.stringify({ author }),
  });
}

const AUTHOR_KEY = "grid-tile-editor:author";

/** 작성자 이름은 브라우저에 기억해 둔다. 로그인까지 둘 일은 아니다. */
export function loadAuthor(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(AUTHOR_KEY) ?? "";
}

export function saveAuthor(name: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTHOR_KEY, name.trim().slice(0, 24));
}

/** 화면에 보일 짧은 시각. `2026-08-19 12:54` */
export function formatStamp(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
