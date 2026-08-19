import {
  defaultPalette,
  type KindId,
  type LayerId,
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
}

export interface PageDoc {
  id: string;
  name: string;
  cols: number;
  rows: number;
  background: Record<string, TileId>;
  equipment: Record<string, EquipmentCell>;
  wiring: Record<string, WireId>;
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
  palette: PaletteItem[];
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

export function isInside(doc: { cols: number; rows: number }, p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < doc.cols && p.y < doc.rows;
}

function isEmptyEquipment(cell: EquipmentCell): boolean {
  return !cell.status && !cell.kind && !cell.label && !cell.memo;
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

    if (item.role === "tile") {
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

  for (const p of points) {
    const key = cellKey(p.x, p.y);
    if (layer === "background") delete next.background[key];
    else if (layer === "wiring") delete next.wiring[key];
    else delete next.equipment[key];
  }

  return next;
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

export function updateEquipmentInfoOnPage(
  page: PageDoc,
  key: string,
  patch: Pick<EquipmentCell, "label" | "memo">,
): PageDoc {
  const merged: EquipmentCell = { ...page.equipment[key], ...patch };
  if (!merged.label) delete merged.label;
  if (!merged.memo) delete merged.memo;

  const equipment = { ...page.equipment };
  if (isEmptyEquipment(merged)) delete equipment[key];
  else equipment[key] = merged;

  return { ...page, equipment };
}

export function updateEquipmentInfo(
  doc: LayoutDoc,
  key: string,
  patch: Pick<EquipmentCell, "label" | "memo">,
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

  return {
    ...page,
    cols: nextCols,
    rows: nextRows,
    background: keep(page.background),
    equipment: keep(page.equipment),
    wiring: keep(page.wiring),
  };
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
