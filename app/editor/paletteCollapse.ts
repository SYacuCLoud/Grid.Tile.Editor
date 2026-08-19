/**
 * 팔레트 분류 접기 상태.
 *
 * 항목이 늘면 왼쪽 패널이 길어져 아래 분류가 화면 밖으로 밀린다. 쓰지 않는
 * 분류를 접어 두면 지금 쓰는 분류만 눈에 남는다.
 *
 * 접어 둔 상태는 브라우저에 기억한다. 새로고침할 때마다 다시 접는 것은 일이다.
 */

import { ROLES, type PaletteRole } from "./palette";

export const COLLAPSE_KEY = "grid-tile-editor:palette-collapsed";

const KNOWN = new Set<string>(ROLES.map((role) => role.id));

/** 저장된 값에서 아는 분류만 골라 낸다. 이름이 바뀐 예전 값은 버린다. */
export function sanitizeCollapsed(raw: unknown): PaletteRole[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<PaletteRole>();
  for (const entry of raw) {
    if (typeof entry === "string" && KNOWN.has(entry)) seen.add(entry as PaletteRole);
  }
  return [...seen];
}

export function isCollapsed(collapsed: PaletteRole[], role: PaletteRole): boolean {
  return collapsed.includes(role);
}

/** 접혀 있으면 펴고, 펴져 있으면 접는다. 원본은 건드리지 않는다. */
export function toggleCollapsed(collapsed: PaletteRole[], role: PaletteRole): PaletteRole[] {
  return isCollapsed(collapsed, role) ? collapsed.filter((entry) => entry !== role) : [...collapsed, role];
}

/** 접힌 분류를 펴 준다. 이미 펴져 있으면 같은 배열을 그대로 돌려준다(불필요한 렌더 방지). */
export function expandCollapsed(collapsed: PaletteRole[], role: PaletteRole): PaletteRole[] {
  return isCollapsed(collapsed, role) ? collapsed.filter((entry) => entry !== role) : collapsed;
}

export function loadCollapsed(): PaletteRole[] {
  if (typeof window === "undefined") return [];
  try {
    const text = window.localStorage.getItem(COLLAPSE_KEY);
    return text ? sanitizeCollapsed(JSON.parse(text)) : [];
  } catch {
    return [];
  }
}

export function saveCollapsed(collapsed: PaletteRole[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(sanitizeCollapsed(collapsed)));
  } catch {
    // 저장 공간이 막혀 있어도 편집은 계속돼야 한다. 접힘 상태는 다음에 다시 잡는다.
  }
}
