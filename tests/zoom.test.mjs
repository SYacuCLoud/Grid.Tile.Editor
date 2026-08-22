import assert from "node:assert/strict";
import test from "node:test";
import { KEY_PAN_CELLS, anchoredScreenPos, anchoredScroll, keyPanScroll, panScroll } from "../app/editor/zoom.ts";
import { ZOOM_STEPS } from "../app/editor/useEditor.ts";

/** 스크롤 영역 왼쪽 위가 화면 (100, 80) 에 있고, 캔버스가 그 안에서 스크롤된 상태. */
function anchorAt(docX, docY, cell, scrollLeft = 0, scrollTop = 0) {
  const boxLeft = 100;
  const boxTop = 80;
  const padding = 16;

  // 캔버스의 현재 화면 위치 = 영역 위치 + 여백 - 스크롤량
  const canvasLeft = boxLeft + padding - scrollLeft;
  const canvasTop = boxTop + padding - scrollTop;

  return {
    docX,
    docY,
    // 커서는 그 도면 지점 위에 있다.
    clientX: canvasLeft + docX * cell,
    clientY: canvasTop + docY * cell,
    canvasLeft,
    canvasTop,
    scrollLeft,
    scrollTop,
  };
}

test("휠 확대: 커서 아래 지점이 제자리에 남는다", () => {
  const cell = 22;
  const next = 26;

  // 도면 한가운데쯤을 가리킨 채 확대한다.
  const anchor = anchorAt(30.5, 18.25, cell, 240, 160);
  const scroll = anchoredScroll(anchor, next);
  const after = anchoredScreenPos(anchor, next, scroll);

  assert.ok(Math.abs(after.x - anchor.clientX) < 1e-9, `가로가 ${after.x - anchor.clientX}px 밀렸다`);
  assert.ok(Math.abs(after.y - anchor.clientY) < 1e-9, `세로가 ${after.y - anchor.clientY}px 밀렸다`);

  // 확대했으므로 더 오른쪽·아래를 봐야 한다.
  assert.ok(scroll.scrollLeft > anchor.scrollLeft);
  assert.ok(scroll.scrollTop > anchor.scrollTop);
});

test("휠 축소: 커서 아래 지점이 제자리에 남는다", () => {
  const anchor = anchorAt(44, 26, 26, 500, 400);
  const next = 22;
  const scroll = anchoredScroll(anchor, next);
  const after = anchoredScreenPos(anchor, next, scroll);

  assert.ok(Math.abs(after.x - anchor.clientX) < 1e-9);
  assert.ok(Math.abs(after.y - anchor.clientY) < 1e-9);
  assert.ok(scroll.scrollLeft < anchor.scrollLeft);
});

test("휠 확대: 모든 배율 단계에서 어긋나지 않는다", () => {
  for (let i = 0; i < ZOOM_STEPS.length; i += 1) {
    for (let j = 0; j < ZOOM_STEPS.length; j += 1) {
      const from = ZOOM_STEPS[i];
      const to = ZOOM_STEPS[j];
      const anchor = anchorAt(17.75, 9.5, from, 120, 90);
      const after = anchoredScreenPos(anchor, to, anchoredScroll(anchor, to));

      // 스크롤이 0 에서 잘리지 않는 범위에서만 정확히 맞는다.
      const scroll = anchoredScroll(anchor, to);
      if (scroll.scrollLeft > 0 && scroll.scrollTop > 0) {
        assert.ok(Math.abs(after.x - anchor.clientX) < 1e-9, `${from} -> ${to} 가로 어긋남`);
        assert.ok(Math.abs(after.y - anchor.clientY) < 1e-9, `${from} -> ${to} 세로 어긋남`);
      }
    }
  }
});

test("휠 축소: 스크롤이 음수로 가지 않는다", () => {
  // 왼쪽 위 끝을 보고 있는 상태에서 축소하면 스크롤이 음수로 계산될 수 있다.
  const anchor = anchorAt(0.5, 0.5, 32, 0, 0);
  const scroll = anchoredScroll(anchor, 14);

  assert.ok(scroll.scrollLeft >= 0, `scrollLeft 가 ${scroll.scrollLeft}`);
  assert.ok(scroll.scrollTop >= 0, `scrollTop 가 ${scroll.scrollTop}`);
});

test("가운데 버튼 화면 이동: 끈 방향과 반대로 스크롤된다", () => {
  const start = { scrollLeft: 300, scrollTop: 200, clientX: 500, clientY: 400 };

  // 오른쪽 아래로 40, 30 끌면 내용이 그만큼 따라오므로 스크롤은 줄어든다.
  const dragged = panScroll(start, 540, 430);
  assert.deepEqual(dragged, { scrollLeft: 260, scrollTop: 170 });

  // 반대로 끌면 스크롤이 늘어난다.
  assert.deepEqual(panScroll(start, 460, 370), { scrollLeft: 340, scrollTop: 230 });

  // 제자리면 그대로다.
  assert.deepEqual(panScroll(start, 500, 400), { scrollLeft: 300, scrollTop: 200 });
});

test("가운데 버튼 화면 이동: 스크롤이 음수로 가지 않는다", () => {
  const start = { scrollLeft: 10, scrollTop: 5, clientX: 100, clientY: 100 };
  const next = panScroll(start, 400, 400);

  assert.equal(next.scrollLeft, 0);
  assert.equal(next.scrollTop, 0);
});

const box = { scrollLeft: 200, scrollTop: 150, clientWidth: 800, clientHeight: 600 };

test("W/A/S/D 화면 이동: 칸 단위로 옮기고 배율을 따라간다", () => {
  // D = 오른쪽으로 4칸(22px 배율 → 88px)
  assert.deepEqual(keyPanScroll(box, { x: 1, y: 0 }, 22), { scrollLeft: 288, scrollTop: 150 });
  // A = 왼쪽, W = 위, S = 아래
  assert.deepEqual(keyPanScroll(box, { x: -1, y: 0 }, 22), { scrollLeft: 112, scrollTop: 150 });
  assert.deepEqual(keyPanScroll(box, { x: 0, y: -1 }, 22), { scrollLeft: 200, scrollTop: 62 });
  assert.deepEqual(keyPanScroll(box, { x: 0, y: 1 }, 22), { scrollLeft: 200, scrollTop: 238 });

  // 배율이 두 배면 픽셀 걸음도 두 배 — 화면에서 옮겨 보이는 칸 수는 그대로다.
  assert.equal(keyPanScroll(box, { x: 1, y: 0 }, 44).scrollLeft - box.scrollLeft, KEY_PAN_CELLS * 44);
});

test("W/A/S/D 화면 이동: Shift 는 한 화면씩, 스크롤은 음수로 가지 않는다", () => {
  assert.deepEqual(keyPanScroll(box, { x: 1, y: 0 }, 22, true), { scrollLeft: 1000, scrollTop: 150 });
  assert.deepEqual(keyPanScroll(box, { x: 0, y: 1 }, 22, true), { scrollLeft: 200, scrollTop: 750 });

  // 왼쪽 위 끝에서 더 밀어도 0 에서 멈춘다.
  const atEdge = { scrollLeft: 10, scrollTop: 5, clientWidth: 800, clientHeight: 600 };
  assert.deepEqual(keyPanScroll(atEdge, { x: -1, y: -1 }, 22, true), { scrollLeft: 0, scrollTop: 0 });
});
