/**
 * 인쇄물 · PNG 아래에 남기는 출처 한 줄.
 *
 * 현장에 돌아다니는 종이가 어느 판인지 구분되지 않으면, 고친 도면을 붙여 놓고도
 * 옛 종이를 보고 일한다. 제목 · 리비전 · 출력 시각 · 작성자를 여백에 적어 두면
 * 종이만 보고도 판을 가릴 수 있다.
 */

export interface SheetMeta {
  title?: string;
  /** 서버 저장 리비전. 서버에 올리지 않은 도면은 없다. */
  revision?: number | null;
  /** 출력 시각. 넣지 않으면 찍지 않는다(테스트에서 시각을 고정하려면 넣는다). */
  printedAt?: Date | null;
  author?: string | null;
  /** 여러 장으로 나뉜 인쇄물의 몇 번째 장인지. */
  sheet?: { index: number; total: number; col: number; row: number } | null;
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/**
 * 워터마크 한 줄. 넣을 값이 없는 자리는 아예 빼서 `· ·` 처럼 비지 않게 한다.
 * 값이 하나도 없으면 빈 문자열이고, 그때는 부르는 쪽에서 찍지 않는다.
 */
export function watermarkText(meta: SheetMeta): string {
  const parts = [
    meta.title?.trim() || null,
    typeof meta.revision === "number" && meta.revision > 0 ? `r${meta.revision}` : null,
    meta.sheet && meta.sheet.total > 1
      ? `${meta.sheet.index + 1}/${meta.sheet.total} (가로 ${meta.sheet.col} · 세로 ${meta.sheet.row})`
      : null,
    meta.printedAt ? stamp(meta.printedAt) : null,
    meta.author?.trim() ? `작성자: ${meta.author.trim()}` : null,
  ].filter(Boolean);

  return parts.join(" · ");
}
