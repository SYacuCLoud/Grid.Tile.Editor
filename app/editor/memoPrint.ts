/**
 * 메모 인쇄 — 번호 매기기와 자리 잡기.
 *
 * 메모는 칸에 적어 두지만 칸 안에는 들어갈 자리가 없다. 그래서 도면에는 번호만
 * 찍고 본문은 따로 싣는다. 여기서 정하는 것은 두 가지다.
 *
 * 1. **번호** — 행 우선(왼→오, 위→아래). 글 읽는 순서와 같아 도면을 훑으며
 *    번호를 세는 눈의 움직임이 자연스럽다. 메모 인쇄를 껐을 때도 번호는 매긴다.
 *    종이에 본문이 없어도 화면에서 세는 순서가 달라지면 안 된다.
 *
 * 2. **자리** — 용지에서 격자가 쓰고 남은 빈 곳. 세로 용지는 아래, 가로 용지는
 *    오른쪽이 넓다. 남는 곳에 다 못 담으면 다음 장으로 이어 붙인다(`inline`)
 *    거나, 아예 뒤에 별지로 모은다(`appendix`).
 */

import type { LayoutDoc } from "./doc";
import { cellKey } from "./doc";
import {
  MAX_CELL_MM,
  MAX_MARGIN_MM,
  MIN_CELL_MM,
  type MemoPrintMode,
  type PagePaper,
  paperSizeMm,
} from "./paper";

/** 번호가 매겨진 메모 한 건. */
export interface MemoEntry {
  /** 1부터. 도면 칸에 찍히는 번호와 같다. */
  no: number;
  x: number;
  y: number;
  key: string;
  /** 장비 ID. 있으면 번호 옆에 적어 어느 설비인지 바로 안다. */
  label?: string;
  memo: string;
}

/**
 * 메모가 적힌 칸을 행 우선으로 훑어 번호를 매긴다.
 *
 * 정렬 기준을 좌표로 삼는다 — 객체 키 순서에 기대면 편집 순서에 따라 번호가
 * 뒤바뀌어, 같은 도면을 두 번 인쇄했을 때 번호가 달라진다.
 */
export function collectMemos(doc: Pick<LayoutDoc, "equipment">): MemoEntry[] {
  const found: Array<Omit<MemoEntry, "no">> = [];

  for (const [key, data] of Object.entries(doc.equipment)) {
    if (!data.memo) continue;
    const [x, y] = key.split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    found.push({ x, y, key, label: data.label, memo: data.memo });
  }

  // 행 우선: 위쪽 줄이 먼저, 같은 줄에서는 왼쪽이 먼저.
  found.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

  return found.map((entry, index) => ({ no: index + 1, ...entry }));
}

/** 칸 좌표 → 번호. 도면을 그릴 때 이 표를 보고 번호를 찍는다. */
export function memoNumbers(doc: Pick<LayoutDoc, "equipment">): Record<string, number> {
  const numbers: Record<string, number> = {};
  for (const entry of collectMemos(doc)) numbers[entry.key] = entry.no;
  return numbers;
}

/** 번호를 매길 때 쓴 것과 같은 키. */
export function memoKey(x: number, y: number): string {
  return cellKey(x, y);
}

/**
 * 메모 본문 한 줄의 크기(mm).
 *
 * 인쇄 치수로 잡는다 — 화면 배율을 바꿔도 몇 장에 걸치는지가 달라지면 안 된다.
 */
export const MEMO_LINE_MM = 3.6;
/** 메모 한 칸(항목)의 최소 너비. 이보다 좁으면 번호와 본문이 붙어 읽히지 않는다. */
export const MEMO_COL_MM = 60;
/** 도면과 메모 사이 숨 자리. */
export const MEMO_GAP_MM = 4;
/** 본문 글자 크기(mm). 현장에서 들고 읽을 수 있는 하한이다. */
export const MEMO_TEXT_MM = 2.6;

/** 이 아래로는 빈 곳이 좁아 메모를 실을 수 없다. 한 줄도 못 들어가면 새 장으로 보낸다. */
const MEMO_MIN_LINES = 2;

export interface MemoBlock {
  /** mm 단위. 용지 왼쪽 위에서 잰다(여백 안쪽). */
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  /** 이 자리에 늘어놓을 열 수. */
  columns: number;
  /** 열 하나에 들어가는 줄 수. */
  linesPerColumn: number;
  /** 이 자리에 담을 수 있는 줄 수 전체. */
  capacity: number;
}

/**
 * 용지에서 격자가 쓰고 남은 자리.
 *
 * 세로 용지는 아래가, 가로 용지는 오른쪽이 넓다 — 넓은 쪽을 쓴다. 둘 다 좁으면
 * `null` 이고, 부르는 쪽이 새 장으로 넘긴다.
 *
 * `gridColsOnSheet` · `gridRowsOnSheet` 는 **이 장에 실제로 실리는** 격자 칸 수다.
 * 도면이 여러 장에 걸치면 마지막 장만 빈 곳이 남는다.
 */
export function memoBlockOnSheet(
  paper: PagePaper,
  gridColsOnSheet: number,
  gridRowsOnSheet: number,
  bandCells: number,
): MemoBlock | null {
  const { widthMm, heightMm } = paperSizeMm(paper);
  const cellMm = Math.min(MAX_CELL_MM, Math.max(MIN_CELL_MM, paper.cellMm));
  const marginMm = Math.min(MAX_MARGIN_MM, Math.max(0, paper.marginMm));

  /**
   * 쓸 수 있는 인쇄영역 — **칸 경계까지만** 센다.
   *
   * 인쇄영역이 칸으로 나누어떨어지지 않으면 자투리가 남는다(A4 가로 277mm ÷
   * 5mm = 55.4칸). 인쇄물은 용지 픽셀로 그리니 그 자투리까지 쓸 수 있지만,
   * 화면 캔버스는 칸 단위라 55칸에서 끝난다 — mm 로 잡은 자리가 자투리를
   * 넘으면 화면에서 잘려 보인다. 두 곳이 같아야 미리보기를 믿을 수 있다.
   */
  const usableW = Math.floor((widthMm - marginMm * 2) / cellMm) * cellMm;
  const usableH = Math.floor((heightMm - marginMm * 2) / cellMm) * cellMm;

  // 범례 띠도 격자 아래를 차지한다. 그만큼 빼고 남은 자리를 센다.
  const gridW = gridColsOnSheet * cellMm;
  const gridH = (gridRowsOnSheet + bandCells) * cellMm;

  const rightMm = usableW - gridW;
  const bottomMm = usableH - gridH;

  // 세로 용지는 아래, 가로 용지는 오른쪽이 넓다. 다만 실제로 남은 자리를 재서
  // 고른다 — 격자 모양에 따라 방향과 반대로 남을 수 있다.
  const preferBottom = paper.orientation === "portrait";
  const candidates: Array<{ bottom: boolean; roomMm: number }> = preferBottom
    ? [
        { bottom: true, roomMm: bottomMm },
        { bottom: false, roomMm: rightMm },
      ]
    : [
        { bottom: false, roomMm: rightMm },
        { bottom: true, roomMm: bottomMm },
      ];

  for (const pick of candidates) {
    const room = pick.roomMm - MEMO_GAP_MM;
    if (room <= 0) continue;

    if (pick.bottom) {
      const columns = Math.max(1, Math.floor(usableW / MEMO_COL_MM));
      const linesPerColumn = Math.floor(room / MEMO_LINE_MM);
      if (linesPerColumn < MEMO_MIN_LINES) continue;
      return {
        xMm: marginMm,
        yMm: marginMm + gridH + MEMO_GAP_MM,
        widthMm: usableW,
        heightMm: room,
        columns,
        linesPerColumn,
        capacity: columns * linesPerColumn,
      };
    }

    const columns = Math.floor(room / MEMO_COL_MM);
    if (columns < 1) continue;
    const linesPerColumn = Math.floor(usableH / MEMO_LINE_MM);
    if (linesPerColumn < MEMO_MIN_LINES) continue;
    return {
      xMm: marginMm + gridW + MEMO_GAP_MM,
      yMm: marginMm,
      widthMm: room,
      heightMm: usableH,
      columns,
      linesPerColumn,
      capacity: columns * linesPerColumn,
    };
  }

  return null;
}

/** 용지 한 장을 메모로만 채울 때의 자리. 별지 · 이어붙임에 쓴다. */
export function memoBlockOnBlankSheet(paper: PagePaper): MemoBlock {
  const { widthMm, heightMm } = paperSizeMm(paper);
  const cellMm = Math.min(MAX_CELL_MM, Math.max(MIN_CELL_MM, paper.cellMm));
  const marginMm = Math.min(MAX_MARGIN_MM, Math.max(0, paper.marginMm));
  // 도면 장과 같은 자로 잰다(칸 경계까지) — 장마다 메모 폭이 달라지면 어색하다.
  const usableW = Math.floor((widthMm - marginMm * 2) / cellMm) * cellMm;
  const usableH = Math.floor((heightMm - marginMm * 2) / cellMm) * cellMm;

  const columns = Math.max(1, Math.floor(usableW / MEMO_COL_MM));
  const linesPerColumn = Math.max(MEMO_MIN_LINES, Math.floor(usableH / MEMO_LINE_MM));

  return {
    xMm: marginMm,
    yMm: marginMm,
    widthMm: usableW,
    heightMm: usableH,
    columns,
    linesPerColumn,
    capacity: columns * linesPerColumn,
  };
}

/**
 * 메모 한 건이 차지하는 줄 수.
 *
 * 번호 · 장비 ID · 본문을 한 줄에 이어 적고, 넘치면 접는다. 글자 폭은 캔버스를
 * 봐야 정확하지만, 몇 장이 나오는지는 그리기 전에 알아야 한다 — 그래서 여기서는
 * 글자 수로 어림한다. 어림이 실제보다 짧으면 마지막 줄이 잘리므로, 넉넉히
 * 잡히는 쪽(글자 폭을 좁게 보는 대신 여유 한 줄)을 택한다.
 */
export function memoLineCount(entry: MemoEntry, columnWidthMm: number): number {
  // 본문 글자 하나가 차지하는 폭. 한글·숫자가 섞이므로 글자 크기의 0.62 로 본다.
  const perCharMm = MEMO_TEXT_MM * 0.62;
  const head = `${entry.no}. ${entry.label ? `${entry.label} ` : ""}`;
  const text = `${head}${entry.memo}`;

  // 줄바꿈이 들어 있으면 그 자리에서 끊는다 — 사용자가 나눈 줄을 붙이지 않는다.
  const paragraphs = text.split(/\r?\n/);
  const perLine = Math.max(8, Math.floor((columnWidthMm - 2) / perCharMm));

  let lines = 0;
  for (const paragraph of paragraphs) {
    lines += Math.max(1, Math.ceil(paragraph.length / perLine));
  }
  // 항목 사이 숨 자리 한 줄.
  return lines + 1;
}

export interface MemoPage {
  /** 이 장에 실리는 메모. */
  entries: MemoEntry[];
  /** 도면과 같은 장에 얹히는지, 메모만 있는 새 장인지. */
  onGridSheet: boolean;
  /** 도면과 같은 장일 때, 그 장의 번호(0부터). */
  gridSheetIndex?: number;
  block: MemoBlock;
}

/**
 * 메모를 장마다 나눈다.
 *
 * `inline` 은 도면 마지막 장의 빈 곳부터 채우고 넘치면 새 장으로 이어 붙인다.
 * `appendix` 는 도면에 섞지 않고 새 장부터 시작한다.
 *
 * 빈 곳이 없거나(`memoBlockOnSheet` 가 `null`) 남은 메모가 없으면 그만큼 장이
 * 줄어든다 — 메모가 없으면 빈 장을 만들지 않는다.
 */
export function planMemoPages(
  mode: MemoPrintMode,
  entries: MemoEntry[],
  paper: PagePaper,
  lastSheet: { index: number; gridCols: number; gridRows: number; bandCells: number } | null,
): MemoPage[] {
  if (mode === "off" || entries.length === 0) return [];

  const pages: MemoPage[] = [];
  const rest = [...entries];

  /** 이 자리에 들어가는 만큼 떼어 낸다. 한 건도 안 들어가면 빈 배열. */
  const take = (block: MemoBlock): MemoEntry[] => {
    const columnWidthMm = block.widthMm / Math.max(1, block.columns);
    const taken: MemoEntry[] = [];
    let used = 0;
    let column = 0;

    while (rest.length > 0) {
      const need = memoLineCount(rest[0], columnWidthMm);

      // 이 열에 안 들어가면 다음 열로 넘어간다.
      if (used + need > block.linesPerColumn) {
        column += 1;
        used = 0;
        if (column >= block.columns) break;
        // 한 열보다 긴 항목은 어느 열에도 안 들어간다. 그대로 넣어 잘리게 두는
        // 편이 무한 반복보다 낫다 — 이런 메모는 애초에 한 장을 넘긴다.
        if (need > block.linesPerColumn) {
          taken.push(rest.shift() as MemoEntry);
          used = block.linesPerColumn;
          continue;
        }
        continue;
      }

      taken.push(rest.shift() as MemoEntry);
      used += need;
    }

    return taken;
  };

  if (mode === "inline" && lastSheet) {
    const block = memoBlockOnSheet(paper, lastSheet.gridCols, lastSheet.gridRows, lastSheet.bandCells);
    if (block) {
      const taken = take(block);
      if (taken.length > 0) {
        pages.push({ entries: taken, onGridSheet: true, gridSheetIndex: lastSheet.index, block });
      }
    }
  }

  // 남은 것은 메모만 있는 새 장에 이어 붙인다.
  const blank = memoBlockOnBlankSheet(paper);
  let guard = 0;
  while (rest.length > 0) {
    const taken = take(blank);
    if (taken.length === 0) break;
    pages.push({ entries: taken, onGridSheet: false, block: blank });

    // 한 건도 못 담는 상황이 이어지면 멈춘다. (지켜 주는 쪽이 없으면 도면 하나가
    // 프로그램을 멈춰 세운다.)
    guard += 1;
    if (guard > 500) break;
  }

  return pages;
}
