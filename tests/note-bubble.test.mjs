/**
 * 말풍선 자리 — 메모·사진이 있는 칸에 마우스를 올렸을 때.
 *
 * 실제 컴포넌트는 CSS `top/bottom/left/right` 로 자리를 잡는다. 여기서는 그
 * 계산만 떼어 내 견준다 — 브라우저 없이 확인하려는 것이다. 계산식이 컴포넌트와
 * 어긋나면 이 테스트가 지켜 주지 못하므로, `CellNoteBubble.tsx` 를 고칠 때
 * 여기도 함께 본다.
 */

import assert from "node:assert/strict";
import test from "node:test";

const MAX_WIDTH = 220;

/**
 * `CellNoteBubble` 과 같은 셈. 캔버스 왼쪽 위에서 잰 픽셀 자리를 돌려준다.
 *
 * `cols`/`rows` 는 컴포넌트가 받는 값(자리 계산에 쓰는 칸 수)이고,
 * `canvasCols`/`canvasRows` 는 실제 캔버스 크기다. **CSS `right`/`bottom` 은 늘
 * 실제 캔버스 끝에서 재므로** 둘이 다르면 자리가 밀린다 — 그 어긋남을 보려고
 * 일부러 갈라 둔다.
 */
function bubbleBox(x, y, cell, cols, rows, canvasCols = cols, canvasRows = rows) {
  const flipX = (x + 1) * cell + MAX_WIDTH > cols * cell;
  const flipY = y > rows - 4;

  const left = flipX
    ? canvasCols * cell - (cols - x - 1) * cell - MAX_WIDTH
    : x * cell;
  const top = flipY ? undefined : (y + 1) * cell + 6;
  const bottomEdge = flipY ? canvasRows * cell - ((rows - y) * cell + 6) : undefined;

  return { flipX, flipY, left, top, bottomEdge };
}

test("말풍선: 칸 바로 아래·왼쪽 정렬로 뜬다", () => {
  const cell = 22;
  const box = bubbleBox(2, 2, cell, 40, 30);

  assert.equal(box.flipX, false);
  assert.equal(box.flipY, false);
  // 칸 왼쪽에 맞추고 칸 아래로 6px 띄운다.
  assert.equal(box.left, 2 * cell);
  assert.equal(box.top, 3 * cell + 6);
});

test("말풍선: 오른쪽 끝에서는 왼쪽으로 펼쳐 칸 옆에 붙는다", () => {
  const cell = 22;
  const cols = 40;
  // 오른쪽에서 두 번째 칸 — 말풍선 폭(220)이 남은 자리를 넘는다.
  const x = cols - 2;
  const box = bubbleBox(x, 2, cell, cols, 30);

  assert.equal(box.flipX, true);
  // 뒤집혀도 칸에서 멀어지면 안 된다. 말풍선 오른쪽 끝이 칸 오른쪽에 닿는다.
  const bubbleRight = box.left + MAX_WIDTH;
  assert.equal(bubbleRight, (x + 1) * cell);
  // 그러므로 왼쪽 끝은 칸에서 딱 말풍선 폭만큼만 떨어진다.
  assert.equal(box.left, (x + 1) * cell - MAX_WIDTH);
});

/**
 * 이 테스트가 실제로 잡은 버그.
 *
 * 예전에는 `cols`/`rows` 로 **도면** 칸 수를 넘겼다. 인쇄 경계선을 켜면 캔버스가
 * 용지 범위까지 넓어지는데, `right` 는 **캔버스** 오른쪽 끝에서 재기 때문에
 * 도면과 용지의 폭 차이만큼 말풍선이 왼쪽으로 밀려 엉뚱한 곳에 떴다.
 */
test("말풍선: 인쇄 경계선을 켜도 칸 옆에 붙는다 (캔버스 칸 수를 써야 한다)", () => {
  const cell = 22;
  const docCols = 40;
  const docRows = 25;
  // 인쇄 경계선을 켜면 캔버스가 용지까지 넓어진다(가로 A4 는 55x38칸).
  const canvasCols = 55;
  const canvasRows = 38;

  // 도면 오른쪽 끝 칸 — 뒤집기가 걸리는 자리.
  const x = docCols - 1;

  // 고친 뒤: 캔버스 칸 수를 넘긴다 — 자리 계산과 CSS 기준이 같아진다.
  const fixed = bubbleBox(x, 2, cell, canvasCols, canvasRows, canvasCols, canvasRows);
  // 도면 끝이지만 캔버스는 더 넓으니 뒤집을 이유가 없다 — 오른쪽으로 펼친다.
  assert.equal(fixed.flipX, false);
  assert.equal(fixed.left, x * cell, "말풍선이 칸에서 떨어졌다");

  // 옛 버그: 도면 칸 수로 계산하면 뒤집히는데, CSS 는 캔버스 끝에서 재므로
  // 도면과 용지의 폭 차이(15칸 = 330px)만큼 오른쪽으로 밀려 엉뚱한 곳에 뜬다.
  const buggy = bubbleBox(x, 2, cell, docCols, docRows, canvasCols, canvasRows);
  assert.equal(buggy.flipX, true);
  // 제대로라면 말풍선 오른쪽 끝이 칸 오른쪽에 닿아야 한다.
  const wantLeft = (x + 1) * cell - MAX_WIDTH;
  const drift = buggy.left - wantLeft;
  assert.equal(
    drift,
    (canvasCols - docCols) * cell,
    "옛 버그가 재현되지 않는다 — 이 테스트가 무의미하다",
  );
  assert.ok(drift > cell * 10, `어긋남이 너무 작다 (${drift}px)`);

  // 아래쪽도 같다. 도면 아래 끝이지만 캔버스는 더 아래까지 있다.
  const fixedDown = bubbleBox(2, docRows - 1, cell, canvasCols, canvasRows, canvasCols, canvasRows);
  assert.equal(fixedDown.flipY, false, "캔버스에 자리가 남는데 위로 펼쳤다");
  assert.equal(fixedDown.top, docRows * cell + 6);

  const buggyDown = bubbleBox(2, docRows - 1, cell, docCols, docRows, canvasCols, canvasRows);
  assert.equal(buggyDown.flipY, true);
  // 위로 펼치면서 캔버스 아래 끝 기준이라 도면보다 한참 아래에 뜬다.
  assert.ok(
    buggyDown.bottomEdge > docRows * cell,
    `아래쪽 어긋남이 없다 (${buggyDown.bottomEdge})`,
  );
});

test("말풍선: 아래 끝에서는 위로 펼친다", () => {
  const cell = 22;
  const rows = 30;

  // 아래에서 세 번째 칸부터 위로 펼친다(y > rows - 4).
  assert.equal(bubbleBox(2, rows - 4, cell, 40, rows).flipY, false);
  assert.equal(bubbleBox(2, rows - 3, cell, 40, rows).flipY, true);

  const box = bubbleBox(2, rows - 1, cell, 40, rows);
  // 칸 위로 6px 띄운다 — 칸을 덮으면 무엇을 보려던 것인지 가려진다.
  assert.equal(box.bottomEdge, rows * cell - cell - 6);
});
