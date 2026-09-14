/**
 * 실시간 현황판 — MQTT 로 받은 리더 상태를 도면 칸에 잇는 순수 계산.
 *
 * RfidReaderMonitor 가 발행하는 토픽 세 갈래를 받는다.
 *   {prefix}/{site}/reader/{key}/state   retained · 리더의 지금 상태
 *   {prefix}/{site}/reader/{key}/event   등장 · 제거 이벤트
 *   {prefix}/{site}/host/{host}/status   retained + LWT · 감시 PC 의 online/offline
 * 페이로드 형식(v1)과 JSON Schema 는 RfidReaderMonitor 저장소 docs/mqtt/ 에 있다.
 * 여기서는 모르는 필드를 무시하고, 없는 필드는 빈 값으로 채운다 — 판이 올라도 화면이 죽지 않게.
 *
 * 여기서는 문서(도면)를 한 글자도 바꾸지 않는다. 받은 값은 `LiveModel` 에만 쌓이고
 * 화면은 그 위에 오버레이로 그린다 — 이벤트가 리비전을 만들면 이력이 초 단위로 쌓이고
 * 사람 편집과 부딪친다.
 *
 * 브라우저 · MQTT 클라이언트 없이 시험할 수 있게 입출력을 모두 값으로 둔다.
 */

import { type PageDoc, type Point, type ProjectDoc, parseCellKey } from "../editor/doc";

/** 리더 한 대의 지금. `…/state` 페이로드 그대로에 토픽에서 읽은 자리를 붙인 것. */
export interface ReaderState {
  /** `{site}/{key}` — 사업장이 여럿이어도 같은 S/N 이 섞이지 않게. */
  id: string;
  site: string;
  /** 토픽 마디. RfidReaderMonitor 는 S/N → 별명 → 이름 순으로 채운다. */
  key: string;
  host: string;
  /** 사람이 부르는 이름(별명이 있으면 별명). */
  reader: string;
  alias: string;
  readerName: string;
  serial: string;
  present: boolean;
  online: boolean;
  uid: string;
  tech: string;
  state: string;
  /** 상태가 바뀐 시각(ISO). */
  at: string;
  /** 이 브라우저가 받은 시각(ms). */
  receivedAt: number;
}

export interface HostStatus {
  id: string;
  site: string;
  host: string;
  online: boolean;
  time: string | null;
  version: string;
  readerCount: number;
  onlineReaders: number;
  presentReaders: number;
  appearToday: number;
  removeToday: number;
  receivedAt: number;
}

export type LiveEventKind = "APPEAR" | "REMOVE";

export interface LiveEvent {
  id: string;
  time: string;
  kind: LiveEventKind;
  readerId: string;
  site: string;
  key: string;
  reader: string;
  uid: string;
  dwellMs: number | null;
  host: string;
  receivedAt: number;
}

/** 방금 일어난 이벤트의 잔상. 칸 둘레에 번쩍이는 테를 그릴 근거다. */
export interface Flash {
  kind: LiveEventKind;
  at: number;
}

export interface LiveModel {
  readers: Record<string, ReaderState>;
  hosts: Record<string, HostStatus>;
  /** 최신이 앞. `MAX_EVENTS` 에서 끊는다. */
  events: LiveEvent[];
  flashes: Record<string, Flash>;
  /** 받은 메시지 수. 연결이 살아 있는지 눈으로 보는 용도. */
  received: number;
}

export const EMPTY_LIVE: LiveModel = { readers: {}, hosts: {}, events: [], flashes: {}, received: 0 };

/** 화면에 남기는 이벤트 수. 현황판은 "지금" 이 먼저라 길게 두지 않는다. */
export const MAX_EVENTS = 60;
/** 잔상이 사라지는 데 걸리는 시간(ms). */
export const FLASH_MS = 2500;

export type ParsedTopic =
  | { kind: "state" | "event"; site: string; key: string }
  | { kind: "status"; site: string; host: string };

/**
 * 토픽을 읽는다. 첫 마디(prefix)는 무엇이든 받는다 — 브로커 하나에 여러 시스템이
 * 섞일 때 `rfid` 가 아닐 수 있고, 구독 필터가 이미 골라 준 뒤라 여기서 다시 따지지 않는다.
 */
export function parseTopic(topic: string): ParsedTopic | null {
  const parts = topic.split("/");
  if (parts.length !== 5) return null;
  const [, site, group, name, leaf] = parts;
  if (!site || !name) return null;
  if (group === "reader" && (leaf === "state" || leaf === "event")) return { kind: leaf, site, key: name };
  if (group === "host" && leaf === "status") return { kind: "status", site, host: name };
  return null;
}

export function readerId(site: string, key: string): string {
  return `${site}/${key}`;
}

/**
 * 메시지 하나를 모델에 반영한 새 모델을 돌려준다.
 *
 * retained 토픽에 빈 페이로드가 오면 "지웠다" 는 뜻이라 그 항목을 뺀다.
 * 해석할 수 없는 페이로드는 조용히 무시한다 — 현황판이 한 메시지 때문에 죽으면 안 된다.
 */
export function applyMessage(model: LiveModel, topic: string, payload: string, now: number): LiveModel {
  const parsed = parseTopic(topic);
  if (!parsed) return model;
  const received = model.received + 1;

  if (parsed.kind === "status") {
    const id = readerId(parsed.site, parsed.host);
    if (payload.trim() === "") {
      if (!(id in model.hosts)) return { ...model, received };
      const hosts = { ...model.hosts };
      delete hosts[id];
      return { ...model, hosts, received };
    }
    const json = parseJson(payload);
    if (!json) return { ...model, received };
    const status: HostStatus = {
      id,
      site: parsed.site,
      host: str(json.host) || parsed.host,
      online: bool(json.online),
      time: str(json.time) || null,
      version: str(json.version),
      readerCount: int(json.readerCount),
      onlineReaders: int(json.onlineReaders),
      presentReaders: int(json.presentReaders),
      appearToday: int(json.appearToday),
      removeToday: int(json.removeToday),
      receivedAt: now,
    };
    return { ...model, hosts: { ...model.hosts, [id]: status }, received };
  }

  const id = readerId(parsed.site, parsed.key);

  if (parsed.kind === "state") {
    if (payload.trim() === "") {
      if (!(id in model.readers)) return { ...model, received };
      const readers = { ...model.readers };
      delete readers[id];
      return { ...model, readers, received };
    }
    const json = parseJson(payload);
    if (!json) return { ...model, received };
    const reader: ReaderState = {
      id,
      site: parsed.site,
      key: parsed.key,
      host: str(json.host),
      reader: str(json.reader) || str(json.alias) || str(json.readerName) || parsed.key,
      alias: str(json.alias),
      readerName: str(json.readerName),
      serial: str(json.serial),
      present: bool(json.present),
      online: json.online === undefined ? true : bool(json.online),
      uid: str(json.uid),
      tech: str(json.tech),
      state: str(json.state),
      // v1 은 `time`. 스키마 확정 전 시험판이 `at` 으로 냈으므로 그것도 받는다.
      at: str(json.time) || str(json.at),
      receivedAt: now,
    };
    return { ...model, readers: { ...model.readers, [id]: reader }, received };
  }

  // event
  const json = parseJson(payload);
  if (!json) return { ...model, received };
  const kind: LiveEventKind = str(json.kind) === "REMOVE" ? "REMOVE" : "APPEAR";
  const time = str(json.time);
  const event: LiveEvent = {
    id: `${time}|${id}|${kind}`,
    time,
    kind,
    readerId: id,
    site: parsed.site,
    key: parsed.key,
    reader: str(json.reader) || str(json.alias) || str(json.readerName) || parsed.key,
    uid: str(json.uid),
    dwellMs: typeof json.dwellMs === "number" ? json.dwellMs : null,
    host: str(json.host),
    receivedAt: now,
  };
  // 같은 이벤트가 두 번 오면(QoS 1 재전송) 한 번만 남긴다.
  if (model.events.some((e) => e.id === event.id)) return { ...model, received };
  const events = [event, ...model.events].slice(0, MAX_EVENTS);
  return { ...model, events, flashes: { ...model.flashes, [id]: { kind, at: now } }, received };
}

/** 잔상의 남은 진하기(1 → 0). 끝났으면 0. */
export function flashAlpha(flash: Flash | undefined, now: number): number {
  if (!flash) return 0;
  const t = (now - flash.at) / FLASH_MS;
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return 1 - t;
}

/** 아직 살아 있는 잔상만 남긴다. 오래된 것을 지워 두어야 매 틱 훑는 양이 늘지 않는다. */
export function pruneFlashes(model: LiveModel, now: number): LiveModel {
  const alive: Record<string, Flash> = {};
  let changed = false;
  for (const [id, flash] of Object.entries(model.flashes)) {
    if (flashAlpha(flash, now) > 0) alive[id] = flash;
    else changed = true;
  }
  return changed ? { ...model, flashes: alive } : model;
}

/** 잔상이 하나라도 살아 있는가. 있으면 화면을 빠르게 다시 그린다. */
export function hasLiveFlash(model: LiveModel, now: number): boolean {
  return Object.values(model.flashes).some((flash) => flashAlpha(flash, now) > 0);
}

// ------------------------------------------------------------ 도면과 잇기

/** 도면 칸에 자리 잡은 리더. 한 장치가 여러 칸에 걸쳐 있으면 칸이 여럿이다. */
export interface PlacedReader {
  reader: ReaderState;
  cells: Point[];
  /** 장치 대장으로 찾았으면 그 id. 식별자 글자로 찾았으면 null. */
  deviceId: string | null;
}

export interface ReaderMatch {
  placed: PlacedReader[];
  /** 이 페이지에 자리가 없는 리더. 대장 등록을 유도하는 목록이다. */
  unplaced: ReaderState[];
}

function norm(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * 리더를 도면 칸에 잇는다.
 *
 * 1순위는 장치 대장 — 대장의 S/N 이 리더의 S/N(또는 토픽 키)과 같으면 그 장치가 놓인
 * 칸(`deviceId`)이다. 대장을 안 쓰는 도면을 위해 칸 식별자(label)가 S/N 이나 별명과
 * 같은 칸도 받는다. 어느 쪽으로도 자리가 없으면 `unplaced` 로 간다.
 */
export function matchReaders(project: ProjectDoc, page: PageDoc, readers: ReaderState[]): ReaderMatch {
  const devices = project.devices ?? [];
  const bySerial = new Map<string, string>();
  for (const device of devices) {
    const serial = norm(device.serial);
    if (serial && !bySerial.has(serial)) bySerial.set(serial, device.id);
  }

  const cellsByDevice = new Map<string, Point[]>();
  const cellsByLabel = new Map<string, Point[]>();
  for (const [key, cell] of Object.entries(page.equipment)) {
    const point = parseCellKey(key);
    if (cell.deviceId) {
      const list = cellsByDevice.get(cell.deviceId) ?? [];
      list.push(point);
      cellsByDevice.set(cell.deviceId, list);
    }
    const label = norm(cell.label);
    if (label) {
      const list = cellsByLabel.get(label) ?? [];
      list.push(point);
      cellsByLabel.set(label, list);
    }
  }

  const placed: PlacedReader[] = [];
  const unplaced: ReaderState[] = [];
  for (const reader of readers) {
    const deviceId = bySerial.get(norm(reader.serial)) ?? bySerial.get(norm(reader.key)) ?? null;
    let cells = deviceId ? (cellsByDevice.get(deviceId) ?? []) : [];
    if (cells.length === 0) {
      cells =
        cellsByLabel.get(norm(reader.serial)) ??
        cellsByLabel.get(norm(reader.alias)) ??
        cellsByLabel.get(norm(reader.key)) ??
        [];
    }
    if (cells.length > 0) placed.push({ reader, cells: sortPoints(cells), deviceId });
    else unplaced.push(reader);
  }
  placed.sort((a, b) => a.reader.reader.localeCompare(b.reader.reader, "ko"));
  unplaced.sort((a, b) => a.reader.localeCompare(b.reader, "ko"));
  return { placed, unplaced };
}

function sortPoints(points: Point[]): Point[] {
  return [...points].sort((a, b) => a.y - b.y || a.x - b.x);
}

// ------------------------------------------------------------ 그리기 규칙

/** 오버레이 색. 칸 위에 얹는 것이라 도면 색과 갈리는 진한 계열을 쓴다. */
export const LIVE_COLORS = {
  present: "#16a34a",
  empty: "#0284c7",
  offline: "#6b7280",
  appear: "#22c55e",
  remove: "#f97316",
} as const;

export interface ReaderPaint {
  /** 칸 안을 채울 색. 채우지 않으면 null. */
  fill: string | null;
  fillAlpha: number;
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
  /** 칸 안에 적을 글자. 없으면 빈 문자열. */
  text: string;
}

/** 리더 상태 → 칸을 어떻게 그릴지. */
export function readerPaint(reader: ReaderState): ReaderPaint {
  if (!reader.online) {
    return { fill: LIVE_COLORS.offline, fillAlpha: 0.35, stroke: LIVE_COLORS.offline, strokeWidth: 1.5, dashed: true, text: "" };
  }
  if (reader.present) {
    return { fill: LIVE_COLORS.present, fillAlpha: 0.45, stroke: LIVE_COLORS.present, strokeWidth: 2, dashed: false, text: shortUid(reader.uid) };
  }
  return { fill: null, fillAlpha: 0, stroke: LIVE_COLORS.empty, strokeWidth: 1.5, dashed: false, text: "" };
}

/** 칸에 적을 만큼 짧은 UID. 끝 6자리면 한 현장 안에서는 갈린다. */
export function shortUid(uid: string): string {
  const clean = uid.replace(/\s+/g, "");
  if (clean.length <= 6) return clean;
  return clean.slice(-6);
}

/** 사람이 읽는 "n초 전". */
export function formatAgo(iso: string | null, now: number): string {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "-";
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 ${min % 60}분 전`;
  return `${Math.floor(hour / 24)}일 전`;
}

/** 체류 시간을 짧게. `12.3초` · `3.4분` */
export function formatDwell(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}초`;
  return `${(ms / 60_000).toFixed(1)}분`;
}

/** 현황판 구독 필터. 사업장을 안 정하면 `+` 로 모두 받는다. */
export function subscriptionTopics(prefix: string, site: string): string[] {
  const p = prefix.trim() || "rfid";
  const s = site.trim() || "+";
  return [`${p}/${s}/reader/+/state`, `${p}/${s}/reader/+/event`, `${p}/${s}/host/+/status`];
}

/** 기본 브로커 주소. 도면 서버와 같은 PC 의 WebSocket 리스너(9001). */
export function defaultBrokerUrl(hostname: string): string {
  return `ws://${hostname || "localhost"}:9001`;
}

// ------------------------------------------------------------ JSON 도우미

function parseJson(payload: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(payload);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function bool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "true" || value === "1";
  return false;
}

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}
