/**
 * 실시간 현황판 — MQTT 페이로드 **형식 프로필**.
 *
 * 현황판이 쓰는 모델 필드(상태의 uid · present · online …, 이벤트의 kind · time …, PC 상태의 online …)마다
 * 페이로드 JSON 의 어느 경로에서 읽을지 적는다. 기본 프로필은 RfidReaderMonitor v1 그대로(경로 = 필드 이름)라
 * 아무것도 설정하지 않은 사업장은 예전과 똑같이 돈다. PLC 게이트웨이 · Node-RED 처럼 다른 모양으로 내는
 * 발행자는 이 프로필만 맞추면 현황판에 붙는다.
 *
 * 토픽 구조(`{prefix}/{site}/reader/{key}/state` …)는 바꾸지 않는다 — 구독 필터와 칸 잇기 규칙이 거기 걸려 있다.
 * 브라우저 · Node 어디서든 같은 답을 내는 값 계산만 둔다. 파일 읽기 · 쓰기는 `server/formatStore.ts`.
 */

export const FORMAT_VERSION = 1;

export const STATE_FIELDS = ["uid", "present", "online", "serial", "reader", "alias", "readerName", "host", "tech", "state", "time", "lastUid", "lastTime"] as const;
export const EVENT_FIELDS = ["kind", "uid", "serial", "reader", "alias", "readerName", "host", "time", "dwellMs"] as const;
export const STATUS_FIELDS = ["online", "host", "time", "version", "readerCount", "onlineReaders", "presentReaders", "appearToday", "removeToday"] as const;

export type StateField = (typeof STATE_FIELDS)[number];
export type EventField = (typeof EVENT_FIELDS)[number];
export type StatusField = (typeof STATUS_FIELDS)[number];

/** 사람이 보는 설명. 설정 화면의 표 왼쪽 열. */
export const FIELD_HELP: Record<string, string> = {
  uid: "태그 UID (16진수). 비어 있으면 태그 없음",
  present: "태그가 놓여 있는가 (참/거짓)",
  online: "리더가 살아 있는가 (참/거짓). 없으면 참으로 본다",
  serial: "리더 S/N — 장치 대장과 잇는 값",
  reader: "리더 표시 이름 (없으면 alias → readerName → 토픽 키)",
  alias: "리더 별명",
  readerName: "리더 장치 이름",
  host: "감시 PC 이름",
  tech: "태그 기술 (ISO 15693 등)",
  state: "상태 글자 (PRESENT · EMPTY · 뽑힘 …)",
  time: "바뀐 시각 (ISO 8601 또는 epoch)",
  lastUid: "(선택) 마지막에 놓여 있던 태그 UID — 화면을 늦게 켜도 잔상을 채운다",
  lastTime: "(선택) 그 태그를 들어낸 시각",
  kind: "이벤트 종류 — 제거값 목록에 있으면 제거, 아니면 등장",
  dwellMs: "체류 시간(ms, 제거 이벤트)",
  version: "감시 프로그램 판",
  readerCount: "리더 수",
  onlineReaders: "살아 있는 리더 수",
  presentReaders: "태그가 놓인 리더 수",
  appearToday: "오늘 등장 건수",
  removeToday: "오늘 제거 건수",
};

export type TimeFormat = "auto" | "iso" | "epochMs" | "epochS";

export interface ValueRules {
  /** 참으로 볼 글자 값(대소문자 무시). 불리언 · 숫자는 그대로 해석한다. */
  trueValues: string[];
  /** kind 가 이 값이면 제거, 아니면 등장(대소문자 무시). */
  removeValues: string[];
  /** 시각 해석. `auto` 는 숫자면 크기로 ms/s 를 가르고 글자면 그대로. */
  timeFormat: TimeFormat;
}

export interface MessageFormat {
  v: 1;
  site: string;
  /** 모델 필드 → JSON 경로(`a.b[0].c`). 비우면 그 필드는 읽지 않는다(빈 값). */
  state: Record<StateField, string>;
  event: Record<EventField, string>;
  status: Record<StatusField, string>;
  values: ValueRules;
  updatedAt?: string;
  updatedBy?: string;
}

/** 사업장별 프로필. 없는 사업장은 기본(v1). */
export interface FormatBook {
  sites: Record<string, MessageFormat>;
}

export const DEFAULT_VALUE_RULES: ValueRules = {
  trueValues: ["true", "1", "yes", "y", "on", "present"],
  removeValues: ["REMOVE", "REMOVED", "OUT", "GONE", "LEAVE", "0"],
  timeFormat: "auto",
};

function identity<T extends readonly string[]>(fields: T): Record<T[number], string> {
  return Object.fromEntries(fields.map((f) => [f, f])) as Record<T[number], string>;
}

/** RfidReaderMonitor v1 — 경로가 곧 필드 이름. */
export function defaultFormat(site = "default"): MessageFormat {
  return {
    v: 1,
    site,
    state: identity(STATE_FIELDS),
    event: identity(EVENT_FIELDS),
    status: identity(STATUS_FIELDS),
    values: { ...DEFAULT_VALUE_RULES, trueValues: [...DEFAULT_VALUE_RULES.trueValues], removeValues: [...DEFAULT_VALUE_RULES.removeValues] },
  };
}

/** 기본 프로필과 같은가(저장할 것이 없는지 · 화면에 "기본" 표시). */
export function isDefaultFormat(format: MessageFormat): boolean {
  const base = defaultFormat(format.site);
  const same = (a: Record<string, string>, b: Record<string, string>) => Object.keys(b).every((k) => (a[k] ?? "") === b[k]);
  return (
    same(format.state, base.state) &&
    same(format.event, base.event) &&
    same(format.status, base.status) &&
    format.values.timeFormat === "auto" &&
    format.values.trueValues.join("|").toLowerCase() === base.values.trueValues.join("|") &&
    format.values.removeValues.join("|").toUpperCase() === base.values.removeValues.join("|")
  );
}

// ------------------------------------------------------------ 검사

export class MessageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageFormatError";
  }
}

/** `a.b_c[0].d` — 마디는 글자로 시작, 사이에 `.`, 배열은 `[숫자]`. 한글 키도 받는다. */
const PATH_RE = /^[^\s.[\]]+(\[\d+\])*(\.[^\s.[\]]+(\[\d+\])*)*$/;

export function checkPath(path: string, where: string): string {
  const trimmed = path.trim();
  if (trimmed === "") return "";
  if (!PATH_RE.test(trimmed)) throw new MessageFormatError(`${where} 의 JSON 경로가 이상합니다: ${JSON.stringify(path)} (예: uid, tag.epc, readers[0].id)`);
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMap<T extends readonly string[]>(raw: unknown, fields: T, where: string): Record<T[number], string> {
  const base = identity(fields);
  if (raw === undefined || raw === null) return base;
  if (!isRecord(raw)) throw new MessageFormatError(`${where} 는 필드 → 경로 객체여야 합니다.`);
  for (const field of fields) {
    const value = raw[field];
    if (value === undefined) continue;
    if (value === null) {
      base[field as T[number]] = "";
      continue;
    }
    if (typeof value !== "string") throw new MessageFormatError(`${where}.${field} 는 문자열(JSON 경로)이어야 합니다.`);
    base[field as T[number]] = checkPath(value, `${where}.${field}`);
  }
  return base;
}

function parseList(raw: unknown, fallback: string[], where: string): string[] {
  if (raw === undefined || raw === null) return [...fallback];
  const list = typeof raw === "string" ? raw.split(/[,\n]/) : raw;
  if (!Array.isArray(list)) throw new MessageFormatError(`${where} 는 배열이나 쉼표로 나눈 글자여야 합니다.`);
  const out = list.map((v) => String(v).trim()).filter(Boolean);
  return out.length > 0 ? out : [...fallback];
}

export function parseMessageFormat(raw: unknown, siteFromFile?: string): MessageFormat {
  if (!isRecord(raw)) throw new MessageFormatError("형식 프로필은 JSON 객체여야 합니다.");
  if (raw.v !== undefined && raw.v !== FORMAT_VERSION) throw new MessageFormatError(`지원하지 않는 프로필 판(v=${String(raw.v)})입니다.`);
  const site = (siteFromFile ?? (typeof raw.site === "string" ? raw.site : "") ?? "default").trim() || "default";
  if (/[/+#\s]/.test(site) || site.startsWith(".") || site.startsWith("_")) throw new MessageFormatError(`사업장 이름으로 쓸 수 없습니다: ${JSON.stringify(site)}`);

  const values = isRecord(raw.values) ? raw.values : {};
  const timeFormat = values.timeFormat === undefined ? "auto" : values.timeFormat;
  if (timeFormat !== "auto" && timeFormat !== "iso" && timeFormat !== "epochMs" && timeFormat !== "epochS") {
    throw new MessageFormatError(`values.timeFormat 은 auto · iso · epochMs · epochS 중 하나입니다: ${JSON.stringify(timeFormat)}`);
  }

  const format: MessageFormat = {
    v: 1,
    site,
    state: parseMap(raw.state, STATE_FIELDS, "state"),
    event: parseMap(raw.event, EVENT_FIELDS, "event"),
    status: parseMap(raw.status, STATUS_FIELDS, "status"),
    values: {
      trueValues: parseList(values.trueValues, DEFAULT_VALUE_RULES.trueValues, "values.trueValues"),
      removeValues: parseList(values.removeValues, DEFAULT_VALUE_RULES.removeValues, "values.removeValues"),
      timeFormat,
    },
  };
  if (typeof raw.updatedAt === "string" && raw.updatedAt) format.updatedAt = raw.updatedAt;
  if (typeof raw.updatedBy === "string" && raw.updatedBy) format.updatedBy = raw.updatedBy;
  return format;
}

// ------------------------------------------------------------ 읽기

/** JSON 경로로 값을 꺼낸다. 없으면 undefined. 빈 경로는 undefined(그 필드를 안 읽는다는 뜻). */
export function getPath(json: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = json;
  for (const part of path.split(".")) {
    const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!m) return undefined;
    if (!isRecord(cur)) return undefined;
    cur = cur[m[1]];
    for (const idx of m[2].match(/\d+/g) ?? []) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(idx)];
    }
  }
  return cur;
}

export function readString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** 참/거짓. 불리언 · 숫자는 그대로, 글자는 `trueValues` 에 있으면 참. */
export function readBool(value: unknown, rules: ValueRules): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return rules.trueValues.some((t) => t.toLowerCase() === v);
  }
  return false;
}

export function readInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Math.trunc(Number(value));
  return 0;
}

/** 시각 → ISO 문자열. 숫자는 epoch(ms 또는 s), 글자는 그대로(파싱은 화면이 한다). 못 읽으면 빈 글자. */
export function readTime(value: unknown, rules: ValueRules): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number" || (typeof value === "string" && /^\d{9,14}$/.test(value.trim()) && rules.timeFormat !== "iso")) {
    const n = Number(value);
    const ms = rules.timeFormat === "epochS" ? n * 1000 : rules.timeFormat === "epochMs" ? n : n > 1e11 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  return typeof value === "string" ? value : "";
}

export function readKind(value: unknown, rules: ValueRules): "APPEAR" | "REMOVE" {
  const v = readString(value).trim().toUpperCase();
  return rules.removeValues.some((r) => r.toUpperCase() === v) ? "REMOVE" : "APPEAR";
}

/** 사업장에 맞는 프로필. 없으면 기본(v1). */
export function formatFor(book: FormatBook | null | undefined, site: string): MessageFormat {
  return book?.sites[site] ?? book?.sites.default ?? defaultFormat(site);
}

/** 화면의 미리보기: 프로필로 표본 페이로드를 읽으면 어떻게 보이는지. */
export function previewFields(format: MessageFormat, kind: "state" | "event" | "status", payload: string): { field: string; path: string; raw: unknown; shown: string }[] {
  let json: unknown = null;
  try {
    json = JSON.parse(payload);
  } catch {
    json = null;
  }
  const map = format[kind] as Record<string, string>;
  return Object.entries(map).map(([field, path]) => {
    const raw = getPath(json, path);
    let shown: string;
    if (field === "present" || field === "online") shown = readBool(raw, format.values) ? "참" : "거짓";
    else if (field === "time") shown = readTime(raw, format.values);
    else if (field === "kind") shown = readKind(raw, format.values) === "REMOVE" ? "제거" : "등장";
    else if (field === "dwellMs" || /Count|Readers|Today$/.test(field)) shown = String(readInt(raw));
    else shown = readString(raw);
    return { field, path, raw, shown };
  });
}
