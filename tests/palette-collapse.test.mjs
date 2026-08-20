import assert from "node:assert/strict";
import test from "node:test";

import {
  COLLAPSE_KEY,
  expandCollapsed,
  isCollapsed,
  loadCollapsed,
  sanitizeCollapsed,
  saveCollapsed,
  toggleCollapsed,
} from "../app/editor/paletteCollapse.ts";
import { sectionKey } from "../app/editor/layers.ts";

// 접기 키는 `레이어ID:분류` 꼴이다. 레이어까지 담아야 사용자 레이어의 분류를
// 서로 갈라 접을 수 있다.
const KIND = sectionKey("equipment", "kind");
const WIRE = sectionKey("wiring", "wire");
const STATUS = sectionKey("equipment", "status");
const CUSTOM = sectionKey("layer-1", "tile");

/** 브라우저 없이 localStorage 만 흉내 낸다. */
function withFakeWindow(run, seed = {}) {
  const store = new Map(Object.entries(seed));
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  };
  try {
    return run(store);
  } finally {
    delete globalThis.window;
  }
}

test("접기 키: 레이어와 분류를 함께 담는다", () => {
  assert.equal(KIND, "equipment:kind");
  assert.equal(CUSTOM, "layer-1:tile");
});

test("접기 목록 검사: 아는 꼴만 남기고 중복은 하나로 만든다", () => {
  assert.deepEqual(sanitizeCollapsed([KIND, WIRE]), [KIND, WIRE]);
  assert.deepEqual(sanitizeCollapsed([KIND, KIND]), [KIND]);
  assert.deepEqual(sanitizeCollapsed([CUSTOM]), [CUSTOM], "사용자 레이어 분류도 접을 수 있다");
  assert.deepEqual(sanitizeCollapsed(["없는분류", 3, null]), []);
  assert.deepEqual(sanitizeCollapsed(["kind"]), [], "분류 이름만 적힌 예전 값은 버린다");
  assert.deepEqual(sanitizeCollapsed(["equipment:없는분류"]), []);
  assert.deepEqual(sanitizeCollapsed(KIND), []);
  assert.deepEqual(sanitizeCollapsed(undefined), []);
});

test("토글: 접혀 있으면 펴고 펴져 있으면 접는다. 원본은 그대로 둔다", () => {
  const before = [KIND];

  const opened = toggleCollapsed(before, KIND);
  assert.deepEqual(opened, []);
  assert.deepEqual(before, [KIND], "원본 배열을 건드리지 않는다");

  const closed = toggleCollapsed(before, WIRE);
  assert.deepEqual(closed, [KIND, WIRE]);
  assert.equal(isCollapsed(closed, WIRE), true);
  assert.equal(isCollapsed(closed, STATUS), false);
});

test("펼치기: 이미 펴져 있으면 같은 배열을 그대로 돌려준다", () => {
  const collapsed = [KIND];
  assert.deepEqual(expandCollapsed(collapsed, KIND), []);
  // 참조가 같아야 불필요한 다시 그리기가 없다.
  assert.equal(expandCollapsed(collapsed, STATUS), collapsed);
});

test("저장·불러오기: 새로고침해도 접어 둔 분류가 남는다", () => {
  withFakeWindow((store) => {
    assert.deepEqual(loadCollapsed(), []);

    saveCollapsed([KIND, WIRE]);
    assert.equal(store.get(COLLAPSE_KEY), '["equipment:kind","wiring:wire"]');
    assert.deepEqual(loadCollapsed(), [KIND, WIRE]);

    saveCollapsed([]);
    assert.deepEqual(loadCollapsed(), []);
  });
});

test("저장·불러오기: 깨진 값이 남아 있어도 편집을 막지 않는다", () => {
  withFakeWindow(() => {
    assert.deepEqual(loadCollapsed(), [], "JSON 이 아니면 빈 목록으로 시작한다");
  }, { [COLLAPSE_KEY]: "{망가진" });

  withFakeWindow(() => {
    assert.deepEqual(loadCollapsed(), [STATUS], "모르는 꼴만 걸러 낸다");
  }, { [COLLAPSE_KEY]: '["equipment:status","없는분류","kind"]' });
});

test("서버 렌더(window 없음)에서는 빈 목록이고 저장은 조용히 넘어간다", () => {
  assert.deepEqual(loadCollapsed(), []);
  assert.doesNotThrow(() => saveCollapsed([KIND]));
});
