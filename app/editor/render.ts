import { cellKey, cellPhotos, type LayoutDoc, paintedCells, type Point } from "./doc";
import { defaultLayers, type LayerDef } from "./layers";
import {
  indexPalette,
  itemOpacity,
  type LayerId,
  type PaletteIndex,
  type PaletteItem,
  resolveItem,
  textColorOn,
  type WireId,
} from "./palette";
import { legendItems, legendLabel } from "./paletteOps";
import { dashArray, fillCellPattern } from "./pattern";
import { type CellRange } from "./range";
import { type SheetMeta, watermarkText } from "./watermark";

export interface RenderOptions {
  cell: number;
  visible: Record<LayerId, boolean>;
  showGrid: boolean;
  /** 드래그 중 미리보기. */
  preview?: {
    item: PaletteItem | null;
    layer: LayerId;
    points: Point[];
  } | null;
  selected?: string | null;
  selectionRange?: CellRange | null;
  hover?: Point | null;
  /**
   * 인쇄 한 장에 들어가는 칸 수. 주면 그 간격으로 경계선을 그린다.
   * 화면에서만 쓴다 — PNG 내보내기에는 넘기지 않는다.
   */
  printGuide?: { cols: number; rows: number } | null;
  /**
   * 인쇄 경계선 안에 미리 그려 볼 범례. 인쇄물에는 도면 아래로 범례가 함께
   * 실리므로, 이 자리를 비워 두지 않으면 실제 인쇄 영역과 어긋난다.
   */
  printLegend?: {
    items: PaletteItem[];
    bandCells: number;
    columns: number;
  } | null;
  /**
   * 칸 좌표 → 메모 번호. 메모가 적힌 칸에 이 번호를 찍는다.
   *
   * 없으면 예전처럼 점만 찍는다 — 번호는 도면 전체를 훑어야 매길 수 있어,
   * 부르는 쪽에서 한 번 만들어 넘긴다(`memoPrint.memoNumbers`).
   */
  memoIndex?: Record<string, number>;
  /**
   * 인쇄 경계선 안에 미리 그려 볼 메모 본문.
   *
   * 자리는 mm 로 재어 두고(`memoPrint`), 여기서 칸 좌표로 바꿔 그린다. 화면에서
   * 한 칸이 `cellMm` 에 해당하므로 `(mm - 여백) / cellMm` 이 칸 수다.
   *
   * `originCells` 는 이 자리가 놓인 장의 좌상단 칸이다 — 도면이 여러 장에
   * 걸치면 메모는 마지막 장에 실린다.
   */
  printMemo?: {
    pages: Array<{
      block: { xMm: number; yMm: number; widthMm: number; heightMm: number; columns: number; linesPerColumn: number };
      entries: Array<{ no: number; label?: string; memo: string }>;
      originCells: { x: number; y: number };
    }>;
    cellMm: number;
    marginMm: number;
    lineMm: number;
    textMm: number;
  } | null;
}

const GRID_LINE = "#d3d9df";
const GRID_LINE_STRONG = "#b6bfc8";
const PAPER = "#ffffff";
const LABEL_COLOR = "#101418";
const PRINT_GUIDE = "#c026d3";
/** 용지 범위 안이지만 격자 밖인 자리. 그릴 수 없는 영역임을 알린다. */
const OUTSIDE_GRID = "#e9edf1";

/** 더 줄이면 읽을 수 없다. 이 아래로는 글자 크기 대신 다른 수를 쓴다. */
const MIN_FONT_PX = 6;
/** 글자 둘레 테두리 굵기 비율. 이만큼은 글자 폭 밖으로 번진다. */
const HALO_RATIO = 0.3;
/** 가로로 눌러도 읽을 수 있는 한계. 이보다 납작하면 글자가 뭉갠다. */
const MIN_SCALE_X = 0.55;

function fontFor(px: number): string {
  return `${px}px "Segoe UI", "Malgun Gothic", system-ui, sans-serif`;
}

/** 같은 글꼴의 굵은 꼴. 번호처럼 먼저 눈에 걸려야 하는 글자에 쓴다. */
function boldFontFor(px: number): string {
  return `600 ${fontFor(px)}`;
}

/** 주어진 폭에 들어가는 가장 큰 글자 크기. 못 들어가면 하한선에서 멈춘다. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  basePx: number,
  minPx = MIN_FONT_PX,
): number {
  let size = Math.max(minPx, Math.round(basePx));
  while (size > minPx) {
    ctx.font = fontFor(size);
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  ctx.font = fontFor(size);
  return size;
}

/**
 * 글자 뒤에 깔 테두리 색. 글자와 반대쪽 명도를 쓴다.
 *
 * 밝은 상태색이나 빗금 위에서는 검은 글자든 흰 글자든 무늬에 묻힌다. 글자
 * 둘레를 반대색으로 한 번 두르면 어떤 바탕 위에서도 획이 끊겨 보이지 않는다.
 */
function haloColor(textColor: string): string {
  return textColor === "#ffffff" ? "rgba(16, 20, 24, 0.85)" : "rgba(255, 255, 255, 0.9)";
}

/** 가운데에서 가른다. 띄어쓰기가 가까이 있으면 거기서 가르는 편이 읽기 좋다. */
function splitTwoLines(text: string): [string, string] {
  const middle = Math.ceil(text.length / 2);
  const space = text.lastIndexOf(" ", middle);
  const after = text.indexOf(" ", middle);
  const candidates = [space, after].filter((index) => index > 0 && index < text.length - 1);

  if (candidates.length > 0) {
    const at = candidates.reduce((best, index) => (Math.abs(index - middle) < Math.abs(best - middle) ? index : best));
    return [text.slice(0, at).trim(), text.slice(at + 1).trim()];
  }
  return [text.slice(0, middle), text.slice(middle)];
}

interface TextPlan {
  lines: string[];
  size: number;
  /** 1 이면 그대로, 1 보다 작으면 그만큼 가로로 눌러 넣는다. */
  scaleX: number;
}

/**
 * 칸 안에 글자를 어떻게 넣을지 정한다.
 *
 * 한글 네 글자쯤 되면 한 줄로는 칸 폭을 넘긴다. 예전에는 7px 에서 줄이기를
 * 멈춰 그대로 칸 밖으로 삐져나갔다. 이제는 세 단계로 내려간다.
 *   1. 글자 크기를 줄여 한 줄에 넣는다.
 *   2. 세로로 여유가 있으면 두 줄로 나눈다(네 글자 → 두 글자씩).
 *   3. 그래도 넘치면 가로로 눌러 넣는다.
 * 어느 단계든 결과는 반드시 주어진 폭 안에 들어간다.
 */
function planText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  basePx: number,
  maxHeight: number,
): TextPlan {
  const single = fitText(ctx, text, maxWidth, basePx);
  const singleFits = ctx.measureText(text).width <= maxWidth;

  // 두 줄로 나눌 세로 여유가 있는가. (줄 간격까지 2.2배로 본다)
  let two: TextPlan | null = null;
  const lineRoom = Math.min(basePx, maxHeight / 2.2);
  if (text.trim().length >= 3 && lineRoom >= MIN_FONT_PX) {
    const [first, second] = splitTwoLines(text);
    if (first && second) {
      const size = Math.min(fitText(ctx, first, maxWidth, lineRoom), fitText(ctx, second, maxWidth, lineRoom));
      ctx.font = fontFor(size);
      const widest = Math.max(ctx.measureText(first).width, ctx.measureText(second).width);
      if (widest <= maxWidth) two = { lines: [first, second], size, scaleX: 1 };
    }
  }

  // 한 줄이 들어가고 두 줄보다 작지 않으면 한 줄이 낫다. 두 줄은 글자를 더 크게
  // 쓸 수 있을 때만 쓴다 — 한 줄로 6px 까지 줄이느니 두 줄로 크게 쓰는 편이 읽힌다.
  if (singleFits && (!two || single >= two.size)) return { lines: [text], size: single, scaleX: 1 };
  if (two) return two;

  ctx.font = fontFor(single);
  const width = ctx.measureText(text).width;
  const scaleX = Math.max(MIN_SCALE_X, maxWidth / Math.max(1, width));

  // 눌러도 넘칠 만큼 긴 이름은 잘라내고 말줄임을 붙인다. 이웃 칸을 침범하느니
  // 뒷글자를 접는 편이 낫다. 전체 이름은 팔레트 · 범례에서 볼 수 있다.
  if (width * scaleX > maxWidth) {
    return {
      lines: [ellipsize(ctx, text, maxWidth / scaleX)],
      size: single,
      scaleX,
    };
  }
  return { lines: [text], size: single, scaleX };
}

/** 지금 글꼴 기준으로 폭에 들어갈 만큼만 남기고 `…` 을 붙인다. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  let cut = text.length - 1;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > maxWidth) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

/**
 * 장비 ID 글자 뒤에 깔는 형광펜 색.
 *
 * 상태색과 겹치지 않아야 한다 — 겹치면 "이 칸의 상태" 로 잘못 읽힌다. 기본
 * 상태색은 파랑 · 초록 · 빨강 · 노랑이고, 배경 타일은 회색 계열(벽 · 통로 · 문)
 * 이므로 그 사이에 빈 자리가 분홍뿐이다. 옅은 파스텔은 통로색(`#eef1f4`)에
 * 붙어 버려 쓸 수 없다.
 *
 * (RGB 거리로 재면 상태색과 168, 팔레트 견본과 109, 배경 타일과 106 떨어져 있다.
 * 색을 고칠 때는 `tests/cell-text.test.mjs` 가 이 여유를 지켜 준다.)
 */
export const LABEL_BG = "#ff8fd0";
/** 형광펜 위에 올릴 글자색. 밝은 바탕이므로 짙게 쓴다. */
export const LABEL_BG_TEXT = "#2a0a1e";

function paintLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  bg?: string,
) {
  // 형광펜 배경. 글자 자리만 덮도록 폭을 재서 깔고, 테두리(halo) 는 생략한다 —
  // 배경이 이미 글자를 띄워 주므로 테두리까지 두르면 뭉개진다.
  if (bg) {
    const width = ctx.measureText(text).width;
    const padX = Math.max(1.5, size * 0.22);
    const padY = Math.max(1, size * 0.14);
    ctx.save();
    ctx.fillStyle = bg;
    ctx.fillRect(x - width / 2 - padX, y - size / 2 - padY, width + padX * 2, size + padY * 2);
    ctx.restore();

    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    return;
  }

  ctx.save();
  ctx.lineWidth = Math.max(2, size * HALO_RATIO);
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeStyle = haloColor(color);
  ctx.setLineDash([]);
  ctx.strokeText(text, x, y);
  ctx.restore();

  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * 칸 가운데에 글자를 찍는다.
 *
 * `maxWidth` 는 글자 테두리(halo)까지 포함한 자리다. 테두리가 굵어 칸 밖으로
 * 번지면 이웃 칸을 침범하므로 그만큼 미리 뺀다.
 *
 * `bg` 를 주면 테두리 대신 형광펜 배경을 깐다(장비 ID).
 */
function drawCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  basePx: number,
  color: string,
  maxHeight = basePx,
  bg?: string,
) {
  const halo = Math.max(2, Math.round(basePx) * HALO_RATIO);
  const room = Math.max(4, maxWidth - halo);
  const plan = planText(ctx, text, room, basePx, maxHeight);

  ctx.font = fontFor(plan.size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lineHeight = plan.size * 1.1;
  const top = cy - ((plan.lines.length - 1) * lineHeight) / 2;

  if (plan.scaleX === 1) {
    plan.lines.forEach((line, index) => paintLine(ctx, line, cx, top + index * lineHeight, plan.size, color, bg));
    return;
  }

  // 가로로 누를 때는 원점을 글자 자리로 옮기고 눌러서 그린다.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(plan.scaleX, 1);
  plan.lines.forEach((line, index) =>
    paintLine(ctx, line, 0, (index - (plan.lines.length - 1) / 2) * lineHeight, plan.size, color, bg),
  );
  ctx.restore();
}

/** 메모 번호 표시. 상태색·형광펜과 겹치지 않는 짙은 남색. */
const MEMO_MARK_BG = "#111827";
const MEMO_MARK_TEXT = "#ffffff";

/** 인쇄 미리보기의 메모 자리. 종이에서 메모가 차지할 곳을 옅게 보여 준다. */
const MEMO_PREVIEW_BG = "#fbfcfe";
const MEMO_PREVIEW_BORDER = "#c9d3e0";
const MEMO_PREVIEW_TEXT = "#334155";

/** 이웃으로 뻗는 네 방향. 이어진 방향으로만 띠를 늘인다. */
const WIRE_DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

interface WireGeometry {
  color: string;
  band: number;
  cx: number;
  cy: number;
  links: Array<[number, number]>;
  /** 가운데 네모와 이어지는 방향의 띠. 무늬를 넣을 때 이 모양으로 잘라 쓴다. */
  rects: Array<[number, number, number, number]>;
}

function wireGeometry(
  wiring: Record<string, WireId>,
  x: number,
  y: number,
  id: WireId,
  cell: number,
  color: string,
): WireGeometry {
  const band = Math.max(3, Math.round(cell * 0.34));
  const cx = x * cell + cell / 2;
  const cy = y * cell + cell / 2;
  const links = WIRE_DIRECTIONS.filter(([dx, dy]) => wiring[cellKey(x + dx, y + dy)] === id);

  const rects: Array<[number, number, number, number]> = [[cx - band / 2, cy - band / 2, band, band]];
  for (const [dx, dy] of links) {
    rects.push([
      cx + (dx < 0 ? -cell / 2 : -band / 2),
      cy + (dy < 0 ? -cell / 2 : -band / 2),
      dx === 0 ? band : cell / 2,
      dy === 0 ? band : cell / 2,
    ]);
  }

  return { color, band, cx, cy, links, rects };
}

/** 이 칸이 직선으로 지나가기만 하는가. 모퉁이 · 갈림 · 끝은 아니다. */
function isStraightThrough(links: Array<[number, number]>): boolean {
  if (links.length !== 2) return false;
  return links[0][0] === -links[1][0] && links[0][1] === -links[1][1];
}

/**
 * 한 배선 항목의 칸 전체를 **한 번에** 칠한다.
 *
 * 칸마다 따로 칠하면 안 된다. 배선은 칸 안에서 사각형 여러 개(중앙 매듭 + 뻗는
 * 방향마다 하나)를 겹쳐 그리고, 이웃 칸끼리도 경계에서 맞물린다. 불투명할 때는
 * 같은 색이 겹쳐도 티가 안 나지만, 반투명이면 겹친 자리만 두 번 칠해져 칸마다
 * 진한 이음매가 줄줄이 남는다.
 *
 * 그래서 모든 사각형을 경로 하나에 모아 `fill` 을 한 번만 부른다 — 겹쳐도 칠은
 * 한 겹이다.
 */
function drawWireItem(
  ctx: CanvasRenderingContext2D,
  cells: Record<string, WireId>,
  keys: string[],
  item: PaletteItem,
  cell: number,
) {
  const color = item.color as string;
  const style = item.lineStyle ?? "solid";
  const band = Math.max(3, Math.round(cell * 0.34));

  ctx.save();
  ctx.globalAlpha = ctx.globalAlpha * itemOpacity(item);

  if (style === "solid") {
    // 사각형을 모두 한 경로에 모아 한 번만 채운다.
    ctx.beginPath();
    for (const key of keys) {
      const [x, y] = key.split(",").map(Number);
      const geometry = wireGeometry(cells, x, y, item.id, cell, color);
      for (const [rx, ry, rw, rh] of geometry.rects) ctx.rect(rx, ry, rw, rh);
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    return;
  }

  // 점선·파선. 선은 겹치지 않게 한 방향으로만 긋고, 매듭은 뒤에 한 번에 채운다.
  const knots: Array<[number, number, number, number]> = [];

  ctx.strokeStyle = color;
  ctx.lineWidth = band;
  ctx.lineCap = "butt";
  ctx.setLineDash(dashArray(style, band));

  for (const key of keys) {
    const [x, y] = key.split(",").map(Number);
    const { cx, cy, links } = wireGeometry(cells, x, y, item.id, cell, color);

    for (const [dx, dy] of links) {
      // 오른쪽·아래로만 긋는다. 양쪽에서 그으면 칸 경계의 같은 자리를 두 번
      // 지나 반투명일 때 이음매가 진해진다.
      if (dx < 0 || dy < 0) continue;

      // 이웃 칸의 중심까지 한 번에 긋고, dash 위상을 절대 좌표에 맞춘다.
      // 칸마다 위상을 0 에서 다시 시작하면 이웃 칸과 점선이 어긋나 끊겨 보인다.
      const horizontal = dy === 0;
      ctx.lineDashOffset = horizontal ? cx : cy;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dx * cell, cy + dy * cell);
      ctx.stroke();
    }

    // 모퉁이 · 갈림 · 끝에는 매듭을 채운다. 곧게 지나가는 칸은 점선 그대로 둔다.
    if (!isStraightThrough(links)) knots.push([cx - band / 2, cy - band / 2, band, band]);
  }

  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  if (knots.length > 0) {
    ctx.beginPath();
    for (const [kx, ky, kw, kh] of knots) ctx.rect(kx, ky, kw, kh);
    ctx.fillStyle = color;
    ctx.fill();
  }

  ctx.restore();
}

/**
 * 범례 · 미리보기 견본 한 칸.
 *
 * 도면에서 쓰이는 방식을 그대로 보여 준다 — 장비는 칸 테두리, 배선은 가로지르는
 * 경로, 나머지는 칸 채움. 목록과 도면이 다르게 보이면 같은 색이 무엇을 뜻하는지
 * 읽을 수 없다.
 */
function drawLegendSwatch(ctx: CanvasRenderingContext2D, item: PaletteItem, x: number, y: number, box: number) {
  const color = item.color as string;

  if (item.role === "kind") {
    ctx.fillStyle = PAPER;
    ctx.fillRect(x, y, box, box);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dashArray(item.lineStyle, 2));
    ctx.strokeRect(x + 1, y + 1, box - 2, box - 2);
    ctx.setLineDash([]);
    return;
  }

  if (item.role === "wire") {
    ctx.fillStyle = PAPER;
    ctx.fillRect(x, y, box, box);
    ctx.strokeStyle = GRID_LINE_STRONG;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, box, box);

    // 배선은 칸을 채우지 않고 지나간다. 견본도 가로지르는 선으로 보인다.
    // 도면과 같은 불투명도로 그려야 목록에서 고른 것이 도면과 같아 보인다.
    const band = Math.max(2, box * 0.34);
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * itemOpacity(item);
    ctx.strokeStyle = color;
    ctx.lineWidth = band;
    ctx.setLineDash(dashArray(item.lineStyle, band));
    ctx.beginPath();
    ctx.moveTo(x, y + box / 2);
    ctx.lineTo(x + box, y + box / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  fillCellPattern(ctx, x, y, box, color, item.pattern);
  ctx.strokeStyle = GRID_LINE_STRONG;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, box, box);
}

export function docPixelSize(doc: LayoutDoc, cell: number): { width: number; height: number } {
  return { width: doc.cols * cell, height: doc.rows * cell };
}

/**
 * 인쇄 경계선까지 담으려면 몇 칸이 필요한지.
 *
 * 격자가 한 장보다 작으면 경계선이 격자 밖에 놓여 그릴 자리가 없다.
 * 마지막 장의 바깥 테두리까지 보이도록 범위를 용지 단위로 올림한다.
 */
export function printExtentCells(
  cols: number,
  rows: number,
  guide: { cols: number; rows: number },
): { cols: number; rows: number } {
  const across = Math.max(1, Math.ceil(cols / guide.cols));
  const down = Math.max(1, Math.ceil(rows / guide.rows));
  return { cols: across * guide.cols, rows: down * guide.rows };
}

/** 화면 캔버스가 차지할 칸 수. 인쇄 경계선을 켜면 용지 범위까지 넓어진다. */
export function canvasCells(
  doc: { cols: number; rows: number },
  guide: { cols: number; rows: number } | null | undefined,
  legendBandCells = 0,
): { cols: number; rows: number } {
  if (!guide) return { cols: doc.cols, rows: doc.rows };
  return printExtentCells(doc.cols, doc.rows + legendBandCells, guide);
}

export function renderDoc(ctx: CanvasRenderingContext2D, doc: LayoutDoc, options: RenderOptions) {
  const { cell, visible, showGrid } = options;
  const { width, height } = docPixelSize(doc, cell);
  const index = indexPalette(doc.palette);

  // 인쇄 경계선을 켜면 캔버스가 용지 범위까지 넓다. 그 바깥은 그릴 수 없는 자리로 표시한다.
  const band = options.printLegend?.bandCells ?? 0;
  const extent = canvasCells(doc, options.printGuide, band);

  ctx.save();
  if (extent.cols !== doc.cols || extent.rows !== doc.rows) {
    ctx.fillStyle = OUTSIDE_GRID;
    ctx.fillRect(0, 0, extent.cols * cell, extent.rows * cell);
  }
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  /**
   * 레이어를 아래에서 위로 순서대로 그린다.
   *
   * 격자선은 채움 레이어 위, 표식 레이어(설비 · 배선) 아래에 한 번 긋는다.
   * 채움은 칸을 덮는 바탕이고 표식은 그 위에 얹는 것이라, 격자선이 채움에
   * 덮이면 칸 세는 눈금이 사라지고 표식을 덮으면 표식을 가린다.
   */
  const layers = doc.layers && doc.layers.length > 0 ? doc.layers : defaultLayers();
  let gridDrawn = false;

  const drawGrid = () => {
    gridDrawn = true;
    if (!showGrid) return;
    ctx.lineWidth = 1;
    for (let x = 0; x <= doc.cols; x += 1) {
      ctx.strokeStyle = x % 5 === 0 ? GRID_LINE_STRONG : GRID_LINE;
      ctx.beginPath();
      ctx.moveTo(x * cell + 0.5, 0);
      ctx.lineTo(x * cell + 0.5, height);
      ctx.stroke();
    }
    for (let y = 0; y <= doc.rows; y += 1) {
      ctx.strokeStyle = y % 5 === 0 ? GRID_LINE_STRONG : GRID_LINE;
      ctx.beginPath();
      ctx.moveTo(0, y * cell + 0.5);
      ctx.lineTo(width, y * cell + 0.5);
      ctx.stroke();
    }
  };

  for (const layer of layers) {
    if (!gridDrawn && layer.kind !== "fill") drawGrid();
    // 표시 맵에 없는 레이어(예전 호출부가 넘긴 맵)는 보이는 것으로 본다.
    if (layer.hidden === true || visible[layer.id] === false) continue;

    if (layer.kind === "fill") drawFillLayer(ctx, doc, layer, index, cell);
    else if (layer.kind === "wire") drawWireLayer(ctx, doc, layer, index, cell);
    else drawEquipmentLayer(ctx, doc, index, cell, options.memoIndex);
  }
  if (!gridDrawn) drawGrid();

  renderOverlays(ctx, doc, options, extent, band);
  ctx.restore();
}

/** 칸을 색으로 칠하는 레이어. 배경과 사용자 채움 레이어가 같은 길을 쓴다. */
function drawFillLayer(
  ctx: CanvasRenderingContext2D,
  doc: LayoutDoc,
  layer: LayerDef,
  index: PaletteIndex,
  cell: number,
) {
  for (const [key, id] of Object.entries(paintedCells(doc, layer.id))) {
    const item = resolveItem(index, id, "tile");
    const [x, y] = key.split(",").map(Number);
    fillCellPattern(ctx, x * cell, y * cell, cell, item.color as string, item.pattern);
    if (item.glyph && cell >= 14) {
      drawCenteredText(
        ctx,
        item.glyph,
        x * cell + cell / 2,
        y * cell + cell / 2,
        cell - 4,
        cell * 0.42,
        textColorOn(item.color),
      );
    }
  }
}

/**
 * 이웃한 칸끼리 선을 잇는 레이어. 배선과 사용자 선 레이어가 같은 길을 쓴다.
 *
 * 항목별로 모아 한 번에 그린다 — 반투명일 때 칸마다 따로 칠하면 겹친 자리가
 * 두 번 칠해져 이음매가 진해진다.
 */
function drawWireLayer(
  ctx: CanvasRenderingContext2D,
  doc: LayoutDoc,
  layer: LayerDef,
  index: PaletteIndex,
  cell: number,
) {
  const cells = paintedCells(doc, layer.id);

  const byItem = new Map<WireId, string[]>();
  for (const [key, id] of Object.entries(cells)) {
    const keys = byItem.get(id);
    if (keys) keys.push(key);
    else byItem.set(id, [key]);
  }

  for (const [id, keys] of byItem) {
    drawWireItem(ctx, cells, keys, resolveItem(index, id, "wire"), cell);
  }
}

function drawEquipmentLayer(
  ctx: CanvasRenderingContext2D,
  doc: LayoutDoc,
  index: PaletteIndex,
  cell: number,
  memoIndex?: Record<string, number>,
) {
  for (const [key, data] of Object.entries(doc.equipment)) {
    const [x, y] = key.split(",").map(Number);
    const px = x * cell;
    const py = y * cell;
    const status = data.status ? resolveItem(index, data.status, "status") : null;

    if (status) {
      fillCellPattern(ctx, px, py, cell, status.color as string, status.pattern);
    }

    // 글자는 아래 깔린 채움색 위에서 읽히는 색으로 찍는다.
    const textColor = status ? textColorOn(status.color) : LABEL_COLOR;

    if (data.kind) {
      const kind = resolveItem(index, data.kind, "kind");

      // 장비 색은 테두리로 보인다. 상태 채움색을 가리지 않는다.
      if (kind.color) {
        ctx.strokeStyle = kind.color;
        ctx.lineWidth = 2;
        ctx.setLineDash(dashArray(kind.lineStyle, 2));
        ctx.strokeRect(px + 1, py + 1, cell - 2, cell - 2);
        ctx.setLineDash([]);
      }

      if (cell >= 12) {
        const cy = data.label ? py + cell * 0.68 : py + cell / 2;
        // 장비는 디스플레이 이름이 곧 칸에 찍히는 글자다.
        // 장비 ID 가 함께 있으면 칸을 반으로 나눠 쓰므로 두 줄로 늘릴 자리가 없다.
        const room = data.label ? cell * 0.4 : cell * 0.8;
        drawCenteredText(ctx, kind.name, px + cell / 2, cy, cell - 5, cell * 0.36, textColor, room);
      }
    }

    if (data.label && cell >= 12) {
      const cy = data.kind ? py + cell * 0.28 : py + cell / 2;
      const room = data.kind ? cell * 0.4 : cell * 0.8;
      // 장비 ID 는 형광펜 배경을 깐다. 상태색과 겹치지 않는 옅은 색이라 어느 칸
      // 위에서도 "여기 적어 둔 번호" 로 읽힌다. (장비 이름은 그대로 둔다.)
      drawCenteredText(
        ctx,
        data.label,
        px + cell / 2,
        cy,
        cell - 5,
        cell * 0.34,
        LABEL_BG_TEXT,
        room,
        LABEL_BG,
      );
    }

    if (data.memo) {
      // 메모가 적힌 칸에는 번호를 찍는다. 본문은 용지 빈 곳이나 별지에 실리고,
      // 이 번호가 둘을 잇는다. 메모를 인쇄하지 않을 때도 번호는 매긴다 —
      // 종이에 본문이 없어도 화면에서 세는 순서가 달라지면 안 된다.
      const no = memoIndex?.[key];
      const dot = Math.max(3, Math.round(cell * 0.16));
      const cxDot = px + cell - dot - 1;
      const cyDot = py + dot + 1;

      if (no !== undefined && cell >= 16) {
        ctx.fillStyle = MEMO_MARK_BG;
        ctx.beginPath();
        ctx.arc(cxDot, cyDot, dot, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = MEMO_MARK_TEXT;
        ctx.font = fontFor(Math.max(6, dot * 1.3));
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(no), cxDot, cyDot + dot * 0.06);
      } else {
        // 작은 배율에서는 번호가 뭉개진다. 있다는 표시만 남긴다.
        ctx.fillStyle = MEMO_MARK_BG;
        ctx.beginPath();
        ctx.arc(px + cell - 4, py + 4, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 사진이 붙은 칸은 왼쪽 아래에 작은 네모 표시를 둔다. 메모 점(오른쪽 위)과
    // 자리를 달리해 둘이 함께 있어도 구분된다.
    // 두 장 이상이면 네모 오른쪽에 장수를 적는다 — 열어 보지 않아도 몇 장인지 안다.
    const photos = cellPhotos(data);
    if (photos.length > 0) {
      const size = Math.max(4, Math.round(cell * 0.18));
      const top = py + cell - size - 2;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(px + 2, top, size, size);
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(px + 2.5, top + 0.5, size - 1, size - 1);

      if (photos.length > 1 && cell >= 18) {
        const fontSize = Math.max(7, Math.round(cell * 0.24));
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "#111827";
        ctx.fillText(`${photos.length}`, px + size + 4, py + cell - 2);
      }
    }
  }
}

/**
 * 인쇄물에 실릴 메모 본문을 화면에 미리 그린다.
 *
 * 자리는 mm 로 재어 두었으므로(`memoPrint`) 칸 크기로 나눠 칸 좌표로 바꾼다.
 * 화면에서 한 칸이 `cellMm` 이니, `(mm - 여백) / cellMm * cell` 이 픽셀이다.
 *
 * 인쇄물의 글자 크기도 같은 자로 재어, 배율을 올리면 종이에서 보일 크기 그대로
 * 커진다 — 미리보기가 실제와 어긋나면 볼 이유가 없다.
 */
function drawMemoPreview(
  ctx: CanvasRenderingContext2D,
  memo: NonNullable<RenderOptions["printMemo"]>,
  cell: number,
) {
  const { cellMm, marginMm, lineMm, textMm } = memo;
  // mm → 화면 픽셀. 여백은 용지 기준이고 도면은 여백 안쪽에서 시작하므로 뺀다.
  const toPx = (mm: number) => ((mm - marginMm) / cellMm) * cell;
  const spanPx = (mm: number) => (mm / cellMm) * cell;

  const size = spanPx(textMm);
  // 너무 작으면 글자가 뭉개진다. 자리만 보여 준다.
  const readable = size >= 5;
  const lineH = spanPx(lineMm);

  for (const page of memo.pages) {
    const { block, entries, originCells } = page;
    const left = originCells.x * cell + toPx(block.xMm);
    const top = originCells.y * cell + toPx(block.yMm);
    const width = spanPx(block.widthMm);
    const height = spanPx(block.heightMm);

    // 메모가 놓일 자리를 옅게 칠해 둔다 — 여기가 종이에서 메모가 차지할 곳이다.
    ctx.fillStyle = MEMO_PREVIEW_BG;
    ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = MEMO_PREVIEW_BORDER;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);

    if (!readable) continue;

    ctx.save();
    // 자리를 넘는 글자는 자른다. 이웃 장으로 새어 나가면 미리보기가 거짓이 된다.
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const columnW = width / Math.max(1, block.columns);
    let column = 0;
    let used = 0;

    for (const entry of entries) {
      // 인쇄와 같은 셈으로 줄 수를 잡는다(`memoLineCount` 와 같은 어림).
      const head = `${entry.no}. ${entry.label ? `${entry.label} · ` : ""}`;
      const text = `${head}${entry.memo}`;
      const perCharMm = textMm * 0.62;
      const columnWidthMm = block.widthMm / Math.max(1, block.columns);
      const perLine = Math.max(8, Math.floor((columnWidthMm - 2) / perCharMm));
      const need =
        text.split(/\r?\n/).reduce((sum, p) => sum + Math.max(1, Math.ceil(p.length / perLine)), 0) + 1;

      if (used + need > block.linesPerColumn && column + 1 < block.columns) {
        column += 1;
        used = 0;
      }

      const x = left + column * columnW;
      let y = top + used * lineH;

      ctx.font = boldFontFor(size);
      ctx.fillStyle = MEMO_MARK_BG;
      ctx.fillText(`${entry.no}.`, x + 1, y);
      const headW = ctx.measureText(`${entry.no}. `).width;

      ctx.font = fontFor(size);
      ctx.fillStyle = MEMO_PREVIEW_TEXT;

      const room = columnW - headW - 2;
      const body = `${entry.label ? `${entry.label} · ` : ""}${entry.memo}`;
      for (const paragraph of body.split(/\r?\n/)) {
        for (const line of wrapToWidth(ctx, paragraph, room)) {
          ctx.fillText(line, x + 1 + headW, y);
          y += lineH;
        }
      }

      used += need;
      if (used >= block.linesPerColumn && column + 1 >= block.columns) break;
    }

    ctx.restore();
  }
}

/** 글자 폭을 재서 주어진 폭에 맞게 접는다. 단어 경계가 없는 한글도 글자 단위로 끊는다. */
function wrapToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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

/** 범례 띠 · 인쇄 경계선 · 미리보기 · 선택 표시 — 레이어 위에 얹는 것들. */
function renderOverlays(
  ctx: CanvasRenderingContext2D,
  doc: LayoutDoc,
  options: RenderOptions,
  extent: { cols: number; rows: number },
  band: number,
) {
  const { cell } = options;

  // 인쇄물에 실릴 메모 본문을 미리 그려 둔다. 자리는 mm 로 재어 두었으므로
  // 칸 크기(cellMm)로 나눠 화면 픽셀로 바꾼다.
  if (options.printMemo && options.printMemo.pages.length > 0) {
    drawMemoPreview(ctx, options.printMemo, cell);
  }

  // 인쇄물에 함께 실릴 범례를 도면 아래에 미리 그려 둔다.
  if (options.printLegend && options.printLegend.items.length > 0 && band > 0) {
    const { items, columns } = options.printLegend;
    const bandTop = doc.rows * cell;
    const bandHeight = band * cell;
    const colWidth = (extent.cols * cell) / Math.max(1, columns);
    const rowHeight = bandHeight / Math.max(1, Math.ceil(items.length / Math.max(1, columns)));
    const box = Math.max(6, Math.min(rowHeight * 0.62, cell * 0.8));

    ctx.save();
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, bandTop, extent.cols * cell, bandHeight);

    items.forEach((item, i) => {
      const x = (i % columns) * colWidth + 4;
      const y = bandTop + Math.floor(i / columns) * rowHeight + (rowHeight - box) / 2;

      drawLegendSwatch(ctx, item, x, y, box);

      ctx.fillStyle = LABEL_COLOR;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      fitText(ctx, item.name, colWidth - box - 12, Math.max(8, box * 0.8));
      ctx.fillText(item.name, x + box + 5, y + box / 2);
    });

    ctx.restore();
  }

  // 인쇄 경계선 — 큰 도면이 어디서 잘려 다음 장으로 넘어가는지 보여 준다.
  // 마지막 장의 바깥 테두리까지 그린다. 격자가 한 장보다 작아도 용지 크기가 보인다.
  if (options.printGuide) {
    const per = options.printGuide;
    const spanW = extent.cols * cell;
    const spanH = extent.rows * cell;

    ctx.save();
    ctx.strokeStyle = PRINT_GUIDE;
    ctx.lineWidth = 2;
    ctx.setLineDash([9, 6]);

    for (let x = per.cols; x <= extent.cols; x += per.cols) {
      ctx.beginPath();
      ctx.moveTo(x * cell - 1, 0);
      ctx.lineTo(x * cell - 1, spanH);
      ctx.stroke();
    }
    for (let y = per.rows; y <= extent.rows; y += per.rows) {
      ctx.beginPath();
      ctx.moveTo(0, y * cell - 1);
      ctx.lineTo(spanW, y * cell - 1);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  if (options.preview && options.preview.points.length > 0) {
    const item = options.preview.item;
    ctx.globalAlpha = 0.55;
    for (const p of options.preview.points) {
      fillCellPattern(ctx, p.x * cell + 1, p.y * cell + 1, cell - 2, item?.color ?? "#111827", item?.pattern);
    }
    ctx.globalAlpha = 1;
  }

  if (options.hover && options.hover.x < doc.cols && options.hover.y < doc.rows) {
    ctx.strokeStyle = "#1f6fb2";
    ctx.lineWidth = 1;
    ctx.strokeRect(options.hover.x * cell + 0.5, options.hover.y * cell + 0.5, cell - 1, cell - 1);
  }

  if (options.selectionRange) {
    const sr = options.selectionRange;
    const rx = sr.minX * cell;
    const ry = sr.minY * cell;
    const rw = sr.width * cell;
    const rh = sr.height * cell;

    ctx.fillStyle = "rgba(2, 132, 199, 0.14)";
    ctx.fillRect(rx + 1, ry + 1, rw - 2, rh - 2);

    ctx.strokeStyle = "#0284c7";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
    ctx.setLineDash([]);

    if (sr.width > 1 || sr.height > 1) {
      const badgeText = `${sr.width} × ${sr.height}`;
      const basePx = Math.max(9, Math.round(cell * 0.38));
      fitText(ctx, badgeText, rw, basePx);
      const textWidth = ctx.measureText(badgeText).width;
      const padding = 5;
      const bw = textWidth + padding * 2;
      const bh = basePx + 6;

      const bx = rx + 3;
      let by = ry - bh - 3;
      if (by < 2) by = ry + 3;

      ctx.fillStyle = "#0284c7";
      ctx.beginPath();
      ctx.fillRect(bx, by, bw, bh);

      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(badgeText, bx + padding, by + bh / 2 + 1);
    }
  } else if (options.selected) {
    const [x, y] = options.selected.split(",").map(Number);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
    ctx.setLineDash([]);
  }
}

const SHEET_PADDING = 24;
const SHEET_TITLE_HEIGHT = 44;
const LEGEND_BOX = 16;
const LEGEND_ROW_HEIGHT = 24;
const LEGEND_COL_MIN = 170;
/** 설명까지 들어가면 한 줄이 길어지므로 열을 넓게 잡는다. */
const LEGEND_COL_MIN_WITH_DESC = 300;
const LEGEND_DESC_COLOR = "#5b6672";
const LEGEND_TOP_GAP = 18;

/** 범례 칸 배치 — 항목 수가 사용자마다 다르므로 폭에 맞춰 줄 수를 계산한다. */
function legendLayout(doc: LayoutDoc, cell: number, legend: PaletteItem[]) {
  const gridWidth = docPixelSize(doc, cell).width;
  const count = legend.length;
  const colMin = legend.some((item) => item.description) ? LEGEND_COL_MIN_WITH_DESC : LEGEND_COL_MIN;
  const cols = Math.max(1, Math.floor(gridWidth / colMin));
  const rows = Math.max(1, Math.ceil(count / cols));

  return {
    cols,
    rows,
    colWidth: gridWidth / cols,
    height: LEGEND_TOP_GAP + rows * LEGEND_ROW_HEIGHT,
  };
}

/**
 * 인쇄·공유용 이미지: 제목 + 배치도 + 범례를 한 장에 그린다.
 *
 * `legend` 를 넘기지 않으면 이 문서(=활성 페이지) 기준으로 고른다. 프로젝트 전체
 * 기준 범례를 쓰려면 호출하는 쪽에서 넘긴다. 이때 `sheetPixelSize` 에도 같은
 * 목록을 넘겨야 높이가 맞는다.
 */
export function renderSheet(
  ctx: CanvasRenderingContext2D,
  doc: LayoutDoc,
  cell: number,
  visible: Record<LayerId, boolean>,
  legendList?: PaletteItem[],
  meta?: SheetMeta,
  memoIndex?: Record<string, number>,
) {
  const items = legendList ?? legendItems(doc);
  const grid = docPixelSize(doc, cell);
  const size = sheetPixelSize(doc, cell, items);
  const legend = legendLayout(doc, cell, items);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size.width, size.height);

  ctx.fillStyle = LABEL_COLOR;
  ctx.font = fontFor(22);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(doc.title || "격자형 배치도", SHEET_PADDING, SHEET_PADDING);

  ctx.save();
  ctx.translate(SHEET_PADDING, SHEET_PADDING + SHEET_TITLE_HEIGHT);
  renderDoc(ctx, doc, { cell, visible, showGrid: true, memoIndex });
  ctx.strokeStyle = GRID_LINE_STRONG;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, grid.width, grid.height);
  ctx.restore();

  const top = SHEET_PADDING + SHEET_TITLE_HEIGHT + grid.height + LEGEND_TOP_GAP;

  items.forEach((item, i) => {
    const x = SHEET_PADDING + (i % legend.cols) * legend.colWidth;
    const y = top + Math.floor(i / legend.cols) * LEGEND_ROW_HEIGHT;

    drawLegendSwatch(ctx, item, x, y, LEGEND_BOX);

    const textX = x + LEGEND_BOX + 6;
    const textY = y + LEGEND_BOX / 2;
    const room = legend.colWidth - LEGEND_BOX - 14;

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // 디스플레이 이름을 먼저 찍고, 설명이 있으면 옅은 색으로 이어 붙인다.
    const label = legendLabel(item);
    const nameSize = fitText(ctx, label, room, 13);
    const nameWidth = ctx.measureText(label).width;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(label, textX, textY);

    if (item.description) {
      const descText = ` — ${item.description}`;
      const descRoom = room - nameWidth;
      if (descRoom > 24) {
        fitText(ctx, descText, descRoom, Math.max(9, nameSize - 2));
        ctx.fillStyle = LEGEND_DESC_COLOR;
        ctx.fillText(descText, textX + nameWidth, textY);
      }
    }
  });

  // 출처 한 줄 — 어느 판을 언제 누가 뽑았는지. 아래 여백에 옅게 적는다.
  const footer = watermarkText({
    title: meta?.title ?? doc.title ?? "격자형 배치도",
    revision: meta?.revision ?? null,
    printedAt: meta?.printedAt ?? null,
    author: meta?.author ?? null,
  });
  if (footer) {
    ctx.font = fontFor(11);
    ctx.fillStyle = LEGEND_DESC_COLOR;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(footer, SHEET_PADDING, size.height - SHEET_PADDING * 0.4);
  }
}

export function sheetPixelSize(
  doc: LayoutDoc,
  cell: number,
  legendList?: PaletteItem[],
): { width: number; height: number } {
  const grid = docPixelSize(doc, cell);
  const items = legendList ?? legendItems(doc);
  return {
    width: grid.width + SHEET_PADDING * 2,
    height: grid.height + SHEET_TITLE_HEIGHT + legendLayout(doc, cell, items).height + SHEET_PADDING * 2,
  };
}
