"use client";

import { useEffect, useMemo, useState } from "react";
import { loadAuthor, saveAuthor } from "../editor/server/api";
import {
  type ColumnInfo,
  type ConnectionInfo,
  DEFAULT_KEY_FIELD,
  DEFAULT_REFRESH_SECONDS,
  FILTER_OPS,
  KEY_FIELDS,
  type LookupFilter,
  type LookupFilterOp,
  type LookupKeyFormat,
  type LookupPreview,
  type LookupSnapshot,
  MIN_REFRESH_SECONDS,
  renderTemplate,
  type TableInfo,
} from "./lookup";
import { loadColumns, loadConnections, loadTables, previewLookup, type PublicLookupConfig, saveLookupConfig } from "./lookupClient";

/**
 * 기준정보 매핑 설정 창.
 *
 * 일반 사용자가 바꾸는 것은 **매핑**이다 — 어느 표의 어느 열이 UID 이고, 무엇을 이름으로 보일지, 몇 분마다 읽을지.
 * 접속(비밀번호)은 관리자가 서버 파일 `connections.json` 에 두고 여기서는 이름만 고른다.
 * 표 · 열은 타이핑하지 않고 DB 에서 읽어 온 목록에서 고른다 — 오타로 깨질 일이 없다.
 * 자유 SQL 은 받지 않는다. 조건은 `열 · 연산자 · 값` 구조로만 받아 서버가 조립한다.
 */

interface Props {
  site: string;
  initial: PublicLookupConfig | null;
  onClose: () => void;
  onSaved: (snapshot: LookupSnapshot, config: PublicLookupConfig) => void;
}

interface DraftColumn {
  column: string;
  label: string;
  show: boolean;
}

const FIELD_BASE = "rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:border-sky-500 focus:outline-none disabled:opacity-50";
const FIELD = `w-full ${FIELD_BASE}`;
/** 옆에 붙는 좁은 고르기 상자. `w-full` 과 겹치면 안 되므로 따로 둔다. */
const NARROW = `w-28 shrink-0 ${FIELD_BASE}`;
const LABEL = "block text-[11px] font-semibold tracking-wide text-slate-400";
const BUTTON = "rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50";

/** 표 이름을 목록 값(`schema.name`)으로. 설정에 `db.schema.name` 로 적혀 있어도 뒤 두 마디로 맞춘다. */
function tableValue(table: string): string {
  const parts = table.split(".");
  return parts.length >= 2 ? `${parts[parts.length - 2]}.${parts[parts.length - 1]}` : table;
}

export function LookupSettings(props: Props) {
  const { site, initial, onClose, onSaved } = props;

  const [connections, setConnections] = useState<ConnectionInfo[] | null>(null);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [connection, setConnection] = useState(initial?.source.connection ?? "");
  const [table, setTable] = useState(initial?.source.table ?? "");
  // 읽어 온 목록은 "무엇에 대한 것인지" 와 함께 둔다. 접속 · 표가 바뀌면 파생값이 저절로 null 이 되어 effect 에서 초기화할 일이 없다.
  const [tablesFor, setTablesFor] = useState<{ connection: string; tables: TableInfo[]; error: string | null } | null>(null);
  const [tableFilter, setTableFilter] = useState("");
  const [columnsFor, setColumnsFor] = useState<{ connection: string; table: string; columns: ColumnInfo[]; error: string | null } | null>(null);
  const tables = tablesFor && tablesFor.connection === connection ? tablesFor.tables : null;
  const tablesError = tablesFor && tablesFor.connection === connection ? tablesFor.error : null;
  const dbColumns = columnsFor && columnsFor.connection === connection && columnsFor.table === table ? columnsFor.columns : null;
  const columnsError = columnsFor && columnsFor.connection === connection && columnsFor.table === table ? columnsFor.error : null;

  const [keyField, setKeyField] = useState(initial?.key.field ?? DEFAULT_KEY_FIELD);
  const [keyColumn, setKeyColumn] = useState(initial?.key.column ?? "");
  const [keyFormat, setKeyFormat] = useState<LookupKeyFormat>(initial?.key.format ?? "hex");
  const [reverseBytes, setReverseBytes] = useState(initial?.key.reverseBytes === true);
  const [title, setTitle] = useState(initial?.display.title ?? "");
  const [subtitle, setSubtitle] = useState(initial?.display.subtitle ?? "");
  const [columns, setColumns] = useState<DraftColumn[]>(
    (initial?.columns ?? []).map((c) => ({ column: c.column, label: c.label ?? "", show: c.show !== false })),
  );
  const [filters, setFilters] = useState<LookupFilter[]>(initial?.source.filters ?? []);
  const [refreshSeconds, setRefreshSeconds] = useState(String(initial?.refreshSeconds ?? DEFAULT_REFRESH_SECONDS));
  const [author, setAuthor] = useState(() => loadAuthor());

  const [preview, setPreview] = useState<LookupPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "save">("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // 접속 이름이 없고 구식 env 로만 붙어 있는 설정. 접속을 고르지 않으면 서버가 그 env 를 그대로 지킨다.
  const legacyEnv = !initial?.source.connection && initial?.envFile ? initial.envFile : null;
  const sourceReady = connection !== "" || legacyEnv !== null;

  // ---- 접속 목록 ----
  useEffect(() => {
    loadConnections()
      .then((r) => {
        setConnections(r.connections);
        setConnectionsError(null);
      })
      .catch((e: unknown) => {
        setConnections([]);
        setConnectionsError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  // ---- 표 목록(접속이 정해졌을 때) ----
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    loadTables(connection)
      .then((r) => {
        if (!cancelled) setTablesFor({ connection, tables: r.tables, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setTablesFor({ connection, tables: [], error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  // ---- 열 목록(표가 정해졌을 때). 구식 env 설정은 접속 이름이 없어 목록을 못 읽는다 — 그때는 설정에 적힌 열로만 보인다. ----
  useEffect(() => {
    if (!connection || !table) return;
    let cancelled = false;
    loadColumns(connection, table)
      .then((r) => {
        if (!cancelled) setColumnsFor({ connection, table, columns: r.columns, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setColumnsFor({ connection, table, columns: [], error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [connection, table]);

  /** 고를 수 있는 열. DB 에서 읽었으면 그것, 아니면 설정에 적힌 열(구식 env 설정용). */
  const columnNames = useMemo(() => {
    if (dbColumns && dbColumns.length > 0) return dbColumns.map((c) => c.name);
    const names = new Set<string>();
    if (keyColumn) names.add(keyColumn);
    for (const c of columns) names.add(c.column);
    for (const f of filters) names.add(f.column);
    return [...names];
  }, [columns, dbColumns, filters, keyColumn]);

  const columnType = (name: string) => dbColumns?.find((c) => c.name === name)?.type ?? "";

  const filteredTables = useMemo(() => {
    if (!tables) return [];
    const q = tableFilter.trim().toLowerCase();
    return q ? tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(q)) : tables;
  }, [tableFilter, tables]);

  const draft = () => ({
    v: 1,
    site,
    source: {
      kind: "mssql",
      ...(connection ? { connection } : {}),
      table,
      filters: filters.filter((f) => f.column),
    },
    key: { field: keyField.trim(), column: keyColumn, format: keyFormat, reverseBytes },
    display: { title, subtitle },
    columns: columns.map((c) => ({ column: c.column, ...(c.label.trim() ? { label: c.label.trim() } : {}), ...(c.show ? {} : { show: false }) })),
    refreshSeconds: Number(refreshSeconds),
  });

  const problems: string[] = [];
  if (!sourceReady) problems.push("접속을 고르십시오.");
  if (!table) problems.push("표를 고르십시오.");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyField.trim())) problems.push("MQTT 필드 이름은 글자 · 숫자 · 밑줄만 됩니다.");
  if (!keyColumn) problems.push("키가 들어 있는 DB 열을 고르십시오.");
  if (!title.trim()) problems.push("제목 템플릿을 적으십시오.");
  if (!Number.isFinite(Number(refreshSeconds)) || Number(refreshSeconds) < MIN_REFRESH_SECONDS) problems.push(`갱신 주기는 ${MIN_REFRESH_SECONDS}초 이상이어야 합니다.`);
  for (const f of filters) {
    const def = FILTER_OPS.find((d) => d.op === f.op);
    if (!f.column) problems.push("조건의 열을 고르십시오.");
    else if (def?.needsValue && !(f.value ?? "").trim()) problems.push(`조건 "${f.column}" 의 값이 비어 있습니다.`);
  }
  const canSubmit = problems.length === 0 && busy === "";

  const runPreview = () => {
    setBusy("preview");
    setPreviewError(null);
    previewLookup(site, draft())
      .then((p) => setPreview(p))
      .catch((e: unknown) => {
        setPreview(null);
        setPreviewError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(""));
  };

  const save = () => {
    setBusy("save");
    setSaveError(null);
    saveAuthor(author);
    saveLookupConfig(site, draft(), author)
      .then((r) => onSaved(r.snapshot, r.config))
      .catch((e: unknown) => setSaveError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(""));
  };

  const toggleColumn = (name: string) => {
    setColumns((cur) => (cur.some((c) => c.column === name) ? cur.filter((c) => c.column !== name) : [...cur, { column: name, label: "", show: true }]));
  };

  const appendToTemplate = (which: "title" | "subtitle", name: string) => {
    if (!name) return;
    const token = `{${name}}`;
    if (which === "title") setTitle((t) => (t.trim() ? `${t.trimEnd()} ${token}` : token));
    else setSubtitle((t) => (t.trim() ? `${t.trimEnd()} ${token}` : token));
  };

  const previewRow = preview?.rows[0];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="lookup-settings-title">
      <div className="my-4 w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <header className="flex items-center gap-3 border-b border-slate-800 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="lookup-settings-title" className="text-base font-semibold">기준정보 매핑 설정 · {site}</h2>
            <p className="truncate text-[11px] text-slate-400">
              UID 를 회사 자료의 어느 열과 맞추고 무엇을 이름으로 보일지 정합니다. 접속(비밀번호)은 관리자가 서버 파일로 관리합니다.
              {initial?.updatedAt ? ` · 마지막 저장 ${initial.updatedBy ?? "익명"} · ${new Date(initial.updatedAt).toLocaleString("ko-KR")}` : ""}
            </p>
          </div>
          <button type="button" className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        <div className="grid gap-5 px-5 py-4 md:grid-cols-2">
          {/* ---- 1. 접속 · 표 ---- */}
          <section className="flex flex-col gap-3">
            <div>
              <label className={LABEL} htmlFor="lookup-connection">1. 접속</label>
              <select id="lookup-connection" className={FIELD} value={connection} onChange={(e) => setConnection(e.target.value)} disabled={connections === null}>
                <option value="">{legacyEnv ? `(파일 설정 그대로 · ${legacyEnv})` : connections === null ? "읽는 중…" : "접속을 고르십시오"}</option>
                {(connections ?? []).map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                    {c.database ? ` — ${c.database} @ ${c.server}` : ` — ${c.server}`}
                  </option>
                ))}
              </select>
              {connectionsError ? <p className="mt-1 text-[11px] text-amber-300">{connectionsError}</p> : null}
              {connections && connections.length === 0 && !connectionsError ? (
                <p className="mt-1 text-[11px] text-amber-300">
                  등록된 접속이 없습니다. 관리자가 서버 폴더 <code>.grid-projects/.lookup/connections.json</code> 에 <code>{`{"MES":{"env":"…/DB-mes.env"}}`}</code> 처럼 적어야 합니다.
                </p>
              ) : null}
            </div>

            <div>
              <label className={LABEL} htmlFor="lookup-table">2. 표 (또는 뷰)</label>
              {connection ? (
                <>
                  <input className={`${FIELD} mb-1`} placeholder="이름으로 걸러 보기" value={tableFilter} onChange={(e) => setTableFilter(e.target.value)} />
                  <select id="lookup-table" className={FIELD} size={6} value={tableValue(table)} onChange={(e) => setTable(e.target.value)} disabled={tables === null}>
                    {tables === null ? <option value="">읽는 중…</option> : null}
                    {table && !filteredTables.some((t) => `${t.schema}.${t.name}` === tableValue(table)) ? <option value={tableValue(table)}>{tableValue(table)} (지금 설정)</option> : null}
                    {filteredTables.map((t) => (
                      <option key={`${t.schema}.${t.name}`} value={`${t.schema}.${t.name}`}>
                        {t.schema}.{t.name}
                        {t.kind === "view" ? " (뷰)" : ""}
                      </option>
                    ))}
                  </select>
                  {tablesError ? <p className="mt-1 text-[11px] text-amber-300">{tablesError}</p> : null}
                </>
              ) : (
                <input id="lookup-table" className={FIELD} value={table} onChange={(e) => setTable(e.target.value)} placeholder="db.schema.table" disabled={!legacyEnv} />
              )}
            </div>

            <div>
              <label className={LABEL} htmlFor="lookup-field">3. 키 맞추기 — MQTT 메시지 필드 ↔ DB 열</label>
              <div className="flex gap-2">
                <select id="lookup-field" className={FIELD} value={KEY_FIELDS.some((k) => k.field === keyField) ? keyField : "__custom"} onChange={(e) => setKeyField(e.target.value === "__custom" ? "" : e.target.value)}>
                  {KEY_FIELDS.map((k) => <option key={k.field} value={k.field}>{k.label}</option>)}
                  <option value="__custom">직접 입력 (다른 발행자의 필드 이름)</option>
                </select>
                {!KEY_FIELDS.some((k) => k.field === keyField) ? (
                  <input className={`${NARROW} w-36`} value={keyField} onChange={(e) => setKeyField(e.target.value)} placeholder="예: epc" aria-label="MQTT 필드 이름" />
                ) : null}
              </div>
              {KEY_FIELDS.find((k) => k.field === keyField)?.hint ? <p className="mt-1 text-[11px] text-slate-500">{KEY_FIELDS.find((k) => k.field === keyField)?.hint}</p> : null}
              <div className="mt-1 flex gap-2">
                <select id="lookup-key" className={FIELD} value={keyColumn} onChange={(e) => setKeyColumn(e.target.value)} aria-label="DB 열">
                  <option value="">고르십시오</option>
                  {columnNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                      {columnType(name) ? ` (${columnType(name)})` : ""}
                    </option>
                  ))}
                </select>
                <select className={NARROW} value={keyFormat} onChange={(e) => setKeyFormat(e.target.value as LookupKeyFormat)} title="hex: 16진수만 남겨 대문자로 비교 · text: 글자 그대로">
                  <option value="hex">16진수</option>
                  <option value="text">문자</option>
                </select>
              </div>
              {keyFormat === "hex" ? (
                <label className="mt-1 flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={reverseBytes} onChange={(e) => setReverseBytes(e.target.checked)} />
                  DB 가 바이트를 거꾸로 저장함 (리더 `E0 04 …` ↔ DB `…04E0`)
                </label>
              ) : null}
              {columnsError ? <p className="mt-1 text-[11px] text-amber-300">{columnsError}</p> : null}
            </div>

            <div>
              <label className={LABEL} htmlFor="lookup-refresh">4. 다시 읽는 주기 (초)</label>
              <input id="lookup-refresh" className={FIELD} type="number" min={MIN_REFRESH_SECONDS} step={15} value={refreshSeconds} onChange={(e) => setRefreshSeconds(e.target.value)} />
              <p className="mt-1 text-[11px] text-slate-500">서버가 이 간격으로 표를 통째로 다시 읽습니다. 자료가 하루에 몇 번 바뀌면 300(5분)이면 충분합니다. 최소 {MIN_REFRESH_SECONDS}.</p>
            </div>
          </section>

          {/* ---- 2. 표시 · 조건 ---- */}
          <section className="flex flex-col gap-3">
            <div>
              <label className={LABEL} htmlFor="lookup-title">5. 칸에 적을 제목</label>
              <div className="flex gap-2">
                <input id="lookup-title" className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="{정의구분} {정의번호}" />
                <select className={NARROW} value="" onChange={(e) => appendToTemplate("title", e.target.value)} aria-label="제목에 열 넣기">
                  <option value="">열 넣기…</option>
                  {columnNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <label className={`${LABEL} mt-2`} htmlFor="lookup-subtitle">부제 (목록 둘째 줄 · 비워도 됨)</label>
              <div className="flex gap-2">
                <input id="lookup-subtitle" className={FIELD} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="{정의명}" />
                <select className={NARROW} value="" onChange={(e) => appendToTemplate("subtitle", e.target.value)} aria-label="부제에 열 넣기">
                  <option value="">열 넣기…</option>
                  {columnNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              {previewRow ? (
                <p className="mt-1 truncate text-[11px] text-emerald-300">
                  미리보기: {renderTemplate(title, previewRow) || "(빈 제목)"}
                  {subtitle.trim() ? ` · ${renderTemplate(subtitle, previewRow)}` : ""}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">{"{열이름}"} 자리에 그 행의 값이 들어갑니다. 아래 미리보기로 실제 값을 확인하십시오.</p>
              )}
            </div>

            <div>
              <span className={LABEL}>6. 상세에 보일 열 (마우스를 올리면 보이는 것 · 이름 바꾸기 가능)</span>
              <ul className="mt-1 max-h-44 overflow-y-auto rounded border border-slate-700 bg-slate-800/60 p-1">
                {columnNames.filter((n) => n !== keyColumn).map((name) => {
                  const picked = columns.find((c) => c.column === name);
                  return (
                    <li key={name} className="flex items-center gap-2 px-1 py-0.5 text-xs">
                      <input type="checkbox" checked={!!picked} onChange={() => toggleColumn(name)} aria-label={`${name} 표시`} />
                      <span className="min-w-0 flex-1 truncate" title={columnType(name)}>{name}</span>
                      {picked ? (
                        <input
                          className="w-28 rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-xs"
                          placeholder="표시 이름"
                          value={picked.label}
                          onChange={(e) => setColumns((cur) => cur.map((c) => (c.column === name ? { ...c, label: e.target.value } : c)))}
                          aria-label={`${name} 표시 이름`}
                        />
                      ) : null}
                    </li>
                  );
                })}
                {columnNames.length === 0 ? <li className="px-1 py-1 text-xs text-slate-500">표를 고르면 열이 나옵니다.</li> : null}
              </ul>
            </div>

            <div>
              <span className={LABEL}>7. 조건 (모두 만족하는 행만 · 없어도 됨)</span>
              <ul className="mt-1 flex flex-col gap-1">
                {filters.map((f, index) => {
                  const def = FILTER_OPS.find((d) => d.op === f.op) ?? FILTER_OPS[0];
                  return (
                    <li key={index} className="flex items-center gap-1">
                      <select className={FIELD} value={f.column} onChange={(e) => setFilters((cur) => cur.map((x, i) => (i === index ? { ...x, column: e.target.value } : x)))} aria-label="조건 열">
                        <option value="">열</option>
                        {columnNames.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                      <select className={` w-36`} value={f.op} onChange={(e) => setFilters((cur) => cur.map((x, i) => (i === index ? { ...x, op: e.target.value as LookupFilterOp } : x)))} aria-label="조건 연산자">
                        {FILTER_OPS.map((d) => <option key={d.op} value={d.op}>{d.label}</option>)}
                      </select>
                      {def.needsValue ? (
                        <input className={NARROW} value={f.value ?? ""} onChange={(e) => setFilters((cur) => cur.map((x, i) => (i === index ? { ...x, value: e.target.value } : x)))} placeholder="값" aria-label="조건 값" />
                      ) : null}
                      <button type="button" className="shrink-0 rounded px-2 py-1 text-slate-400 hover:bg-slate-800" onClick={() => setFilters((cur) => cur.filter((_, i) => i !== index))} aria-label="조건 지우기">✕</button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="mt-1 rounded px-2 py-1 text-xs text-sky-300 hover:bg-slate-800" onClick={() => setFilters((cur) => [...cur, { column: "", op: "eq", value: "" }])}>
                + 조건 추가
              </button>
              {initial?.hasWhere ? <p className="mt-1 text-[11px] text-slate-500">이 사업장에는 관리자가 파일에 적은 추가 조건(WHERE)이 있어 위 조건과 함께 적용됩니다.</p> : null}
            </div>
          </section>
        </div>

        {/* ---- 미리보기 ---- */}
        <section className="border-t border-slate-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <button type="button" className={`${BUTTON} bg-slate-700 text-slate-100 hover:bg-slate-600`} onClick={runPreview} disabled={!canSubmit}>
              {busy === "preview" ? "읽는 중…" : `미리보기 (${5}행)`}
            </button>
            <span className="text-[11px] text-slate-500">저장하지 않고 초안대로 몇 행만 읽어 봅니다.</span>
          </div>
          {previewError ? <p className="mt-2 text-xs text-amber-300">{previewError}</p> : null}
          {preview ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="px-2 py-1">제목</th>
                    <th className="px-2 py-1">{keyColumn}</th>
                    {columns.filter((c) => c.show).map((c) => <th key={c.column} className="px-2 py-1">{c.label.trim() || c.column}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="border-t border-slate-800">
                      <td className="px-2 py-1 font-semibold text-emerald-300">{preview.titles[i]}</td>
                      <td className="px-2 py-1 font-mono text-slate-300">{String(row[keyColumn] ?? "")}</td>
                      {columns.filter((c) => c.show).map((c) => <td key={c.column} className="px-2 py-1 text-slate-200">{String(row[c.column] ?? "")}</td>)}
                    </tr>
                  ))}
                  {preview.rows.length === 0 ? <tr><td className="px-2 py-2 text-slate-500" colSpan={2 + columns.length}>조건에 맞는 행이 없습니다.</td></tr> : null}
                </tbody>
              </table>
              <p className="mt-1 truncate font-mono text-[10px] text-slate-500" title={preview.sql}>{preview.sql}</p>
            </div>
          ) : null}
        </section>

        {/* ---- 저장 ---- */}
        <footer className="flex flex-wrap items-center gap-3 border-t border-slate-800 px-5 py-3">
          <input className={` w-32`} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="저장자 이름" aria-label="저장자 이름" />
          <div className="min-w-0 flex-1 text-[11px] text-amber-300">
            {saveError ?? (problems.length > 0 ? problems[0] : "")}
          </div>
          <button type="button" className={`${BUTTON} text-slate-300 hover:bg-slate-800`} onClick={onClose}>취소</button>
          <button type="button" className={`${BUTTON} bg-sky-600 text-white hover:bg-sky-500`} onClick={save} disabled={!canSubmit}>
            {busy === "save" ? "저장 중…" : "저장하고 바로 읽기"}
          </button>
        </footer>
      </div>
    </div>
  );
}
