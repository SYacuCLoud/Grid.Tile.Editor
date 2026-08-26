/**
 * 구역 — 칸 범위에 사람이 부르는 이름을 붙인다.
 *
 * 도면은 `가로 37 · 세로 12` 로 자리를 가리킬 수 있지만, 현장에서 오가는 말은
 * "입하존", "A라인", "3번 서버실" 이다. 구역은 그 두 말을 잇는다 — 좌표를 물으면
 * 구역 이름이 함께 나오고, 집계표에도 구역 열이 붙는다.
 *
 * 여기에는 DOM 도 캔버스도 없다. 범위를 다듬고(`sanitizeZones`), 어느 칸이 어느
 * 구역에 드는지 찾고(`zonesAt`), 부를 이름을 짓는(`zoneLabel`) 일까지만 한다.
 * 그리는 일은 `render.ts`, 편집 상자는 `InspectorPanel.tsx` 가 맡는다.
 *
 * 모양은 사각 범위 하나뿐이다. 겹치는 것은 막지 않는다 — 큰 구역(`입하존`) 안에
 * 작은 구역(`A라인`)이 드는 일이 실제로 흔하고, 그때는 둘 다 이름이 나온다.
 */

export const MAX_ZONE_NAME = 24;
/** 한 페이지에 둘 수 있는 구역 수. 이 위로 가면 이름표가 도면을 덮는다. */
export const MAX_ZONES = 60;

export interface Zone {
  id: string;
  /** 구역 이름. 비어 있을 수 없다. */
  name: string;
  /** 왼쪽 위 칸(0부터). */
  x: number;
  y: number;
  /** 칸 수. 1 이상. */
  w: number;
  h: number;
  /** 테두리·이름표 색. 없으면 기본색으로 그린다. */
  color?: string;
  /**
   * 이 구역을 범례에서 뺀다.
   *
   * 구역마다 따로 두는 이유: 큰 구역(`입하존`) 은 범례에 있어야 남이 도면을 읽을 수
   * 있지만, 작은 구역(`A-3 선반`) 까지 올라오면 범례가 도면보다 길어진다. 그때
   * 사용자는 "구역 기능을 끄는" 것이 아니라 "이 구역만 범례에서 빼는" 것을 원한다.
   *
   * 켜져 있을 때만 필드를 둔다 — 대부분의 구역은 범례에 나오므로, 그 쪽이 파일에
   * 아무것도 남기지 않는다.
   */
  hideLegend?: true;
  /**
   * 이름표 자리 — 구역 왼쪽 위를 (0,0) 으로 한 **칸 단위** 오프셋.
   *
   * 픽셀이 아니라 칸으로 두는 이유: 이 편집기는 칸이 단위이고 배율이 자유롭게
   * 바뀐다. 픽셀로 저장하면 배율을 바꾸는 순간 이름표가 도면과 어긋난다.
   *
   * 없으면 (0,0) — 구역 왼쪽 위다. 옮긴 이름표만 파일에 남는다.
   */
  labelX?: number;
  labelY?: number;
}

/** 색을 정하지 않은 구역이 쓰는 색. `render.ts` 도 이 값을 쓴다. */
export const DEFAULT_ZONE_COLOR = "#7c3aed";

/** 구역 색 고르기용 추천 색. 팔레트 색과 부딪히지 않게 짙은 쪽으로 골랐다. */
export const ZONE_COLORS = [
  "#7c3aed",
  "#0891b2",
  "#c2410c",
  "#15803d",
  "#b91c1c",
  "#4338ca",
  "#a16207",
  "#be185d",
];

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 이름을 다듬는다. 앞뒤 공백을 떼고 길이를 자른다. 빈 이름은 빈 문자열이다. */
export function normalizeZoneName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, MAX_ZONE_NAME);
}

/**
 * 저장된 값을 다듬는다.
 *
 * 이름이 없거나 격자 밖으로 온전히 나간 구역은 버린다. 걸친 구역은 격자 안으로
 * 잘라 남긴다 — 격자를 줄였다고 이름을 통째로 잃지는 않게.
 * 아무것도 남지 않으면 `undefined` 다. 필드 자체가 저장되지 않아 예전 판 파일과
 * 같은 모양이 유지된다.
 */
export function sanitizeZones(raw: unknown, cols: number, rows: number): Zone[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const out: Zone[] = [];
  const used = new Set<string>();

  for (const entry of raw) {
    if (out.length >= MAX_ZONES) break;
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<Zone>;

    const name = normalizeZoneName(candidate.name);
    if (!name) continue;

    // 격자 밖으로 온전히 나간 구역은 버린다. 안으로 끌어당기면 이름이 살아도
    // 자리가 엉뚱하게 옮겨져, 지운 것보다 나쁘다.
    const rawX = typeof candidate.x === "number" && Number.isFinite(candidate.x) ? Math.round(candidate.x) : 0;
    const rawY = typeof candidate.y === "number" && Number.isFinite(candidate.y) ? Math.round(candidate.y) : 0;
    if (rawX >= cols || rawY >= rows) continue;

    const x = clampInt(rawX, 0, Math.max(0, cols - 1), 0);
    const y = clampInt(rawY, 0, Math.max(0, rows - 1), 0);
    const w = clampInt(candidate.w, 1, Math.max(1, cols - x), 1);
    const h = clampInt(candidate.h, 1, Math.max(1, rows - y), 1);

    let id = typeof candidate.id === "string" && candidate.id ? candidate.id : `zone-${out.length + 1}`;
    while (used.has(id)) id = `${id}-`;
    used.add(id);

    out.push({
      id,
      name,
      x,
      y,
      w,
      h,
      ...(typeof candidate.color === "string" && candidate.color ? { color: candidate.color } : {}),
      ...(candidate.hideLegend === true ? { hideLegend: true as const } : {}),
      // 이름표 오프셋은 구역 안쪽으로만 둔다. 밖으로 나간 값은 0 으로 되돌린다 —
      // 어긋난 값을 그대로 두면 이름표가 옆 구역 위에 그려진다.
      ...(typeof candidate.labelX === "number" && Number.isFinite(candidate.labelX) && candidate.labelX > 0
        ? { labelX: Math.min(Math.round(candidate.labelX), Math.max(0, w - 1)) }
        : {}),
      ...(typeof candidate.labelY === "number" && Number.isFinite(candidate.labelY) && candidate.labelY > 0
        ? { labelY: Math.min(Math.round(candidate.labelY), Math.max(0, h - 1)) }
        : {}),
    });
  }

  return out.length > 0 ? out : undefined;
}

/** 쓰이지 않은 구역 ID. 시각·난수를 쓰지 않아 같은 조작이 항상 같은 결과를 낸다. */
export function nextZoneId(zones: Zone[]): string {
  const used = new Set(zones.map((zone) => zone.id));
  for (let n = zones.length + 1; ; n += 1) {
    const candidate = `zone-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** 겹치지 않는 기본 이름. 구역을 지운 뒤 추가해도 이름이 부딪히지 않는다. */
export function nextZoneName(zones: Zone[]): string {
  const used = new Set(zones.map((zone) => zone.name));
  for (let n = zones.length + 1; ; n += 1) {
    const candidate = `구역 ${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** 이 칸이 드는 구역들. 작은 것이 앞에 온다 — 좁게 부르는 이름이 더 정확하다. */
export function zonesAt(zones: Zone[] | undefined, x: number, y: number): Zone[] {
  if (!zones || zones.length === 0) return [];
  return zones
    .filter((zone) => x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h)
    .sort((a, b) => a.w * a.h - b.w * b.h);
}

/**
 * 이 칸을 부르는 구역 이름. 겹치면 좁은 쪽부터 ` / ` 로 잇는다.
 * 드는 구역이 없으면 빈 문자열 — 부르는 쪽에서 좌표만 쓰면 된다.
 */
export function zoneLabel(zones: Zone[] | undefined, x: number, y: number): string {
  return zonesAt(zones, x, y)
    .map((zone) => zone.name)
    .join(" / ");
}

/** 구역이 덮는 칸 수. 목록에 "몇 칸" 을 보일 때 쓴다. */
export function zoneArea(zone: Zone): number {
  return zone.w * zone.h;
}

/**
 * 이름표가 얹히는 칸 — 격자 절대 좌표.
 *
 * 저장된 오프셋(`labelX`/`labelY`)은 구역 안쪽 좌표라, 구역을 옮기거나 격자를
 * 줄여도 따라온다. 구역 밖으로 나간 값은 여기서 안쪽으로 끌어당긴다 — 저장된
 * 값이 어긋나 있어도 이름표가 도면 밖에서 사라지지 않게.
 *
 * 렌더러와 끌기 판정이 **이 한 함수**를 함께 쓴다. 각자 계산하면 눌러도 안
 * 잡히는 이름표가 생긴다.
 */
export function zoneLabelCell(zone: Zone): { x: number; y: number } {
  const dx = Math.min(Math.max(0, Math.round(zone.labelX ?? 0)), Math.max(0, zone.w - 1));
  const dy = Math.min(Math.max(0, Math.round(zone.labelY ?? 0)), Math.max(0, zone.h - 1));
  return { x: zone.x + dx, y: zone.y + dy };
}

/**
 * 이 칸에서 끌 수 있는 이름표를 가진 구역. 없으면 null.
 *
 * 이름표는 한 칸에서 시작하지만 글자가 오른쪽으로 뻗는다. 그래도 잡는 자리는
 * 시작 칸 하나로 둔다 — 글자 폭은 배율·글꼴에 따라 달라져서, 넓게 잡으면
 * "여기는 이름표인가 아닌가" 가 배율마다 바뀐다.
 *
 * 겹치면 작은 구역이 이긴다. 작은 구역의 이름표가 위에 그려지므로(`drawZones`),
 * 눈에 보이는 것을 잡는 것이 맞다.
 */
export function zoneLabelAt(zones: Zone[] | undefined, x: number, y: number): Zone | null {
  if (!zones || zones.length === 0) return null;
  const hits = zones.filter((zone) => {
    const cell = zoneLabelCell(zone);
    return cell.x === x && cell.y === y;
  });
  if (hits.length === 0) return null;
  return hits.sort((a, b) => a.w * a.h - b.w * b.h)[0];
}

/**
 * 이름표를 이 칸으로 옮긴다. 좌표는 격자 절대 좌표다.
 *
 * 구역 밖으로는 나가지 않는다 — 이름표가 자기 구역을 가리키지 않으면 이름표가
 * 아니다. (0,0) 으로 되돌리면 필드를 지운다: 옮기지 않은 구역은 파일에 자리를
 * 차지하지 않는다.
 */
export function moveZoneLabel(zones: Zone[] | undefined, id: string, x: number, y: number): Zone[] {
  return (zones ?? []).map((zone) => {
    if (zone.id !== id) return zone;

    const dx = Math.min(Math.max(0, Math.round(x) - zone.x), Math.max(0, zone.w - 1));
    const dy = Math.min(Math.max(0, Math.round(y) - zone.y), Math.max(0, zone.h - 1));

    const next: Zone = { ...zone };
    if (dx === 0) delete next.labelX;
    else next.labelX = dx;
    if (dy === 0) delete next.labelY;
    else next.labelY = dy;
    return next;
  });
}


/**
 * 범례에 올릴 구역들. 큰 것이 앞에 온다 — 도면을 처음 보는 사람은 큰 구역부터 읽는다.
 *
 * `hideLegend` 를 켠 구역은 빠지고, 나머지는 그린 그대로 남는다. 범례에서 뺀
 * 구역도 도면에는 여전히 테두리와 이름표가 그려진다 — "범례에서 뺀다" 는
 * "안 보이게 한다" 가 아니다. 안 보이게 하는 것은 레이어 눈 아이콘이 한다.
 */
export function zoneLegendItems(zones: Zone[] | undefined): Zone[] {
  if (!zones || zones.length === 0) return [];
  return zones.filter((zone) => zone.hideLegend !== true).sort((a, b) => b.w * b.h - a.w * a.h);
}

/** 범례 한 줄에 찍는 글. 이름과 칸 수를 함께 읽는다. */
export function zoneLegendLabel(zone: Zone): string {
  return `${zone.name} (${zoneArea(zone)}칸)`;
}

/**
 * 구역을 범례 항목 모양으로 바꾼다.
 *
 * 범례를 그리는 곳이 셋(화면 시트 · PNG · 인쇄 띠)이라 구역용 그리기 코드를 따로
 * 두면 셋 다 손봐야 하고, 하나를 빼먹으면 화면에는 있는데 인쇄에는 없는 범례가
 * 생긴다. 그래서 구역을 팔레트 항목처럼 생긴 값으로 바꿔 기존 목록 뒤에 붙인다.
 *
 * ID 에 `zone:` 을 붙이는 이유: 진짜 팔레트 ID 와 겹치면 범례를 클릭했을 때
 * 엉뚱한 항목이 잡힌다. 이 값은 그리기용으로만 쓰고 문서에 저장하지 않는다.
 */
export function zoneLegendEntries(zones: Zone[] | undefined): Array<{
  id: string;
  name: string;
  layer: string;
  role: "tile";
  color: string;
}> {
  return zoneLegendItems(zones).map((zone) => ({
    id: `zone:${zone.id}`,
    name: zoneLegendLabel(zone),
    layer: ZONE_LAYER_ID,
    role: "tile" as const,
    color: zone.color ?? DEFAULT_ZONE_COLOR,
  }));
}

/**
 * 구역이 쓰는 레이어 ID.
 *
 * 구역은 진짜 레이어가 아니다 — 칸에 칠하는 것이 아니라 범위에 붙인 이름이라
 * 팔레트 항목 모델과 맞지 않는다. 그래서 `LayerDef` 목록에는 넣지 않고, 눈
 * 아이콘이 켜고 끄는 표시 맵(`visible`)에서만 이 ID 를 쓴다. 렌더러는 이 값이
 * `false` 면 구역을 그리지 않는다.
 */
export const ZONE_LAYER_ID = "zones";



/** 사람이 읽는 구역 범위. 좌표는 1부터 센다. */
export function zoneRangeText(zone: Zone): string {
  return `가로 ${zone.x + 1}~${zone.x + zone.w} · 세로 ${zone.y + 1}~${zone.y + zone.h}`;
}

/**
 * 구역을 더한다. 이름이 비었거나 자리가 다 찼으면 그대로 돌려준다.
 *
 * 겹침은 막지 않는다 — 겹치는 구역은 둘 다 이름이 나온다(`zoneLabel`).
 */
export function addZone(
  zones: Zone[] | undefined,
  rect: { x: number; y: number; w: number; h: number },
  name: string,
  color?: string,
): Zone[] {
  const list = zones ?? [];
  const trimmed = normalizeZoneName(name) || nextZoneName(list);
  if (list.length >= MAX_ZONES) return list;

  return [
    ...list,
    {
      id: nextZoneId(list),
      name: trimmed,
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      w: Math.max(1, Math.round(rect.w)),
      h: Math.max(1, Math.round(rect.h)),
      ...(color ? { color } : {}),
    },
  ];
}

/**
 * 구역 하나를 고친다. 이름을 비우면 예전 이름을 지킨다.
 *
 * `hideLegend` 는 `false` 를 명시적으로 받는다 — `undefined` 는 "건드리지 않는다" 라서,
 * 범례에서 뺀 구역을 다시 올릴 길이 없어진다.
 */
export function updateZone(
  zones: Zone[] | undefined,
  id: string,
  patch: Partial<Omit<Zone, "id" | "hideLegend">> & { hideLegend?: boolean },
): Zone[] {
  const list = zones ?? [];
  return list.map((zone) => {
    if (zone.id !== id) return zone;
    const next: Zone = { ...zone };
    if (patch.name !== undefined) next.name = normalizeZoneName(patch.name) || zone.name;
    if (patch.x !== undefined) next.x = Math.max(0, Math.round(patch.x));
    if (patch.y !== undefined) next.y = Math.max(0, Math.round(patch.y));
    if (patch.w !== undefined) next.w = Math.max(1, Math.round(patch.w));
    if (patch.h !== undefined) next.h = Math.max(1, Math.round(patch.h));
    if (patch.color !== undefined) {
      if (patch.color) next.color = patch.color;
      else delete next.color;
    }
    if (patch.hideLegend !== undefined) {
      if (patch.hideLegend) next.hideLegend = true;
      else delete next.hideLegend;
    }
    return next;
  });
}

export function removeZone(zones: Zone[] | undefined, id: string): Zone[] {
  return (zones ?? []).filter((zone) => zone.id !== id);
}

/**
 * 우클릭이 무엇을 뜻하는지 정한다.
 *
 * 우클릭 하나에 두 가지 일(칸 메모 · 구역)을 물리므로, 무엇이 뜰지는 손이
 * 방금 한 일에서 나와야 한다. 규칙은 셋이다:
 *
 * - `"create"`: 잡아 둔 범위 **안**을 우클릭했고 그 범위가 두 칸 이상이다.
 *   범위를 끌어 놓은 직후라 손이 캔버스에 있다 — 오른쪽 패널까지 가는 왕복을 없앤다.
 *   한 칸 범위를 빼는 이유: 선택 도구로 칸 하나만 누르는 것은 "고를 것을 골랐다"
 *   보다 "이 칸을 보겠다" 인 경우가 훨씬 많고, 그때 뜨는 것은 메모여야 한다.
 * - `"zone"`: 범위 밖(또는 범위 없음)에서 구역 위를 우클릭했다. 그 구역을 고친다.
 *   겹친 구역은 좁은 쪽이 나온다(`zonesAt` 이 이미 그 순서다) — 좁게 부르는 이름이
 *   그 자리를 더 정확히 가리킨다.
 * - `"note"`: 그 밖 전부. 지금까지의 동작이 그대로 남는다.
 */
export type ContextMenuKind =
  | { kind: "create"; rect: { x: number; y: number; w: number; h: number } }
  | { kind: "zone"; zone: Zone }
  | { kind: "note" };

export function contextMenuFor(
  point: { x: number; y: number },
  selection: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null,
  zones: Zone[] | undefined,
): ContextMenuKind {
  if (selection && selection.width * selection.height > 1) {
    const inside =
      point.x >= selection.minX &&
      point.x <= selection.maxX &&
      point.y >= selection.minY &&
      point.y <= selection.maxY;
    if (inside) {
      return {
        kind: "create",
        rect: { x: selection.minX, y: selection.minY, w: selection.width, h: selection.height },
      };
    }
  }

  const hit = zonesAt(zones, point.x, point.y)[0];
  if (hit) return { kind: "zone", zone: hit };

  return { kind: "note" };
}

