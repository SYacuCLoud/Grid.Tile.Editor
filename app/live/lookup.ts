/**
 * 실시간 현황판 — 태그 UID 를 회사 기준정보(실물)와 잇는 순수 계산.
 *
 * 리더는 UID(`E0 04 01 53 …`)만 준다. 그것이 어느 통(桶)인지, 누구의 사원증인지는
 * 회사마다 다른 곳(MSSQL · CSV · 다른 시스템)에 있다. 이 모듈은 그 자료의 **열과 열을
 * 짝짓는 설정**(`LookupConfig`)과, 서버가 주기적으로 읽어 둔 **스냅샷**(`LookupSnapshot`)을
 * 다루는 규칙만 안다. DB 에 붙는 일은 `server/lookupStore.ts` 가 하고, 여기서는
 * 브라우저 · Node 어디서든 같은 답을 내는 값 계산만 둔다.
 *
 * 설정 파일은 `.grid-projects/.lookup/{사업장}.json` 이다. 접속 비밀은 그 파일에 적지 않고
 * `_env` 규칙의 env 파일(SERVER · DATABASE · USERNAME · PASSWORD)을 가리킨다.
 */

import { shortUid } from "./liveState";

export const LOOKUP_VERSION = 1;

/** 스냅샷에 실어 보내는 열 하나. */
export interface LookupColumn {
  /** DB 열 이름 그대로. */
  column: string;
  /** 화면에 보일 이름. 없으면 열 이름. */
  label?: string;
  /** 사이드바 상세에 보일지. 기본 true. 제목 계산에만 쓰는 열은 false 로 숨긴다. */
  show?: boolean;
}

export type LookupKeyFormat = "hex" | "text";

export interface LookupKey {
  /**
   * MQTT 메시지 쪽 필드. 기본 `uid`(태그 UID). `serial` 이면 리더 S/N 으로 리더 대장을 잇고,
   * 다른 발행자가 `epc` 처럼 다른 이름을 쓰면 그 이름을 적는다. 현황판이 모델에 담은 필드 이름과 같아야 한다.
   */
  field?: string;
  /** 그 값이 들어 있는 DB 열. */
  column: string;
  /**
   * `hex`  — 16진수만 남기고 대문자로(공백 · 콜론 · 하이픈 제거). 리더가 `E0 04 …` 로 주든
   *          DB 가 `e004…` 로 갖고 있든 같아진다. 기본값.
   * `text` — 앞뒤 공백만 떼고 그대로 비교(대소문자 구분).
   */
  format?: LookupKeyFormat;
  /** ISO 15693 처럼 저장 순서가 리더와 거꾸로일 때 true. `hex` 에서만 뜻이 있다. */
  reverseBytes?: boolean;
}

/** 화면에서 고르는 조건 한 줄. 서버가 안전하게 SQL 로 조립한다. 자유 SQL 은 받지 않는다. */
export type LookupFilterOp = "eq" | "ne" | "contains" | "empty" | "notEmpty";

export interface LookupFilter {
  column: string;
  op: LookupFilterOp;
  /** `empty` · `notEmpty` 에는 없다. */
  value?: string;
}

export const FILTER_OPS: { op: LookupFilterOp; label: string; needsValue: boolean }[] = [
  { op: "eq", label: "= 같음", needsValue: true },
  { op: "ne", label: "≠ 다름", needsValue: true },
  { op: "contains", label: "포함", needsValue: true },
  { op: "notEmpty", label: "비어 있지 않음", needsValue: false },
  { op: "empty", label: "비어 있음", needsValue: false },
];

export interface LookupSource {
  kind: "mssql";
  /**
   * 접속 이름. 서버 파일 `.lookup/connections.json` 의 항목을 가리킨다.
   * 화면에서 고르는 것은 이 이름뿐이고, 비밀은 그 파일 너머 env 에만 있다.
   */
  connection?: string;
  /** (구식 · 관리자용) 접속 비밀이 든 env 파일 경로. `connection` 이 없을 때만 쓴다. 화면에서는 바꿀 수 없다. */
  env?: string;
  /** `db.schema.table` · `schema.table` · `table`. 뷰도 된다. */
  table: string;
  /** env 파일에 SERVER 가 없을 때 쓰는 서버 주소(`host` 또는 `host,port`). */
  server?: string;
  /** env 파일에 DATABASE 가 없을 때 쓰는 DB 이름. */
  database?: string;
  /** 화면에서 고른 조건들. AND 로 잇는다. */
  filters?: LookupFilter[];
  /** (관리자용) WHERE 뒤에 그대로 붙는 자유 조건. 서버 쪽 파일에만 적으므로 브라우저에서 바꿀 수 없다. `filters` 와 함께 있으면 AND. */
  where?: string;
}

export interface LookupDisplay {
  /** 칸 안과 목록 첫 줄. `{열이름}` 자리표시. 예: `{정의구분} {정의번호}` */
  title: string;
  /** 목록 둘째 줄. 없으면 비움. */
  subtitle?: string;
}

export interface LookupConfig {
  v: 1;
  /** MQTT 토픽의 사업장 마디와 같은 값. 파일 이름과도 같다. */
  site: string;
  source: LookupSource;
  key: LookupKey;
  display: LookupDisplay;
  columns: LookupColumn[];
  /** 다시 읽는 간격(초). 기본 300. 최소 15. */
  refreshSeconds: number;
  /** 화면에서 저장한 기록. 파일을 손으로 고쳤으면 없다. */
  updatedAt?: string;
  updatedBy?: string;
}

/** 사업장 이름으로 쓸 수 없는 마디. `/api/lookup/_meta/…` 가 접속 · 표 · 열 조회 주소다. */
export const RESERVED_SITES = new Set(["_meta"]);

/** 접속 하나를 화면에 보이는 만큼만. 비밀 · 경로는 빠진다. */
export interface ConnectionInfo {
  name: string;
  database: string;
  server: string;
}

export interface TableInfo {
  schema: string;
  name: string;
  kind: "table" | "view";
}

export interface ColumnInfo {
  name: string;
  type: string;
}

/** 저장 전 미리보기. 초안 설정으로 몇 행만 읽은 것. */
export interface LookupPreview {
  sql: string;
  rows: LookupRow[];
  /** 정규화한 키 → 제목. 템플릿이 실제 값으로 어떻게 보이는지. */
  titles: string[];
}

export type LookupValue = string | number | boolean | null;
export type LookupRow = Record<string, LookupValue>;

/**
 * 서버가 들고 있는 한 사업장의 기준정보.
 *
 * 읽기에 실패해도 `rows` 는 마지막으로 성공한 것을 그대로 두고 `ok=false` · `error` 만 채운다.
 * DB 가 잠깐 끊겨도 현황판이 이름을 잃지 않게.
 */
export interface LookupSnapshot {
  v: 1;
  site: string;
  ok: boolean;
  error: string | null;
  /** 마지막으로 성공한 시각(ISO). 한 번도 성공하지 못했으면 null. */
  fetchedAt: string | null;
  /** 마지막으로 시도한 시각(ISO). */
  attemptedAt: string | null;
  /** 시도 중인가(브라우저가 "새로고침 중" 을 보이는 용도). */
  refreshing: boolean;
  table: string;
  key: Required<Pick<LookupKey, "field" | "column" | "format" | "reverseBytes">>;
  display: LookupDisplay;
  columns: LookupColumn[];
  refreshSeconds: number;
  rowCount: number;
  /** 정규화한 UID → 행. */
  rows: Record<string, LookupRow>;
}

/** `GET /api/lookup` 의 답. 사업장별 스냅샷. */
export interface LookupBook {
  sites: Record<string, LookupSnapshot>;
}

/** UID 하나를 풀어낸 결과. */
export interface TagInfo {
  key: string;
  title: string;
  subtitle: string;
  fields: { label: string; value: string }[];
  row: LookupRow;
}

export const DEFAULT_REFRESH_SECONDS = 300;
export const MIN_REFRESH_SECONDS = 15;
export const DEFAULT_KEY_FIELD = "uid";

/** 화면에서 고를 수 있는 MQTT 필드. 리더 상태(`…/state`)와 이벤트(`…/event`)에 공통으로 있는 것들이다. */
export const KEY_FIELDS: { field: string; label: string; hint: string }[] = [
  { field: "uid", label: "uid — 태그 UID", hint: "놓인 태그가 무엇인지. 태그가 있을 때만 이름이 붙는다." },
  { field: "serial", label: "serial — 리더 S/N", hint: "리더 자체가 무엇인지(리더 대장). 태그가 없어도 이름이 붙는다." },
  { field: "reader", label: "reader — 리더 표시 이름", hint: "별명이 있으면 별명, 없으면 리더 이름." },
  { field: "alias", label: "alias — 리더 별명", hint: "" },
  { field: "readerName", label: "readerName — 리더 장치 이름", hint: "" },
  { field: "key", label: "key — 토픽 마디", hint: "토픽의 {key}. 발행 쪽이 S/N → 별명 → 이름 순으로 채운 값." },
  { field: "host", label: "host — 감시 PC 이름", hint: "" },
  { field: "tech", label: "tech — 태그 기술", hint: "" },
];

const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 필드 이름 검사. 모델의 속성 이름으로 쓰므로 글자 · 숫자 · 밑줄만. */
export function checkFieldName(name: string): string {
  const trimmed = name.trim();
  if (!FIELD_NAME_RE.test(trimmed)) throw new LookupConfigError(`MQTT 필드 이름으로 쓸 수 없습니다: ${JSON.stringify(name)}`);
  return trimmed;
}

/**
 * 리더 상태 · 이벤트에서 키가 될 값을 꺼낸다.
 * `uid` 는 태그가 놓여 있을 때만 뜻이 있으므로(비어 있으면 빈 값), 다른 필드는 그대로 읽는다.
 */
export function subjectValue(snapshot: Pick<LookupSnapshot, "key"> | null, source: Record<string, unknown>): string {
  const field = snapshot?.key.field || DEFAULT_KEY_FIELD;
  const value = source[field];
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

// ------------------------------------------------------------ 설정 검사

export class LookupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookupConfigError";
  }
}

const IDENT_BAD = /[[\]\s;'"`]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string, where: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") throw new LookupConfigError(`${where}.${key} 는 비어 있지 않은 문자열이어야 합니다.`);
  return value.trim();
}

function optionalString(obj: Record<string, unknown>, key: string, where: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new LookupConfigError(`${where}.${key} 는 문자열이어야 합니다.`);
  return value.trim();
}

/** SQL 식별자로 쓸 수 있는 이름인지. 대괄호 · 공백 · 따옴표 · 세미콜론이 있으면 거부한다. */
export function checkIdentifier(name: string, where: string): string {
  const trimmed = name.trim();
  if (!trimmed || IDENT_BAD.test(trimmed)) throw new LookupConfigError(`${where} 에 쓸 수 없는 이름입니다: ${JSON.stringify(name)}`);
  return trimmed;
}

/**
 * 파일에서 읽은 JSON 을 설정으로 굳힌다. 모양이 틀리면 어디가 틀렸는지 한국어로 던진다.
 * 사업장 이름(`site`)은 파일 이름에서 온 값을 우선한다 — 파일을 복사해 놓고 안을 안 고친 실수를 막는다.
 */
export function parseLookupConfig(raw: unknown, siteFromFile?: string): LookupConfig {
  if (!isRecord(raw)) throw new LookupConfigError("설정은 JSON 객체여야 합니다.");
  if (raw.v !== undefined && raw.v !== LOOKUP_VERSION) throw new LookupConfigError(`지원하지 않는 설정 판(v=${String(raw.v)})입니다. v=1 만 읽습니다.`);

  const site = checkSite((siteFromFile ?? optionalString(raw, "site", "설정") ?? "default").trim());

  if (!isRecord(raw.source)) throw new LookupConfigError("source 가 없습니다.");
  const kind = optionalString(raw.source, "kind", "source") ?? "mssql";
  if (kind !== "mssql") throw new LookupConfigError(`source.kind 는 지금 "mssql" 만 됩니다: ${JSON.stringify(kind)}`);
  const table = requireString(raw.source, "table", "source");
  for (const part of table.split(".")) checkIdentifier(part, "source.table");
  const connection = optionalString(raw.source, "connection", "source");
  const env = optionalString(raw.source, "env", "source");
  if (!connection && !env) throw new LookupConfigError("source.connection(접속 이름) 또는 source.env(env 파일) 중 하나는 있어야 합니다.");
  const source: LookupSource = {
    kind: "mssql",
    ...(connection ? { connection } : {}),
    ...(env ? { env } : {}),
    table,
    server: optionalString(raw.source, "server", "source"),
    database: optionalString(raw.source, "database", "source"),
    filters: parseFilters(raw.source.filters),
    where: optionalString(raw.source, "where", "source"),
  };
  if (!source.filters?.length) delete source.filters;
  for (const key of ["server", "database", "where"] as const) if (source[key] === undefined) delete source[key];

  if (!isRecord(raw.key)) throw new LookupConfigError("key 가 없습니다.");
  const format = optionalString(raw.key, "format", "key") ?? "hex";
  if (format !== "hex" && format !== "text") throw new LookupConfigError(`key.format 은 "hex" 또는 "text" 입니다: ${JSON.stringify(format)}`);
  const key: LookupKey = {
    field: checkFieldName(optionalString(raw.key, "field", "key") ?? DEFAULT_KEY_FIELD),
    column: checkIdentifier(requireString(raw.key, "column", "key"), "key.column"),
    format,
    reverseBytes: raw.key.reverseBytes === true,
  };

  if (!isRecord(raw.display)) throw new LookupConfigError("display 가 없습니다.");
  const display: LookupDisplay = {
    title: requireString(raw.display, "title", "display"),
    subtitle: optionalString(raw.display, "subtitle", "display"),
  };

  if (!Array.isArray(raw.columns)) throw new LookupConfigError("columns 는 배열이어야 합니다.");
  const columns: LookupColumn[] = raw.columns.map((entry, index) => {
    if (typeof entry === "string") return { column: checkIdentifier(entry, `columns[${index}]`) };
    if (!isRecord(entry)) throw new LookupConfigError(`columns[${index}] 는 문자열이나 객체여야 합니다.`);
    const column = checkIdentifier(requireString(entry, "column", `columns[${index}]`), `columns[${index}].column`);
    const label = optionalString(entry, "label", `columns[${index}]`);
    const show = entry.show === undefined ? undefined : entry.show !== false;
    return { column, ...(label ? { label } : {}), ...(show === undefined ? {} : { show }) };
  });

  // 제목 · 부제목이 쓰는 열은 목록에 없어도 읽어야 한다. 숨김으로 채워 넣는다.
  const named = new Set(columns.map((c) => c.column));
  for (const column of templateColumns(display.title).concat(display.subtitle ? templateColumns(display.subtitle) : [])) {
    if (column !== key.column && !named.has(column)) {
      columns.push({ column: checkIdentifier(column, "display"), show: false });
      named.add(column);
    }
  }

  let refreshSeconds = DEFAULT_REFRESH_SECONDS;
  if (raw.refreshSeconds !== undefined && raw.refreshSeconds !== null && raw.refreshSeconds !== "") {
    const n = typeof raw.refreshSeconds === "string" ? Number(raw.refreshSeconds) : raw.refreshSeconds;
    if (typeof n !== "number" || !Number.isFinite(n)) throw new LookupConfigError("refreshSeconds 는 숫자여야 합니다.");
    refreshSeconds = Math.max(MIN_REFRESH_SECONDS, Math.round(n));
  }

  const config: LookupConfig = { v: 1, site, source, key, display, columns, refreshSeconds };
  const updatedAt = optionalString(raw, "updatedAt", "설정");
  const updatedBy = optionalString(raw, "updatedBy", "설정");
  if (updatedAt) config.updatedAt = updatedAt;
  if (updatedBy) config.updatedBy = updatedBy;
  return config;
}

export function checkSite(site: string): string {
  if (!site || /[/+#\s]/.test(site)) throw new LookupConfigError(`사업장 이름(site)에 공백이나 / + # 를 쓸 수 없습니다: ${JSON.stringify(site)}`);
  if (RESERVED_SITES.has(site) || site.startsWith(".")) throw new LookupConfigError(`사업장 이름으로 쓸 수 없습니다: ${JSON.stringify(site)}`);
  return site;
}

function parseFilters(raw: unknown): LookupFilter[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new LookupConfigError("source.filters 는 배열이어야 합니다.");
  return raw.map((entry, index) => {
    if (!isRecord(entry)) throw new LookupConfigError(`source.filters[${index}] 는 객체여야 합니다.`);
    const column = checkIdentifier(requireString(entry, "column", `source.filters[${index}]`), `source.filters[${index}].column`);
    const op = requireString(entry, "op", `source.filters[${index}]`);
    const def = FILTER_OPS.find((f) => f.op === op);
    if (!def) throw new LookupConfigError(`source.filters[${index}].op 를 모릅니다: ${JSON.stringify(op)}`);
    const value = optionalString(entry, "value", `source.filters[${index}]`) ?? "";
    if (def.needsValue && value === "") throw new LookupConfigError(`source.filters[${index}] (${column} ${def.label}) 에 값이 없습니다.`);
    return def.needsValue ? { column, op: def.op, value } : { column, op: def.op };
  });
}

/**
 * 화면에 내보낼 설정. env 파일 경로는 파일 이름만 남긴다 — 서버 폴더 구조를 밖에 알릴 이유가 없다.
 * 자유 WHERE 는 있다는 사실만 보인다(내용은 관리자 파일).
 */
export function publicConfig(config: LookupConfig): LookupConfig & { envFile?: string; hasWhere: boolean } {
  const { env, where, ...source } = config.source;
  const out: LookupConfig & { envFile?: string; hasWhere: boolean } = { ...config, source: { ...source }, hasWhere: !!where };
  if (env) out.envFile = env.split(/[\\/]/).pop() ?? env;
  return out;
}

/**
 * 화면에서 온 초안을 기존 설정 위에 얹는다. 화면이 못 만지는 것(env 파일 · 자유 WHERE · server · database)은 기존 값을 지킨다.
 * 초안이 접속 이름을 고르면 구식 env 는 버린다 — 둘이 같이 있으면 어느 쪽인지 헷갈린다.
 */
export function mergeDraft(existing: LookupConfig | null, draft: unknown, site: string): LookupConfig {
  if (!isRecord(draft)) throw new LookupConfigError("설정은 JSON 객체여야 합니다.");
  const draftSource = isRecord(draft.source) ? { ...draft.source } : {};
  const keep = existing?.source;
  delete draftSource.env;
  delete draftSource.where;
  delete draftSource.server;
  delete draftSource.database;
  const source: Record<string, unknown> = { ...draftSource };
  if (typeof source.connection !== "string" || !source.connection) {
    delete source.connection;
    if (keep?.env) source.env = keep.env;
    if (keep?.server) source.server = keep.server;
    if (keep?.database) source.database = keep.database;
  }
  if (keep?.where) source.where = keep.where;
  return parseLookupConfig({ ...draft, v: 1, site, source }, site);
}

// ------------------------------------------------------------ 키 · 템플릿

/** 리더가 준 UID 와 DB 의 값을 같은 모양으로. 비교는 반드시 이 함수를 거친 값끼리 한다. */
export function normalizeKey(value: unknown, key: Pick<LookupKey, "format" | "reverseBytes">): string {
  const text = value === null || value === undefined ? "" : String(value);
  if ((key.format ?? "hex") === "text") return text.trim();
  const hex = text.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (!key.reverseBytes || hex.length % 2 !== 0) return hex;
  const bytes = hex.match(/../g) ?? [];
  return bytes.reverse().join("");
}

const TEMPLATE_RE = /\{([^{}]+)\}/g;

/** 템플릿이 참조하는 열 이름들. */
export function templateColumns(template: string): string[] {
  const out: string[] = [];
  for (const match of template.matchAll(TEMPLATE_RE)) out.push(match[1].trim());
  return out;
}

/** `{열}` 을 행의 값으로 바꾼다. 없는 열 · null 은 빈 글자. 여러 공백은 하나로. */
export function renderTemplate(template: string, row: LookupRow): string {
  return template
    .replace(TEMPLATE_RE, (_, name: string) => valueText(row[name.trim()]))
    .replace(/\s+/g, " ")
    .trim();
}

export function valueText(value: LookupValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  return String(value).trim();
}

// ------------------------------------------------------------ 행 → 스냅샷

/** DB 드라이버가 준 값을 JSON 에 실을 수 있는 값으로. 날짜는 ISO, 바이트는 16진수. */
export function coerceValue(value: unknown): LookupValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object" && value !== null && "length" in value && typeof (value as { toString: (enc: string) => string }).toString === "function") {
    try {
      return (value as { toString: (enc: string) => string }).toString("hex").toUpperCase();
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * 질의 결과를 `rows` 로. 키가 비면 버리고, 같은 키가 둘이면 **앞 것을 남긴다**(정렬은 질의가 정한다).
 * 열은 설정에 적은 것만 남긴다 — 비밀번호 열 같은 것을 실수로 실어 보내지 않게.
 */
export function buildRows(config: LookupConfig, raw: Record<string, unknown>[]): { rows: Record<string, LookupRow>; dropped: number; duplicates: number } {
  const rows: Record<string, LookupRow> = {};
  let dropped = 0;
  let duplicates = 0;
  const wanted = config.columns.map((c) => c.column);
  for (const record of raw) {
    const key = normalizeKey(record[config.key.column], config.key);
    if (!key) {
      dropped += 1;
      continue;
    }
    if (key in rows) {
      duplicates += 1;
      continue;
    }
    const row: LookupRow = { [config.key.column]: coerceValue(record[config.key.column]) };
    for (const column of wanted) row[column] = coerceValue(record[column]);
    rows[key] = row;
  }
  return { rows, dropped, duplicates };
}

/** 아직 한 번도 읽지 않은 사업장의 빈 스냅샷. */
export function emptySnapshot(config: LookupConfig): LookupSnapshot {
  return {
    v: 1,
    site: config.site,
    ok: false,
    error: null,
    fetchedAt: null,
    attemptedAt: null,
    refreshing: false,
    table: config.source.table,
    key: { field: config.key.field || DEFAULT_KEY_FIELD, column: config.key.column, format: config.key.format ?? "hex", reverseBytes: config.key.reverseBytes === true },
    display: config.display,
    columns: config.columns,
    refreshSeconds: config.refreshSeconds,
    rowCount: 0,
    rows: {},
  };
}

// ------------------------------------------------------------ 찾기

/** 사업장에 맞는 스냅샷. 정확히 같은 이름 → 하나뿐이면 그것 → `default`. */
export function pickSnapshot(book: LookupBook | null, site: string): LookupSnapshot | null {
  if (!book) return null;
  const exact = book.sites[site];
  if (exact) return exact;
  const all = Object.values(book.sites);
  if (all.length === 1) return all[0];
  return book.sites.default ?? null;
}

/**
 * 키 값(보통 UID)을 실물로. 모르는 값은 null.
 * 리더 상태 · 이벤트 객체를 주면 설정된 MQTT 필드에서 값을 꺼낸다.
 */
export function resolveTag(snapshot: LookupSnapshot | null, subject: string | Record<string, unknown>): TagInfo | null {
  if (!snapshot) return null;
  const value = typeof subject === "string" ? subject : subjectValue(snapshot, subject);
  if (!value) return null;
  const key = normalizeKey(value, snapshot.key);
  if (!key) return null;
  const row = snapshot.rows[key];
  if (!row) return null;
  const fields = snapshot.columns
    .filter((c) => c.show !== false)
    .map((c) => ({ label: c.label ?? c.column, value: valueText(row[c.column]) }))
    .filter((f) => f.value !== "");
  return {
    key,
    title: renderTemplate(snapshot.display.title, row) || key,
    subtitle: snapshot.display.subtitle ? renderTemplate(snapshot.display.subtitle, row) : "",
    fields,
    row,
  };
}

/** 칸에 적을 글자. 실물을 알면 그 이름, 모르면 짧은 UID. */
export function tagLabel(snapshot: LookupSnapshot | null, subject: string | Record<string, unknown>): string {
  const value = typeof subject === "string" ? subject : subjectValue(snapshot, subject);
  if (!value) return "";
  return resolveTag(snapshot, value)?.title ?? shortUid(value);
}

/** 사람이 읽는 한 줄: `통번호 129 · 칼작업분배`. 모르면 `UID …`(키가 다른 필드면 그 이름으로). */
export function tagLine(snapshot: LookupSnapshot | null, subject: string | Record<string, unknown>): string {
  const value = typeof subject === "string" ? subject : subjectValue(snapshot, subject);
  if (!value) return "";
  const tag = resolveTag(snapshot, value);
  if (!tag) {
    const field = snapshot?.key.field || DEFAULT_KEY_FIELD;
    return `${field === "uid" ? "UID" : field} ${value}`;
  }
  return tag.subtitle ? `${tag.title} · ${tag.subtitle}` : tag.title;
}
