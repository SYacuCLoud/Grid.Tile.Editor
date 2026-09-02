/**
 * 모바일 도면 보기 — 화면 계산과 칸 요약.
 *
 * 편집기와 달리 여기서는 **보기만** 한다. 손가락으로 끌어 옮기고 두 손가락으로
 * 키우는 계산, 누른 칸에 무엇이 있는지 모으는 일을 순수 함수로 둔다 —
 * 캔버스 컴포넌트는 손가락 이벤트만 받아 이 함수들로 넘긴다.
 */

import { cellKey, cellPhotos, type PageDoc, type Point, type ProjectDoc } from "../editor/doc";
import { type Device, deviceById } from "../editor/device";
import { layerById } from "../editor/layers";
import type { PaletteItem } from "../editor/palette";
import { zonesAt } from "../editor/zone";

/** 이 아래로는 칸이 점이 되어 아무것도 읽을 수 없다. */
export const MIN_VIEW_CELL = 3;
/** 이 위로는 칸 하나가 손바닥만 해져 도면이 아니다. */
export const MAX_VIEW_CELL = 64;
/**
 * 캔버스 한 변의 상한(px). 휴대폰 브라우저는 이보다 큰 캔버스를 그리지 못하거나
 * 빈 화면을 남긴다. 200칸 도면을 64px 로 키우면 12800px 라 여기서 막는다.
 */
export const MAX_CANVAS_PX = 4096;

export interface Offset {
  x: number;
  y: number;
}

/** 이 도면에서 허용되는 최대 칸 크기. 캔버스 상한을 넘지 않는 선이다. */
export function maxCellFor(cols: number, rows: number): number {
  const byCanvas = Math.floor(MAX_CANVAS_PX / Math.max(1, cols, rows));
  return Math.max(MIN_VIEW_CELL, Math.min(MAX_VIEW_CELL, byCanvas));
}

export function clampCell(cell: number, cols: number, rows: number): number {
  if (!Number.isFinite(cell)) return MIN_VIEW_CELL;
  return Math.min(maxCellFor(cols, rows), Math.max(MIN_VIEW_CELL, cell));
}

/**
 * 도면 전체가 화면에 들어가는 칸 크기.
 *
 * 0.5px 단위로 내림한다 — 소수점 아래가 길면 격자선이 칸마다 다르게 번진다.
 */
export function fitCell(cols: number, rows: number, viewW: number, viewH: number, pad = 16): number {
  const w = Math.max(1, viewW - pad);
  const h = Math.max(1, viewH - pad);
  const raw = Math.min(w / Math.max(1, cols), h / Math.max(1, rows));
  return clampCell(Math.floor(raw * 2) / 2, cols, rows);
}

/**
 * 캔버스가 화면 밖으로 달아나지 않게 잡는다.
 *
 * 화면보다 작은 축은 가운데에 두고(그 축으로는 끌어도 움직이지 않는다), 큰 축은
 * 빈 여백이 보이지 않는 범위 안에서만 움직인다.
 */
export function clampOffset(offset: Offset, canvasW: number, canvasH: number, viewW: number, viewH: number): Offset {
  const x = canvasW <= viewW ? (viewW - canvasW) / 2 : Math.min(0, Math.max(viewW - canvasW, offset.x));
  const y = canvasH <= viewH ? (viewH - canvasH) / 2 : Math.min(0, Math.max(viewH - canvasH, offset.y));
  return { x, y };
}

/** 화면의 한 점(손가락 사이 가운데)을 고정한 채 칸 크기를 바꿀 때의 새 오프셋. */
export function zoomAbout(offset: Offset, oldCell: number, newCell: number, anchor: Offset): Offset {
  const ratio = newCell / Math.max(1e-6, oldCell);
  return {
    x: anchor.x - (anchor.x - offset.x) * ratio,
    y: anchor.y - (anchor.y - offset.y) * ratio,
  };
}

/** 이 칸이 화면 가운데에 오는 오프셋. 메모 목록에서 칸으로 건너갈 때 쓴다. */
export function centerOn(point: Point, cell: number, viewW: number, viewH: number): Offset {
  return {
    x: viewW / 2 - (point.x + 0.5) * cell,
    y: viewH / 2 - (point.y + 0.5) * cell,
  };
}

/** 화면 좌표 → 칸 좌표. 도면 밖이면 null. */
export function cellAt(screen: Offset, offset: Offset, cell: number, cols: number, rows: number): Point | null {
  const x = Math.floor((screen.x - offset.x) / cell);
  const y = Math.floor((screen.y - offset.y) / cell);
  if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
  return { x, y };
}

/** 누른 칸에 있는 것. 도면을 처음 보는 사람이 "이 칸이 뭐지" 에 답할 만큼만. */
export interface CellSummary {
  key: string;
  x: number;
  y: number;
  /** 칸에 찍힌 장비 ID. */
  label?: string;
  memo?: string;
  photos: string[];
  /** 이 칸을 품은 구역 이름들. 겹치면 여럿이다. */
  zones: string[];
  /** 칸에 칠해진 팔레트 항목. 레이어 이름과 함께. */
  items: Array<{ layer: string; item: PaletteItem }>;
  /** 대장에 등록된 장치. 칸이 `deviceId` 로 참조한다. */
  device?: Device;
}

export function cellSummary(project: ProjectDoc, page: PageDoc, x: number, y: number): CellSummary {
  const key = cellKey(x, y);
  const find = (id: string | undefined) => (id ? project.palette.find((item) => item.id === id) : undefined);
  const layerName = (id: string) => layerById(project.layers, id)?.name ?? id;

  const items: CellSummary["items"] = [];
  const push = (item: PaletteItem | undefined) => {
    if (item) items.push({ layer: layerName(item.layer), item });
  };

  push(find(page.background[key]));
  const cell = page.equipment[key];
  push(find(cell?.status));
  push(find(cell?.kind));
  push(find(page.wiring[key]));
  for (const cells of Object.values(page.layerCells ?? {})) push(find(cells[key]));

  const device = deviceById(project.devices, cell?.deviceId);

  return {
    key,
    x,
    y,
    ...(cell?.label ? { label: cell.label } : {}),
    ...(cell?.memo ? { memo: cell.memo } : {}),
    photos: cellPhotos(cell),
    zones: zonesAt(page.zones, x, y).map((zone) => zone.name),
    items,
    ...(device ? { device } : {}),
  };
}

/** 아무것도 없는 칸인가. 시트에 "빈 칸" 이라고만 적을지 정한다. */
export function isEmptyCell(summary: CellSummary): boolean {
  return (
    !summary.label &&
    !summary.memo &&
    summary.photos.length === 0 &&
    summary.zones.length === 0 &&
    summary.items.length === 0 &&
    !summary.device
  );
}

/** 두 손가락 사이 거리. */
export function distance(a: Offset, b: Offset): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Offset, b: Offset): Offset {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
