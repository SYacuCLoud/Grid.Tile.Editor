/**
 * 채움 무늬와 선 모양.
 *
 * 색만으로는 구분이 어려운 자리가 있다 — 흑백 인쇄, 색각 이상, 비슷한 색이 여럿일 때.
 * 무늬는 색과 별개의 두 번째 표식이라 그런 자리에서도 항목이 구분된다.
 *
 * 값이 없으면(`undefined`) 예전 문서와 똑같이 솔리드·실선으로 그린다.
 */

import type { CSSProperties } from "react";

export type FillPattern = "solid" | "hatch" | "hatchReverse" | "crosshatch" | "dots";
export type LineStyle = "solid" | "dotted" | "dashed";

export interface PatternMeta {
  id: FillPattern;
  name: string;
}

export interface LineStyleMeta {
  id: LineStyle;
  name: string;
}

export const FILL_PATTERNS: PatternMeta[] = [
  { id: "solid", name: "솔리드" },
  { id: "hatch", name: "빗금" },
  { id: "hatchReverse", name: "역빗금" },
  { id: "crosshatch", name: "교차빗금" },
  { id: "dots", name: "점" },
];

export const LINE_STYLES: LineStyleMeta[] = [
  { id: "solid", name: "실선" },
  { id: "dotted", name: "점선" },
  { id: "dashed", name: "파선" },
];

export const DEFAULT_PATTERN: FillPattern = "solid";
export const DEFAULT_LINE_STYLE: LineStyle = "solid";

const PATTERN_IDS = new Set<string>(FILL_PATTERNS.map((item) => item.id));
const LINE_STYLE_IDS = new Set<string>(LINE_STYLES.map((item) => item.id));

/** 저장된 값이 아는 무늬일 때만 받는다. 모르는 값은 솔리드로 본다. */
export function sanitizePattern(raw: unknown): FillPattern | null {
  return typeof raw === "string" && PATTERN_IDS.has(raw) ? (raw as FillPattern) : null;
}

export function sanitizeLineStyle(raw: unknown): LineStyle | null {
  return typeof raw === "string" && LINE_STYLE_IDS.has(raw) ? (raw as LineStyle) : null;
}

export function patternName(pattern: FillPattern | undefined): string {
  return FILL_PATTERNS.find((item) => item.id === (pattern ?? DEFAULT_PATTERN))?.name ?? "솔리드";
}

export function lineStyleName(style: LineStyle | undefined): string {
  return LINE_STYLES.find((item) => item.id === (style ?? DEFAULT_LINE_STYLE))?.name ?? "실선";
}

/**
 * 점선·파선의 dash 배열. 선 굵기에 맞춰 늘려 두꺼운 선에서도 간격이 보인다.
 * 실선은 빈 배열이라 `setLineDash([])` 로 그대로 넘길 수 있다.
 */
export function dashArray(style: LineStyle | undefined, lineWidth: number): number[] {
  const unit = Math.max(1, lineWidth);
  if (style === "dotted") return [unit, unit * 1.8];
  if (style === "dashed") return [unit * 3.2, unit * 2.2];
  return [];
}

/** 무늬 아래에 까는 옅은 바탕. 색이 무엇인지는 여기서 읽힌다. */
const TINT_ALPHA = 0.22;

/** 무늬 줄 간격 — 칸이 작아도 최소 4px 은 벌린다. */
function stripeGap(size: number): number {
  return Math.max(4, size / 3.2);
}

function strokeLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** `/` 방향 빗금. 칸 밖으로 나간 부분은 호출한 쪽에서 clip 으로 자른다. */
function drawDiagonals(ctx: CanvasRenderingContext2D, px: number, py: number, size: number, reverse: boolean) {
  const gap = stripeGap(size);
  for (let offset = -size; offset <= size * 2; offset += gap) {
    if (reverse) strokeLine(ctx, px + offset, py, px + offset - size, py + size);
    else strokeLine(ctx, px + offset, py, px + offset + size, py + size);
  }
}

function drawDots(ctx: CanvasRenderingContext2D, px: number, py: number, size: number, color: string) {
  const gap = stripeGap(size);
  const dot = Math.max(1.5, size * 0.13);
  ctx.fillStyle = color;
  for (let y = gap / 2; y < size; y += gap) {
    for (let x = gap / 2; x < size; x += gap) {
      ctx.fillRect(px + x - dot / 2, py + y - dot / 2, dot, dot);
    }
  }
}

/**
 * 한 칸(또는 견본 상자)을 무늬로 채운다.
 *
 * 솔리드는 예전과 똑같이 `fillRect` 한 번이다. 무늬는 옅은 바탕 위에 진한 줄을
 * 얹어, 무늬가 있어도 색을 알아볼 수 있게 한다.
 */
export function fillCellPattern(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  color: string,
  pattern: FillPattern | undefined,
) {
  const kind = pattern ?? DEFAULT_PATTERN;

  if (kind === "solid") {
    ctx.fillStyle = color;
    ctx.fillRect(px, py, size, size);
    return;
  }

  ctx.save();

  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = previousAlpha * TINT_ALPHA;
  ctx.fillStyle = color;
  ctx.fillRect(px, py, size, size);
  ctx.globalAlpha = previousAlpha;

  // 무늬는 칸 안에서만 보여야 한다. 이웃 칸을 침범하면 격자가 뭉개진다.
  ctx.beginPath();
  ctx.rect(px, py, size, size);
  ctx.clip();

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.11);
  ctx.setLineDash([]);

  if (kind === "hatch") drawDiagonals(ctx, px, py, size, false);
  else if (kind === "hatchReverse") drawDiagonals(ctx, px, py, size, true);
  else if (kind === "crosshatch") {
    drawDiagonals(ctx, px, py, size, false);
    drawDiagonals(ctx, px, py, size, true);
  } else if (kind === "dots") drawDots(ctx, px, py, size, color);

  ctx.restore();
}

/**
 * 브라우저 견본(HTML)용 CSS. Canvas 와 같은 무늬를 CSS 배경으로 흉내 낸다.
 * 팔레트 목록과 도면이 다르게 보이면 같은 색이 무엇을 뜻하는지 읽을 수 없다.
 */
export function patternCss(color: string, pattern: FillPattern | undefined): CSSProperties {
  const kind = pattern ?? DEFAULT_PATTERN;
  if (kind === "solid") return { background: color };

  const tint = `${color}38`; // 22% 정도의 옅은 바탕
  const stripe = `${color} 0 2px, transparent 2px 6px`;

  if (kind === "dots") {
    return {
      backgroundColor: tint,
      backgroundImage: `radial-gradient(${color} 1.2px, transparent 1.3px)`,
      backgroundSize: "6px 6px",
    };
  }

  const forward = `repeating-linear-gradient(45deg, ${stripe})`;
  const reverse = `repeating-linear-gradient(-45deg, ${stripe})`;

  return {
    backgroundColor: tint,
    backgroundImage: kind === "crosshatch" ? `${forward}, ${reverse}` : kind === "hatch" ? forward : reverse,
  };
}

/** 견본 테두리에 쓸 CSS 선 모양. */
export function borderStyleCss(style: LineStyle | undefined): "solid" | "dotted" | "dashed" {
  return style ?? DEFAULT_LINE_STYLE;
}
