/**
 * `/api/projects` 경로 규칙 한 벌.
 *
 * Node 미들웨어(개발 서버)와 App Router 라우트 핸들러가 **같은 코드**를 쓴다.
 * 두 벌로 나뉘어 있으면 한쪽만 고쳐 놓고 다른 쪽에서 다르게 도는 일이 생긴다.
 * 여기서는 HTTP 를 모른다 — 메서드 · 경로 조각 · 몸통만 받아 결과를 돌려준다.
 */

import { ToolError } from "../mcp/types";
import { ApiError, type RevisionStore } from "./revisions";

export const API_BASE = "/api/projects";

export interface RouteRequest {
  method: string;
  /** `/api/projects` 뒤에 붙는 조각. 빈 배열이면 목록이다. */
  segments: string[];
  /** 몸통은 필요한 갈래에서만 읽는다. */
  body: () => Promise<unknown>;
}

export interface RouteResult {
  status: number;
  body: unknown;
}

/** `/api/projects/...` 경로에서 조각을 뽑는다. 다른 주소면 null. */
export function parsePath(pathname: string): string[] | null {
  if (pathname !== API_BASE && !pathname.startsWith(`${API_BASE}/`)) return null;
  const rest = pathname.slice(API_BASE.length).replace(/^\//, "");
  return rest ? rest.split("/").map((part) => decodeURIComponent(part)) : [];
}

export async function routeProjects(store: RevisionStore, request: RouteRequest): Promise<RouteResult> {
  const method = request.method.toUpperCase();
  const { segments } = request;

  // GET /api/projects — 목록
  if (segments.length === 0 && method === "GET") {
    return { status: 200, body: { dir: store.dir, projects: store.list() } };
  }

  // POST /api/projects — 새 도면
  if (segments.length === 0 && method === "POST") {
    const body = (await request.body()) as { title?: string; author?: string };
    return { status: 201, body: store.create(body.title ?? "", body.author) };
  }

  const [id, action, argument] = segments;
  if (!id) throw new ApiError(404, "없는 주소입니다.");

  // GET /api/projects/:id — 최신 내용과 리비전
  if (segments.length === 1 && method === "GET") {
    return { status: 200, body: store.read(id) };
  }

  // POST /api/projects/:id — 저장(자동 스냅샷)
  if (segments.length === 1 && method === "POST") {
    const body = (await request.body()) as {
      project?: unknown;
      baseRevision?: number;
      author?: string;
      mode?: "save" | "overwrite" | "copy";
    };
    const result = store.save({
      id,
      project: body.project,
      baseRevision: body.baseRevision,
      author: body.author,
      mode: body.mode,
    });
    // 충돌은 오류가 아니라 사용자가 고를 일이다. 409 로 알리고 내용을 함께 준다.
    return { status: result.ok ? 200 : 409, body: result };
  }

  // GET /api/projects/:id/history — 이력 목록
  if (segments.length === 2 && action === "history" && method === "GET") {
    return { status: 200, body: { id, revisions: store.history(id) } };
  }

  // POST /api/projects/:id/restore/:revId — 과거 버전으로 되돌리기
  if (segments.length === 3 && action === "restore" && method === "POST") {
    const body = (await request.body()) as { author?: string };
    const revision = Number.parseInt(argument, 10);
    if (!Number.isFinite(revision)) throw new ApiError(400, "리비전 번호가 아닙니다.");
    return { status: 200, body: store.restore(id, revision, body.author) };
  }

  throw new ApiError(404, "없는 주소입니다.");
}

/**
 * 저장소가 던지는 오류를 HTTP 코드로 바꾼다.
 *
 * 파일이 없는 것은 서버 잘못이 아니라 없는 자원이므로 404 다. 쓸 수 없는 ID 처럼
 * 요청이 잘못된 것은 400 이다. 그 밖은 우리 잘못이니 500 으로 남긴다.
 */
export function statusOf(error: unknown, message: string): number {
  if (error instanceof ApiError) return error.status;
  if (error instanceof ToolError) return message.includes("찾을 수 없습니다") ? 404 : 400;
  return 500;
}
