"use client";

import { useState } from "react";
import { loadReaderEvents } from "./eventsClient";
import { bulkRows, downloadText, historyCsv, historyFileName } from "./historyCsv";
import type { LookupSnapshot } from "./lookup";

/**
 * 여러 리더의 식별 이력을 한 파일로 내려받는 작은 줄.
 * 범위는 "이 페이지에 놓인 리더" 또는 "사업장 전체", 기간은 24시간 ~ 30일. 서버에서 그 기간의 이벤트를 한 번에 받아
 * 리더별로 등장 · 제거를 짝지어 CSV 한 장으로 만든다(리더 열이 있으니 엑셀에서 필터로 가른다).
 */

interface Props {
  /** 조회할 사업장. 비우면 모든 사업장. */
  site: string;
  /** 이 페이지에 놓인 리더 id(`site/key`). */
  placedIds: string[];
  /** 파일 이름에 넣을 도면 · 페이지 이름. */
  title: string;
  snapshotFor: (site: string) => LookupSnapshot | null;
  now: number;
}

const RANGES: { hours: number; label: string }[] = [
  { hours: 24, label: "24시간" },
  { hours: 72, label: "3일" },
  { hours: 168, label: "7일" },
  { hours: 720, label: "30일" },
];
const LIMIT = 50_000;

export function HistoryExport(props: Props) {
  const { site, placedIds, title, snapshotFor, now } = props;
  const [hours, setHours] = useState(24);
  const [scope, setScope] = useState<"page" | "site">("page");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = () => {
    setBusy(true);
    setNote(null);
    loadReaderEvents({ site: site || undefined, hours, limit: LIMIT })
      .then((page) => {
        const rows = bulkRows(page.events, scope === "page" ? new Set(placedIds) : undefined);
        if (rows.length === 0) {
          setNote("이 기간에 기록된 이벤트가 없습니다.");
          return;
        }
        // 사업장이 여럿 섞일 수 있으니 줄마다 그 사업장의 기준정보로 이름을 붙인다. 한 사업장이면 그 하나.
        const sites = new Set(rows.map((r) => (r.appear ?? r.remove)?.site ?? ""));
        const snapshot = sites.size === 1 ? snapshotFor([...sites][0]) : snapshotFor(site || "default");
        const label = scope === "page" ? title : `${site || "전체"}_전체`;
        downloadText(historyFileName(label, new Date(now)), historyCsv(rows, snapshot));
        setNote(`${rows.length}줄 · 리더 ${new Set(rows.map((r) => (r.appear ?? r.remove)?.key)).size}대${page.truncated ? " · 건수가 많아 일부만" : ""}`);
      })
      .catch((e: unknown) => setNote(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const select = "rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-100 disabled:opacity-50";
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
      <span>이력 CSV</span>
      <select className={select} value={scope} onChange={(e) => setScope(e.target.value as "page" | "site")} disabled={busy} aria-label="내려받을 범위">
        <option value="page">이 페이지 리더 {placedIds.length}대</option>
        <option value="site">{site ? `사업장 ${site} 전체` : "모든 사업장"}</option>
      </select>
      <select className={select} value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={busy} aria-label="기간">
        {RANGES.map((r) => (
          <option key={r.hours} value={r.hours}>
            {r.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="rounded bg-emerald-700 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
        onClick={run}
        disabled={busy || (scope === "page" && placedIds.length === 0)}
        title="여러 리더의 등장 · 제거 이력을 한 CSV 로"
      >
        {busy ? "읽는 중…" : "내려받기"}
      </button>
      {note ? <span className="basis-full truncate text-slate-500">{note}</span> : null}
    </div>
  );
}
