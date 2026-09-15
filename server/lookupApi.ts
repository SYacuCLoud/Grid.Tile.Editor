/**
 * `/api/lookup` 을 Node 개발 서버(Vite 미들웨어)에 붙이는 껍데기.
 * 경로 규칙은 `lookupRouter.ts`, 실제 일은 `lookupStore.ts` 가 한다.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { createLookupStore, type LookupStore, type LookupStoreOptions } from "./lookupStore";
import { LOOKUP_API_BASE, lookupStatusOf, parseLookupPath, routeLookup } from "./lookupRouter";

export { LOOKUP_API_BASE, parseLookupPath };

const MAX_BODY_BYTES = 1024 * 1024;

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
    if (size > MAX_BODY_BYTES) throw new Error("보낸 내용이 너무 큽니다.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("JSON 형식이 아닙니다.");
  }
}

type NextFunction = (error?: unknown) => void;

export function createLookupApi(dir?: string, options?: LookupStoreOptions): { middleware: (req: IncomingMessage, res: ServerResponse, next: NextFunction) => Promise<void>; store: LookupStore } {
  const store = createLookupStore(dir, options);
  store.start();

  async function middleware(req: IncomingMessage, res: ServerResponse, next: NextFunction) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const segments = parseLookupPath(url.pathname);
    if (!segments) {
      next();
      return;
    }
    try {
      const { status, body } = await routeLookup(store, {
        method: req.method ?? "GET",
        segments,
        query: url.searchParams,
        body: () => readBody(req),
      });
      sendJson(res, status, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, lookupStatusOf(error), { ok: false, error: message });
    }
  }

  return { middleware, store };
}
