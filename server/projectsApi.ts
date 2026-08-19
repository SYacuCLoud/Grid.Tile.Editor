/**
 * `/api/projects` 를 Node 개발 서버(Vite 미들웨어)에 붙이는 껍데기.
 *
 * 경로 규칙은 `projectsRouter.ts`, 실제 일은 `revisions.ts` 가 한다. 여기서는
 * Node 의 요청·응답을 그 모양에 맞춰 주기만 한다.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { ApiError, createRevisionStore } from "./revisions";
import { API_BASE, parsePath, routeProjects, statusOf } from "./projectsRouter";

export { API_BASE };

/** 몸통이 지나치게 크면 읽지 않는다. 도면 하나가 이보다 커질 일은 없다. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, "보낸 내용이 너무 큽니다.");
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "JSON 형식이 아닙니다.");
  }
}

export type NextFunction = (error?: unknown) => void;

/** connect 미들웨어. Vite 개발 서버와 미리보기 서버에 그대로 붙는다. */
export function createProjectsApi(dir?: string) {
  const store = createRevisionStore(dir);

  return async function projectsApi(req: IncomingMessage, res: ServerResponse, next: NextFunction) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const segments = parsePath(url.pathname);
    if (!segments) {
      next();
      return;
    }

    try {
      const { status, body } = await routeProjects(store, {
        method: req.method ?? "GET",
        segments,
        body: () => readBody(req),
      });
      sendJson(res, status, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, statusOf(error, message), { ok: false, error: message });
    }
  };
}
