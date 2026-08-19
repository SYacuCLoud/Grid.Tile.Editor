import { cellKey, type LayoutDoc, type Point } from "./doc";
import {
  indexPalette,
  type LayerId,
  type PaletteIndex,
  type PaletteItem,
  resolveItem,
  textColorOn,
  type WireId,
} from "./palette";
import { legendItems, legendLabel } from "./paletteOps";
import { type CellRange } from "./range";

export interface RenderOptions {
  cell: number;
  visible: Record<LayerId, boolean>;
  showGrid: boolean;
  /** 드래그 중 미리보기. */
  preview?: { item: PaletteItem | null; layer: LayerId; points: Point[] } | null;
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
  printLegend?: { items: PaletteItem[]; bandCells: number; columns: number } | null;
}

const GRID_LINE = "#d3d9df";
const GRID_LINE_STRONG = "#b6bfc8";
const PAPER = "#ffffff";
const LABEL_COLOR = "#101418";
const PRINT_GUIDE = "#c026d3";
/** 용지 범위 안이지만 격자 밖인 자리. 그릴 수 없는 영역임을 알린다. */
const OUTSIDE_GRID = "#e9edf1";

function fontFor(px: number): string {
  return `${px}px "Segoe UI", "Malgun Gothic", system-ui, sans-serif`;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, basePx: number): number {
  let size = Math.max(7, Math.round(basePx));
  while (size > 7) {
    ctx.font = fontFor(size);
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  ctx.font = fontFor(size);
  return size;
}

function drawCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  basePx: number,
  color: string,
) {
  fitText(ctx, text, maxWidth, basePx);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy);
}

function drawWire(
  ctx: CanvasRenderingContext2D,
  wiring: Record<string, WireId>,
  index: PaletteIndex,
  x: number,
  y: number,
  id: WireId,
  cell: number,
) {
  const color = resolveItem(index, id, "wire").color as string;
  const band = Math.max(3, Math.round(cell * 0.34));
  const cx = x * cell + cell / 2;
  const cy = y * cell + cell / 2;

  ctx.fillStyle = color;
  ctx.fillRect(cx - band / 2, cy - band / 2, band, band);

  if (wiring[cellKey(x + 1, y)] === id) {
    ctx.fillRect(cx, cy - band / 2, cell / 2, band);
  }
  if (wiring[cellKey(x - 1, y)] === id) {
    ctx.fillRect(cx - cell / 2, cy - band / 2, cell / 2, band);
  }
  if (wiring[cellKey(x, y + 1)] === id) {
    ctx.fillRect(cx - band / 2, cy, band, cell / 2);
  }
  if (wiring[cellKey(x, y - 1)] === id) {
    ctx.fillRect(cx - band / 2, cy - cell / 2, band, cell / 2);
  }
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

  if (visible.background) {
    for (const [key, tile] of Object.entries(doc.background)) {
      const item = resolveItem(index, tile, "tile");
      const [x, y] = key.split(",").map(Number);
      ctx.fillStyle = item.color as string;
      ctx.fillRect(x * cell, y * cell, cell, cell);
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

  if (showGrid) {
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
  }

  if (visible.equipment) {
    for (const [key, data] of Object.entries(doc.equipment)) {
      const [x, y] = key.split(",").map(Number);
      const px = x * cell;
      const py = y * cell;
      const status = data.status ? resolveItem(index, data.status, "status") : null;

      if (status) {
        ctx.fillStyle = status.color as string;
        ctx.fillRect(px, py, cell, cell);
      }

      // 글자는 아래 깔린 채움색 위에서 읽히는 색으로 찍는다.
      const textColor = status ? textColorOn(status.color) : LABEL_COLOR;

      if (data.kind) {
        const kind = resolveItem(index, data.kind, "kind");

        // 장비 색은 테두리로 보인다. 상태 채움색을 가리지 않는다.
        if (kind.color) {
          ctx.strokeStyle = kind.color;
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 1, py + 1, cell - 2, cell - 2);
        }

        if (cell >= 12) {
          const cy = data.label ? py + cell * 0.68 : py + cell / 2;
          // 장비는 디스플레이 이름이 곧 칸에 찍히는 글자다.
          drawCenteredText(ctx, kind.name, px + cell / 2, cy, cell - 5, cell * 0.36, textColor);
        }
      }

      if (data.label && cell >= 12) {
        const cy = data.kind ? py + cell * 0.28 : py + cell / 2;
        drawCenteredText(ctx, data.label, px + cell / 2, cy, cell - 5, cell * 0.34, textColor);
      }

      if (data.memo) {
        ctx.fillStyle = "#111827";
        ctx.beginPath();
        ctx.arc(px + cell - 4, py + 4, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (visible.wiring) {
    for (const [key, id] of Object.entries(doc.wiring)) {
      const [x, y] = key.split(",").map(Number);
      drawWire(ctx, doc.wiring, index, x, y, id, cell);
    }
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

      if (item.role === "kind") {
        ctx.fillStyle = PAPER;
        ctx.fillRect(x, y, box, box);
        ctx.strokeStyle = item.color as string;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, box - 2, box - 2);
      } else {
        ctx.fillStyle = item.color as string;
        ctx.fillRect(x, y, box, box);
        ctx.strokeStyle = GRID_LINE_STRONG;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, box, box);
      }

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
    ctx.fillStyle = item?.color ?? "#111827";
    for (const p of options.preview.points) {
      ctx.fillRect(p.x * cell + 1, p.y * cell + 1, cell - 2, cell - 2);
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

  ctx.restore();
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
  renderDoc(ctx, doc, { cell, visible, showGrid: true });
  ctx.strokeStyle = GRID_LINE_STRONG;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, grid.width, grid.height);
  ctx.restore();

  const top = SHEET_PADDING + SHEET_TITLE_HEIGHT + grid.height + LEGEND_TOP_GAP;

  items.forEach((item, i) => {
    const x = SHEET_PADDING + (i % legend.cols) * legend.colWidth;
    const y = top + Math.floor(i / legend.cols) * LEGEND_ROW_HEIGHT;

    // 견본은 도면에서 쓰이는 방식을 그대로 보여 준다.
    // 장비 색은 칸 테두리로 그려지므로 범례도 테두리로 그린다. 채우면 상태색과 구분되지 않는다.
    if (item.role === "kind") {
      ctx.fillStyle = PAPER;
      ctx.fillRect(x, y, LEGEND_BOX, LEGEND_BOX);
      ctx.strokeStyle = item.color as string;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, LEGEND_BOX - 2, LEGEND_BOX - 2);
    } else {
      ctx.fillStyle = item.color as string;
      ctx.fillRect(x, y, LEGEND_BOX, LEGEND_BOX);
      ctx.strokeStyle = GRID_LINE_STRONG;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, LEGEND_BOX, LEGEND_BOX);
    }

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
