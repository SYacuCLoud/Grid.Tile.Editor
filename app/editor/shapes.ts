import { cellKey, isInside, type LayoutDoc, paintedCells, type Point } from "./doc";
import type { LayerId } from "./palette";

/** 브레젠험 직선 — 격자 셀 목록으로 반환. */
export function linePoints(a: Point, b: Point): Point[] {
  const points: Point[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;

  for (;;) {
    points.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }

  return points;
}

/** 사각형 테두리. */
export function rectOutlinePoints(a: Point, b: Point): Point[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const points: Point[] = [];

  for (let x = x0; x <= x1; x += 1) {
    points.push({ x, y: y0 });
    if (y1 !== y0) points.push({ x, y: y1 });
  }
  for (let y = y0 + 1; y <= y1 - 1; y += 1) {
    points.push({ x: x0, y });
    if (x1 !== x0) points.push({ x: x1, y });
  }

  return points;
}

export function rectFillPoints(a: Point, b: Point): Point[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const points: Point[] = [];

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) points.push({ x, y });
  }

  return points;
}

function signature(doc: LayoutDoc, layer: LayerId, p: Point): string {
  const key = cellKey(p.x, p.y);
  if (layer === "equipment") {
    const cell = doc.equipment[key];
    if (!cell) return "";
    return `${cell.status ?? ""}|${cell.kind ?? ""}`;
  }
  // 배경 · 배선 · 사용자 레이어는 모두 칸마다 팔레트 ID 하나다.
  return paintedCells(doc, layer)[key] ?? "";
}

/** 같은 내용으로 이어진 영역을 4방향으로 채운다. */
export function floodFillPoints(doc: LayoutDoc, layer: LayerId, start: Point): Point[] {
  if (!isInside(doc, start)) return [];

  const target = signature(doc, layer, start);
  const seen = new Set<string>([cellKey(start.x, start.y)]);
  const queue: Point[] = [start];
  const out: Point[] = [];

  while (queue.length > 0) {
    const p = queue.shift() as Point;
    out.push(p);

    const neighbors: Point[] = [
      { x: p.x + 1, y: p.y },
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x, y: p.y - 1 },
    ];

    for (const n of neighbors) {
      const key = cellKey(n.x, n.y);
      if (seen.has(key) || !isInside(doc, n)) continue;
      if (signature(doc, layer, n) !== target) continue;
      seen.add(key);
      queue.push(n);
    }
  }

  return out;
}
