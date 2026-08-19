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

test("접기 목록 검사: 아는 분류만 남기고 중복은 하나로 만든다", () => {
  assert.deepEqual(sanitizeCollapsed(["kind", "wire"]), ["kind", "wire"]);
  assert.deepEqual(sanitizeCollapsed(["kind", "kind"]), ["kind"]);
  assert.deepEqual(sanitizeCollapsed(["없는분류", 3, null]), []);
  assert.deepEqual(sanitizeCollapsed("kind"), []);
  assert.deepEqual(sanitizeCollapsed(undefined), []);
});

test("토글: 접혀 있으면 펴고 펴져 있으면 접는다. 원본은 그대로 둔다", () => {
  const before = ["kind"];

  const opened = toggleCollapsed(before, "kind");
  assert.deepEqual(opened, []);
  assert.deepEqual(before, ["kind"], "원본 배열을 건드리지 않는다");

  const closed = toggleCollapsed(before, "wire");
  assert.deepEqual(closed, ["kind", "wire"]);
  assert.equal(isCollapsed(closed, "wire"), true);
  assert.equal(isCollapsed(closed, "status"), false);
});

test("펼치기: 이미 펴져 있으면 같은 배열을 그대로 돌려준다", () => {
  const collapsed = ["kind"];
  assert.deepEqual(expandCollapsed(collapsed, "kind"), []);
  // 참조가 같아야 불필요한 다시 그리기가 없다.
  assert.equal(expandCollapsed(collapsed, "status"), collapsed);
});

test("저장·불러오기: 새로고침해도 접어 둔 분류가 남는다", () => {
  withFakeWindow((store) => {
    assert.deepEqual(loadCollapsed(), []);

    saveCollapsed(["kind", "wire"]);
    assert.equal(store.get(COLLAPSE_KEY), '["kind","wire"]');
    assert.deepEqual(loadCollapsed(), ["kind", "wire"]);

    saveCollapsed([]);
    assert.deepEqual(loadCollapsed(), []);
  });
});

test("저장·불러오기: 깨진 값이 남아 있어도 편집을 막지 않는다", () => {
  withFakeWindow(() => {
    assert.deepEqual(loadCollapsed(), [], "JSON 이 아니면 빈 목록으로 시작한다");
  }, { [COLLAPSE_KEY]: "{망가진" });

  withFakeWindow(() => {
    assert.deepEqual(loadCollapsed(), ["status"], "모르는 분류만 걸러 낸다");
  }, { [COLLAPSE_KEY]: '["status","없는분류"]' });
});

test("서버 렌더(window 없음)에서는 빈 목록이고 저장은 조용히 넘어간다", () => {
  assert.deepEqual(loadCollapsed(), []);
  assert.doesNotThrow(() => saveCollapsed(["kind"]));
});
