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
import {
  type EventField,
  type FormatBook,
  formatFor,
  getPath,
  readBool,
  readInt,
  readKind,
  readString,
  readTime,
  type StateField,
  type StatusField,
} from "./messageFormat";

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
  /**
   * 잔상 — 마지막으로 놓여 있던 태그. 태그를 들어낸 뒤 다음 태그가 올 때까지 남는다.
   * 발행 쪽이 `lastUid` 를 실어 주면 화면을 늦게 켜도 채워지고, 아니면 이 브라우저가 본 제거 순간에 채운다.
   */
  lastUid: string;
  /** 들어낸 시각(ISO). 사람이 읽는 "n분 전" 용. */
  lastAt: string;
  /** 잔상을 만든 브라우저 시각(ms). 잔상 만료는 이것으로 센다 — 감시 PC 시계가 어긋나도 흔들리지 않게. */
  lastSeenAt: number;
}

/** 잔상 기본 유지 시간(분). 주소의 `?ghost=분` 으로 바꾼다. 0 이면 끔. */
export const DEFAULT_GHOST_MINUTES = 20;

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
  serial: string;
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
  /** 사업장별로 마지막에 받은 원문 페이로드. 형식 프로필 설정 화면이 "실제 메시지" 로 경로를 고르게 한다. */
  samples: Record<string, SiteSamples>;
}

export interface SiteSamples {
  state?: string;
  event?: string;
  status?: string;
}

export const EMPTY_LIVE: LiveModel = { readers: {}, hosts: {}, events: [], flashes: {}, received: 0, samples: {} };

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
 * 페이로드는 사업장의 형식 프로필(`book`)로 읽는다. 프로필이 없으면 v1(경로 = 필드 이름).
 * retained 토픽에 빈 페이로드가 오면 "지웠다" 는 뜻이라 그 항목을 뺀다.
 * 해석할 수 없는 페이로드는 조용히 무시한다 — 현황판이 한 메시지 때문에 죽으면 안 된다.
 */
export function applyMessage(model: LiveModel, topic: string, payload: string, now: number, book?: FormatBook | null): LiveModel {
  const parsed = parseTopic(topic);
  if (!parsed) return model;
  const received = model.received + 1;
  const fmt = formatFor(book, parsed.site);
  const rules = fmt.values;
  // 원문 표본. 형식 설정 화면이 "실제로 오는 메시지" 를 보여 주며 경로를 고르게 한다.
  const samples: Record<string, SiteSamples> =
    payload.trim() === "" ? model.samples : { ...model.samples, [parsed.site]: { ...model.samples[parsed.site], [parsed.kind]: payload } };

  if (parsed.kind === "status") {
    const id = readerId(parsed.site, parsed.host);
    if (payload.trim() === "") {
      if (!(id in model.hosts)) return { ...model, received };
      const hosts = { ...model.hosts };
      delete hosts[id];
      return { ...model, hosts, received };
    }
    const json = parseJson(payload);
    if (!json) return { ...model, received, samples };
    const g = (field: StatusField) => getPath(json, fmt.status[field]);
    const status: HostStatus = {
      id,
      site: parsed.site,
      host: readString(g("host")) || parsed.host,
      online: readBool(g("online"), rules),
      time: readTime(g("time"), rules) || null,
      version: readString(g("version")),
      readerCount: readInt(g("readerCount")),
      onlineReaders: readInt(g("onlineReaders")),
      presentReaders: readInt(g("presentReaders")),
      appearToday: readInt(g("appearToday")),
      removeToday: readInt(g("removeToday")),
      receivedAt: now,
    };
    return { ...model, hosts: { ...model.hosts, [id]: status }, received, samples };
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
    if (!json) return { ...model, received, samples };
    const g = (field: StateField) => getPath(json, fmt.state[field]);
    const onlineRaw = g("online");
    const prev = model.readers[id];
    const present = readBool(g("present"), rules);
    const uid = readString(g("uid"));
    const at = readTime(g("time"), rules) || readTime(json.at, rules);
    // 잔상: 태그가 있으면 없음. 방금 들어냈으면 직전 UID. 그 밖에는 (발행 쪽이 실어 준 값 →) 전에 만든 잔상 유지.
    let ghost = { lastUid: "", lastAt: "", lastSeenAt: 0 };
    if (!present) {
      const published = readString(g("lastUid"));
      if (prev?.present && prev.uid) ghost = { lastUid: prev.uid, lastAt: at || new Date(now).toISOString(), lastSeenAt: now };
      else if (prev?.lastUid) ghost = { lastUid: prev.lastUid, lastAt: prev.lastAt, lastSeenAt: prev.lastSeenAt };
      else if (published) ghost = { lastUid: published, lastAt: readTime(g("lastTime"), rules) || at, lastSeenAt: now };
    }
    const reader: ReaderState = {
      id,
      site: parsed.site,
      key: parsed.key,
      host: readString(g("host")),
      reader: readString(g("reader")) || readString(g("alias")) || readString(g("readerName")) || parsed.key,
      alias: readString(g("alias")),
      readerName: readString(g("readerName")),
      serial: readString(g("serial")),
      present,
      // online 이 없는 발행자는 살아 있는 것으로 본다.
      online: onlineRaw === undefined ? true : readBool(onlineRaw, rules),
      uid,
      tech: readString(g("tech")),
      state: readString(g("state")),
      // v1 은 `time`. 스키마 확정 전 시험판이 `at` 으로 냈으므로 그것도 받는다.
      at,
      receivedAt: now,
      ...ghost,
    };
    return { ...model, readers: { ...model.readers, [id]: reader }, received, samples };
  }

  // event
  const json = parseJson(payload);
  if (!json) return { ...model, received, samples };
  const g = (field: EventField) => getPath(json, fmt.event[field]);
  const kind: LiveEventKind = readKind(g("kind"), rules);
  const time = readTime(g("time"), rules);
  const dwellRaw = g("dwellMs");
  const event: LiveEvent = {
    id: `${time}|${id}|${kind}`,
    time,
    kind,
    readerId: id,
    site: parsed.site,
    key: parsed.key,
    reader: readString(g("reader")) || readString(g("alias")) || readString(g("readerName")) || parsed.key,
    serial: readString(g("serial")),
    uid: readString(g("uid")),
    dwellMs: dwellRaw === undefined || dwellRaw === null || dwellRaw === "" ? null : readInt(dwellRaw),
    host: readString(g("host")),
    receivedAt: now,
  };
  // 같은 이벤트가 두 번 오면(QoS 1 재전송) 한 번만 남긴다.
  if (model.events.some((e) => e.id === event.id)) return { ...model, received, samples };
  const events = [event, ...model.events].slice(0, MAX_EVENTS);
  // 제거 이벤트의 UID 로도 잔상을 채운다 — 상태(retained)가 먼저 와 잔상을 못 만든 리더를 위해.
  let readers = model.readers;
  const current = model.readers[id];
  if (kind === "REMOVE" && event.uid && current && !current.present && !current.lastUid) {
    readers = { ...readers, [id]: { ...current, lastUid: event.uid, lastAt: time || new Date(now).toISOString(), lastSeenAt: now } };
  }
  return { ...model, readers, events, flashes: { ...model.flashes, [id]: { kind, at: now } }, received, samples };
}

/** 잔상이 보일 때인가. 비어 있고, 잔상이 있고, 유지 시간 안. `ttlMs` 0 이면 끔. */
export function ghostVisible(reader: ReaderState, now: number, ttlMs: number): boolean {
  if (ttlMs <= 0 || reader.present || !reader.lastUid || !reader.online) return false;
  return now - reader.lastSeenAt <= ttlMs;
}

/** 주소의 `?ghost=분` → ms. 없으면 기본, 숫자가 아니면 기본, 음수는 0. */
export function ghostTtlMs(param: string | null): number {
  if (param === null || param.trim() === "") return DEFAULT_GHOST_MINUTES * 60_000;
  const minutes = Number(param);
  if (!Number.isFinite(minutes)) return DEFAULT_GHOST_MINUTES * 60_000;
  return Math.max(0, minutes) * 60_000;
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
  /** 잔상 글자. 흰 글씨(태그 있음)와 갈리게 진한 회색 — 벽걸이 거리에서도 읽혀야 한다. */
  ghost: "#334155",
  /** 잔상 칸의 옅은 채움. */
  ghostFill: "#94a3b8",
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
  /** 글자가 잔상(마지막에 있던 태그)인가. 회색 · 반투명으로 그린다. */
  ghost: boolean;
}

/**
 * 리더 상태 → 칸을 어떻게 그릴지.
 * `label` 을 주면 칸 글자로 그것을 쓴다(기준정보에서 찾은 실물 이름). 없으면 짧은 UID.
 * `ghostLabel` 은 비어 있는 칸에 남길 잔상 글자. 부르는 쪽이 `ghostVisible` 로 걸러 넘긴다.
 */
export function readerPaint(reader: ReaderState, label?: string, ghostLabel?: string): ReaderPaint {
  if (!reader.online) {
    return { fill: LIVE_COLORS.offline, fillAlpha: 0.35, stroke: LIVE_COLORS.offline, strokeWidth: 1.5, dashed: true, text: "", ghost: false };
  }
  if (reader.present) {
    return { fill: LIVE_COLORS.present, fillAlpha: 0.45, stroke: LIVE_COLORS.present, strokeWidth: 2, dashed: false, text: label || shortUid(reader.uid), ghost: false };
  }
  if (ghostLabel) {
    // 잔상 칸은 옅은 회색으로 살짝 채워 "비었지만 방금 무엇이 있었다" 가 한눈에 갈리게 한다.
    return { fill: LIVE_COLORS.ghostFill, fillAlpha: 0.35, stroke: LIVE_COLORS.empty, strokeWidth: 1.5, dashed: false, text: ghostLabel, ghost: true };
  }
  return { fill: null, fillAlpha: 0, stroke: LIVE_COLORS.empty, strokeWidth: 1.5, dashed: false, text: "", ghost: false };
}

// ------------------------------------------------------------ 칸 글자 맞추기

const LABEL_FONT = "system-ui, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
const UID_FONT = "ui-monospace, Consolas, monospace";
export const MIN_LABEL_FONT = 7;
const LINE_HEIGHT = 1.15;
const MAX_LABEL_LINES = 3;

export interface FittedLabel {
  lines: string[];
  font: string;
  fontSize: number;
  lineHeight: number;
}

type MeasureContext = Pick<CanvasRenderingContext2D, "measureText"> & { font: string };

/**
 * 실물 이름을 칸(들)의 폭 · 높이에 맞춘다.
 *
 * 한 줄로 안 들어가면 글자를 줄이고, 그래도 안 되면 띄어쓰기 자리에서 줄을 나누고(`통번호` / `129`),
 * 낱말 하나가 너무 길면 글자 단위로 자른다. 그래도 안 되면 짧은 UID 로 물러난다.
 * 벽걸이 화면에서 잘린 글자는 없는 것보다 나쁘다.
 */
export function fitLabel(ctx: MeasureContext, label: string, fallback: string, maxWidth: number, maxHeight: number, cell: number): FittedLabel {
  const base = Math.max(MIN_LABEL_FONT, Math.min(cell * 0.34, 18));
  const fits = (text: string, size: number, family: string) => {
    ctx.font = `700 ${size}px ${family}`;
    return ctx.measureText(text).width <= maxWidth;
  };
  const make = (lines: string[], size: number, family: string): FittedLabel => ({ lines, font: `700 ${size}px ${family}`, fontSize: size, lineHeight: size * LINE_HEIGHT });

  if (label && label !== fallback) {
    // 1) 한 줄, 글자 줄이기.
    for (let size = base; size >= MIN_LABEL_FONT; size -= 1) {
      if (fits(label, size, LABEL_FONT)) return make([label], size, LABEL_FONT);
    }
    // 2) 여러 줄. 큰 글자부터 시도해 들어가는 첫 크기를 쓴다.
    for (let size = base; size >= MIN_LABEL_FONT; size -= 1) {
      const maxLines = Math.min(MAX_LABEL_LINES, Math.floor(maxHeight / (size * LINE_HEIGHT)));
      if (maxLines < 2) continue;
      const lines = wrapLabel(label, maxLines, (text) => fits(text, size, LABEL_FONT));
      if (lines) return make(lines, size, LABEL_FONT);
    }
  }
  // 3) 짧은 UID.
  for (let size = base; size >= MIN_LABEL_FONT; size -= 1) {
    if (fits(fallback, size, UID_FONT)) return make([fallback], size, UID_FONT);
  }
  return make([fallback], MIN_LABEL_FONT, UID_FONT);
}

/** 띄어쓰기 자리에서 줄을 나눈다. 한 낱말이 폭을 넘으면 글자로 자른다. 줄 수를 넘으면 null. */
export function wrapLabel(label: string, maxLines: number, fits: (text: string) => boolean): string[] | null {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const push = (line: string) => {
    if (line) lines.push(line);
  };
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    push(current);
    current = "";
    if (fits(word)) {
      current = word;
      continue;
    }
    // 낱말이 너무 길다 — 글자로 자른다.
    let piece = "";
    for (const ch of word) {
      if (fits(piece + ch)) piece += ch;
      else {
        if (!piece) return null; // 글자 하나도 안 들어간다.
        push(piece);
        piece = ch;
      }
    }
    current = piece;
  }
  push(current);
  if (lines.length === 0 || lines.length > maxLines) return null;
  return lines;
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

/** 페이로드 앞의 BOM. Windows 도구(메모장 · PowerShell Set-Content)가 붙이면 JSON.parse 가 터진다. */
const PAYLOAD_BOM = String.fromCharCode(0xfeff);

function parseJson(payload: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(payload.startsWith(PAYLOAD_BOM) ? payload.slice(1) : payload);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

