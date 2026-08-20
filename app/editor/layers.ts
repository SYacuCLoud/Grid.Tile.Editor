/**
 * 레이어 — 무엇을 어느 순서로 그리는가.
 *
 * 처음에는 배경 · 설비 · 배선 셋뿐이었고, 그 셋은 코드에 박혀 있었다. 각자 칸에
 * 담는 값이 다르기 때문이다(배경·배선은 팔레트 ID 하나, 설비는 상태·장비·ID·메모·사진).
 * 그래서 이제 사용자가 레이어를 더 만들 수 있게 하면서도 그 셋은 그대로 둔다 —
 * 예전 문서를 한 글자도 고치지 않고 열 수 있어야 한다.
 *
 * 사용자 레이어는 그 셋 중 **그리는 방식**만 골라 쓴다.
 *
 * - `fill` — 칸을 색으로 칠한다(배경과 같은 방식).
 * - `wire` — 이웃한 칸끼리 선을 잇는다(배선과 같은 방식).
 *
 * `equipment` 는 사용자 레이어가 가질 수 없다. 칸 하나에 상태 · 장비 · 장비 ID ·
 * 메모 · 사진이 함께 얹히는 특별한 레이어라서, 여러 벌 두면 "이 칸의 메모" 가
 * 어느 레이어의 메모인지부터 갈라야 한다. 그만한 값이 없다.
 *
 * 배열 순서가 곧 그리는 순서다. **앞이 아래, 뒤가 위**.
 */

import { type PaletteRole, rolesOfLayer } from "./palette";

/** 레이어가 칸을 그리는 방식. */
export type LayerKind = "fill" | "equipment" | "wire";

export interface LayerDef {
  id: string;
  name: string;
  /** 이름 옆에 흐리게 붙는 한 줄. 비워 둘 수 있다. */
  hint: string;
  kind: LayerKind;
  /** 지울 수 없고 그리는 방식도 바꿀 수 없는 기본 레이어. */
  builtin?: true;
  /** 잠긴 레이어는 칠하지도 지우지도 못한다. 아래 깔린 도면을 보호할 때 쓴다. */
  locked?: true;
  /** 숨긴 레이어는 그리지 않는다. 내용은 그대로 남는다. */
  hidden?: true;
}

export const LAYER_NAME_MAX = 16;
export const LAYER_HINT_MAX = 24;
/** 기본 3종을 포함한 최대 레이어 수. 왼쪽 패널이 읽을 수 있는 길이를 넘지 않게. */
export const MAX_LAYERS = 12;

const BUILTIN: LayerDef[] = [
  { id: "background", name: "배경", hint: "벽 · 통로 · 문", kind: "fill", builtin: true },
  { id: "equipment", name: "설비", hint: "상태색 · 장비", kind: "equipment", builtin: true },
  { id: "wiring", name: "배선", hint: "배선 경로", kind: "wire", builtin: true },
];

export const BUILTIN_LAYER_IDS: string[] = BUILTIN.map((layer) => layer.id);

export function isBuiltinLayerId(id: string): boolean {
  return BUILTIN_LAYER_IDS.includes(id);
}

/** 새 문서·이전 문서에 넣을 기본 레이어 구성. */
export function defaultLayers(): LayerDef[] {
  return BUILTIN.map((layer) => ({ ...layer }));
}

/** 사용자가 고를 수 있는 그리는 방식. */
export const USER_LAYER_KINDS: Array<{ kind: LayerKind; name: string; hint: string }> = [
  { kind: "fill", name: "칸 채움", hint: "고른 색으로 칸을 칠한다 (배경과 같은 방식)" },
  { kind: "wire", name: "선 잇기", hint: "이웃한 칸끼리 선을 잇는다 (배선과 같은 방식)" },
];

export function layerKindName(kind: LayerKind): string {
  if (kind === "equipment") return "설비";
  return USER_LAYER_KINDS.find((entry) => entry.kind === kind)?.name ?? "칸 채움";
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/i;

/**
 * 저장된 레이어 구성을 다듬는다.
 *
 * 레이어 목록이 아예 없는 이전 문서에는 기본 3종을 넣는다. 목록이 있어도 기본
 * 3종은 반드시 남긴다 — 그 셋은 칸을 담는 자리(`background` · `equipment` ·
 * `wiring`)가 문서 구조에 박혀 있어서, 목록에서 빠지면 이미 그려 둔 칸이
 * 화면에서 사라진다.
 */
export function sanitizeLayers(raw: unknown): LayerDef[] {
  const out: LayerDef[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (out.length >= MAX_LAYERS) break;
      if (!entry || typeof entry !== "object") continue;

      const candidate = entry as Partial<LayerDef>;
      const id = candidate.id;
      if (typeof id !== "string" || !ID_PATTERN.test(id) || seen.has(id)) continue;

      const builtin = BUILTIN.find((layer) => layer.id === id);
      const name =
        typeof candidate.name === "string" && candidate.name.trim().length > 0
          ? candidate.name.trim().slice(0, LAYER_NAME_MAX)
          : builtin?.name;
      if (!name) continue;

      // 그리는 방식은 기본 레이어에서는 고정이고, 사용자 레이어에서는 둘 중 하나여야 한다.
      const kind: LayerKind | null = builtin
        ? builtin.kind
        : candidate.kind === "wire" || candidate.kind === "fill"
          ? candidate.kind
          : null;
      if (!kind) continue;

      const layer: LayerDef = {
        id,
        name,
        hint:
          typeof candidate.hint === "string"
            ? candidate.hint.trim().slice(0, LAYER_HINT_MAX)
            : (builtin?.hint ?? ""),
        kind,
      };
      if (builtin) layer.builtin = true;
      if (candidate.locked === true) layer.locked = true;
      if (candidate.hidden === true) layer.hidden = true;

      out.push(layer);
      seen.add(id);
    }
  }

  const missing = BUILTIN.filter((layer) => !seen.has(layer.id)).map((layer) => ({ ...layer }));
  if (out.length === 0) return defaultLayers();
  return [...missing, ...out].slice(0, MAX_LAYERS);
}

export function layerById(layers: LayerDef[], id: string): LayerDef | undefined {
  return layers.find((layer) => layer.id === id);
}

/** 렌더러가 쓰는 표시 여부 맵. 숨긴 레이어만 false 가 된다. */
export function visibleMap(layers: LayerDef[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const layer of layers) out[layer.id] = layer.hidden !== true;
  return out;
}

/** 이 레이어에 칠하거나 지울 수 있는가. 없는 레이어 · 잠긴 레이어는 안 된다. */
export function canEditLayer(layers: LayerDef[], id: string): boolean {
  const layer = layerById(layers, id);
  return !!layer && layer.locked !== true;
}

/** 잠긴 레이어 ID 들. 붙여넣기·잘라내기가 건드리지 않을 자리다. */
export function lockedLayerIds(layers: LayerDef[]): string[] {
  return layers.filter((layer) => layer.locked === true).map((layer) => layer.id);
}

/** 레이어 이름 검사. 문제가 없으면 null, 있으면 사용자에게 보일 한 줄. */
export function validateLayerName(layers: LayerDef[], name: string, exceptId?: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "레이어 이름을 입력해 달라.";
  if (trimmed.length > LAYER_NAME_MAX) return `레이어 이름은 ${LAYER_NAME_MAX}자까지 쓸 수 있다.`;
  if (layers.some((layer) => layer.id !== exceptId && layer.name.trim() === trimmed)) {
    return "같은 이름의 레이어가 이미 있다.";
  }
  return null;
}

/** 쓰이지 않은 레이어 ID. 시각·난수를 쓰지 않아 같은 조작이 항상 같은 결과를 낸다. */
export function nextLayerId(layers: LayerDef[]): string {
  const used = new Set(layers.map((layer) => layer.id));
  for (let n = 1; ; n += 1) {
    const candidate = `layer-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export interface LayerInput {
  name: string;
  kind: LayerKind;
  hint?: string;
}

/**
 * 레이어를 목록 맨 위에 더한다.
 *
 * 새 레이어는 위에 얹는다 — 방금 만든 레이어에 그린 것이 기존 도면에 가려
 * 보이지 않으면 만든 사람은 아무 일도 일어나지 않은 줄 안다.
 */
export function addLayer(layers: LayerDef[], input: LayerInput): { layers: LayerDef[]; created: LayerDef } {
  const created: LayerDef = {
    id: nextLayerId(layers),
    name: input.name.trim().slice(0, LAYER_NAME_MAX),
    hint: (input.hint ?? "").trim().slice(0, LAYER_HINT_MAX),
    kind: input.kind === "wire" ? "wire" : "fill",
  };
  return { layers: [...layers, created], created };
}

export function renameLayer(layers: LayerDef[], id: string, name: string): LayerDef[] {
  const trimmed = name.trim().slice(0, LAYER_NAME_MAX);
  if (trimmed.length === 0) return layers;
  return layers.map((layer) => (layer.id === id ? { ...layer, name: trimmed } : layer));
}

/** 그리는 순서를 한 칸 옮긴다. `delta` 가 +1 이면 위로(뒤로), -1 이면 아래로. */
export function moveLayer(layers: LayerDef[], id: string, delta: number): LayerDef[] {
  const from = layers.findIndex((layer) => layer.id === id);
  if (from < 0) return layers;
  const to = from + Math.sign(delta);
  if (to < 0 || to >= layers.length) return layers;

  const next = [...layers];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** 잠금·숨김을 켜고 끈다. 켜면 표시를 남기고, 끄면 표시를 지운다(파일이 깔끔해진다). */
export function setLayerFlag(
  layers: LayerDef[],
  id: string,
  flag: "locked" | "hidden",
  value: boolean,
): LayerDef[] {
  return layers.map((layer) => {
    if (layer.id !== id) return layer;
    const next = { ...layer };
    if (value) next[flag] = true;
    else delete next[flag];
    return next;
  });
}

export function toggleLayerFlag(layers: LayerDef[], id: string, flag: "locked" | "hidden"): LayerDef[] {
  const layer = layerById(layers, id);
  if (!layer) return layers;
  return setLayerFlag(layers, id, flag, layer[flag] !== true);
}

/** 사용자 레이어를 지운다. 기본 3종은 지울 수 없다 — 칸을 담는 자리가 문서 구조다. */
export function deleteLayer(layers: LayerDef[], id: string): LayerDef[] {
  const layer = layerById(layers, id);
  if (!layer || layer.builtin) return layers;
  return layers.filter((entry) => entry.id !== id);
}

/**
 * 팔레트 패널의 분류 한 칸.
 *
 * 기본 레이어는 예전처럼 분류(상태 · 장비 · 배선 …)로 갈라 보이고, 사용자
 * 레이어는 분류가 하나다 — 레이어 자체가 곧 분류다.
 */
export interface LayerSection {
  key: string;
  layerId: string;
  role: PaletteRole;
  name: string;
  addLabel: string;
  hint: string;
  /** 사용자가 항목을 추가·수정·삭제할 수 있는 분류인가. */
  editable: boolean;
}

export function sectionKey(layerId: string, role: PaletteRole): string {
  return `${layerId}:${role}`;
}

export function layerSections(layer: LayerDef): LayerSection[] {
  if (layer.builtin) {
    return rolesOfLayer(layer.id).map((role) => ({
      key: sectionKey(layer.id, role.id),
      layerId: layer.id,
      role: role.id,
      name: role.name,
      addLabel: role.addLabel,
      hint: role.hint,
      editable: role.editable,
    }));
  }

  const role: PaletteRole = layer.kind === "wire" ? "wire" : "tile";
  return [
    {
      key: sectionKey(layer.id, role),
      layerId: layer.id,
      role,
      name: layer.name,
      addLabel: "+ 항목 추가",
      hint: layer.hint || (layer.kind === "wire" ? "경로를 잇는다" : "칸을 색으로 칠한다"),
      editable: true,
    },
  ];
}
