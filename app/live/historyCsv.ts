/**
 * 식별 이력 → CSV. 브라우저가 화면에 보이는 그대로(등장 · 제거 짝 한 줄) 내려받는다.
 * 엑셀이 한글을 바로 읽도록 UTF-8 BOM 을 앞에 붙이고, 셀 안의 쉼표 · 따옴표 · 줄바꿈은 따옴표로 감싼다.
 * 순수 계산만 둔다 — 파일 저장(Blob · a[download])은 화면이 한다.
 */

import type { LoggedEvent } from "../../server/eventLog";
import { type LookupSnapshot, resolveTag } from "./lookup";

export interface HistoryRow {
  id: string;
  appear: LoggedEvent | null;
  remove: LoggedEvent | null;
}

/**
 * 최신순 이벤트(한 리더)를 등장 · 제거 짝으로. 제거 뒤에 같은 UID 의 등장이 오면(시간 역순이므로) 한 줄.
 * 짝이 없는 것은 홀로 한 줄 — 서버가 켜지기 전에 등장했거나, 아직 놓여 있는 것.
 */
export function pairEvents(events: LoggedEvent[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  let pending: LoggedEvent | null = null; // 아직 짝(등장)을 못 만난 제거
  for (const e of events) {
    if (e.kind === "REMOVE") {
      if (pending) rows.push({ id: pending.id, appear: null, remove: pending });
      pending = e;
      continue;
    }
    if (pending && (!pending.uid || !e.uid || pending.uid === e.uid)) {
      rows.push({ id: e.id, appear: e, remove: pending });
      pending = null;
    } else {
      if (pending) {
        rows.push({ id: pending.id, appear: null, remove: pending });
        pending = null;
      }
      rows.push({ id: e.id, appear: e, remove: null });
    }
  }
  if (pending) rows.push({ id: pending.id, appear: null, remove: pending });
  return rows;
}

/**
 * 여러 리더의 이벤트를 리더별로 나눠 짝지은 뒤 한 목록으로. 리더 이름 → 최신순.
 * `keys` 를 주면 그 리더(`site/key`)만 남긴다 — "이 페이지에 놓인 리더만" 내려받을 때.
 */
export function bulkRows(events: LoggedEvent[], keys?: Set<string>): HistoryRow[] {
  const byReader = new Map<string, LoggedEvent[]>();
  for (const e of events) {
    const id = `${e.site}/${e.key}`;
    if (keys && !keys.has(id)) continue;
    const list = byReader.get(id) ?? [];
    list.push(e);
    byReader.set(id, list);
  }
  const groups = [...byReader.entries()].sort((a, b) => (a[1][0]?.reader ?? a[0]).localeCompare(b[1][0]?.reader ?? b[0], "ko"));
  const out: HistoryRow[] = [];
  for (const [, list] of groups) {
    list.sort((a, b) => b.receivedAt - a.receivedAt || b.time.localeCompare(a.time));
    out.push(...pairEvents(list));
  }
  return out;
}

export const HISTORY_CSV_HEADER = ["등장", "제거", "체류(초)", "태그", "태그 상세", "UID", "리더", "S/N", "감시 PC", "사업장"] as const;

/** 엑셀 · 구글 시트가 한 칸으로 읽는 로컬 시각 `YYYY-MM-DD HH:mm:ss`. */
export function csvTime(e: LoggedEvent | null): string {
  if (!e) return "";
  const t = e.time ? Date.parse(e.time) : Number.NaN;
  const d = new Date(Number.isFinite(t) ? t : e.receivedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function historyCsv(rows: HistoryRow[], snapshot: LookupSnapshot | null): string {
  const lines = [HISTORY_CSV_HEADER.join(",")];
  for (const row of rows) {
    const any = row.appear ?? row.remove;
    if (!any) continue;
    const uid = row.appear?.uid || row.remove?.uid || "";
    const tag = resolveTag(snapshot, uid);
    const dwell = row.remove?.dwellMs;
    lines.push(
      [
        csvTime(row.appear),
        csvTime(row.remove),
        dwell === null || dwell === undefined ? "" : String(Math.round(dwell / 100) / 10),
        tag?.title ?? "",
        tag?.subtitle ?? "",
        uid,
        any.reader,
        any.serial,
        any.host,
        any.site,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // BOM + CRLF — 윈도 엑셀이 더블클릭으로 열 때 한글과 줄이 깨지지 않는다.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** 내려받기 파일 이름. `식별이력_05-01_2026-09-16.csv` 처럼 리더 이름을 넣되 파일명에 못 쓰는 글자는 뺀다. */
export function historyFileName(reader: string, now: Date): string {
  const safe = reader.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "reader";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `식별이력_${safe}_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}

/** 브라우저에서 글자를 파일로 내려받는다. 화면 코드가 부른다. */
export function downloadText(fileName: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
