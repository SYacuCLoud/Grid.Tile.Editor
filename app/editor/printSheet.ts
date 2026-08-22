/**
 * 용지 규격에 정확히 맞춘 PNG 내보내기.
 *
 * 기본 PNG(`renderSheet`)는 격자 크기에 맞춰 이미지 크기가 정해진다. 화면에
 * 그려 둔 인쇄 경계선과 비율이 다르고, 인쇄할 때 축소·확대가 한 번 더 걸린다.
 *
 * 여기서는 반대로 간다 — **용지가 먼저**다. A4 210×297mm 를 지정한 DPI 로 바꾼
 * 크기가 그대로 이미지 크기가 되고, 여백(mm)과 한 칸(mm)도 같은 자로 잰다.
 * 그래서 뽑은 PNG 를 100% 배율로 인쇄하면 화면의 경계선 안내와 장수·자리가 맞는다.
 *
 * 여러 장에 걸치는 도면은 장마다 한 파일로 나눈다. 나누는 기준(장당 칸 수·범례
 * 띠)은 화면 경계선과 같은 계산(`sheetCells` · `legendBandCells`)을 쓴다.
 */

import type { LayoutDoc } from "./doc";
import type { LayerId, PaletteItem } from "./palette";
import {
  legendBandCells,
  legendColumns,
  MAX_CELL_MM,
  MAX_MARGIN_MM,
  MIN_CELL_MM,
  type PagePaper,
  paperMeta,
  paperSizeMm,
  sheetCells,
  sheetCount,
} from "./paper";
import { renderDoc } from "./render";
import {
  type MemoPage,
  MEMO_LINE_MM,
  MEMO_TEXT_MM,
  memoLineCount,
} from "./memoPrint";
import { type SheetMeta, watermarkText } from "./watermark";

export const MM_PER_INCH = 25.4;

/** 기본 해상도. A4 기준 1240×1754px — 화면으로 보기에도, 인쇄하기에도 무난하다. */
export const DEFAULT_PRINT_DPI = 150;
export const MIN_PRINT_DPI = 72;
export const MAX_PRINT_DPI = 600;

export function mmToPx(mm: number, dpi: number): number {
  return (mm / MM_PER_INCH) * dpi;
}

export interface PrintPlan {
  paper: PagePaper;
  dpi: number;
  /** 용지 한 장의 픽셀 크기. 이미지 크기가 곧 이 값이다. */
  pageWidth: number;
  pageHeight: number;
  marginPx: number;
  /** 인쇄물에서 한 칸이 차지하는 픽셀. `cellMm` 을 DPI 로 바꾼 값이다. */
  cellPx: number;
  /** 한 장에 들어가는 칸 수. 화면 경계선과 같은 계산이다. */
  sheet: { cols: number; rows: number };
  across: number;
  down: number;
  total: number;
  /** 도면 아래 범례 띠가 차지하는 행 수. */
  bandCells: number;
  legendColumns: number;
}

function clampDpi(dpi: number): number {
  if (!Number.isFinite(dpi)) return DEFAULT_PRINT_DPI;
  return Math.min(MAX_PRINT_DPI, Math.max(MIN_PRINT_DPI, Math.round(dpi)));
}

/** 용지 설정과 격자 크기로 몇 장을 어떤 픽셀 크기로 그릴지 정한다. */
export function planPrint(
  doc: { cols: number; rows: number },
  paper: PagePaper,
  legendCount: number,
  dpi: number = DEFAULT_PRINT_DPI,
): PrintPlan {
  const resolution = clampDpi(dpi);
  const { widthMm, heightMm } = paperSizeMm(paper);
  const cellMm = Math.min(MAX_CELL_MM, Math.max(MIN_CELL_MM, paper.cellMm));
  const marginMm = Math.min(MAX_MARGIN_MM, Math.max(0, paper.marginMm));
  const counts = sheetCount(paper, doc.cols, doc.rows, legendCount);

  return {
    paper,
    dpi: resolution,
    pageWidth: Math.round(mmToPx(widthMm, resolution)),
    pageHeight: Math.round(mmToPx(heightMm, resolution)),
    marginPx: mmToPx(marginMm, resolution),
    cellPx: mmToPx(cellMm, resolution),
    sheet: sheetCells(paper),
    across: counts.across,
    down: counts.down,
    total: counts.total,
    bandCells: legendBandCells(paper, legendCount),
    legendColumns: legendColumns(paper),
  };
}

const PAPER_WHITE = "#ffffff";
const FOOTER_COLOR = "#64748b";
/** 이 아래로는 여백이 좁아 쪽 번호를 넣을 자리가 없다. */
const FOOTER_MIN_MARGIN_MM = 6;

/** 여백에 적을 출처 한 줄. 제목은 도면에서, 나머지는 부르는 쪽에서 받는다. */
function footerText(doc: LayoutDoc, plan: PrintPlan, index: number, meta: SheetMeta | undefined): string {
  const across = plan.across;
  return watermarkText({
    title: meta?.title ?? doc.title ?? "격자형 배치도",
    revision: meta?.revision ?? null,
    printedAt: meta?.printedAt ?? null,
    author: meta?.author ?? null,
    sheet: { index, total: plan.total, col: (index % across) + 1, row: Math.floor(index / across) + 1 },
  });
}

/**
 * 한 장을 그린다. `ctx` 는 `plan.pageWidth × plan.pageHeight` 크기의 캔버스여야 한다.
 *
 * `index` 는 0부터. 가로로 먼저 세고 다음 줄로 내려간다.
 */
export function renderPrintSheet(
  ctx: CanvasRenderingContext2D,
  doc: LayoutDoc,
  plan: PrintPlan,
  index: number,
  visible: Record<LayerId, boolean>,
  legend: PaletteItem[],
  meta?: SheetMeta,
  memo?: { index: Record<string, number>; page: MemoPage | null },
) {
  const sheetIndex = Math.min(Math.max(0, Math.round(index)), plan.total - 1);
  const ax = sheetIndex % plan.across;
  const ay = Math.floor(sheetIndex / plan.across);

  ctx.fillStyle = PAPER_WHITE;
  ctx.fillRect(0, 0, plan.pageWidth, plan.pageHeight);

  const printableWidth = plan.pageWidth - plan.marginPx * 2;
  const printableHeight = plan.pageHeight - plan.marginPx * 2;

  ctx.save();
  // 여백 밖으로는 한 칸도 넘어가지 않게 자른다. 넘어가면 다음 장과 겹쳐 보인다.
  ctx.beginPath();
  ctx.rect(plan.marginPx, plan.marginPx, printableWidth, printableHeight);
  ctx.clip();

  // 이 장이 맡은 조각이 인쇄 영역 왼쪽 위에 오도록 도면 전체를 밀어 놓고 그린다.
  ctx.translate(
    plan.marginPx - ax * plan.sheet.cols * plan.cellPx,
    plan.marginPx - ay * plan.sheet.rows * plan.cellPx,
  );

  renderDoc(ctx, doc, {
    cell: plan.cellPx,
    visible,
    showGrid: true,
    // 경계선(자홍색 점선)은 화면 안내이므로 인쇄물에는 넣지 않는다. 장을 나눈 자리가 곧 경계다.
    printLegend:
      legend.length > 0 && plan.bandCells > 0
        ? { items: legend, bandCells: plan.bandCells, columns: plan.legendColumns }
        : null,
    memoIndex: memo?.index,
  });

  ctx.restore();

  // 이 장의 빈 곳에 실리는 메모. 도면을 자른 뒤에 그린다 — 잘림 영역 밖이다.
  if (memo?.page) renderMemoBlock(ctx, memo.page, plan, "메모");

  const marginMm = (plan.marginPx / plan.dpi) * MM_PER_INCH;
  const footer = footerText(doc, plan, sheetIndex, meta);
  if (marginMm >= FOOTER_MIN_MARGIN_MM && footer) {
    const size = Math.max(7, Math.round(mmToPx(2.6, plan.dpi)));
    ctx.fillStyle = FOOTER_COLOR;
    ctx.font = `${size}px "Segoe UI", "Malgun Gothic", system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(footer, plan.marginPx, plan.pageHeight - plan.marginPx * 0.35);
  }
}

/** 파일 이름 꼬리. `A4-세로-2of4` 처럼 어떤 용지의 몇 번째 장인지 남긴다. */
export function printSheetSuffix(plan: PrintPlan, index: number): string {
  const meta = paperMeta(plan.paper.id);
  const orientation = plan.paper.orientation === "portrait" ? "세로" : "가로";
  const base = `${meta.name}-${orientation}-${plan.dpi}dpi`;
  return plan.total <= 1 ? base : `${base}-${index + 1}of${plan.total}`;
}

const MEMO_TITLE_COLOR = "#334155";
const MEMO_TEXT_COLOR = "#1f2937";
const MEMO_NO_COLOR = "#111827";
const MEMO_RULE_COLOR = "#cbd5e1";

/**
 * 메모 본문을 한 자리에 늘어놓는다.
 *
 * 열을 채우고 다음 열로 넘어간다. 어느 장에 무엇이 실릴지는 이미
 * `planMemoPages` 가 정해 두었으므로, 여기서는 그대로 그린다.
 *
 * `title` 은 별지 첫 장에만 붙인다 — 도면과 같은 장에서는 도면이 이미 제목을
 * 달고 있어 두 번 적을 자리가 없다.
 */
export function renderMemoBlock(
  ctx: CanvasRenderingContext2D,
  page: MemoPage,
  plan: PrintPlan,
  title?: string,
) {
  const { block, entries } = page;
  const px = (mm: number) => mmToPx(mm, plan.dpi);

  const size = Math.max(7, Math.round(px(MEMO_TEXT_MM)));
  const lineH = px(MEMO_LINE_MM);
  const columnWidthMm = block.widthMm / Math.max(1, block.columns);
  const columnW = px(columnWidthMm);

  let top = px(block.yMm);

  if (title) {
    ctx.fillStyle = MEMO_TITLE_COLOR;
    ctx.font = `600 ${Math.round(size * 1.15)}px "Segoe UI", "Malgun Gothic", system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(title, px(block.xMm), top);

    // 제목 아래 가로줄. 도면과 메모를 눈으로 갈라 준다.
    const ruleY = top + lineH * 0.95;
    ctx.strokeStyle = MEMO_RULE_COLOR;
    ctx.lineWidth = Math.max(1, px(0.2));
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(px(block.xMm), ruleY);
    ctx.lineTo(px(block.xMm + block.widthMm), ruleY);
    ctx.stroke();

    top = ruleY + lineH * 0.5;
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  let column = 0;
  let used = 0;

  for (const entry of entries) {
    const need = memoLineCount(entry, columnWidthMm);
    if (used + need > block.linesPerColumn && column + 1 < block.columns) {
      column += 1;
      used = 0;
    }

    const x = px(block.xMm) + column * columnW;
    let y = top + used * lineH;

    // 번호는 짙게, 본문은 그보다 옅게 — 번호를 먼저 찾고 본문을 읽는다.
    ctx.font = `600 ${size}px "Segoe UI", "Malgun Gothic", system-ui, sans-serif`;
    ctx.fillStyle = MEMO_NO_COLOR;
    const head = `${entry.no}.`;
    ctx.fillText(head, x, y);
    const headW = ctx.measureText(`${head} `).width;

    ctx.font = `${size}px "Segoe UI", "Malgun Gothic", system-ui, sans-serif`;
    ctx.fillStyle = MEMO_TEXT_COLOR;

    // 본문은 열 폭에 맞춰 접는다. 줄바꿈은 사용자가 적은 자리에서 끊는다.
    const room = columnW - headW - px(2);
    const label = entry.label ? `${entry.label} · ` : "";
    let first = true;

    for (const paragraph of `${label}${entry.memo}`.split(/\r?\n/)) {
      for (const line of wrapText(ctx, paragraph, room)) {
        ctx.fillText(line, x + (first ? headW : headW), y);
        y += lineH;
        first = false;
      }
    }

    used += need;
    if (used >= block.linesPerColumn && column + 1 >= block.columns) break;
  }
}

/** 글자 폭을 재서 주어진 폭에 맞게 접는다. 단어 경계가 없는 한글도 글자 단위로 끊는다. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [""];
  if (ctx.measureText(text).width <= maxWidth) return [text];

  const lines: string[] = [];
  let line = "";

  for (const ch of text) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 메모만 실리는 장을 그린다. 별지 · 이어붙임에 쓴다. */
export function renderMemoSheet(
  ctx: CanvasRenderingContext2D,
  page: MemoPage,
  plan: PrintPlan,
  title: string,
  footer?: string,
) {
  ctx.fillStyle = PAPER_WHITE;
  ctx.fillRect(0, 0, plan.pageWidth, plan.pageHeight);

  renderMemoBlock(ctx, page, plan, title);

  const marginMm = (plan.marginPx / plan.dpi) * MM_PER_INCH;
  if (marginMm >= FOOTER_MIN_MARGIN_MM && footer) {
    const size = Math.max(7, Math.round(mmToPx(2.6, plan.dpi)));
    ctx.fillStyle = FOOTER_COLOR;
    ctx.font = `${size}px "Segoe UI", "Malgun Gothic", system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(footer, plan.marginPx, plan.pageHeight - plan.marginPx * 0.35);
  }
}

/**
 * 이 도면의 마지막 장에 실제로 실리는 격자 칸 수.
 *
 * 메모를 넣을 빈 곳을 재려면 필요하다 — 도면이 여러 장에 걸치면 마지막 장만
 * 남는 자리가 생긴다.
 */
export function lastSheetGrid(
  doc: { cols: number; rows: number },
  plan: PrintPlan,
): { index: number; gridCols: number; gridRows: number; bandCells: number } {
  const index = plan.total - 1;
  const ax = index % plan.across;
  const ay = Math.floor(index / plan.across);

  const gridCols = Math.min(plan.sheet.cols, doc.cols - ax * plan.sheet.cols);
  const totalRows = doc.rows + plan.bandCells;
  const rowsOnSheet = Math.min(plan.sheet.rows, totalRows - ay * plan.sheet.rows);

  // 이 장에 실리는 행 중 범례 띠 몫을 갈라낸다.
  const gridRowsHere = Math.max(0, Math.min(rowsOnSheet, doc.rows - ay * plan.sheet.rows));
  const bandHere = Math.max(0, rowsOnSheet - gridRowsHere);

  return {
    index,
    gridCols: Math.max(0, gridCols),
    gridRows: gridRowsHere,
    bandCells: bandHere,
  };
}
