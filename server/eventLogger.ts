/**
 * 이벤트 기록기 — 서버가 브로커를 직접 구독해 등장 · 제거 이벤트를 `EventLog` 에 쌓는다.
 *
 * 현황판(브라우저)은 열려 있을 때만 받지만, 서버는 늘 켜져 있으므로 "밤새 무엇이 지나갔나" 가 남는다.
 * 프로세스에 하나만 둔다(전역 심볼) — 개발 서버는 Vite 미들웨어와 App Router 라우트가 같은 프로세스라 둘 다 부를 수 있다.
 * 페이로드 해석은 현황판과 같은 `applyMessage`(형식 프로필 포함)를 그대로 써 두 곳이 어긋나지 않게 한다.
 *
 * 설정(선택): `.grid-projects/.live/logger.json`
 *   { "broker": "mqtt://127.0.0.1:1883", "prefix": "rfid", "site": "+", "retentionDays": 30, "enabled": true }
 * 없으면 같은 PC 의 브로커(1883)를 구독한다 — 상시 서비스와 브로커가 같은 PC 에 있는 것이 기본 배치다.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { applyMessage, EMPTY_LIVE } from "../app/live/liveState";
import type { EventLog, LoggedEvent } from "./eventLog";
import type { FormatStore } from "./formatStore";

export interface LoggerConfig {
  enabled: boolean;
  broker: string;
  prefix: string;
  site: string;
  retentionDays: number;
}

export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  enabled: true,
  broker: "mqtt://127.0.0.1:1883",
  prefix: "rfid",
  site: "+",
  retentionDays: 30,
};

export interface LoggerStatus {
  enabled: boolean;
  broker: string;
  topic: string;
  connected: boolean;
  /** 받은 메시지 수(이 프로세스). */
  received: number;
  /** 기록한 건수(재전송 · 해석 실패 제외). */
  logged: number;
  lastError: string | null;
  lastMessageAt: string | null;
  startedAt: string;
}

export interface EventLoggerHandle {
  status(): LoggerStatus;
  stop(): Promise<void>;
}

/** 시험에서 갈아 끼우는 최소한의 MQTT 클라이언트 모양. */
export interface MinimalMqttClient {
  on(event: "connect" | "close" | "error" | "message", handler: (...args: never[]) => void): unknown;
  subscribe(topic: string, options: { qos: 0 | 1 | 2 }): unknown;
  end(force?: boolean): unknown;
  connected?: boolean;
}

export type MqttConnect = (url: string, options: Record<string, unknown>) => Promise<MinimalMqttClient> | MinimalMqttClient;

export interface EventLoggerOptions {
  log: EventLog;
  formats: FormatStore;
  /** 설정 파일이 놓인 폴더(`.grid-projects/.live`). */
  configDir: string;
  connect?: MqttConnect;
  now?: () => number;
  logger?: (message: string) => void;
  /**
   * 상태를 주기적으로 적어 둘 파일. 기록기가 별도 프로세스로 돌 때 웹 서버가 이것을 읽어 `/api/live/events/status` 에 싣는다.
   */
  statusFile?: string;
}

/** 별도 프로세스 기록기가 남긴 상태 파일. 너무 오래됐으면(30초 넘게 갱신 없음) 죽은 것으로 본다. */
export function readLoggerStatusFile(file: string, now: number = Date.now()): (LoggerStatus & { stale: boolean; writtenAt: string }) | null {
  try {
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, "utf8")) as LoggerStatus & { writtenAt?: string };
    const written = typeof raw.writtenAt === "string" ? Date.parse(raw.writtenAt) : Number.NaN;
    const stale = !Number.isFinite(written) || now - written > 30_000;
    return { ...raw, writtenAt: raw.writtenAt ?? "", stale, connected: stale ? false : raw.connected };
  } catch {
    return null;
  }
}

export function readLoggerConfig(configDir: string): LoggerConfig {
  const file = join(configDir, "logger.json");
  if (!existsSync(file)) return { ...DEFAULT_LOGGER_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8").replace(new RegExp("^" + String.fromCharCode(0xfeff)), "")) as Record<string, unknown>;
    return {
      enabled: raw.enabled !== false,
      broker: typeof raw.broker === "string" && raw.broker.trim() ? raw.broker.trim() : DEFAULT_LOGGER_CONFIG.broker,
      prefix: typeof raw.prefix === "string" && raw.prefix.trim() ? raw.prefix.trim() : DEFAULT_LOGGER_CONFIG.prefix,
      site: typeof raw.site === "string" && raw.site.trim() ? raw.site.trim() : DEFAULT_LOGGER_CONFIG.site,
      retentionDays: typeof raw.retentionDays === "number" && raw.retentionDays >= 1 ? Math.trunc(raw.retentionDays) : DEFAULT_LOGGER_CONFIG.retentionDays,
    };
  } catch {
    return { ...DEFAULT_LOGGER_CONFIG };
  }
}

/** 기본 접속 — `mqtt` 패키지. 그때 불러 시험과 Worker 빌드가 드라이버를 끌어오지 않게 한다. */
const mqttConnect: MqttConnect = async (url, options) => {
  const mod = (await import("mqtt")) as unknown as { default?: { connect: MqttConnect }; connect?: MqttConnect };
  const connect = mod.default?.connect ?? mod.connect;
  if (!connect) throw new Error("mqtt 패키지를 불러오지 못했습니다.");
  return connect(url, options);
};

const GLOBAL_KEY = Symbol.for("grid-tile-editor.live.event-logger");

/** 이미 도는 기록기가 있으면 그것을 돌려준다. 없으면 만든다. */
export function startEventLogger(options: EventLoggerOptions): EventLoggerHandle {
  const g = globalThis as unknown as Record<symbol, EventLoggerHandle | undefined>;
  const existing = g[GLOBAL_KEY];
  if (existing) return existing;
  const handle = createEventLogger(options);
  g[GLOBAL_KEY] = handle;
  return handle;
}

export function createEventLogger(options: EventLoggerOptions): EventLoggerHandle {
  const { log, formats } = options;
  const config = readLoggerConfig(options.configDir);
  const connect = options.connect ?? mqttConnect;
  const now = options.now ?? (() => Date.now());
  const say = options.logger ?? ((message: string) => console.log(`[live-log] ${message}`));
  const topic = `${config.prefix}/${config.site}/reader/+/event`;
  const startedAt = new Date(now()).toISOString();

  let client: MinimalMqttClient | null = null;
  let connected = false;
  let received = 0;
  let logged = 0;
  let lastError: string | null = null;
  let lastMessageAt: string | null = null;
  let stopped = false;

  function onMessage(topicName: string, payload: { toString(): string }) {
    received += 1;
    const at = now();
    lastMessageAt = new Date(at).toISOString();
    try {
      const book = { sites: formats.book().sites };
      const model = applyMessage(EMPTY_LIVE, topicName, payload.toString(), at, book);
      const e = model.events[0];
      if (!e) return;
      const record: LoggedEvent = {
        id: e.id,
        time: e.time,
        receivedAt: at,
        site: e.site,
        key: e.key,
        kind: e.kind,
        uid: e.uid,
        serial: e.serial,
        reader: e.reader,
        host: e.host,
        dwellMs: e.dwellMs,
      };
      if (log.append(record)) logged += 1;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const status = (): LoggerStatus => ({ enabled: config.enabled, broker: config.broker, topic, connected, received, logged, lastError, lastMessageAt, startedAt });

  // 보관 정리는 켤 때 한 번, 그 뒤 하루에 한 번.
  const pruned = log.prune();
  if (pruned > 0) say(`오래된 이벤트 파일 ${pruned}개 정리`);
  const pruneTimer = setInterval(() => log.prune(), 24 * 60 * 60 * 1000);
  (pruneTimer as { unref?: () => void }).unref?.();

  // 상태 파일 — 별도 프로세스로 돌 때 웹 서버가 읽는다. 10초마다 덮어쓴다.
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  const writeStatus = () => {
    if (!options.statusFile) return;
    try {
      mkdirSync(dirname(options.statusFile), { recursive: true });
      writeFileSync(options.statusFile, JSON.stringify({ ...status(), writtenAt: new Date(now()).toISOString(), pid: process.pid }), "utf8");
    } catch {
      // 상태 파일은 진단용이다. 못 써도 기록은 계속한다.
    }
  };
  if (options.statusFile) {
    writeStatus();
    statusTimer = setInterval(writeStatus, 10_000);
    (statusTimer as { unref?: () => void }).unref?.();
  }

  if (config.enabled) {
    void (async () => {
      try {
        const c = await connect(config.broker, {
          clientId: `grid-live-log-${log.instance}-${Math.random().toString(36).slice(2, 8)}`,
          clean: true,
          reconnectPeriod: 5000,
          connectTimeout: 8000,
          keepalive: 30,
        });
        if (stopped) {
          c.end(true);
          return;
        }
        client = c;
        c.on("connect", (() => {
          connected = true;
          lastError = null;
          c.subscribe(topic, { qos: 1 });
          say(`브로커 ${config.broker} 구독 ${topic} (${log.instance})`);
        }) as never);
        c.on("close", (() => {
          connected = false;
        }) as never);
        c.on("error", ((err: Error) => {
          lastError = err.message;
        }) as never);
        c.on("message", onMessage as never);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        say(`브로커 접속 실패 — ${lastError}`);
      }
    })();
  } else {
    say("logger.json 의 enabled:false — 이벤트를 기록하지 않습니다.");
  }

  return {
    status,
    stop: async () => {
      stopped = true;
      clearInterval(pruneTimer);
      if (statusTimer) clearInterval(statusTimer);
      client?.end(true);
      client = null;
      if (options.statusFile) {
        try {
          unlinkSync(options.statusFile);
        } catch {
          // 없으면 그만
        }
      }
      const g = globalThis as unknown as Record<symbol, EventLoggerHandle | undefined>;
      if (g[GLOBAL_KEY]) delete g[GLOBAL_KEY];
    },
  };
}
