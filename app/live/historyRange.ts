/**
 * 식별 이력 · 이력 CSV 의 기간 선택 — 화면 두 곳(리더 이력 창 · 일괄 CSV)이 같은 목록과 같은 계산을 쓴다.
 *
 * `오늘` 은 이 브라우저의 자정부터 지금까지다(작업 교대가 날짜로 갈리는 현장을 위해). 서버는 UTC 만 알고
 * 화면의 시간대를 모르니 자정 시각(ms)을 `since` 로 보낸다. 나머지는 지금부터 n시간 전.
 * `이전 … 더` 는 `오늘` 이면 앞 달력 하루(어제 0시 ~ 24시), 아니면 같은 시간 폭을 앞으로 옮긴다.
 * 브라우저 · 서버 없이 시험할 수 있게 순수 계산만 둔다.
 */

export type HistoryRangeId = "today" | "24h" | "3d" | "7d" | "30d";

export interface HistoryRange {
  id: HistoryRangeId;
  label: string;
  /** `이전 … 더` 단추에 넣는 폭 이름. */
  step: string;
  /** 시간 폭. `today` 는 이어 받기 폭(하루). */
  hours: number;
}

export const HISTORY_RANGES: HistoryRange[] = [
  { id: "today", label: "오늘", step: "하루", hours: 24 },
  { id: "24h", label: "24시간", step: "24시간", hours: 24 },
  { id: "3d", label: "3일", step: "3일", hours: 72 },
  { id: "7d", label: "7일", step: "7일", hours: 168 },
  { id: "30d", label: "30일", step: "30일", hours: 720 },
];

export const DEFAULT_HISTORY_RANGE: HistoryRangeId = "today";

export function historyRange(id: string): HistoryRange {
  return HISTORY_RANGES.find((r) => r.id === id) ?? HISTORY_RANGES[0];
}

/** 그 시각이 속한 날의 0시(이 실행 환경의 시간대). */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `/api/live/events` 에 보낼 시간 조건. */
export interface RangeQuery {
  hours?: number;
  since?: number;
  before?: number;
}

/**
 * 기간 선택 → 질의 조건. `before` 가 있으면 그 앞 구간(`이전 … 더`).
 * - `today` 처음: 오늘 0시(`since`) ~ 지금.
 * - `today` 이어 받기: `before` 직전 순간이 속한 날의 0시 ~ `before` — 달력 하루씩 뒤로 간다.
 * - 그 밖: 지금(또는 `before`)부터 n시간 전.
 */
export function rangeQuery(id: HistoryRangeId, now: number, before?: number): RangeQuery {
  if (id === "today") {
    if (before === undefined) return { since: startOfDay(now) };
    return { since: startOfDay(before - 1), before };
  }
  const { hours } = historyRange(id);
  return before === undefined ? { hours } : { hours, before };
}
