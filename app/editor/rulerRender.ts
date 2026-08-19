/**
 * 눈금자 그리기 계산.
 *
 * 큰 도면에서는 "가로 37 · 세로 12" 같은 좌표로 말해야 서로 같은 칸을 본다.
 * 화면에 번호가 없으면 칸을 손으로 짚어 세게 된다.
 *
 * 눈금 간격은 배율에 따라 정한다 — 칸이 좁을 때 5칸마다 숫자를 찍으면 숫자가
 * 서로 겹쳐 오히려 읽히지 않는다.
 */

/** 눈금자 두께(px). 위쪽 · 왼쪽 모두 같은 값을 쓴다. */
export const RULER_THICKNESS = 18;

export interface RulerTick {
  /** 칸 번호(0부터). */
  index: number;
  /** 눈금자 안에서의 픽셀 위치(칸 시작점). */
  offset: number;
  /** 숫자를 찍는 눈금인가. 아니면 짧은 금만 긋는다. */
  labeled: boolean;
}

/**
 * 숫자를 몇 칸마다 찍을지.
 *
 * 두 자리 숫자가 들어갈 만큼(약 18px) 벌어져야 읽힌다.
 */
export function tickStep(cell: number): number {
  for (const step of [5, 10, 20]) {
    if (cell * step >= 18) return step;
  }
  return 50;
}

export function rulerTicks(count: number, cell: number): RulerTick[] {
  const step = tickStep(cell);
  const ticks: RulerTick[] = [];

  for (let index = 0; index < count; index += 1) {
    const labeled = index % step === 0;
    // 칸이 아주 좁으면 금까지 다 그으면 검게 뭉갠다. 숫자 자리만 남긴다.
    if (!labeled && cell < 10) continue;
    ticks.push({ index, offset: index * cell, labeled });
  }

  return ticks;
}

const RULER_BG = "#eef1f4";
const RULER_LINE = "#b6bfc8";
const RULER_TEXT = "#475569";
const RULER_HIGHLIGHT = "rgba(2, 132, 199, 0.22)";
const RULER_HIGHLIGHT_TEXT = "#0c4a6e";

export interface RulerOptions {
  /** 칸 수. 가로 눈금자는 cols, 세로 눈금자는 rows. */
  count: number;
  cell: number;
  orientation: "horizontal" | "vertical";
  /** 커서가 놓인 칸. 그 칸만 밝게 칠해 지금 어디를 짚고 있는지 보여 준다. */
  highlight?: number | null;
}

/**
 * 눈금자를 그린다. 캔버스 크기는 가로 눈금자면 `count * cell × RULER_THICKNESS`,
 * 세로 눈금자면 `RULER_THICKNESS × count * cell` 이어야 한다.
 */
export function drawRuler(ctx: CanvasRenderingContext2D, options: RulerOptions) {
  const { count, cell, orientation, highlight } = options;
  const along = count * cell;
  const width = orientation === "horizontal" ? along : RULER_THICKNESS;
  const height = orientation === "horizontal" ? RULER_THICKNESS : along;

  ctx.fillStyle = RULER_BG;
  ctx.fillRect(0, 0, width, height);

  if (typeof highlight === "number" && highlight >= 0 && highlight < count) {
    ctx.fillStyle = RULER_HIGHLIGHT;
    if (orientation === "horizontal") ctx.fillRect(highlight * cell, 0, cell, height);
    else ctx.fillRect(0, highlight * cell, width, cell);
  }

  ctx.font = `10px "Segoe UI", "Malgun Gothic", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;

  for (const tick of rulerTicks(count, cell)) {
    const long = tick.labeled;
    ctx.strokeStyle = RULER_LINE;
    ctx.beginPath();

    if (orientation === "horizontal") {
      const x = Math.round(tick.offset) + 0.5;
      ctx.moveTo(x, long ? RULER_THICKNESS * 0.45 : RULER_THICKNESS * 0.7);
      ctx.lineTo(x, RULER_THICKNESS);
    } else {
      const y = Math.round(tick.offset) + 0.5;
      ctx.moveTo(long ? RULER_THICKNESS * 0.45 : RULER_THICKNESS * 0.7, y);
      ctx.lineTo(RULER_THICKNESS, y);
    }
    ctx.stroke();

    if (!long) continue;

    // 숫자는 그 칸의 가운데에 놓는다. 칸 경계에 붙이면 어느 칸인지 헷갈린다.
    ctx.fillStyle = tick.index === highlight ? RULER_HIGHLIGHT_TEXT : RULER_TEXT;
    const label = String(tick.index);
    if (orientation === "horizontal") {
      ctx.fillText(label, tick.offset + cell / 2, RULER_THICKNESS * 0.28);
    } else {
      ctx.fillText(label, RULER_THICKNESS * 0.42, tick.offset + cell / 2);
    }
  }

  // 격자와 맞닿는 쪽에 실선을 그어 눈금자와 도면을 가른다.
  ctx.strokeStyle = RULER_LINE;
  ctx.beginPath();
  if (orientation === "horizontal") {
    ctx.moveTo(0, height - 0.5);
    ctx.lineTo(width, height - 0.5);
  } else {
    ctx.moveTo(width - 0.5, 0);
    ctx.lineTo(width - 0.5, height);
  }
  ctx.stroke();
}
