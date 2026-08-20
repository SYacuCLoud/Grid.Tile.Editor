/**
 * 팔레트 분류 접기 상태.
 *
 * 항목이 늘면 왼쪽 패널이 길어져 아래 분류가 화면 밖으로 밀린다. 쓰지 않는
 * 분류를 접어 두면 지금 쓰는 분류만 눈에 남는다.
 *
 * 접어 둔 상태는 브라우저에 기억한다. 새로고침할 때마다 다시 접는 것은 일이다.
 */

export const COLLAPSE_KEY = "grid-tile-editor:palette-collapsed";

/**
 * 접힌 분류의 키. `layers.ts` 의 `sectionKey` 가 만드는 `레이어ID:분류` 꼴이다.
 * 레이어까지 담아야 사용자 레이어의 분류를 서로 갈라 접을 수 있다.
 */
export type CollapseKey = string;

const KEY_PATTERN = /^[a-z0-9-]{1,32}:(tile|status|kind|wire)$/i;

/** 저장된 값에서 아는 꼴만 골라 낸다. 분류 이름만 적혀 있던 예전 값은 버린다. */
export function sanitizeCollapsed(raw: unknown): CollapseKey[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<CollapseKey>();
  for (const entry of raw) {
    if (typeof entry === "string" && KEY_PATTERN.test(entry)) seen.add(entry);
  }
  return [...seen];
}

export function isCollapsed(collapsed: CollapseKey[], key: CollapseKey): boolean {
  return collapsed.includes(key);
}

/** 접혀 있으면 펴고, 펴져 있으면 접는다. 원본은 건드리지 않는다. */
export function toggleCollapsed(collapsed: CollapseKey[], key: CollapseKey): CollapseKey[] {
  return isCollapsed(collapsed, key) ? collapsed.filter((entry) => entry !== key) : [...collapsed, key];
}

/** 접힌 분류를 펴 준다. 이미 펴져 있으면 같은 배열을 그대로 돌려준다(불필요한 렌더 방지). */
export function expandCollapsed(collapsed: CollapseKey[], key: CollapseKey): CollapseKey[] {
  return isCollapsed(collapsed, key) ? collapsed.filter((entry) => entry !== key) : collapsed;
}

export function loadCollapsed(): CollapseKey[] {
  if (typeof window === "undefined") return [];
  try {
    const text = window.localStorage.getItem(COLLAPSE_KEY);
    return text ? sanitizeCollapsed(JSON.parse(text)) : [];
  } catch {
    return [];
  }
}

export function saveCollapsed(collapsed: CollapseKey[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(sanitizeCollapsed(collapsed)));
  } catch {
    // 저장 공간이 막혀 있어도 편집은 계속돼야 한다. 접힘 상태는 다음에 다시 잡는다.
  }
}
