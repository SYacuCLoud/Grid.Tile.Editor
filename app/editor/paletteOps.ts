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
import {
  DEFAULT_LINE_STYLE,
  DEFAULT_PATTERN,
  type FillPattern,
  type LineStyle,
  sanitizeLineStyle,
  sanitizePattern,
} from "./pattern";

export interface PaletteInput {
  /** 디스플레이 이름. */
  name: string;
  color: string;
  /** 설명. 비워 둘 수 있다. */
  description: string;
  /** 칸 채움 무늬. 없으면 솔리드. */
  pattern?: FillPattern;
  /** 선 모양. 없으면 실선. */
  lineStyle?: LineStyle;
}

/** 이름·색 검사. 문제가 없으면 null, 있으면 사용자에게 보일 한 줄. */
/** 칸을 통째로 채우는 분류인가. 장비는 테두리, 배선은 경로로 보이므로 무늬를 쓰지 않는다. */
export function usesPattern(role: PaletteRole): boolean {
  return role !== "kind" && role !== "wire";
}

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
  // 기본값(솔리드 · 실선)은 저장하지 않는다. 예전 문서와 파일 모양이 같아진다.
  // 배선은 칸을 채우지 않으므로 무늬를 받지 않는다.
  if (usesPattern(role) && input.pattern && input.pattern !== DEFAULT_PATTERN) created.pattern = input.pattern;
  if (input.lineStyle && input.lineStyle !== DEFAULT_LINE_STYLE) created.lineStyle = input.lineStyle;

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

    if (usesPattern(item.role) && input.pattern && input.pattern !== DEFAULT_PATTERN) next.pattern = input.pattern;
    else delete next.pattern;
    if (input.lineStyle && input.lineStyle !== DEFAULT_LINE_STYLE) next.lineStyle = input.lineStyle;
    else delete next.lineStyle;

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
    const pattern = sanitizePattern(candidate.pattern);
    // 예전 파일에 배선 무늬가 남아 있어도 버린다. 배선은 선 모양만 쓴다.
    if (usesPattern(candidate.role) && pattern && pattern !== DEFAULT_PATTERN) item.pattern = pattern;
    const lineStyle = sanitizeLineStyle(candidate.lineStyle);
    if (lineStyle && lineStyle !== DEFAULT_LINE_STYLE) item.lineStyle = lineStyle;
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

/**
 * 범례는 **실제로 칠해진 항목만** 담는다.
 *
 * 팔레트에는 있지만 이 도면에서 한 칸도 쓰지 않은 항목까지 넣으면 범례 띠가
 * 쓸데없이 길어지고, 인쇄할 때 그만큼 도면 자리를 잡아먹는다. 읽는 사람에게도
 * 쓰지 않은 색을 설명할 이유가 없다.
 *
 * 팔레트에서 지웠지만 칸에는 남아 있는 항목(retired)은 그 칸이 있는 한 남는다.
 */
function buildLegend(palette: PaletteItem[], sources: CellSource[]): PaletteItem[] {
  const out: PaletteItem[] = [];

  for (const role of LEGEND_ORDER) {
    for (const item of palette) {
      if (item.role !== role || !item.color) continue;
      if (usageCountIn(sources, item) === 0) continue;
      out.push(item);
    }
  }

  return out;
}

/** 이 문서(활성 페이지)에서 쓰인 항목만. */
export function legendItems(doc: LayoutDoc): PaletteItem[] {
  return buildLegend(doc.palette, [doc]);
}

/** 이 페이지에서 쓰인 항목만. 페이지마다 범례가 달라진다. */
export function legendItemsForPage(palette: PaletteItem[], page: PageDoc): PaletteItem[] {
  return buildLegend(palette, [page]);
}

/**
 * 프로젝트 전체에서 한 번이라도 쓰인 항목.
 * 페이지를 가리지 않는 목록이 필요할 때만 쓴다(범례 기본값은 페이지 기준이다).
 */
export function legendItemsForProject(project: ProjectDoc): PaletteItem[] {
  return buildLegend(project.palette, project.pages);
}

/** 범례 · 목록에 보일 디스플레이 이름. */
export function legendLabel(item: PaletteItem): string {
  return item.name;
}
