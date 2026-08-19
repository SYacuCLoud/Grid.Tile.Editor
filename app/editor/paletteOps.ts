import { type EquipmentCell, type LayoutDoc, type PageDoc, type ProjectDoc } from "./doc";
import {
  defaultPalette,
  defaultTiles,
  DESCRIPTION_MAX,
  isHexColor,
  NAME_MAX,
  NEW_ITEM_COLOR,
  type PaletteId,
  type PaletteItem,
  type PaletteRole,
  roleMeta,
  ROLES,
} from "./palette";

export interface PaletteInput {
  /** 디스플레이 이름. */
  name: string;
  color: string;
  /** 설명. 비워 둘 수 있다. */
  description: string;
}

/** 이름·색 검사. 문제가 없으면 null, 있으면 사용자에게 보일 한 줄. */
export function validateInput(
  palette: PaletteItem[],
  role: PaletteRole,
  input: PaletteInput,
  exceptId?: PaletteId,
): string | null {
  const name = input.name.trim();
  if (name.length === 0) return "이름을 입력해 달라.";
  if (name.length > NAME_MAX) return `디스플레이 이름은 ${NAME_MAX}자까지 쓸 수 있다.`;
  if (input.description.trim().length > DESCRIPTION_MAX) return `설명은 ${DESCRIPTION_MAX}자까지 쓸 수 있다.`;
  if (!isHexColor(input.color)) return "색을 다시 골라 달라.";

  const clash = palette.some(
    (item) => item.role === role && item.id !== exceptId && !item.retired && item.name.trim() === name,
  );
  if (clash) return `${roleMeta(role).name} 분류에 같은 디스플레이 이름이 이미 있다.`;

  return null;
}

function slug(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 16) : "item";
}

/** 사용자 항목의 고유 ID. 기본 항목 ID 와 겹치지 않게 분류 접두어를 붙인다. */
function nextId(palette: PaletteItem[], role: PaletteRole, name: string): PaletteId {
  const base = `${role}-${slug(name)}`;
  if (!palette.some((item) => item.id === base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!palette.some((item) => item.id === candidate)) return candidate;
  }
}

/** 팔레트 목록에 항목을 더한다. 만들어진 항목도 함께 돌려준다. */
export function addPaletteEntry(
  palette: PaletteItem[],
  role: PaletteRole,
  input: PaletteInput,
): { palette: PaletteItem[]; created: PaletteItem } {
  const meta = roleMeta(role);
  const name = input.name.trim();
  const created: PaletteItem = {
    id: nextId(palette, role, name),
    name,
    layer: meta.layer,
    role,
    color: isHexColor(input.color) ? input.color.toLowerCase() : NEW_ITEM_COLOR,
  };
  const description = input.description.trim();
  if (description) created.description = description;

  return { palette: [...palette, created], created };
}

/** 팔레트 목록에서 한 항목의 이름·색을 고친다. */
export function updatePaletteEntry(
  palette: PaletteItem[],
  id: PaletteId,
  input: PaletteInput,
): PaletteItem[] {
  const name = input.name.trim();
  return palette.map((item) => {
    if (item.id !== id) return item;
    const next: PaletteItem = {
      ...item,
      name,
      color: isHexColor(input.color) ? input.color.toLowerCase() : item.color,
    };
    const description = input.description.trim();
    if (description) next.description = description;
    else delete next.description;
    return next;
  });
}

export function addItem(doc: LayoutDoc, role: PaletteRole, input: PaletteInput): LayoutDoc {
  return { ...doc, palette: addPaletteEntry(doc.palette, role, input).palette };
}

export function updateItem(doc: LayoutDoc, id: PaletteId, input: PaletteInput): LayoutDoc {
  return { ...doc, palette: updatePaletteEntry(doc.palette, id, input) };
}

/** 칸을 담고 있는 것 — `PageDoc` 과 `LayoutDoc` 이 모두 만족한다. */
export interface CellSource {
  background: Record<string, PaletteId>;
  equipment: Record<string, EquipmentCell>;
  wiring: Record<string, PaletteId>;
}

/** 여러 페이지를 합쳐 이 항목이 쓰인 칸 수를 센다. */
export function usageCountIn(sources: CellSource[], item: PaletteItem): number {
  let total = 0;

  for (const source of sources) {
    if (item.role === "tile") {
      total += Object.values(source.background).filter((id) => id === item.id).length;
      continue;
    }
    if (item.role === "wire") {
      total += Object.values(source.wiring).filter((id) => id === item.id).length;
      continue;
    }
    const field: "status" | "kind" = item.role === "status" ? "status" : "kind";
    total += Object.values(source.equipment).filter((cell) => cell[field] === item.id).length;
  }

  return total;
}

/** 이 항목이 쓰인 칸 수 — 한 페이지 기준. */
export function usageCount(doc: CellSource, item: PaletteItem): number {
  return usageCountIn([doc], item);
}

/**
 * 이 항목이 쓰인 칸 수 — 프로젝트의 모든 페이지 기준.
 *
 * 팔레트는 프로젝트 공용이므로 삭제 판정·범례는 반드시 이 함수를 써야 한다.
 * 활성 페이지만 세면 다른 페이지에서 쓰는 항목을 "미사용" 으로 오판해 지워 버린다.
 */
export function usageCountInProject(project: ProjectDoc, item: PaletteItem): number {
  return usageCountIn(project.pages, item);
}

function isEmptyCell(cell: EquipmentCell): boolean {
  return !cell.status && !cell.kind && !cell.label && !cell.memo;
}

/** 이 항목이 쓰인 칸을 한 페이지에서 모두 비운다. */
function clearUsageIn<T extends CellSource>(source: T, item: PaletteItem): T {
  if (item.role === "tile" || item.role === "wire") {
    const map = item.role === "tile" ? source.background : source.wiring;
    const kept: Record<string, PaletteId> = {};
    for (const [key, id] of Object.entries(map)) {
      if (id !== item.id) kept[key] = id;
    }
    return item.role === "tile" ? { ...source, background: kept } : { ...source, wiring: kept };
  }

  const field: "status" | "kind" = item.role === "status" ? "status" : "kind";
  const equipment: Record<string, EquipmentCell> = {};
  for (const [key, cell] of Object.entries(source.equipment)) {
    if (cell[field] !== item.id) {
      equipment[key] = cell;
      continue;
    }
    const next: EquipmentCell = { ...cell };
    delete next[field];
    if (!isEmptyCell(next)) equipment[key] = next;
  }

  return { ...source, equipment };
}

function clearUsage(doc: LayoutDoc, item: PaletteItem): LayoutDoc {
  return clearUsageIn(doc, item);
}

export type DeleteMode = "keepCells" | "purgeCells";

/**
 * 팔레트 항목 삭제.
 * - 쓰이지 않은 항목은 정의까지 완전히 지운다.
 * - `keepCells`: 팔레트 목록에서만 감추고 정의는 남긴다. 배치된 칸은 그대로 보인다.
 * - `purgeCells`: 배치된 칸까지 비우고 정의도 지운다.
 */
export function deleteItem(doc: LayoutDoc, id: PaletteId, mode: DeleteMode): LayoutDoc {
  const item = doc.palette.find((entry) => entry.id === id);
  if (!item) return doc;

  if (mode === "purgeCells") {
    const cleared = clearUsage(doc, item);
    return { ...cleared, palette: cleared.palette.filter((entry) => entry.id !== id) };
  }

  if (usageCount(doc, item) === 0) {
    return { ...doc, palette: doc.palette.filter((entry) => entry.id !== id) };
  }

  return {
    ...doc,
    palette: doc.palette.map((entry) => (entry.id === id ? { ...entry, retired: true } : entry)),
  };
}

/**
 * 프로젝트 전체를 대상으로 한 팔레트 항목 삭제.
 *
 * 팔레트는 프로젝트 공용이므로 사용 여부는 **모든 페이지**를 합쳐 따진다.
 * 활성 페이지만 보면 다른 페이지에서 쓰는 항목을 미사용으로 오판해 정의까지
 * 지워 버리고, 그 페이지의 칸이 회색 대체 항목으로 깨진다.
 *
 * - 어느 페이지에서도 쓰지 않는 항목은 정의까지 완전히 지운다.
 * - `keepCells`: 목록에서만 감추고 정의를 남긴다. 모든 페이지의 칸이 원래 색으로 남는다.
 * - `purgeCells`: 모든 페이지에서 해당 칸을 비우고 정의도 지운다.
 */
export function deleteItemInProject(project: ProjectDoc, id: PaletteId, mode: DeleteMode): ProjectDoc {
  const item = project.palette.find((entry) => entry.id === id);
  if (!item) return project;

  if (mode === "purgeCells") {
    return {
      ...project,
      pages: project.pages.map((page) => clearUsageIn(page, item)),
      palette: project.palette.filter((entry) => entry.id !== id),
    };
  }

  if (usageCountInProject(project, item) === 0) {
    return { ...project, palette: project.palette.filter((entry) => entry.id !== id) };
  }

  return {
    ...project,
    palette: project.palette.map((entry) => (entry.id === id ? { ...entry, retired: true } : entry)),
  };
}

/** 페이지 하나에 대해 이 항목이 쓰인 칸을 모두 비운다. */
export function clearUsageOnPage(page: PageDoc, item: PaletteItem): PageDoc {
  return clearUsageIn(page, item);
}

/**
 * 저장된 문서의 팔레트를 다듬는다.
 * 팔레트가 아예 없는 이전 문서 · 이전 localStorage 에는 기본 팔레트를 넣는다.
 */
export function ensurePalette(raw: unknown): PaletteItem[] {
  if (!Array.isArray(raw)) return defaultPalette();

  const known = new Set<PaletteRole>(ROLES.map((role) => role.id));
  const seen = new Set<PaletteId>();
  const items: PaletteItem[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<PaletteItem>;
    if (typeof candidate.id !== "string" || candidate.id.length === 0) continue;
    if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) continue;
    if (!candidate.role || !known.has(candidate.role)) continue;
    if (seen.has(candidate.id)) continue;

    const meta = roleMeta(candidate.role);
    const item: PaletteItem = {
      id: candidate.id,
      name: candidate.name.trim(),
      layer: meta.layer,
      role: candidate.role,
    };
    if (typeof candidate.color === "string" && isHexColor(candidate.color)) item.color = candidate.color;
    // 글자는 배경 타일만 쓴다. 장비는 디스플레이 이름이 곧 칸 글자다.
    if (candidate.role === "tile" && typeof candidate.glyph === "string" && candidate.glyph.length > 0) {
      item.glyph = candidate.glyph;
    }
    if (typeof candidate.description === "string" && candidate.description.trim().length > 0) {
      item.description = candidate.description.trim().slice(0, DESCRIPTION_MAX);
    }
    if (candidate.retired === true) item.retired = true;

    seen.add(candidate.id);
    items.push(item);
  }

  // 쓸 만한 항목이 하나도 없으면 기본 팔레트로 되돌린다.
  if (items.length === 0) return defaultPalette();

  // 배경 항목은 사용자 관리 대상이 아니므로 빠져 있으면 되채운다.
  const missingTiles = defaultTiles().filter((tile) => !seen.has(tile.id));
  return [...missingTiles, ...items];
}

/**
 * 기준 팔레트에 사용자가 따로 만든 항목을 덧붙인다.
 * 예시 도면을 다시 불러도 사용자가 만든 항목이 사라지지 않게 한다.
 */
export function withUserItems(base: PaletteItem[], current: PaletteItem[]): PaletteItem[] {
  const known = new Set(base.map((item) => item.id));
  return [...base, ...current.filter((item) => !known.has(item.id))];
}

const LEGEND_ORDER: PaletteRole[] = ["status", "kind", "tile", "wire"];

function buildLegend(palette: PaletteItem[], sources: CellSource[]): PaletteItem[] {
  const out: PaletteItem[] = [];

  for (const role of LEGEND_ORDER) {
    for (const item of palette) {
      if (item.role !== role || !item.color) continue;
      // 감춘 항목은 어딘가에서 아직 쓰이는 동안만 범례에 남긴다.
      if (item.retired && usageCountIn(sources, item) === 0) continue;
      out.push(item);
    }
  }

  return out;
}

/** 범례에 넣을 항목 — 색을 가진 항목. 삭제 후 칸에만 남은 항목도 함께 보인다. */
export function legendItems(doc: LayoutDoc): PaletteItem[] {
  return buildLegend(doc.palette, [doc]);
}

/**
 * 프로젝트 기준 범례. 감춘 항목이 다른 페이지에서 쓰이고 있으면 함께 남긴다.
 * 활성 페이지만 보면 그 항목의 색 설명이 범례·PNG 에서 사라진다.
 */
export function legendItemsForProject(project: ProjectDoc): PaletteItem[] {
  return buildLegend(project.palette, project.pages);
}

/** 범례 · 목록에 보일 디스플레이 이름. */
export function legendLabel(item: PaletteItem): string {
  return item.name;
}
