/**
 * 기준정보 조회 저장소 — `.grid-projects/.lookup/{사업장}.json` 설정을 읽고, 그 자료를
 * SQL Server 에서 주기적으로 통째로 가져와 메모리에 든다.
 *
 * 이벤트마다 DB 에 묻지 않는다. DB 가 사내망 밖(느림)이고, 잠깐 끊겨도 현황판이 이름을
 * 잃으면 안 되기 때문이다. 기준정보는 수천 행 규모라 몇 분마다 한 번 다 읽는 것이 가장 단순하다.
 *
 * 접속(비밀)과 매핑(열 대응)은 층이 다르다.
 *   - `.lookup/connections.json`  관리자가 파일로만 관리. 이름 → env 파일. 화면에는 이름만 보인다.
 *   - `.lookup/{사업장}.json`      화면에서 저장할 수 있다(표 · 열 · 템플릿 · 조건 · 갱신 주기).
 *
 * DB 드라이버(`mssql`)는 여기서만 부른다. 시험에서는 `query` 를 바꿔 끼워 DB 없이 돈다.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

import {
  buildRows,
  type ColumnInfo,
  type ConnectionInfo,
  emptySnapshot,
  LookupConfigError,
  type LookupConfig,
  type LookupFilter,
  type LookupPreview,
  type LookupSnapshot,
  type LookupSource,
  mergeDraft,
  parseLookupConfig,
  renderTemplate,
  RESERVED_SITES,
  type TableInfo,
} from "../app/live/lookup";

export const LOOKUP_DIR = ".lookup";
export const CONNECTIONS_FILE = "connections.json";
export const PREVIEW_ROWS = 5;

/** 접속 정보. env 파일과 설정을 합친 것. 비밀번호가 들어 있으니 로그에 찍지 않는다. */
export interface SqlTarget {
  server: string;
  port: number | null;
  database: string;
  user: string;
  password: string;
}

export type QueryRunner = (target: SqlTarget, sql: string) => Promise<Record<string, unknown>[]>;

export interface LookupStoreOptions {
  /** DB 를 부르는 함수. 기본은 `mssql`. */
  query?: QueryRunner;
  now?: () => Date;
  /** 주기 갱신 타이머를 돌릴지. 시험에서는 false. */
  autoRefresh?: boolean;
  /** env 파일의 상대 경로를 푸는 기준. 기본은 실행 폴더. */
  cwd?: string;
  log?: (message: string) => void;
}

/** `connections.json` 의 항목 하나. */
export interface ConnectionDef {
  env: string;
  server?: string;
  database?: string;
}

interface Entry {
  file: string;
  mtimeMs: number;
  config: LookupConfig;
  snapshot: LookupSnapshot;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: Promise<LookupSnapshot> | null;
}

export interface LookupStore {
  dir: string;
  /** 사업장 이름 목록. 설정 파일이 없으면 빈 배열. */
  sites(): string[];
  /** 지금 들고 있는 스냅샷. 없으면 null. */
  get(site: string): LookupSnapshot | null;
  all(): Record<string, LookupSnapshot>;
  /** 파일에 적힌 설정. 없으면 null. */
  config(site: string): LookupConfig | null;
  /** 지금 다시 읽는다. 이미 읽는 중이면 그 약속을 돌려준다. */
  refresh(site: string): Promise<LookupSnapshot>;
  /** 설정 폴더를 다시 훑는다(파일 추가 · 삭제 · 수정). 바뀐 것만 다시 읽는다. */
  reload(): void;
  /** 화면에서 온 초안을 검증해 파일에 쓰고 바로 읽는다. */
  save(site: string, draft: unknown, author: string): Promise<{ config: LookupConfig; snapshot: LookupSnapshot }>;
  /** 접속 이름 목록(비밀 없음). */
  connections(): ConnectionInfo[];
  tables(connection: string): Promise<TableInfo[]>;
  columns(connection: string, table: string): Promise<ColumnInfo[]>;
  /** 초안 설정으로 몇 행만 읽어 본다. 파일은 건드리지 않는다. */
  preview(site: string, draft: unknown): Promise<LookupPreview>;
  start(): void;
  stop(): void;
}

// ------------------------------------------------------------ env 파일

/** Windows 메모장이 앞에 붙이는 BOM. 남으면 첫 줄의 키 이름이 어긋난다. */
const BOM = String.fromCharCode(0xfeff);

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/** `KEY=value` 줄. `#` 주석과 빈 줄은 건너뛴다. 값의 따옴표는 벗긴다. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripBom(rawLine).trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function pick(env: Record<string, string>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

/** env 파일 + 서버 · DB 이름 → 접속 정보. 무엇이 빠졌는지 한국어로 알린다. */
export function resolveTarget(def: ConnectionDef, cwd: string): SqlTarget {
  const envPath = isAbsolute(def.env) ? def.env : resolve(cwd, def.env);
  if (!existsSync(envPath)) throw new LookupConfigError(`env 파일이 없습니다: ${envPath}`);
  const env = parseEnvText(readFileSync(envPath, "utf8"));

  const serverText = pick(env, "SERVER", "DB_SERVER", "HOST", "DB_HOST") ?? def.server;
  if (!serverText) throw new LookupConfigError(`서버 주소가 없습니다. env 의 SERVER 또는 접속 설정의 server 에 적어 주십시오 (${basename(envPath)}).`);
  const database = pick(env, "DATABASE", "DB_NAME", "DB") ?? def.database;
  if (!database) throw new LookupConfigError(`DB 이름이 없습니다. env 의 DATABASE 또는 접속 설정의 database 에 적어 주십시오 (${basename(envPath)}).`);
  const user = pick(env, "USERNAME", "USER", "DB_USER", "UID");
  const password = pick(env, "PASSWORD", "PASS", "DB_PASSWORD", "PWD");
  if (!user || password === undefined) throw new LookupConfigError(`USERNAME/PASSWORD 가 없습니다 (${basename(envPath)}).`);

  // `host,1433` (SQL Server 표기) 또는 `host:1433`.
  const m = /^(.*?)[,:](\d+)$/.exec(serverText.trim());
  const server = m ? m[1].trim() : serverText.trim();
  const port = m ? Number.parseInt(m[2], 10) : null;
  return { server, port, database, user, password };
}

// ------------------------------------------------------------ connections.json

export function parseConnections(raw: unknown): Record<string, ConnectionDef> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new LookupConfigError("connections.json 은 JSON 객체여야 합니다.");
  const root = raw as Record<string, unknown>;
  const list = (root.connections ?? root) as Record<string, unknown>;
  if (typeof list !== "object" || list === null || Array.isArray(list)) throw new LookupConfigError("connections 는 이름 → 접속 객체여야 합니다.");
  const out: Record<string, ConnectionDef> = {};
  for (const [name, value] of Object.entries(list)) {
    if (name === "v") continue;
    if (!/^[^\s/+#]+$/.test(name)) throw new LookupConfigError(`접속 이름에 공백이나 / + # 를 쓸 수 없습니다: ${JSON.stringify(name)}`);
    if (typeof value !== "object" || value === null) throw new LookupConfigError(`connections.${name} 은 객체여야 합니다.`);
    const v = value as Record<string, unknown>;
    if (typeof v.env !== "string" || !v.env.trim()) throw new LookupConfigError(`connections.${name}.env 가 없습니다.`);
    const def: ConnectionDef = { env: v.env.trim() };
    if (typeof v.server === "string" && v.server.trim()) def.server = v.server.trim();
    if (typeof v.database === "string" && v.database.trim()) def.database = v.database.trim();
    out[name] = def;
  }
  return out;
}

// ------------------------------------------------------------ SQL

function quoteIdent(name: string): string {
  return `[${name.replace(/]/g, "]]")}]`;
}

/** 문자열 리터럴. 홑따옴표만 두 개로. 식별자는 이미 검사했고 값은 이것으로만 들어간다. */
export function sqlLiteral(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`;
}

/** 화면에서 고른 조건 → SQL 조각. 자유 SQL 은 없다. */
export function filterSql(filter: LookupFilter): string {
  const col = quoteIdent(filter.column);
  const value = filter.value ?? "";
  switch (filter.op) {
    case "eq":
      return `${col} = ${sqlLiteral(value)}`;
    case "ne":
      return `(${col} <> ${sqlLiteral(value)} OR ${col} IS NULL)`;
    case "contains":
      return `${col} LIKE ${sqlLiteral(`%${value.replace(/[%_[]/g, (ch) => `[${ch}]`)}%`)}`;
    case "empty":
      return `(${col} IS NULL OR LTRIM(RTRIM(CONVERT(nvarchar(4000), ${col}))) = N'')`;
    case "notEmpty":
      return `(${col} IS NOT NULL AND LTRIM(RTRIM(CONVERT(nvarchar(4000), ${col}))) <> N'')`;
  }
}

function tableSql(table: string): string {
  return table.split(".").map(quoteIdent).join(".");
}

/** 설정에서 SELECT 문을 만든다. 식별자는 모두 대괄호로 감싼다. 조건은 화면의 filters + 파일의 where 를 AND 로. */
export function buildSelect(config: LookupConfig, top?: number): string {
  const columns = [config.key.column, ...config.columns.map((c) => c.column).filter((c) => c !== config.key.column)];
  const parts: string[] = [];
  for (const filter of config.source.filters ?? []) parts.push(filterSql(filter));
  if (config.source.where) parts.push(`(${config.source.where})`);
  const where = parts.length > 0 ? ` WHERE ${parts.join(" AND ")}` : "";
  const limit = top ? `TOP ${Math.max(1, Math.trunc(top))} ` : "";
  return `SELECT ${limit}${columns.map(quoteIdent).join(", ")} FROM ${tableSql(config.source.table)}${where}`;
}

/** 표 · 뷰 목록. 접속의 DB 안에서만 본다. */
export const TABLES_SQL =
  "SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name], TABLE_TYPE AS [type] FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_SCHEMA, TABLE_NAME";

export function columnsSql(table: string): string {
  const parts = table.split(".");
  const name = parts[parts.length - 1];
  const schema = parts.length >= 2 ? parts[parts.length - 2] : null;
  const where = schema ? `TABLE_NAME = ${sqlLiteral(name)} AND TABLE_SCHEMA = ${sqlLiteral(schema)}` : `TABLE_NAME = ${sqlLiteral(name)}`;
  return `SELECT COLUMN_NAME AS [name], DATA_TYPE AS [type] FROM INFORMATION_SCHEMA.COLUMNS WHERE ${where} ORDER BY ORDINAL_POSITION`;
}

/** 기본 질의기. `mssql` 을 그때 불러 시험 · Worker 빌드가 드라이버를 끌어오지 않게 한다. */
export const mssqlQuery: QueryRunner = async (target, sql) => {
  const mod = (await import("mssql")) as unknown as { default?: MssqlModule } & MssqlModule;
  const mssql = mod.default ?? mod;
  const pool = new mssql.ConnectionPool({
    server: target.server,
    ...(target.port ? { port: target.port } : {}),
    database: target.database,
    user: target.user,
    password: target.password,
    connectionTimeout: 10_000,
    requestTimeout: 60_000,
    pool: { max: 1, min: 0, idleTimeoutMillis: 5_000 },
    options: { encrypt: true, trustServerCertificate: true, useUTC: false },
  });
  try {
    await pool.connect();
    const result = await pool.request().query(sql);
    return result.recordset ?? [];
  } finally {
    await pool.close().catch(() => undefined);
  }
};

interface MssqlModule {
  ConnectionPool: new (config: Record<string, unknown>) => {
    connect(): Promise<unknown>;
    close(): Promise<void>;
    request(): { query(sql: string): Promise<{ recordset?: Record<string, unknown>[] }> };
  };
}

// ------------------------------------------------------------ 저장소

export function createLookupStore(dir?: string, options: LookupStoreOptions = {}): LookupStore {
  const root = resolve(dir ?? ".grid-projects");
  const folder = join(root, LOOKUP_DIR);
  const query = options.query ?? mssqlQuery;
  const now = options.now ?? (() => new Date());
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? ((message: string) => console.log(`[lookup] ${message}`));
  const autoRefresh = options.autoRefresh !== false;
  const entries = new Map<string, Entry>();
  let started = false;

  // ---- 접속 ----
  let connectionDefs: Record<string, ConnectionDef> = {};
  let connectionsMtime = -1;
  let connectionsError: string | null = null;

  function loadConnections() {
    const file = join(folder, CONNECTIONS_FILE);
    if (!existsSync(file)) {
      connectionDefs = {};
      connectionsMtime = -1;
      connectionsError = null;
      return;
    }
    const mtimeMs = statSync(file).mtimeMs;
    if (mtimeMs === connectionsMtime) return;
    connectionsMtime = mtimeMs;
    try {
      connectionDefs = parseConnections(JSON.parse(stripBom(readFileSync(file, "utf8"))));
      connectionsError = null;
    } catch (error) {
      connectionsError = error instanceof Error ? error.message : String(error);
      log(`${CONNECTIONS_FILE}: ${connectionsError}`);
    }
  }

  function connectionDef(name: string): ConnectionDef {
    loadConnections();
    const def = connectionDefs[name];
    if (!def) {
      const hint = connectionsError ? ` (${connectionsError})` : Object.keys(connectionDefs).length === 0 ? ` — ${join(folder, CONNECTIONS_FILE)} 에 접속을 적어 주십시오.` : "";
      throw new LookupConfigError(`접속 ${JSON.stringify(name)} 이 없습니다.${hint}`);
    }
    return def;
  }

  /** 설정의 source → 접속 정보. 접속 이름이 있으면 그것, 없으면 (구식) env 경로. */
  function targetFor(source: LookupSource): SqlTarget {
    if (source.connection) return resolveTarget(connectionDef(source.connection), cwd);
    if (!source.env) throw new LookupConfigError("접속 이름(connection)도 env 파일도 없습니다.");
    return resolveTarget({ env: source.env, server: source.server, database: source.database }, cwd);
  }

  // ---- 설정 파일 ----
  function readConfig(file: string): LookupConfig {
    const site = basename(file, ".json");
    let raw: unknown;
    try {
      raw = JSON.parse(stripBom(readFileSync(file, "utf8")));
    } catch (error) {
      throw new LookupConfigError(`${basename(file)}: JSON 을 읽지 못했습니다 — ${error instanceof Error ? error.message : String(error)}`);
    }
    return parseLookupConfig(raw, site);
  }

  function schedule(entry: Entry) {
    if (entry.timer) clearInterval(entry.timer);
    entry.timer = null;
    if (!autoRefresh || !started) return;
    const site = entry.config.site;
    entry.timer = setInterval(() => {
      // 주기마다 설정 폴더도 다시 본다 — 파일을 고치면 서버를 다시 켜지 않아도 다음 갱신에 반영된다.
      // 바뀐 파일은 reload 가 새 항목으로 바꾸고 스스로 읽기 시작하므로, 그대로인 항목만 여기서 읽는다.
      const before = entries.get(site);
      reload();
      const after = entries.get(site);
      if (after && after === before && after.config.source) void refreshEntry(after);
    }, entry.config.refreshSeconds * 1000);
    // 서비스가 오래 살아 있어도 타이머 때문에 종료가 막히지 않게.
    const t = entry.timer as { unref?: () => void };
    t.unref?.();
  }

  function refreshEntry(entry: Entry): Promise<LookupSnapshot> {
    if (entry.inFlight) return entry.inFlight;
    const config = entry.config;
    const startedAt = now();
    entry.snapshot = { ...entry.snapshot, refreshing: true };
    entry.inFlight = (async () => {
      try {
        const target = targetFor(config.source);
        const raw = await query(target, buildSelect(config));
        const { rows, dropped, duplicates } = buildRows(config, raw);
        entry.snapshot = {
          ...entry.snapshot,
          ok: true,
          error: null,
          refreshing: false,
          fetchedAt: now().toISOString(),
          attemptedAt: startedAt.toISOString(),
          rowCount: Object.keys(rows).length,
          rows,
        };
        log(`${config.site}: ${config.source.table} ${entry.snapshot.rowCount}행 (키 없음 ${dropped} · 중복 ${duplicates})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        entry.snapshot = { ...entry.snapshot, ok: false, error: message, refreshing: false, attemptedAt: startedAt.toISOString() };
        log(`${config.site}: 읽기 실패 — ${message}`);
      } finally {
        entry.inFlight = null;
      }
      return entry.snapshot;
    })();
    return entry.inFlight;
  }

  function brokenSnapshot(site: string, existing: Entry | undefined, message: string): LookupSnapshot {
    return {
      ...(existing?.snapshot ?? {
        v: 1, site, ok: false, error: null, fetchedAt: null, attemptedAt: null, refreshing: false,
        table: "", key: { field: "uid", column: "", format: "hex", reverseBytes: false }, display: { title: "" }, columns: [], refreshSeconds: 0, rowCount: 0, rows: {},
      }),
      ok: false,
      error: message,
      refreshing: false,
    };
  }

  function reload() {
    loadConnections();
    const seen = new Set<string>();
    if (existsSync(folder)) {
      for (const name of readdirSync(folder)) {
        if (!name.endsWith(".json") || name.startsWith(".") || name === CONNECTIONS_FILE) continue;
        const file = join(folder, name);
        const site = basename(name, ".json");
        if (RESERVED_SITES.has(site)) continue;
        seen.add(site);
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(file).mtimeMs;
        } catch {
          continue;
        }
        const existing = entries.get(site);
        if (existing && existing.mtimeMs === mtimeMs) continue;
        try {
          const config = readConfig(file);
          const entry: Entry = {
            file,
            mtimeMs,
            config,
            // 같은 사업장의 설정이 바뀌면 행은 새 질의로 채우되, 그때까지는 예전 행을 보여 준다.
            snapshot: existing
              ? { ...emptySnapshot(config), rows: existing.snapshot.rows, rowCount: existing.snapshot.rowCount, fetchedAt: existing.snapshot.fetchedAt }
              : emptySnapshot(config),
            timer: null,
            inFlight: null,
          };
          if (existing?.timer) clearInterval(existing.timer);
          entries.set(site, entry);
          schedule(entry);
          if (started && autoRefresh) void refreshEntry(entry);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`${name}: 설정 오류 — ${message}`);
          // 설정이 깨졌다는 것도 화면에 보여야 한다. 빈 스냅샷에 오류만 싣는다.
          if (existing?.timer) clearInterval(existing.timer);
          entries.set(site, { file, mtimeMs, config: existing?.config ?? ({} as LookupConfig), snapshot: brokenSnapshot(site, existing, message), timer: null, inFlight: null });
        }
      }
    }
    for (const [site, entry] of entries) {
      if (seen.has(site)) continue;
      if (entry.timer) clearInterval(entry.timer);
      entries.delete(site);
    }
  }

  reload();

  function requireEntry(site: string): Entry {
    reload();
    const entry = entries.get(site);
    if (!entry) throw new LookupConfigError(`사업장 ${JSON.stringify(site)} 의 조회 설정이 없습니다. ${join(folder, `${site}.json`)} 을 만들어 주십시오.`);
    return entry;
  }

  return {
    dir: folder,
    sites: () => [...entries.keys()].sort(),
    get: (site) => entries.get(site)?.snapshot ?? null,
    all: () => Object.fromEntries([...entries.entries()].map(([site, entry]) => [site, entry.snapshot])),
    config: (site) => {
      const entry = entries.get(site);
      return entry?.config.source ? entry.config : null;
    },
    refresh: (site) => {
      let entry: Entry;
      try {
        entry = requireEntry(site);
      } catch (error) {
        return Promise.reject(error);
      }
      if (!entry.config.source) return Promise.resolve(entry.snapshot);
      return refreshEntry(entry);
    },
    reload,
    save: async (site, draft, author) => {
      const existing = entries.get(site)?.config.source ? entries.get(site)!.config : null;
      const config = mergeDraft(existing, draft, site);
      config.updatedAt = now().toISOString();
      config.updatedBy = author.trim().slice(0, 40) || "익명";
      // 접속 이름이 진짜 있는지 저장 전에 본다. 없는 이름을 저장해 두면 화면이 계속 오류만 보인다.
      if (config.source.connection) connectionDef(config.source.connection);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, `${site}.json`), JSON.stringify(config, null, 2) + "\n", "utf8");
      reload();
      const entry = entries.get(site);
      if (!entry) throw new LookupConfigError("저장한 설정을 다시 읽지 못했습니다.");
      const snapshot = await refreshEntry(entry);
      return { config, snapshot };
    },
    connections: () => {
      loadConnections();
      const out: ConnectionInfo[] = [];
      for (const [name, def] of Object.entries(connectionDefs)) {
        try {
          const target = resolveTarget(def, cwd);
          out.push({ name, database: target.database, server: target.server });
        } catch (error) {
          out.push({ name, database: "", server: error instanceof Error ? error.message : String(error) });
        }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
    tables: async (connection) => {
      const rows = await query(resolveTarget(connectionDef(connection), cwd), TABLES_SQL);
      return rows.map((r) => ({
        schema: String(r.schema ?? ""),
        name: String(r.name ?? ""),
        kind: String(r.type ?? "").toUpperCase() === "VIEW" ? "view" : "table",
      }));
    },
    columns: async (connection, table) => {
      for (const part of table.split(".")) if (!part.trim() || /[[\]\s;'"`]/.test(part)) throw new LookupConfigError(`표 이름에 쓸 수 없는 글자가 있습니다: ${JSON.stringify(table)}`);
      const rows = await query(resolveTarget(connectionDef(connection), cwd), columnsSql(table));
      return rows.map((r) => ({ name: String(r.name ?? ""), type: String(r.type ?? "") }));
    },
    preview: async (site, draft) => {
      const existing = entries.get(site)?.config.source ? entries.get(site)!.config : null;
      const config = mergeDraft(existing, draft, site);
      const sql = buildSelect(config, PREVIEW_ROWS);
      const raw = await query(targetFor(config.source), sql);
      const { rows } = buildRows(config, raw);
      const list = Object.values(rows);
      return { sql, rows: list, titles: list.map((row) => renderTemplate(config.display.title, row)) };
    },
    start: () => {
      if (started) return;
      started = true;
      for (const entry of entries.values()) {
        if (!entry.config.source) continue;
        schedule(entry);
        if (autoRefresh) void refreshEntry(entry);
      }
    },
    stop: () => {
      started = false;
      for (const entry of entries.values()) {
        if (entry.timer) clearInterval(entry.timer);
        entry.timer = null;
      }
    },
  };
}
