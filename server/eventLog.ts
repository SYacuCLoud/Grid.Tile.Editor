/**
 * 이벤트 로그 — 브로커에서 받은 등장 · 제거 이벤트를 하루 한 파일(JSONL)로 쌓는다.
 *
 *   .grid-projects/.live/events/2026-09-16.main.jsonl
 *
 * 왜 파일인가: 이벤트는 하루 수백 건, 한 줄 200바이트 안이라 한 달을 모아도 수 MB 다. DB 를 두면
 * 설치 · 백업 · 권한이 따라오지만 파일은 폴더째 복사하면 끝이다. 도면 저장소(`.grid-projects`)와 같은 철학.
 *
 * 파일 이름의 `main` 은 기록한 프로세스 표시다. 개발 서버(3200)와 상시 서비스(3100)가 같은 브로커를 함께
 * 구독하면 둘 다 기록하므로 파일을 나누고, 읽을 때 이벤트 id 로 겹친 것을 걸러 낸다.
 *
 * 도면 문서는 여기서도 손대지 않는다 — 이벤트는 도면 리비전과 완전히 다른 층이다.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

export const EVENTS_DIR = ".live/events";
export const DEFAULT_RETENTION_DAYS = 30;
/** 한 번에 돌려주는 최대 건수. 화면은 "더 보기" 로 이전 구간을 이어 받는다. */
export const MAX_QUERY_LIMIT = 50_000;

export interface LoggedEvent {
  /** `${time}|${site}/${key}|${kind}` — 재전송 · 두 프로세스 기록을 한 건으로 합치는 열쇠. */
  id: string;
  /** 발행 쪽 시각(ISO). 없으면 빈 글자. */
  time: string;
  /** 서버가 받은 시각(ms). 파일 날짜와 조회 범위는 이것을 쓴다 — 감시 PC 시계가 어긋나도 파일이 흩어지지 않게. */
  receivedAt: number;
  site: string;
  key: string;
  kind: "APPEAR" | "REMOVE";
  uid: string;
  serial: string;
  reader: string;
  host: string;
  dwellMs: number | null;
}

export interface EventQuery {
  site?: string;
  key?: string;
  /** 받은 시각(ms) 범위. 둘 다 포함. */
  fromMs: number;
  toMs: number;
  /** 최신부터 이 건수만. 기본 200, 최대 MAX_QUERY_LIMIT. */
  limit?: number;
}

export interface EventQueryResult {
  events: LoggedEvent[];
  fromMs: number;
  toMs: number;
  /** limit 에 걸려 더 있는가. */
  truncated: boolean;
  /** 훑은 파일 수. 화면 진단용. */
  files: number;
}

export interface EventLogStatus {
  dir: string;
  instance: string;
  /** 이 프로세스가 켜진 뒤 기록한 건수. */
  appended: number;
  /** 오늘 파일들의 크기 합(바이트). */
  todayBytes: number;
  files: number;
  retentionDays: number;
}

export interface EventLog {
  dir: string;
  instance: string;
  append(event: LoggedEvent): boolean;
  query(q: EventQuery): EventQueryResult;
  /** 보관 일수를 넘은 파일을 지운다. 지운 파일 수. */
  prune(): number;
  status(): EventLogStatus;
}

export interface EventLogOptions {
  /** 파일 이름에 붙는 프로세스 표시. 기본은 GRID_LIVE_INSTANCE → NODE_ENV 로 `main`/`dev`. */
  instance?: string;
  retentionDays?: number;
  now?: () => number;
}

/**
 * 리더마다 가장 최근 이벤트가 제거(REMOVE)인 것만 — 화면을 새로 켰을 때 잔상을 되살리는 재료다.
 * `events` 는 조회 결과(최신이 앞). 마지막 이벤트가 등장이면 지금 놓여 있는 것이니 잔상이 아니다.
 * 결과는 리더 id(`site/key`) 순서 없이 처음 만난 순(= 최근 것부터).
 */
export function lastRemovals(events: LoggedEvent[]): LoggedEvent[] {
  const seen = new Set<string>();
  const out: LoggedEvent[] = [];
  for (const e of events) {
    const id = `${e.site}/${e.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (e.kind === "REMOVE" && e.uid) out.push(e);
  }
  return out;
}

/** 서버 로컬 날짜 `YYYY-MM-DD`. 하루 파일의 경계는 서버 시계다. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.([A-Za-z0-9_-]+)\.jsonl$/;

export function defaultInstance(): string {
  const env = process.env.GRID_LIVE_INSTANCE?.trim();
  if (env) return env.replace(/[^A-Za-z0-9_-]/g, "_");
  return process.env.NODE_ENV === "production" ? "main" : "dev";
}

export function createEventLog(dir?: string, options: EventLogOptions = {}): EventLog {
  const folder = resolve(dir ?? join(".grid-projects", EVENTS_DIR));
  const instance = options.instance ?? defaultInstance();
  const retentionDays = Math.max(1, options.retentionDays ?? DEFAULT_RETENTION_DAYS);
  const now = options.now ?? (() => Date.now());
  let appended = 0;
  // 최근 id — 같은 프로세스 안에서 QoS 1 재전송을 걸러 파일에 두 번 쓰지 않는다.
  const recent = new Set<string>();
  const recentOrder: string[] = [];

  function remember(id: string): boolean {
    if (recent.has(id)) return false;
    recent.add(id);
    recentOrder.push(id);
    if (recentOrder.length > 2000) {
      const old = recentOrder.splice(0, 1000);
      for (const x of old) recent.delete(x);
    }
    return true;
  }

  function listFiles(): { file: string; day: string; instance: string }[] {
    if (!existsSync(folder)) return [];
    const out: { file: string; day: string; instance: string }[] = [];
    for (const name of readdirSync(folder)) {
      const m = FILE_RE.exec(name);
      if (m) out.push({ file: join(folder, name), day: m[1], instance: m[2] });
    }
    return out.sort((a, b) => a.day.localeCompare(b.day));
  }

  return {
    dir: folder,
    instance,
    append: (event) => {
      if (!remember(event.id)) return false;
      mkdirSync(folder, { recursive: true });
      appendFileSync(join(folder, `${dayOf(event.receivedAt)}.${instance}.jsonl`), JSON.stringify(event) + "\n", "utf8");
      appended += 1;
      return true;
    },
    query: (q) => {
      const limit = Math.min(MAX_QUERY_LIMIT, Math.max(1, Math.trunc(q.limit ?? 200)));
      const fromDay = dayOf(q.fromMs);
      const toDay = dayOf(q.toMs);
      const files = listFiles().filter((f) => f.day >= fromDay && f.day <= toDay);
      const seen = new Set<string>();
      const events: LoggedEvent[] = [];
      for (const f of files) {
        let text: string;
        try {
          text = readFileSync(f.file, "utf8");
        } catch {
          continue;
        }
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          let e: LoggedEvent;
          try {
            e = JSON.parse(line) as LoggedEvent;
          } catch {
            continue; // 쓰다 끊긴 마지막 줄 같은 것. 한 줄 때문에 조회가 죽으면 안 된다.
          }
          if (typeof e.receivedAt !== "number" || e.receivedAt < q.fromMs || e.receivedAt > q.toMs) continue;
          if (q.site && e.site !== q.site) continue;
          if (q.key && e.key !== q.key) continue;
          if (!e.id || seen.has(e.id)) continue;
          seen.add(e.id);
          events.push(e);
        }
      }
      events.sort((a, b) => b.receivedAt - a.receivedAt || b.time.localeCompare(a.time));
      const truncated = events.length > limit;
      return { events: events.slice(0, limit), fromMs: q.fromMs, toMs: q.toMs, truncated, files: files.length };
    },
    prune: () => {
      const cutoff = dayOf(now() - retentionDays * 86_400_000);
      let removed = 0;
      for (const f of listFiles()) {
        if (f.day < cutoff) {
          try {
            unlinkSync(f.file);
            removed += 1;
          } catch {
            // 다른 프로세스가 쥐고 있으면 다음에.
          }
        }
      }
      return removed;
    },
    status: () => {
      const files = listFiles();
      const today = dayOf(now());
      let todayBytes = 0;
      for (const f of files) {
        if (f.day !== today) continue;
        try {
          todayBytes += statSync(f.file).size;
        } catch {
          // 없어졌으면 0
        }
      }
      return { dir: folder, instance, appended, todayBytes, files: files.length, retentionDays };
    },
  };
}
