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
  });

  ctx.restore();

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
