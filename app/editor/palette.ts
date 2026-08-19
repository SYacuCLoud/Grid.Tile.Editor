export type LayerId = "background" | "equipment" | "wiring";

export interface LayerMeta {
  id: LayerId;
  name: string;
  hint: string;
}

export const LAYERS: LayerMeta[] = [
  { id: "background", name: "배경", hint: "벽 · 통로 · 문" },
  { id: "equipment", name: "설비", hint: "상태색 · 장비" },
  { id: "wiring", name: "배선", hint: "배선 경로" },
];

/**
 * 팔레트 항목 ID. 예전 판에서는 고정 문자열 조합이었지만, 사용자가 항목을
 * 추가·삭제하므로 이제는 자유 문자열이다. 아래 별칭은 어느 분류의 ID인지
 * 읽는 사람에게 알려주기 위해 남겨 둔다.
 */
export type PaletteId = string;
export type TileId = PaletteId;
export type StatusId = PaletteId;
export type KindId = PaletteId;
export type WireId = PaletteId;

export type PaletteRole = "tile" | "status" | "kind" | "wire";

export interface RoleMeta {
  id: PaletteRole;
  layer: LayerId;
  /** 팔레트 패널의 분류 제목. */
  name: string;
  /** 추가 버튼에 쓰는 글. */
  addLabel: string;
  hint: string;
  /** 사용자가 추가·수정·삭제할 수 있는 분류인가. */
  editable: boolean;
}

export const ROLES: RoleMeta[] = [
  { id: "tile", layer: "background", name: "배경", addLabel: "", hint: "벽 · 통로 · 문", editable: false },
  { id: "status", layer: "equipment", name: "상태", addLabel: "+ 상태 추가", hint: "칸을 상태색으로 칠한다", editable: true },
  { id: "kind", layer: "equipment", name: "장비", addLabel: "+ 장비 추가", hint: "칸에 이름을 올린다", editable: true },
  { id: "wire", layer: "wiring", name: "배선", addLabel: "+ 배선 추가", hint: "배선 경로를 잇는다", editable: true },
];

export function roleMeta(role: PaletteRole): RoleMeta {
  return ROLES.find((item) => item.id === role) ?? ROLES[1];
}

export function rolesOfLayer(layer: LayerId): RoleMeta[] {
  return ROLES.filter((item) => item.layer === layer);
}

export interface PaletteItem {
  id: PaletteId;
  /**
   * 디스플레이 이름. 팔레트 목록 · 범례에 보이고, 장비는 이 이름이 칸에 찍힌다.
   * (저장 형식 호환을 위해 키 이름은 `name` 을 유지한다.)
   */
  name: string;
  /** 이 항목이 무엇인지 적어 두는 설명. PNG 범례에 이름과 함께 나온다. */
  description?: string;
  layer: LayerId;
  role: PaletteRole;
  /** 셀 채움색(배경 · 상태 · 배선) 또는 테두리색(장비). */
  color?: string;
  /**
   * 칸에 표시할 짧은 글자. 기본 장비 항목만 이름과 다른 짧은 글자를 갖는다.
   * 사용자가 이름을 고치면 이름과 같아진다.
   */
  /**
   * 배경 타일이 칸에 찍는 짧은 글자. 배경은 사용자 관리 대상이 아니라
   * 고정 항목이므로 여기서만 쓴다. 없으면 글자를 찍지 않는다(벽 · 통로).
   */
  glyph?: string;
  /**
   * 팔레트 목록에서 감춘 항목. 사용 중인 항목을 삭제하면 이미 배치된 칸이
   * 깨지지 않도록 정의만 남긴다.
   */
  retired?: boolean;
}

/** 최초 실행 초기값. 사용자는 여기서 시작해 자유롭게 고친다. */
const DEFAULT_ITEMS: PaletteItem[] = [
  { id: "wall", name: "벽", layer: "background", role: "tile", color: "#9aa3ad" },
  { id: "aisle", name: "통로", layer: "background", role: "tile", color: "#eef1f4" },
  { id: "door", name: "문", layer: "background", role: "tile", color: "#4a3f2a", glyph: "문" },

  { id: "existing", name: "기존 장비", layer: "equipment", role: "status", color: "#1f6fb2", description: "이미 설치되어 운영 중" },
  { id: "installed", name: "설치 (정상)", layer: "equipment", role: "status", color: "#57a639", description: "설치 완료 · 통신 정상" },
  { id: "pending", name: "미설치 (오류)", layer: "equipment", role: "status", color: "#e33a2e", description: "설치 예정 또는 오류" },
  { id: "unlinked", name: "미연결 (점검)", layer: "equipment", role: "status", color: "#f2c230", description: "설치는 됐으나 통신 미연결" },

  { id: "reader", name: "리더", layer: "equipment", role: "kind", color: "#0f766e", description: "식별 리더기" },
  { id: "sensor", name: "센서", layer: "equipment", role: "kind", color: "#7e22ce", description: "감지 센서" },
  { id: "monitor", name: "모니터", layer: "equipment", role: "kind", color: "#b45309" },
  { id: "pc", name: "PC", layer: "equipment", role: "kind", color: "#334155", description: "검사·관리용 PC" },
  { id: "scale", name: "저울", layer: "equipment", role: "kind", color: "#be123c", description: "계량대 저울" },

  { id: "wirePurple", name: "신호선", layer: "wiring", role: "wire", color: "#7c3aed", description: "데이터 · 통신 배선" },
  { id: "wireOrange", name: "전원선", layer: "wiring", role: "wire", color: "#f2622a", description: "전원 공급 배선" },
];

/** 새 문서·이전 문서에 넣을 기본 팔레트 사본. */
export function defaultPalette(): PaletteItem[] {
  return DEFAULT_ITEMS.map((item) => ({ ...item }));
}

/** 배경 항목은 사용자 관리 대상이 아니므로 언제나 이 목록을 쓴다. */
export function defaultTiles(): PaletteItem[] {
  return DEFAULT_ITEMS.filter((item) => item.role === "tile").map((item) => ({ ...item }));
}

export const NEW_ITEM_COLOR = "#1f6fb2";

export type PaletteIndex = Map<PaletteId, PaletteItem>;

export function indexPalette(palette: PaletteItem[]): PaletteIndex {
  return new Map(palette.map((item) => [item.id, item]));
}

const MISSING: Record<PaletteRole, PaletteItem> = {
  tile: { id: "", name: "삭제된 배경", layer: "background", role: "tile", color: "#d7dbdf" },
  status: { id: "", name: "삭제된 상태", layer: "equipment", role: "status", color: "#c8ced4" },
  kind: { id: "", name: "?", layer: "equipment", role: "kind", color: "#94a3b8", description: "삭제된 장비" },
  wire: { id: "", name: "삭제된 배선", layer: "wiring", role: "wire", color: "#94a3b8" },
};

/**
 * 팔레트에서 항목을 찾는다. 정의가 사라진 ID도 회색 대체 항목으로 돌려주므로
 * 이전 문서나 삭제된 항목이 남은 칸도 그려진다.
 */
export function resolveItem(index: PaletteIndex, id: PaletteId, role: PaletteRole): PaletteItem {
  return index.get(id) ?? { ...MISSING[role], id };
}

export function itemsOfRole(palette: PaletteItem[], role: PaletteRole): PaletteItem[] {
  return palette.filter((item) => item.role === role && !item.retired);
}

export function itemsOfLayer(palette: PaletteItem[], layer: LayerId): PaletteItem[] {
  return palette.filter((item) => item.layer === layer && !item.retired);
}

/** 항목 이름 최대 길이. 칸에 찍히므로 너무 길면 읽히지 않는다. */
export const NAME_MAX = 24;
/** 설명 최대 길이. PNG 범례 한 줄에 들어가야 한다. */
export const DESCRIPTION_MAX = 60;

function parseHex(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function isHexColor(color: string): boolean {
  return parseHex(color) !== null;
}

/** 채움색 위에 올릴 글자색 — 밝은 색 위에는 검정, 어두운 색 위에는 흰색. */
export function textColorOn(background: string | undefined): string {
  const rgb = background ? parseHex(background) : null;
  if (!rgb) return "#101418";
  const luminance = (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255;
  return luminance > 0.62 ? "#101418" : "#ffffff";
}
