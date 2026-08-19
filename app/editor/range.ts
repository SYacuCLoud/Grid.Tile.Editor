import { cellKey, type EquipmentCell, isInside, type LayoutDoc, type Point } from "./doc";
import { type TileId, type WireId } from "./palette";

export interface CellRange {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface ClipboardCell {
  relX: number;
  relY: number;
  background?: TileId;
  equipment?: EquipmentCell;
  wiring?: WireId;
}

export interface ClipboardData {
  width: number;
  height: number;
  cells: ClipboardCell[];
}

/** 두 점을 정규화하여 셀 범위(CellRange)를 만든다. 문서가 주어지면 격자 경계 내로 클램핑한다. */
export function normalizeRange(p1: Point, p2: Point, doc?: LayoutDoc): CellRange {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  if (!doc) {
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  }

  const clampedMinX = Math.max(0, Math.min(doc.cols - 1, minX));
  const clampedMaxX = Math.max(0, Math.min(doc.cols - 1, maxX));
  const clampedMinY = Math.max(0, Math.min(doc.rows - 1, minY));
  const clampedMaxY = Math.max(0, Math.min(doc.rows - 1, maxY));

  return {
    minX: clampedMinX,
    minY: clampedMinY,
    maxX: clampedMaxX,
    maxY: clampedMaxY,
    width: clampedMaxX - clampedMinX + 1,
    height: clampedMaxY - clampedMinY + 1,
  };
}

/** 점이 범위 내에 속하는지 확인한다. */
export function rangeContains(range: CellRange, p: Point): boolean {
  return p.x >= range.minX && p.x <= range.maxX && p.y >= range.minY && p.y <= range.maxY;
}

/** 선택 범위의 배경·설비·배선 레이어 및 장비 ID·메모 메타를 모두 복사하여 상대 좌표 클립보드 데이터로 추출한다. */
export function copyRange(doc: LayoutDoc, range: CellRange): ClipboardData {
  const cells: ClipboardCell[] = [];

  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      const key = cellKey(x, y);
      const bg = doc.background[key];
      const eq = doc.equipment[key];
      const wr = doc.wiring[key];

      if (bg || eq || wr) {
        cells.push({
          relX: x - range.minX,
          relY: y - range.minY,
          background: bg,
          equipment: eq ? { ...eq } : undefined,
          wiring: wr,
        });
      }
    }
  }

  return {
    width: range.width,
    height: range.height,
    cells,
  };
}

/**
 * 선택 범위를 잘라내어 클립보드 데이터와 원본 셀이 제거된 새 문서를 반환한다.
 *
 * 범위가 통째로 비어 있으면 지울 것이 없으므로 원본 문서를 그대로 돌려준다.
 * 되돌리기 이력에 빈 단계가 쌓이지 않게 하려는 것이다. 클립보드 데이터는
 * 비어 있더라도 기존과 같이 그대로 돌려준다.
 */
export function cutRange(doc: LayoutDoc, range: CellRange): { nextDoc: LayoutDoc; data: ClipboardData } {
  const data = copyRange(doc, range);

  // copyRange 는 세 레이어 중 하나라도 내용이 있는 칸만 담는다.
  // 담긴 칸이 없다면 범위 안에 지울 것이 없다.
  if (data.cells.length === 0) return { nextDoc: doc, data };

  const background = { ...doc.background };
  const equipment = { ...doc.equipment };
  const wiring = { ...doc.wiring };

  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      const key = cellKey(x, y);
      delete background[key];
      delete equipment[key];
      delete wiring[key];
    }
  }

  return {
    nextDoc: {
      ...doc,
      background,
      equipment,
      wiring,
    },
    data,
  };
}

function sameEquipment(a: EquipmentCell | undefined, b: EquipmentCell | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.status === b.status && a.kind === b.kind && a.label === b.label && a.memo === b.memo;
}

/**
 * 클립보드 데이터를 대상 원점(origin)에 붙여넣는다. 격자 밖은 안전하게 클리핑한다.
 *
 * 붙여넣기는 대상 사각형을 **블록 단위로 교체**한다. 원본에서 비어 있던 칸은
 * 대상 칸의 배경·설비·배선을 지운다. 그러지 않으면 이전 내용이 붙여넣은 블록에
 * 구멍처럼 남는다.
 *
 * 실제로 바뀐 내용이 없으면 원본 문서를 그대로 돌려준다. 되돌리기 이력에
 * 빈 단계가 쌓이지 않게 하려는 것이다.
 */
export function pasteClipboard(
  doc: LayoutDoc,
  data: ClipboardData,
  origin: Point,
): { nextDoc: LayoutDoc; pastedRange: CellRange } {
  const background = { ...doc.background };
  const equipment = { ...doc.equipment };
  const wiring = { ...doc.wiring };

  // 붙여넣기 원점이 문서 범위를 조절
  const ox = Math.max(0, Math.min(doc.cols - 1, origin.x));
  const oy = Math.max(0, Math.min(doc.rows - 1, origin.y));

  const byRel = new Map<string, ClipboardCell>(
    data.cells.map((cell) => [cellKey(cell.relX, cell.relY), cell]),
  );

  let changed = false;

  // 클립보드에 담긴 칸만이 아니라 블록 전체를 훑는다. 원본의 빈 칸도 대상을 지운다.
  for (let relY = 0; relY < data.height; relY += 1) {
    for (let relX = 0; relX < data.width; relX += 1) {
      const tx = ox + relX;
      const ty = oy + relY;

      if (!isInside(doc, { x: tx, y: ty })) continue;
      const key = cellKey(tx, ty);
      const cell = byRel.get(cellKey(relX, relY));

      if (cell?.background) {
        if (background[key] !== cell.background) changed = true;
        background[key] = cell.background;
      } else if (key in background) {
        delete background[key];
        changed = true;
      }

      if (cell?.equipment) {
        if (!sameEquipment(equipment[key], cell.equipment)) changed = true;
        equipment[key] = { ...cell.equipment };
      } else if (key in equipment) {
        delete equipment[key];
        changed = true;
      }

      if (cell?.wiring) {
        if (wiring[key] !== cell.wiring) changed = true;
        wiring[key] = cell.wiring;
      } else if (key in wiring) {
        delete wiring[key];
        changed = true;
      }
    }
  }

  const pastedRange = normalizeRange(
    { x: ox, y: oy },
    { x: ox + data.width - 1, y: oy + data.height - 1 },
    doc,
  );

  return {
    nextDoc: changed
      ? {
          ...doc,
          background,
          equipment,
          wiring,
        }
      : doc,
    pastedRange,
  };
}
