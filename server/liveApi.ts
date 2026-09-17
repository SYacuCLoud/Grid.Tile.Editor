/**
 * `/api/live` 를 Node 개발 서버(Vite 미들웨어)에 붙이는 껍데기. 규칙은 `liveRouter.ts`.
 * 형식 프로필 저장소 · 이벤트 로그 · 브로커 기록기를 한데 묶어 `LiveStore` 로 만든다.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";

import { createEventLog, type EventLogOptions, EVENTS_DIR } from "./eventLog";
import { type EventLoggerHandle, type MqttConnect, startEventLogger } from "./eventLogger";
import { createFormatStore, FORMAT_DIR, type FormatStoreOptions } from "./formatStore";
import { LIVE_API_BASE, type LiveStore, liveStatusOf, parseLivePath, routeLive } from "./liveRouter";

export { LIVE_API_BASE, parseLivePath };

const MAX_BODY_BYTES = 256 * 1024;

export interface LiveApiOptions extends FormatStoreOptions {
  eventLog?: EventLogOptions;
  /** 브로커 기록기를 켤지. 시험에서는 false 또는 가짜 connect. */
  logger?: boolean;
  connect?: MqttConnect;
  /** 라우트의 시계(ms). 시험이 고정한다. (`now` 는 FormatStoreOptions 가 Date 로 쓴다.) */
  clock?: () => number;
}

/** 형식 저장소 · 이벤트 로그 · 기록기를 한 벌로. App Router 라우트도 이것을 쓴다. */
export function createLiveStore(dir?: string, options: LiveApiOptions = {}): LiveStore {
  const root = resolve(dir ?? ".grid-projects");
  const formats = createFormatStore(root, options);
  const events = createEventLog(join(root, EVENTS_DIR), options.eventLog);
  let logger: EventLoggerHandle | null = null;
  if (options.logger !== false) {
    logger = startEventLogger({
      log: events,
      formats,
      configDir: join(root, FORMAT_DIR),
      connect: options.connect,
      logger: options.log,
      statusFile: join(root, EVENTS_DIR, `logger-status.${events.instance}.json`),
    });
  }
  return { formats, events, logger };
}

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

export function createLiveApi(dir?: string, options?: LiveApiOptions): { middleware: (req: IncomingMessage, res: ServerResponse, next: NextFunction) => Promise<void>; store: LiveStore } {
  const store = createLiveStore(dir, options);

  async function middleware(req: IncomingMessage, res: ServerResponse, next: NextFunction) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const segments = parseLivePath(url.pathname);
    if (!segments) {
      next();
      return;
    }
    try {
      const { status, body } = await routeLive(store, { method: req.method ?? "GET", segments, query: url.searchParams, body: () => readBody(req) }, options?.clock);
      sendJson(res, status, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, liveStatusOf(error), { ok: false, error: message });
    }
  }

  return { middleware, store };
}
