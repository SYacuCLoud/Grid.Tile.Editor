/**
 * 두 도면을 칸 단위로 비교한다.
 *
 * 리비전 목록은 "언제 누가" 만 알려 준다. 무엇이 바뀌었는지는 칸을 맞대어 봐야
 * 안다. 셀 맵이 희소 맵(쓴 칸만 키가 있다)이라 비교가 싸다 — 두 쪽 키의 합집합만
 * 훑으면 된다.
 */

import { cellPhotos, type CellHolder, type EquipmentCell, type PageDoc, type ProjectDoc, usedLayerIds } from "./doc";
import type { PaletteItem } from "./palette";

export type ChangeKind = "added" | "removed" | "changed";
/** 레이어 ID. 기본 3종과 사용자 레이어 ID 가 함께 온다. */
export type LayerName = string;

export interface CellChange {
  key: string;
  x: number;
  y: number;
  layer: LayerName;
  kind: ChangeKind;
  /** 사람이 읽을 이전 · 이후 값. 없으면 빈 칸이었다는 뜻이다. */
  before: string | null;
  after: string | null;
}

export interface PageDiff {
  pageId: string;
  name: string;
  /** 한쪽에만 있는 페이지인가. */
  status: "same" | "added" | "removed" | "changed";
  size: { before: string | null; after: string | null };
  paper: { before: string | null; after: string | null };
  counts: { added: number; removed: number; changed: number };
  changes: CellChange[];
}

export interface ProjectDiff {
  title: { before: string; after: string };
  counts: { added: number; removed: number; changed: number };
  pages: PageDiff[];
  /** 팔레트가 바뀐 항목 — 이름 · 색 · 무늬가 달라지면 도면 전체가 달라 보인다. */
  palette: Array<{ id: string; kind: ChangeKind; before: string | null; after: string | null }>;
}

function pointOf(key: string): { x: number; y: number } {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

/**
 * 사진 칸을 한 줄로 적는다.
 *
 * data URL 자체는 적지 않는다 — 한 장이 수십만 자라 비교 화면이 못 읽을 것이 된다.
 * 장수와 각 장의 짧은 지문만 적으면 "몇 장이 어떻게 갈렸는지" 는 그대로 보인다.
 * 지문이 있어야 같은 장수에서 한 장을 갈아 끼운 것도 변경으로 잡힌다.
 */
function photoText(cell: EquipmentCell): string | null {
  const photos = cellPhotos(cell);
  if (photos.length === 0) return null;
  return `사진=${photos.length}장(${photos.map(photoFingerprint).join(",")})`;
}

/** 사진 한 장을 가리키는 짧은 표. data URL 뒤쪽 8자면 서로 갈린다. */
function photoFingerprint(dataUrl: string): string {
  return dataUrl.slice(-8);
}

/** 설비 칸을 한 줄로 적는다. 무엇이 달라졌는지 눈으로 비교할 수 있게. */
function equipmentText(cell: EquipmentCell | undefined): string | null {
  if (!cell) return null;
  const parts = [
    cell.status ? `상태=${cell.status}` : null,
    cell.kind ? `장비=${cell.kind}` : null,
    cell.label ? `ID=${cell.label}` : null,
    cell.memo ? `메모=${cell.memo.replace(/\s+/g, " ").slice(0, 40)}` : null,
    photoText(cell),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function diffLayer(
  layer: LayerName,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  describe: (value: unknown) => string | null,
): CellChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: CellChange[] = [];

  for (const key of keys) {
    const from = describe(before[key]);
    const to = describe(after[key]);
    if (from === to) continue;

    const kind: ChangeKind = from === null ? "added" : to === null ? "removed" : "changed";
    out.push({ key, ...pointOf(key), layer, kind, before: from, after: to });
  }

  return out.sort((a, b) => a.y - b.y || a.x - b.x || a.layer.localeCompare(b.layer));
}

const sizeText = (page: PageDoc | undefined) => (page ? `${page.cols} × ${page.rows}` : null);
const paperText = (page: PageDoc | undefined) =>
  page?.paper ? `${page.paper.id} ${page.paper.orientation} ${page.paper.cellMm}mm/칸 여백${page.paper.marginMm}mm` : null;

function paletteText(item: PaletteItem | undefined): string | null {
  if (!item) return null;
  return [
    item.name,
    item.color ?? "",
    item.pattern ?? "solid",
    item.lineStyle ?? "solid",
    item.retired ? "(숨김)" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function diffPage(before: PageDoc | undefined, after: PageDoc | undefined): PageDiff {
  const page = after ?? before;
  const asId = (value: unknown) => (typeof value === "string" ? value : null);

  // 사용자 레이어는 어느 쪽에만 있을 수도 있다(레이어를 새로 만들었거나 지웠거나).
  const empty: CellHolder = { background: {}, equipment: {}, wiring: {} };
  const customIds = new Set([...usedLayerIds(before ?? empty), ...usedLayerIds(after ?? empty)]);

  const changes = [
    ...diffLayer("background", before?.background ?? {}, after?.background ?? {}, asId),
    ...diffLayer("equipment", before?.equipment ?? {}, after?.equipment ?? {}, (value) =>
      equipmentText(value as EquipmentCell | undefined),
    ),
    ...diffLayer("wiring", before?.wiring ?? {}, after?.wiring ?? {}, asId),
    ...[...customIds].flatMap((id) =>
      diffLayer(id, before?.layerCells?.[id] ?? {}, after?.layerCells?.[id] ?? {}, asId),
    ),
  ];

  const counts = {
    added: changes.filter((change) => change.kind === "added").length,
    removed: changes.filter((change) => change.kind === "removed").length,
    changed: changes.filter((change) => change.kind === "changed").length,
  };

  const size = { before: sizeText(before), after: sizeText(after) };
  const paper = { before: paperText(before), after: paperText(after) };

  const status: PageDiff["status"] = !before
    ? "added"
    : !after
      ? "removed"
      : changes.length > 0 ||
          size.before !== size.after ||
          paper.before !== paper.after ||
          before.name !== after.name
        ? "changed"
        : "same";

  return {
    pageId: page?.id ?? "",
    name: after?.name ?? before?.name ?? "",
    status,
    size,
    paper,
    counts,
    changes,
  };
}

/**
 * 프로젝트 두 판을 비교한다.
 *
 * 페이지는 ID 로 맞춘다. 한쪽에만 있으면 페이지 자체가 늘거나 줄어든 것이다.
 */
export function diffProjects(before: ProjectDoc, after: ProjectDoc): ProjectDiff {
  const ids = [...new Set([...before.pages.map((page) => page.id), ...after.pages.map((page) => page.id)])];

  const pages = ids
    .map((id) =>
      diffPage(
        before.pages.find((page) => page.id === id),
        after.pages.find((page) => page.id === id),
      ),
    )
    .filter((page) => page.status !== "same");

  const paletteIds = [...new Set([...before.palette.map((item) => item.id), ...after.palette.map((item) => item.id)])];
  const palette = paletteIds
    .map((id) => {
      const from = paletteText(before.palette.find((item) => item.id === id));
      const to = paletteText(after.palette.find((item) => item.id === id));
      if (from === to) return null;
      const kind: ChangeKind = from === null ? "added" : to === null ? "removed" : "changed";
      return { id, kind, before: from, after: to };
    })
    .filter((entry): entry is ProjectDiff["palette"][number] => entry !== null);

  return {
    title: { before: before.title, after: after.title },
    counts: {
      added: pages.reduce((sum, page) => sum + page.counts.added, 0),
      removed: pages.reduce((sum, page) => sum + page.counts.removed, 0),
      changed: pages.reduce((sum, page) => sum + page.counts.changed, 0),
    },
    pages,
    palette,
  };
}

/** 한 줄 요약. 도구 응답이나 화면 안내에 쓴다. */
export function summarizeDiff(diff: ProjectDiff): string {
  const { added, removed, changed } = diff.counts;
  if (added + removed + changed === 0 && diff.pages.length === 0 && diff.palette.length === 0) {
    return "달라진 곳이 없습니다.";
  }
  const parts = [
    added > 0 ? `추가 ${added}칸` : null,
    removed > 0 ? `삭제 ${removed}칸` : null,
    changed > 0 ? `변경 ${changed}칸` : null,
    diff.palette.length > 0 ? `팔레트 ${diff.palette.length}항목` : null,
  ].filter(Boolean);
  return `${parts.join(" · ")} (페이지 ${diff.pages.length}개)`;
}
