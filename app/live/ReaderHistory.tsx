"use client";

import { useEffect, useState } from "react";
import { formatStamp } from "../editor/server/api";
import { type EventPage, loadReaderEvents, type LoggedEvent } from "./eventsClient";
import { downloadText, historyCsv, historyFileName, pairEvents } from "./historyCsv";
import { formatDwell, LIVE_COLORS, type ReaderState } from "./liveState";
import { type LookupSnapshot, resolveTag } from "./lookup";

/**
 * 리더 하나의 식별 이력.
 *
 * 칸(또는 목록의 리더 줄)을 누르면 열린다. 서버가 브로커를 구독해 쌓아 둔 등장 · 제거 이벤트를 최신부터 보이고,
 * 기간(24시간 · 3일 · 7일 · 30일)을 고르거나 `이전 … 더` 로 과거를 이어 받는다. 기준정보 매핑이 있으면 UID 대신 실물 이름이 붙는다.
 * `CSV 내려받기` 는 지금 보이는 목록을 그대로 파일로 준다(엑셀용 UTF-8 BOM).
 * 현황판 자체는 여전히 읽기 전용이다 — 여기서도 아무것도 바꾸지 않는다.
 */

interface Props {
  reader: ReaderState;
  /** 칸 위치 글. 없으면(미배치) 비움. */
  place: string;
  snapshot: LookupSnapshot | null;
  now: number;
  onClose: () => void;
}

const RANGES: { hours: number; label: string }[] = [
  { hours: 24, label: "24시간" },
  { hours: 72, label: "3일" },
  { hours: 168, label: "7일" },
  { hours: 720, label: "30일" },
];
/** 한 구간에 받아 오는 최대 건수. 리더 하나가 30일에 수천 건이면 그때 `더` 로 이어 받는다. */
const LIMIT = 5000;

export function ReaderHistory(props: Props) {
  const { reader, place, snapshot, now, onClose } = props;
  const [hours, setHours] = useState(24);
  const [pages, setPages] = useState<EventPage[]>([]);
  // 처음 열릴 때 곧 읽기 시작하므로 true 로 시작한다. 리더가 바뀌면 부모가 key 로 새로 만든다.
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const events = pages.flatMap((p) => p.events);
  const oldest = pages.length > 0 ? pages[pages.length - 1].fromMs : now;

  /** 처음부터(또는 기간을 바꿔) 다시 읽거나, `before` 를 주면 그 앞 구간을 이어 붙인다. */
  const load = (range: number, before?: number) => {
    setBusy(true);
    setError(null);
    loadReaderEvents({ site: reader.site, key: reader.key, hours: range, before, limit: LIMIT })
      .then((page) => setPages((cur) => (before ? [...cur, page] : [page])))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    let cancelled = false;
    loadReaderEvents({ site: reader.site, key: reader.key, hours: 24, limit: LIMIT })
      .then((page) => {
        if (!cancelled) {
          setPages([page]);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reader.site, reader.key]);

  // 등장 → 제거 를 한 줄로 묶어 "무엇이 언제부터 언제까지" 로 읽히게 한다. 최신이 위.
  const rows = pairEvents(events);
  const appearCount = events.filter((e) => e.kind === "APPEAR").length;
  const rangeLabel = RANGES.find((r) => r.hours === hours)?.label ?? `${hours}시간`;

  const download = () => downloadText(historyFileName(reader.reader || reader.key, new Date(now)), historyCsv(rows, snapshot));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="reader-history-title">
      <div className="my-4 w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <header className="flex items-center gap-3 border-b border-slate-800 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="reader-history-title" className="truncate text-base font-semibold">
              {reader.reader}
              <span className="ml-2 text-sm font-normal text-slate-400">식별 이력</span>
            </h2>
            <p className="truncate text-[11px] text-slate-400">
              {place ? `${place} · ` : ""}S/N {reader.serial || "-"} · {reader.host} ·{" "}
              {reader.online ? (reader.present ? `지금 ${tagText(snapshot, reader.uid)}` : "지금 비어 있음") : "오프라인"}
            </p>
          </div>
          <label className="flex items-center gap-1 text-[11px] text-slate-400">
            기간
            <select
              className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-100"
              value={hours}
              onChange={(e) => {
                const next = Number(e.target.value);
                setHours(next);
                load(next);
              }}
              disabled={busy}
            >
              {RANGES.map((r) => (
                <option key={r.hours} value={r.hours}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        <div className="px-5 py-3">
          <p className="mb-2 text-[11px] text-slate-500">
            {pages.length > 0 ? `${formatStamp(new Date(oldest).toISOString())} 이후 · 등장 ${appearCount}건 · ${rows.length}줄` : "읽는 중…"}
            {pages.some((p) => p.truncated) ? " · 건수가 많아 일부만 보입니다" : ""}
          </p>
          {error ? <p className="text-xs text-amber-300">{error}</p> : null}
          {pages.length > 0 && rows.length === 0 && !error ? (
            <p className="rounded border border-dashed border-slate-700 p-3 text-xs text-slate-500">
              이 기간에 기록된 이벤트가 없습니다. 서버 기록기는 현황판 서버가 켜져 있는 동안 브로커의 이벤트를 쌓습니다.
            </p>
          ) : null}
          {rows.length > 0 ? (
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-1 py-1">등장</th>
                    <th className="px-1 py-1">제거</th>
                    <th className="px-1 py-1">체류</th>
                    <th className="px-1 py-1">태그</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const uid = row.appear?.uid || row.remove?.uid || "";
                    const tag = resolveTag(snapshot, uid);
                    return (
                      <tr key={row.id} className="border-t border-slate-800 align-top">
                        <td className="whitespace-nowrap px-1 py-1.5 font-mono tabular-nums text-slate-300">{row.appear ? clock(row.appear) : <span className="text-slate-600">—</span>}</td>
                        <td className="whitespace-nowrap px-1 py-1.5 font-mono tabular-nums text-slate-300">
                          {row.remove ? clock(row.remove) : <span className="font-sans" style={{ color: LIVE_COLORS.present }}>놓여 있음</span>}
                        </td>
                        <td className="whitespace-nowrap px-1 py-1.5 text-slate-400">{row.remove?.dwellMs !== null && row.remove?.dwellMs !== undefined ? formatDwell(row.remove.dwellMs) : ""}</td>
                        <td className="px-1 py-1.5">
                          {tag ? (
                            <>
                              <span className="font-semibold text-emerald-300">{tag.title}</span>
                              {tag.subtitle ? <span className="ml-1 text-slate-300">{tag.subtitle}</span> : null}
                              <span className="ml-2 font-mono text-[10px] text-slate-500">{uid}</span>
                            </>
                          ) : (
                            <span className="font-mono text-slate-300">{uid || "(UID 없음)"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-slate-800 px-5 py-3">
          <button
            type="button"
            className="rounded bg-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50"
            onClick={() => load(hours, oldest)}
            disabled={busy || pages.length === 0}
          >
            {busy ? "읽는 중…" : `이전 ${rangeLabel} 더`}
          </button>
          <button
            type="button"
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            onClick={download}
            disabled={rows.length === 0}
            title="지금 보이는 목록을 CSV(엑셀용 UTF-8) 로 저장"
          >
            CSV 내려받기
          </button>
          <span className="min-w-0 flex-1 text-[11px] text-slate-500">서버가 켜져 있던 동안의 기록입니다. 보관 일수는 서버 설정(기본 30일).</span>
          <button type="button" className="rounded px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800" onClick={onClose}>닫기</button>
        </footer>
      </div>
    </div>
  );
}

export { pairEvents };

function clock(e: LoggedEvent): string {
  const t = e.time ? Date.parse(e.time) : e.receivedAt;
  const d = new Date(Number.isFinite(t) ? t : e.receivedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function tagText(snapshot: LookupSnapshot | null, uid: string): string {
  if (!uid) return "";
  const tag = resolveTag(snapshot, uid);
  return tag ? (tag.subtitle ? `${tag.title} · ${tag.subtitle}` : tag.title) : `UID ${uid}`;
}
