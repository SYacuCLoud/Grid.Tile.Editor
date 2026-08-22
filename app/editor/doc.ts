import { defaultLayers, isBuiltinLayerId, type LayerDef } from "./layers";
import {
  defaultPalette,
  type KindId,
  type LayerId,
  type PaletteId,
  type PaletteItem,
  type StatusId,
  type TileId,
  type WireId,
} from "./palette";
import type { PagePaper } from "./paper";

export const DOC_VERSION = 3;
export const MIN_COLS = 10;
export const MAX_COLS = 200;
export const MIN_ROWS = 10;
export const MAX_ROWS = 200;

export interface EquipmentCell {
  status?: StatusId;
  kind?: KindId;
  /** 장비 ID. 예: C1101 */
  label?: string;
  memo?: string;
  /**
   * 칸에 걸어 둔 사진들(data URL). 현장 사진을 그 자리에 붙여 두면 도면이 대장이 된다.
   * 문서에 함께 담기므로 붙일 때 작게 줄이고 장수·용량을 제한한다(`photo.ts`).
   */
  photos?: string[];
  /**
   * 사진 한 장만 담던 이전 판 필드. 새로 쓰지 않는다 —
   * 문서를 열 때 `photos` 로 옮기고 지운다(`storage.ts`).
   * @deprecated `photos` 를 쓴다.
   */
  photo?: string;
}

/** 칸의 사진 목록. 이전 판 문서(단일 `photo`)도 여기서 한 장짜리 목록으로 보인다. */
export function cellPhotos(cell: EquipmentCell | undefined): string[] {
  if (!cell) return [];
  if (cell.photos && cell.photos.length > 0) return cell.photos;
  return cell.photo ? [cell.photo] : [];
}

/** 사용자 레이어의 칸 내용. 레이어 ID → (칸 키 → 팔레트 ID). */
export type LayerCells = Record<string, Record<string, PaletteId>>;

export interface PageDoc {
  id: string;
  name: string;
  cols: number;
  rows: number;
  background: Record<string, TileId>;
  equipment: Record<string, EquipmentCell>;
  wiring: Record<string, WireId>;
  /**
   * 사용자가 만든 레이어의 칸. 기본 3종은 위의 제자리에 그대로 담긴다 —
   * 그래서 이 필드가 없는 이전 문서도 한 글자 고치지 않고 열린다.
   */
  layerCells?: LayerCells;
  /**
   * 인쇄 용지 설정. 없으면 인쇄 경계선을 그리지 않는다.
   * 격자 칸 수와 PNG 내보내기에는 영향을 주지 않는다.
   */
  paper?: PagePaper;
}

export interface ProjectDoc {
  version: number;
  title: string;
  activePageId: string;
  pages: PageDoc[];
  /** 레이어 구성과 그리는 순서. 앞이 아래, 뒤가 위. */
  layers: LayerDef[];
  /** 사용자가 관리하는 상태 · 장비 · 배선 팔레트. 프로젝트 전체에서 공유된다. */
  palette: PaletteItem[];
}

/** 단일 페이지 호환성 및 기존 렌더러용 뷰 타입 */
export interface LayoutDoc {
  version: number;
  title: string;
  cols: number;
  rows: number;
  background: Record<string, TileId>;
  equipment: Record<string, EquipmentCell>;
  wiring: Record<string, WireId>;
  layerCells?: LayerCells;
  layers: LayerDef[];
  palette: PaletteItem[];
}

/** 칸을 담고 있는 것 — `PageDoc` 과 `LayoutDoc` 이 모두 만족한다. */
export interface CellHolder {
  background: Record<string, TileId>;
  equipment: Record<string, EquipmentCell>;
  wiring: Record<string, WireId>;
  layerCells?: LayerCells;
}

/**
 * 한 레이어의 칸 맵을 읽는다.
 *
 * 기본 3종은 문서에 제자리가 있고 사용자 레이어는 `layerCells` 안에 있다. 이
 * 함수와 `withLayerCells` 만 그 갈림길을 안다 — 위쪽 코드는 레이어 ID 하나만
 * 들고 다니면 된다. (설비는 값 모양이 다르므로 여기서는 다루지 않는다.)
 */
export function paintedCells(holder: CellHolder, layerId: string): Record<string, PaletteId> {
  if (layerId === "background") return holder.background;
  if (layerId === "wiring") return holder.wiring;
  if (layerId === "equipment") return {};
  return holder.layerCells?.[layerId] ?? {};
}

/** 한 레이어의 칸 맵을 갈아 끼운 사본. 빈 맵이면 자리를 아예 비운다. */
export function withLayerCells<T extends CellHolder>(
  holder: T,
  layerId: string,
  cells: Record<string, PaletteId>,
): T {
  if (layerId === "background") return { ...holder, background: cells };
  if (layerId === "wiring") return { ...holder, wiring: cells };
  if (layerId === "equipment") return holder;

  const layerCells: LayerCells = { ...holder.layerCells };
  if (Object.keys(cells).length > 0) layerCells[layerId] = cells;
  else delete layerCells[layerId];

  const next = { ...holder };
  if (Object.keys(layerCells).length > 0) next.layerCells = layerCells;
  else delete next.layerCells;
  return next;
}

/** 이 문서에 칸이 담긴 사용자 레이어 ID 들. 비교·복사가 훑을 자리다. */
export function usedLayerIds(holder: CellHolder): string[] {
  return Object.keys(holder.layerCells ?? {});
}

/**
 * 이 레이어에 칸이 몇 개 놓여 있는가 — 프로젝트의 모든 페이지를 합쳐 센다.
 * 비우기·삭제를 확인할 때 "무엇을 잃는지" 를 숫자로 보여 주려는 것이다.
 */
export function layerCellCount(project: ProjectDoc, layerId: string): number {
  let total = 0;
  for (const page of project.pages) {
    total += layerId === "equipment"
      ? Object.keys(page.equipment).length
      : Object.keys(paintedCells(page, layerId)).length;
  }
  return total;
}

export interface Point {
  x: number;
  y: number;
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseCellKey(key: string): Point {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

export function createPage(id: string, name: string, cols = 48, rows = 30): PageDoc {
  return {
    id,
    name,
    cols,
    rows,
    background: {},
    equipment: {},
    wiring: {},
  };
}

export function createProject(title = "격자형 배치 프로젝트"): ProjectDoc {
  const initialPage = createPage("page-1", "1층 메인 공장", 48, 30);
  return {
    version: DOC_VERSION,
    title,
    activePageId: initialPage.id,
    pages: [initialPage],
    layers: defaultLayers(),
    palette: defaultPalette(),
  };
}

/** 하위 호환용 단일 문서 생성 */
export function createDoc(cols = 48, rows = 30): LayoutDoc {
  return {
    version: DOC_VERSION,
    title: "격자형 배치도",
    cols,
    rows,
    background: {},
    equipment: {},
    wiring: {},
    layers: defaultLayers(),
    palette: defaultPalette(),
  };
}

export function activePage(project: ProjectDoc): PageDoc {
  return project.pages.find((p) => p.id === project.activePageId) || project.pages[0];
}

/** 프로젝트의 현재 활성 페이지와 팔레트를 결합하여 렌더러용 LayoutDoc 뷰를 생성한다. */
export function activeLayoutDoc(project: ProjectDoc): LayoutDoc {
  const page = activePage(project);
  return {
    version: project.version,
    title: `${project.title} - ${page.name}`,
    cols: page.cols,
    rows: page.rows,
    background: page.background,
    equipment: page.equipment,
    wiring: page.wiring,
    ...(page.layerCells ? { layerCells: page.layerCells } : {}),
    layers: project.layers,
    palette: project.palette,
  };
}

export function updateActivePage(project: ProjectDoc, updater: (page: PageDoc) => PageDoc): ProjectDoc {
  const activeId = activePage(project).id;
  return {
    ...project,
    pages: project.pages.map((p) => (p.id === activeId ? updater(p) : p)),
  };
}

/** 쓰이지 않은 페이지 ID. 시각·난수를 쓰지 않아 같은 조작이 항상 같은 결과를 낸다. */
export function nextPageId(pages: PageDoc[]): string {
  const used = new Set(pages.map((page) => page.id));
  for (let n = pages.length + 1; ; n += 1) {
    const candidate = `page-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** 겹치지 않는 기본 페이지 이름. 페이지를 지운 뒤 추가해도 이름이 중복되지 않는다. */
export function nextPageName(pages: PageDoc[]): string {
  const used = new Set(pages.map((page) => page.name));
  for (let n = pages.length + 1; ; n += 1) {
    const candidate = `페이지 ${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function addPageToProject(project: ProjectDoc, customName?: string): ProjectDoc {
  const newId = nextPageId(project.pages);
  // 이벤트 객체 같은 것이 흘러들어와도 이름 자리로 쓰지 않는다.
  // (핸들러를 그대로 onClick 에 넘기면 실제로 이런 값이 들어온다.)
  const trimmed = typeof customName === "string" ? customName.trim() : "";
  const newName = trimmed || nextPageName(project.pages);
  const newPage = createPage(newId, newName, 48, 30);
  return {
    ...project,
    pages: [...project.pages, newPage],
    activePageId: newId,
  };
}

export function renamePageInProject(project: ProjectDoc, pageId: string, newName: string): ProjectDoc {
  const trimmed = newName.trim() || "페이지";
  return {
    ...project,
    pages: project.pages.map((p) => (p.id === pageId ? { ...p, name: trimmed } : p)),
  };
}

export function deletePageFromProject(project: ProjectDoc, pageId: string): ProjectDoc {
  if (project.pages.length <= 1) return project;
  const deletedIdx = project.pages.findIndex((p) => p.id === pageId);
  if (deletedIdx < 0) return project;

  const nextPages = project.pages.filter((p) => p.id !== pageId);
  let nextActiveId = project.activePageId;

  if (project.activePageId === pageId) {
    const targetIdx = Math.max(0, deletedIdx - 1);
    nextActiveId = nextPages[targetIdx]?.id || nextPages[0].id;
  }

  return {
    ...project,
    pages: nextPages,
    activePageId: nextActiveId,
  };
}

export function switchActivePage(project: ProjectDoc, pageId: string): ProjectDoc {
  if (!project.pages.some((p) => p.id === pageId)) return project;
  return {
    ...project,
    activePageId: pageId,
  };
}

/**
 * 현재 페이지에서 `delta` 칸 떨어진 페이지 id.
 *
 * 양끝에서는 멈춘다(순환하지 않음). 방향키를 눌러 두다가 마지막 페이지에서
 * 첫 페이지로 튀면 어디를 보고 있는지 놓친다.
 */
export function stepPageId(project: ProjectDoc, delta: number): string {
  const found = project.pages.findIndex((p) => p.id === project.activePageId);
  const from = found < 0 ? 0 : found;
  const next = Math.min(project.pages.length - 1, Math.max(0, from + delta));
  return project.pages[next].id;
}

export function isInside(doc: { cols: number; rows: number }, p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < doc.cols && p.y < doc.rows;
}

function isEmptyEquipment(cell: EquipmentCell): boolean {
  return !cell.status && !cell.kind && !cell.label && !cell.memo && cellPhotos(cell).length === 0;
}

/** 팔레트 항목을 페이지 셀에 적용한다. */
export function paintCellsOnPage(page: PageDoc, item: PaletteItem, points: Point[]): PageDoc {
  const next: PageDoc = {
    ...page,
    background: { ...page.background },
    equipment: { ...page.equipment },
    wiring: { ...page.wiring },
  };

  for (const p of points) {
    if (!isInside(page, p)) continue;
    const key = cellKey(p.x, p.y);

    // 사용자 레이어의 항목은 그리는 방식이 배경·배선과 같아도 자기 레이어에 담긴다.
    if (!isBuiltinLayerId(item.layer)) {
      const cells = { ...(next.layerCells?.[item.layer] ?? {}) };
      cells[key] = item.id;
      next.layerCells = { ...next.layerCells, [item.layer]: cells };
    } else if (item.role === "tile") {
      next.background[key] = item.id as TileId;
    } else if (item.role === "wire") {
      next.wiring[key] = item.id as WireId;
    } else if (item.role === "status") {
      next.equipment[key] = { ...next.equipment[key], status: item.id as StatusId };
    } else {
      next.equipment[key] = { ...next.equipment[key], kind: item.id as KindId };
    }
  }

  return next;
}

/** 단일 LayoutDoc 호환용 paintCells */
export function paintCells(doc: LayoutDoc, item: PaletteItem, points: Point[]): LayoutDoc {
  const p = paintCellsOnPage(
    {
      id: "temp",
      name: "temp",
      cols: doc.cols,
      rows: doc.rows,
      background: doc.background,
      equipment: doc.equipment,
      wiring: doc.wiring,
    },
    item,
    points,
  );
  return { ...doc, background: p.background, equipment: p.equipment, wiring: p.wiring };
}

/** 지정 레이어에서 셀 내용을 지운다. */
export function eraseCellsOnPage(page: PageDoc, layer: LayerId, points: Point[]): PageDoc {
  const next: PageDoc = {
    ...page,
    background: { ...page.background },
    equipment: { ...page.equipment },
    wiring: { ...page.wiring },
  };

  const custom = !isBuiltinLayerId(layer);
  const cells = custom ? { ...(page.layerCells?.[layer] ?? {}) } : null;

  for (const p of points) {
    const key = cellKey(p.x, p.y);
    if (cells) delete cells[key];
    else if (layer === "background") delete next.background[key];
    else if (layer === "wiring") delete next.wiring[key];
    else delete next.equipment[key];
  }

  return cells ? withLayerCells(next, layer, cells) : next;
}

/** 한 레이어의 칸을 통째로 비운다. 레이어는 남고 내용만 사라진다. */
export function clearLayerOnPage(page: PageDoc, layer: string): PageDoc {
  if (layer === "equipment") {
    return Object.keys(page.equipment).length === 0 ? page : { ...page, equipment: {} };
  }
  if (Object.keys(paintedCells(page, layer)).length === 0) return page;
  return withLayerCells(page, layer, {});
}

/** 레이어를 지울 때 그 칸도 함께 버린다. 남겨 두면 파일만 무거워진다. */
export function dropLayerFromPage(page: PageDoc, layer: string): PageDoc {
  if (!page.layerCells || !(layer in page.layerCells)) return page;
  return withLayerCells(page, layer, {});
}

export function eraseCells(doc: LayoutDoc, layer: LayerId, points: Point[]): LayoutDoc {
  const p = eraseCellsOnPage(
    {
      id: "temp",
      name: "temp",
      cols: doc.cols,
      rows: doc.rows,
      background: doc.background,
      equipment: doc.equipment,
      wiring: doc.wiring,
    },
    layer,
    points,
  );
  return { ...doc, background: p.background, equipment: p.equipment, wiring: p.wiring };
}

/** 칸 정보 편집 상자가 넘기는 값. `photo` 는 이전 판 호출부 호환용이다. */
export type EquipmentInfoPatch = Pick<EquipmentCell, "label" | "memo" | "photos" | "photo">;

export function updateEquipmentInfoOnPage(
  page: PageDoc,
  key: string,
  patch: EquipmentInfoPatch,
): PageDoc {
  const merged: EquipmentCell = { ...page.equipment[key], ...patch };
  if (!merged.label) delete merged.label;
  if (!merged.memo) delete merged.memo;

  // 사진은 목록 하나로 모은다. 이전 판 단일 필드는 여기서 사라진다.
  // patch 에 사진 자리가 없으면 원래 칸의 사진을 그대로 둔다.
  const photos =
    patch.photos !== undefined || patch.photo !== undefined
      ? cellPhotos({ photos: patch.photos, photo: patch.photo })
      : cellPhotos(page.equipment[key]);
  delete merged.photo;
  if (photos.length > 0) merged.photos = photos;
  else delete merged.photos;

  const equipment = { ...page.equipment };
  if (isEmptyEquipment(merged)) delete equipment[key];
  else equipment[key] = merged;

  return { ...page, equipment };
}

export function updateEquipmentInfo(
  doc: LayoutDoc,
  key: string,
  patch: EquipmentInfoPatch,
): LayoutDoc {
  const p = updateEquipmentInfoOnPage(
    {
      id: "temp",
      name: "temp",
      cols: doc.cols,
      rows: doc.rows,
      background: doc.background,
      equipment: doc.equipment,
      wiring: doc.wiring,
    },
    key,
    patch,
  );
  return { ...doc, equipment: p.equipment };
}

export function resizePage(page: PageDoc, cols: number, rows: number): PageDoc {
  const nextCols = Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(cols)));
  const nextRows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.round(rows)));

  const keep = <T,>(source: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [key, value] of Object.entries(source)) {
      const { x, y } = parseCellKey(key);
      if (x < nextCols && y < nextRows) out[key] = value;
    }
    return out;
  };

  const next: PageDoc = {
    ...page,
    cols: nextCols,
    rows: nextRows,
    background: keep(page.background),
    equipment: keep(page.equipment),
    wiring: keep(page.wiring),
  };

  // 사용자 레이어도 같은 자로 자른다. 격자를 줄인 뒤 다시 늘렸을 때 밖에 있던
  // 칸이 되살아나면 안 된다.
  if (page.layerCells) {
    const layerCells: LayerCells = {};
    for (const [id, cells] of Object.entries(page.layerCells)) {
      const kept = keep(cells);
      if (Object.keys(kept).length > 0) layerCells[id] = kept;
    }
    if (Object.keys(layerCells).length > 0) next.layerCells = layerCells;
    else delete next.layerCells;
  }

  return next;
}

export function resizeDoc(doc: LayoutDoc, cols: number, rows: number): LayoutDoc {
  const p = resizePage(
    {
      id: "temp",
      name: "temp",
      cols: doc.cols,
      rows: doc.rows,
      background: doc.background,
      equipment: doc.equipment,
      wiring: doc.wiring,
    },
    cols,
    rows,
  );
  return { ...doc, cols: p.cols, rows: p.rows, background: p.background, equipment: p.equipment, wiring: p.wiring };
}

export function cellCount(doc: { equipment: Record<string, unknown>; wiring: Record<string, unknown>; background: Record<string, unknown> }): { equipment: number; wiring: number; background: number } {
  return {
    equipment: Object.keys(doc.equipment).length,
    wiring: Object.keys(doc.wiring).length,
    background: Object.keys(doc.background).length,
  };
}
