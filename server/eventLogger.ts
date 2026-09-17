/**
 * 이벤트 기록기 — 서버가 브로커를 직접 구독해 등장 · 제거 이벤트를 `EventLog` 에 쌓는다.
 *
 * 현황판(브라우저)은 열려 있을 때만 받지만, 서버는 늘 켜져 있으므로 "밤새 무엇이 지나갔나" 가 남는다.
 * 프로세스에 하나만 둔다(전역 심볼) — 개발 서버는 Vite 미들웨어와 App Router 라우트가 같은 프로세스라 둘 다 부를 수 있다.
 * 페이로드 해석은 현황판과 같은 `applyMessage`(형식 프로필 포함)를 그대로 써 두 곳이 어긋나지 않게 한다.
 *
 * 영속 세션(2026-09-18): 상시 서비스(`main`)는 **고정 clientId + clean:false** 로 붙는다. 그래야 기록기가 죽어 있는 동안
 * 브로커가 QoS 1 이벤트를 세션 큐에 쌓아 두고, 다시 붙으면 한꺼번에 내려준다(브로커 `max_queued_messages` 만큼).
 * 2026-09-17 저녁 서비스가 통째로 죽어 15시간 이력이 사라진 뒤 들어간 장치다. 개발 서버(`dev`)는 여러 개가 동시에 뜰 수
 * 있어(Vite · start:test) 기본은 임시 세션이다 — 같은 clientId 두 개가 붙으면 브로커가 서로를 끊어 핑퐁이 난다.
 *
 * 늦게 온 이벤트(브로커 큐 · 감시 PC 의 재발행)는 받은 시각이 아니라 **이벤트 자신의 시각** 자리에 기록한다. 그래야 이력이
 * "어젯밤 그 시간" 에 나타난다. 실제로 받은 시각은 `loggedAt` 에 남긴다.
 *
 * 설정(선택): `.grid-projects/.live/logger.json`
 *   { "broker": "mqtt://127.0.0.1:1883", "prefix": "rfid", "site": "+", "retentionDays": 30, "enabled": true,
 *     "persistent": true, "clientId": "grid-live-log-main" }
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
  /** 영속 세션(고정 clientId · clean:false). null 이면 프로세스 표시가 `main` 일 때만. */
  persistent: boolean | null;
  /** 영속 세션의 clientId. null 이면 `grid-live-log-<표시>`. */
  clientId: string | null;
}

export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  enabled: true,
  broker: "mqtt://127.0.0.1:1883",
  prefix: "rfid",
  site: "+",
  retentionDays: 30,
  persistent: null,
  clientId: null,
};

/** 이벤트 시각이 받은 시각보다 이만큼 넘게 앞서면 "늦게 온 것" 으로 보고 이벤트 시각 자리에 기록한다. 감시 PC 시계 편차(수 초)보다 넉넉히. */
export const LATE_MS = 60_000;

export interface LoggerStatus {
  enabled: boolean;
  broker: string;
  topic: string;
  clientId: string;
  persistent: boolean;
  connected: boolean;
  /** 마지막 접속에서 브로커가 이전 세션을 이어 줬는가(쌓아 둔 이벤트가 내려온다). */
  sessionPresent: boolean;
  /** 받은 메시지 수(이 프로세스). */
  received: number;
  /** 기록한 건수(재전송 · 해석 실패 제외). */
  logged: number;
  /** 기록한 것 중 늦게 온(브로커 큐 · 재발행) 건수. */
  late: number;
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
  subscribe(topic: string | string[], options: { qos: 0 | 1 | 2 }): unknown;
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
      persistent: typeof raw.persistent === "boolean" ? raw.persistent : null,
      clientId: typeof raw.clientId === "string" && raw.clientId.trim() ? raw.clientId.trim() : null,
    };
  } catch {
    return { ...DEFAULT_LOGGER_CONFIG };
  }
}

/** 접속 옵션. 영속이면 고정 clientId · clean:false, 아니면 임시 clientId · clean:true. */
export function connectOptions(config: LoggerConfig, instance: string): { clientId: string; clean: boolean; persistent: boolean } {
  const persistent = config.persistent ?? instance === "main";
  const clientId = persistent ? (config.clientId ?? `grid-live-log-${instance}`) : `grid-live-log-${instance}-${Math.random().toString(36).slice(2, 8)}`;
  return { clientId, clean: !persistent, persistent };
}

/**
 * 기록할 자리(receivedAt). 늦게 온 이벤트는 자신의 시각, 아니면 받은 시각.
 * 시각을 못 읽는 페이로드는 받은 시각이다.
 */
export function placementOf(eventTime: string, receivedAt: number): { receivedAt: number; late: boolean } {
  const t = Date.parse(eventTime);
  if (!Number.isFinite(t) || receivedAt - t <= LATE_MS) return { receivedAt, late: false };
  return { receivedAt: t, late: true };
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
  // 실시간 이벤트와, 감시 PC 가 CSV 에서 다시 낸 이벤트(`…/replay`, 현황판은 구독하지 않고 기록기만 받는다).
  const topics = [`${config.prefix}/${config.site}/reader/+/event`, `${config.prefix}/${config.site}/reader/+/replay`];
  const topic = topics.join(" ");
  const session = connectOptions(config, log.instance);
  const startedAt = new Date(now()).toISOString();

  let client: MinimalMqttClient | null = null;
  let connected = false;
  let sessionPresent = false;
  let received = 0;
  let logged = 0;
  let late = 0;
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
      const place = placementOf(e.time, at);
      const record: LoggedEvent = {
        id: e.id,
        time: e.time,
        receivedAt: place.receivedAt,
        site: e.site,
        key: e.key,
        kind: e.kind,
        uid: e.uid,
        serial: e.serial,
        reader: e.reader,
        host: e.host,
        dwellMs: e.dwellMs,
      };
      if (place.late) record.loggedAt = at;
      if (log.append(record)) {
        logged += 1;
        if (place.late) late += 1;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const status = (): LoggerStatus => ({
    enabled: config.enabled,
    broker: config.broker,
    topic,
    clientId: session.clientId,
    persistent: session.persistent,
    connected,
    sessionPresent,
    received,
    logged,
    late,
    lastError,
    lastMessageAt,
    startedAt,
  });

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
          clientId: session.clientId,
          clean: session.clean,
          reconnectPeriod: 5000,
          connectTimeout: 8000,
          keepalive: 30,
        });
        if (stopped) {
          c.end(true);
          return;
        }
        client = c;
        c.on("connect", ((connack?: { sessionPresent?: boolean }) => {
          connected = true;
          lastError = null;
          sessionPresent = connack?.sessionPresent === true;
          // 영속 세션은 구독이 브로커에 남아 있지만, 처음 붙는 세션(sessionPresent:false)은 여기서 걸어야 한다. 다시 걸어도 해가 없다.
          c.subscribe(topics, { qos: 1 });
          say(
            `브로커 ${config.broker} 구독 ${topic} (${log.instance} · ${session.clientId}${session.persistent ? (sessionPresent ? " · 세션 이어받음 — 쌓인 이벤트를 받는다" : " · 새 영속 세션") : " · 임시 세션"})`,
          );
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
