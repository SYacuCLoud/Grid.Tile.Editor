import assert from "node:assert/strict";
import test from "node:test";
import { createProject } from "../app/editor/doc.ts";
import { defaultPaper, sanitizeMemoMode, sanitizePaper, sheetCells } from "../app/editor/paper.ts";
import {
  collectMemos,
  memoBlockOnBlankSheet,
  memoBlockOnSheet,
  memoLineCount,
  memoNumbers,
  planMemoPages,
} from "../app/editor/memoPrint.ts";
import { lastSheetGrid, mmToPx, planPrint } from "../app/editor/printSheet.ts";
import { canvasCells } from "../app/editor/render.ts";

/** 메모가 적힌 칸을 흩뿌린 페이지. 좌표를 일부러 뒤섞어 넣는다. */
function pageWithMemos(pairs) {
  const project = createProject("메모");
  const page = project.pages[0];
  for (const [x, y, memo, label] of pairs) {
    page.equipment[`${x},${y}`] = { memo, ...(label ? { label } : {}) };
  }
  return { project, page };
}

test("메모 번호: 행 우선(왼→오, 위→아래)으로 매긴다", () => {
  // 넣는 순서를 일부러 뒤집는다 — 번호는 좌표로 정해져야 한다.
  const { page } = pageWithMemos([
    [5, 3, "다섯"],
    [1, 1, "하나"],
    [4, 1, "둘"],
    [2, 3, "넷"],
    [9, 1, "셋"],
  ]);

  const entries = collectMemos(page);
  assert.deepEqual(
    entries.map((e) => [e.no, e.x, e.y]),
    [
      [1, 1, 1],
      [2, 4, 1],
      [3, 9, 1],
      [4, 2, 3],
      [5, 5, 3],
    ],
  );

  // 같은 도면을 두 번 훑어도 번호가 같아야 한다.
  assert.deepEqual(collectMemos(page), entries);

  const numbers = memoNumbers(page);
  assert.equal(numbers["1,1"], 1);
  assert.equal(numbers["5,3"], 5);
  // 메모 없는 칸은 번호가 없다.
  assert.equal(numbers["7,7"], undefined);
});

test("메모 번호: 메모 없는 칸은 세지 않는다", () => {
  const project = createProject("빈 메모");
  const page = project.pages[0];
  page.equipment["1,1"] = { label: "C1" };
  page.equipment["2,1"] = { status: "unlinked" };
  page.equipment["3,1"] = { memo: "여기만" };

  const entries = collectMemos(page);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].no, 1);
  assert.equal(entries[0].x, 3);
});

test("메모 자리: 세로 용지는 아래, 가로 용지는 오른쪽을 쓴다", () => {
  // 격자 30x20, 칸 5mm → 150x100mm. A4 인쇄영역은 세로 190x277, 가로 277x190.
  const portrait = { ...defaultPaper("a4"), orientation: "portrait", cellMm: 5, marginMm: 10 };
  const landscape = { ...defaultPaper("a4"), orientation: "landscape", cellMm: 5, marginMm: 10 };

  const down = memoBlockOnSheet(portrait, 30, 20, 0);
  assert.ok(down, "세로 용지에 자리가 없다");
  // 아래를 쓰면 x 는 여백에서 시작하고 폭은 인쇄영역 전체다.
  assert.equal(down.xMm, 10);
  assert.equal(down.widthMm, 190);
  assert.ok(down.yMm > 100, "격자 아래로 내려가지 않았다");

  const right = memoBlockOnSheet(landscape, 30, 20, 0);
  assert.ok(right, "가로 용지에 자리가 없다");
  // 오른쪽을 쓰면 y 는 여백에서 시작하고 높이는 인쇄영역 전체다.
  assert.equal(right.yMm, 10);
  assert.equal(right.heightMm, 190);
  assert.ok(right.xMm > 150, "격자 오른쪽으로 밀리지 않았다");
});

test("메모 자리: 범례 띠 몫을 빼고 남은 자리를 센다", () => {
  const paper = { ...defaultPaper("a4"), orientation: "portrait", cellMm: 5, marginMm: 10 };

  const without = memoBlockOnSheet(paper, 30, 20, 0);
  const withBand = memoBlockOnSheet(paper, 30, 20, 6);
  assert.ok(without && withBand);

  // 범례가 아래를 차지하면 메모 자리는 그만큼 줄고 아래로 밀린다.
  assert.ok(withBand.yMm > without.yMm, "범례 띠를 지나치지 않았다");
  assert.ok(withBand.capacity < without.capacity, "범례가 자리를 먹지 않았다");
});

test("메모 자리: 격자가 용지를 꽉 채우면 자리가 없다", () => {
  const paper = { ...defaultPaper("a4"), orientation: "portrait", cellMm: 5, marginMm: 10 };
  // 38x55칸이 한 장 정원. 꽉 채우면 남는 곳이 없다.
  assert.equal(memoBlockOnSheet(paper, 38, 55, 0), null);
});

test("메모 나누기: 빈 곳에 채우고 넘치면 다음 장으로 이어 붙인다", () => {
  const paper = { ...defaultPaper("a4"), orientation: "landscape", cellMm: 5, marginMm: 10 };

  // 메모를 넉넉히 만들어 한 장에 못 담게 한다.
  const pairs = [];
  for (let i = 0; i < 120; i += 1) {
    pairs.push([(i % 30) + 1, Math.floor(i / 30) + 1, `점검 항목 ${i + 1} 확인 필요`]);
  }
  const { page } = pageWithMemos(pairs);
  const entries = collectMemos(page);
  assert.equal(entries.length, 120);

  const doc = { cols: 30, rows: 20 };
  const plan = planPrint(doc, paper, 0);
  const last = lastSheetGrid(doc, plan);

  const pages = planMemoPages("inline", entries, paper, last);
  assert.ok(pages.length >= 2, `이어붙임이 없다 (장 ${pages.length})`);

  // 첫 장은 도면과 같은 장, 나머지는 새 장.
  assert.equal(pages[0].onGridSheet, true);
  assert.equal(pages[0].gridSheetIndex, last.index);
  assert.ok(pages.slice(1).every((p) => !p.onGridSheet));

  // 모든 메모가 실려야 한다 — 하나도 잘리지 않는다.
  const carried = pages.flatMap((p) => p.entries.map((e) => e.no));
  assert.equal(carried.length, entries.length, "메모가 누락됐다");
  assert.deepEqual(
    [...carried].sort((a, b) => a - b),
    entries.map((e) => e.no),
  );
  // 번호 순서가 유지된다 — 뒤섞이면 도면의 번호를 찾을 수 없다.
  assert.deepEqual(carried, [...carried].sort((a, b) => a - b));
});

test("메모 나누기: 별지는 도면 장에 얹지 않는다", () => {
  const paper = { ...defaultPaper("a4"), orientation: "landscape", cellMm: 5, marginMm: 10 };
  const { page } = pageWithMemos([
    [1, 1, "첫째"],
    [2, 1, "둘째"],
  ]);
  const entries = collectMemos(page);

  const pages = planMemoPages("appendix", entries, paper, null);
  assert.ok(pages.length >= 1);
  assert.ok(
    pages.every((p) => !p.onGridSheet),
    "별지인데 도면 장에 얹었다",
  );

  const carried = pages.flatMap((p) => p.entries.map((e) => e.no));
  assert.deepEqual(carried, [1, 2]);
});

test("메모 나누기: 껐거나 메모가 없으면 장을 만들지 않는다", () => {
  const paper = defaultPaper("a4");
  const { page } = pageWithMemos([[1, 1, "하나"]]);
  const entries = collectMemos(page);

  assert.deepEqual(planMemoPages("off", entries, paper, null), []);
  assert.deepEqual(planMemoPages("inline", [], paper, null), []);
  assert.deepEqual(planMemoPages("appendix", [], paper, null), []);
});

test("메모 나누기: 한 열보다 긴 메모도 멈추지 않는다", () => {
  const paper = { ...defaultPaper("a4"), orientation: "landscape", cellMm: 5, marginMm: 10 };
  // 한 장을 넘길 만큼 긴 메모 하나. 무한 반복에 빠지면 이 테스트가 멈춘다.
  const long = "가".repeat(20000);
  const { page } = pageWithMemos([
    [1, 1, long],
    [2, 1, "뒤에 오는 짧은 메모"],
  ]);
  const entries = collectMemos(page);

  const pages = planMemoPages("appendix", entries, paper, null);
  const carried = pages.flatMap((p) => p.entries.map((e) => e.no));
  // 긴 메모가 뒤에 오는 메모를 삼키지 않는다.
  assert.ok(carried.includes(1), "긴 메모를 버렸다");
  assert.ok(carried.includes(2), "긴 메모 뒤의 메모를 잃었다");
});

test("메모 줄 수: 긴 본문과 줄바꿈을 셈에 넣는다", () => {
  const short = { no: 1, x: 1, y: 1, key: "1,1", memo: "짧다" };
  const long = { no: 2, x: 2, y: 1, key: "2,1", memo: "가".repeat(200) };
  const broken = { no: 3, x: 3, y: 1, key: "3,1", memo: "첫 줄\n둘째 줄\n셋째 줄" };

  const width = 60;
  assert.ok(memoLineCount(long, width) > memoLineCount(short, width), "긴 본문이 더 많은 줄을 쓰지 않는다");
  assert.ok(memoLineCount(broken, width) >= 4, "줄바꿈을 세지 않았다");

  // 장비 ID 가 붙으면 그만큼 길어진다.
  const labeled = { ...short, label: "C1101-A" };
  assert.ok(memoLineCount(labeled, 12) >= memoLineCount(short, 12));
});

/**
 * 메모 자리가 화면 캔버스 안에 들어가는지.
 *
 * 이 테스트가 잡은 버그: 인쇄영역이 칸으로 나누어떨어지지 않으면 자투리가 남는다
 * (A4 가로 277mm ÷ 5mm = 55.4칸). 인쇄물은 용지 픽셀로 그려 그 자투리까지 쓰지만
 * 화면 캔버스는 칸 단위라 55칸에서 끝난다 — mm 로 잡은 자리가 자투리를 넘으면
 * 화면에서만 잘려 보였다.
 */
test("메모 자리: 화면 캔버스 칸 안에 들어간다 (자투리를 넘지 않는다)", () => {
  const cases = [
    { orientation: "landscape", cellMm: 5, cols: 40, rows: 25 },
    { orientation: "portrait", cellMm: 5, cols: 30, rows: 20 },
    // 나누어떨어지지 않는 칸 크기 — 자투리가 크게 남는다.
    { orientation: "landscape", cellMm: 6, cols: 30, rows: 20 },
    { orientation: "landscape", cellMm: 7, cols: 20, rows: 15 },
    { orientation: "portrait", cellMm: 8, cols: 15, rows: 20 },
    { orientation: "portrait", cellMm: 3, cols: 50, rows: 60 },
  ];

  for (const item of cases) {
    const paper = {
      ...defaultPaper("a4"),
      orientation: item.orientation,
      cellMm: item.cellMm,
      marginMm: 10,
    };
    const doc = { cols: item.cols, rows: item.rows };

    const plan = planPrint(doc, paper, 0);
    const last = lastSheetGrid(doc, plan);
    const block = memoBlockOnSheet(paper, last.gridCols, last.gridRows, last.bandCells);
    if (!block) continue;

    // 화면 캔버스가 실제로 가진 칸 수.
    const per = sheetCells(paper);
    const canvas = canvasCells(doc, { cols: per.cols, rows: per.rows }, 0);

    // mm → 칸. 여백 안쪽에서 잰다(화면 원점이 거기다).
    const toCell = (mm) => (mm - paper.marginMm) / paper.cellMm;
    const rightCell = toCell(block.xMm + block.widthMm);
    const bottomCell = toCell(block.yMm + block.heightMm);

    const label = `${item.orientation} 칸${item.cellMm}mm ${item.cols}x${item.rows}`;
    assert.ok(
      rightCell <= canvas.cols + 1e-9,
      `${label}: 메모가 캔버스 오른쪽을 ${(rightCell - canvas.cols).toFixed(2)}칸 넘는다`,
    );
    assert.ok(
      bottomCell <= canvas.rows + 1e-9,
      `${label}: 메모가 캔버스 아래를 ${(bottomCell - canvas.rows).toFixed(2)}칸 넘는다`,
    );
  }
});

test("빈 장 자리: 인쇄영역을 칸 경계까지 쓴다", () => {
  const paper = { ...defaultPaper("a4"), orientation: "portrait", cellMm: 5, marginMm: 10 };
  const block = memoBlockOnBlankSheet(paper);

  assert.equal(block.xMm, 10);
  assert.equal(block.yMm, 10);
  // 190 · 277 모두 5mm 로 나누어떨어지므로 그대로다.
  assert.equal(block.widthMm, 190);
  assert.equal(block.heightMm, 275);
  assert.ok(block.columns >= 1);

  // 나누어떨어지지 않는 칸 크기에서는 자투리를 버린다.
  const odd = memoBlockOnBlankSheet({ ...paper, cellMm: 6 });
  assert.equal(odd.widthMm % 6, 0, "폭이 칸 경계에 맞지 않는다");
  assert.equal(odd.heightMm % 6, 0, "높이가 칸 경계에 맞지 않는다");
  assert.ok(odd.widthMm <= 190 && odd.heightMm <= 277);
});

test("설정 저장: 기본값(off)은 파일에 남기지 않는다", () => {
  assert.equal(sanitizeMemoMode(undefined), "off");
  assert.equal(sanitizeMemoMode("inline"), "inline");
  assert.equal(sanitizeMemoMode("appendix"), "appendix");
  assert.equal(sanitizeMemoMode("어디에"), "off");

  const base = { id: "a4", orientation: "portrait", cellMm: 5, marginMm: 10 };
  // 껐으면 필드가 생기지 않는다 — 예전 파일과 같은 모양.
  assert.equal("memoMode" in sanitizePaper(base), false);
  assert.equal("memoMode" in sanitizePaper({ ...base, memoMode: "off" }), false);
  // 켰으면 살아남는다.
  assert.equal(sanitizePaper({ ...base, memoMode: "inline" }).memoMode, "inline");
  assert.equal(sanitizePaper({ ...base, memoMode: "appendix" }).memoMode, "appendix");
  // 모르는 값은 버린다.
  assert.equal("memoMode" in sanitizePaper({ ...base, memoMode: 3 }), false);
});

/**
 * 화면 미리보기의 메모 자리가 인쇄물과 같은 곳인지 확인한다.
 *
 * 인쇄는 mm 를 DPI 로 바꾸고, 화면은 mm 를 칸 크기로 바꾼다 — 자를 두 번 재는
 * 셈이라 여백을 빼는 것을 잊으면 자리가 밀린다. 두 길의 결과를 같은 단위로
 * 되돌려 견줘 본다.
 */
test("메모 미리보기: 화면 자리가 인쇄물과 같은 곳을 가리킨다", () => {
  const paper = { ...defaultPaper("a4"), orientation: "landscape", cellMm: 5, marginMm: 10 };
  const doc = { cols: 30, rows: 20 };

  const plan = planPrint(doc, paper, 0);
  const last = lastSheetGrid(doc, plan);
  const block = memoBlockOnSheet(paper, last.gridCols, last.gridRows, last.bandCells);
  assert.ok(block, "빈 곳이 없다");

  // 화면: 한 칸 = cell px, 도면 원점은 여백 안쪽.
  const cell = 22;
  const screenLeft = ((block.xMm - paper.marginMm) / paper.cellMm) * cell;
  const screenTop = ((block.yMm - paper.marginMm) / paper.cellMm) * cell;

  // 인쇄: 한 칸 = cellPx, 용지 원점에서 여백만큼 안쪽.
  const printLeft = mmToPx(block.xMm, plan.dpi) - plan.marginPx;
  const printTop = mmToPx(block.yMm, plan.dpi) - plan.marginPx;

  // 둘을 "칸 몇 개 떨어진 자리" 로 되돌리면 같아야 한다.
  assert.ok(
    Math.abs(screenLeft / cell - printLeft / plan.cellPx) < 0.001,
    `가로 자리가 어긋난다 (화면 ${screenLeft / cell}칸, 인쇄 ${printLeft / plan.cellPx}칸)`,
  );
  assert.ok(
    Math.abs(screenTop / cell - printTop / plan.cellPx) < 0.001,
    `세로 자리가 어긋난다 (화면 ${screenTop / cell}칸, 인쇄 ${printTop / plan.cellPx}칸)`,
  );

  // 가로 용지이므로 메모는 격자 오른쪽에 온다 — 격자 폭(30칸)을 넘어야 한다.
  assert.ok(screenLeft / cell >= doc.cols, "메모가 격자와 겹친다");
});

test("메모 미리보기: 마지막 장 자리를 가리킨다", () => {
  const paper = { ...defaultPaper("a4"), orientation: "landscape", cellMm: 5, marginMm: 10 };
  // 한 장 정원(55x38)을 넘겨 두 장에 걸치게 한다.
  const doc = { cols: 80, rows: 20 };

  const plan = planPrint(doc, paper, 0);
  assert.ok(plan.total > 1, "여러 장에 걸치지 않는다");

  const last = lastSheetGrid(doc, plan);
  assert.equal(last.index, plan.total - 1);

  // 마지막 장에 실리는 격자는 남은 칸만큼이다 — 첫 장에서 55칸을 이미 썼다.
  assert.equal(last.gridCols, doc.cols - plan.sheet.cols);

  // 그 장의 좌상단 칸. 화면에서 메모를 이만큼 밀어 놓아야 한다.
  const originX = (last.index % plan.across) * plan.sheet.cols;
  assert.equal(originX, plan.sheet.cols);

  const block = memoBlockOnSheet(paper, last.gridCols, last.gridRows, last.bandCells);
  assert.ok(block, "마지막 장에 빈 곳이 없다");

  const cell = 22;
  const left = originX * cell + ((block.xMm - paper.marginMm) / paper.cellMm) * cell;
  // 메모는 마지막 장 안에 있어야 한다 — 첫 장으로 되돌아가면 안 된다.
  assert.ok(left / cell >= originX, "메모가 앞 장으로 넘어갔다");
  assert.ok(left / cell < originX + plan.sheet.cols, "메모가 장 밖으로 나갔다");
});
