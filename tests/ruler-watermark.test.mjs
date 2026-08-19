import assert from "node:assert/strict";
import test from "node:test";

import { createProject } from "../app/editor/doc.ts";
import { legendItemsForPage } from "../app/editor/paletteOps.ts";
import { planPrint, renderPrintSheet } from "../app/editor/printSheet.ts";
import { renderSheet } from "../app/editor/render.ts";
import { drawRuler, RULER_THICKNESS, rulerTicks, tickStep } from "../app/editor/rulerRender.ts";
import { watermarkText } from "../app/editor/watermark.ts";
import { recordingContext, VISIBLE } from "./recording-context.mjs";

function layout(project) {
  const page = project.pages[0];
  return {
    version: project.version,
    title: project.title,
    cols: page.cols,
    rows: page.rows,
    background: page.background,
    equipment: page.equipment,
    wiring: page.wiring,
    palette: project.palette,
  };
}

const PRINTED_AT = new Date(2026, 7, 19, 14, 5);

// ── 눈금자 ──────────────────────────────────────────────────────────

test("눈금 간격: 칸이 좁을수록 숫자를 드물게 찍는다", () => {
  // 숫자가 겹치지 않도록 간격 × 칸 크기가 18px 이상이어야 한다.
  for (const cell of [14, 18, 22, 26, 32]) {
    const step = tickStep(cell);
    assert.ok(cell * step >= 18, `${cell}px 에서 ${step}칸 간격은 너무 촘촘하다`);
  }
  assert.ok(tickStep(14) >= tickStep(32), "칸이 좁으면 간격이 더 넓어야 한다");
});

test("눈금 목록: 0부터 시작하고 간격마다 숫자를 붙인다", () => {
  const ticks = rulerTicks(20, 22);
  const labeled = ticks.filter((tick) => tick.labeled).map((tick) => tick.index);

  assert.equal(ticks[0].index, 0);
  assert.equal(ticks[0].offset, 0);
  assert.deepEqual(labeled, [0, 5, 10, 15]);
  // 위치는 칸 시작점이다.
  assert.equal(ticks.find((tick) => tick.index === 5).offset, 5 * 22);
});

test("눈금 목록: 칸이 아주 좁으면 짧은 금은 생략한다", () => {
  const dense = rulerTicks(60, 8);
  assert.ok(dense.every((tick) => tick.labeled), "8px 칸에서는 숫자 자리만 남긴다");
  assert.ok(dense.length < 60);
});

test("눈금자 그리기: 바탕 · 금 · 숫자를 찍고 커서 칸을 밝게 칠한다", () => {
  const ctx = recordingContext();
  drawRuler(ctx, { count: 20, cell: 22, orientation: "horizontal", highlight: 3 });

  const background = ctx.ops[0];
  assert.equal(background.op, "fillRect");
  assert.equal(background.w, 20 * 22);
  assert.equal(background.h, RULER_THICKNESS);

  // 커서가 놓인 칸(3)만 한 칸 너비로 덧칠한다.
  const highlight = ctx.ops.find((op) => op.op === "fillRect" && op.w === 22 && op.x === 3 * 22);
  assert.ok(highlight, "커서 칸 강조가 없다");

  const numbers = ctx.ops.filter((op) => op.op === "fillText").map((op) => op.text);
  assert.deepEqual(numbers, ["0", "5", "10", "15"]);
  assert.ok(ctx.ops.some((op) => op.op === "stroke"), "눈금 금을 그어야 한다");
});

test("눈금자 그리기: 세로 눈금자는 방향만 바뀐다", () => {
  const ctx = recordingContext();
  drawRuler(ctx, { count: 20, cell: 22, orientation: "vertical", highlight: null });

  const background = ctx.ops[0];
  assert.equal(background.w, RULER_THICKNESS);
  assert.equal(background.h, 20 * 22);

  // 강조를 주지 않으면 덧칠이 없다.
  assert.equal(ctx.ops.filter((op) => op.op === "fillRect").length, 1);

  const lines = ctx.ops.filter((op) => op.op === "stroke");
  assert.ok(lines.every((op) => op.from.y === op.to.y || op.from.x === op.to.x));
});

test("눈금자 그리기: 격자 밖 강조 값은 무시한다", () => {
  const ctx = recordingContext();
  drawRuler(ctx, { count: 10, cell: 22, orientation: "horizontal", highlight: 99 });
  assert.equal(ctx.ops.filter((op) => op.op === "fillRect").length, 1);
});

// ── 워터마크 ────────────────────────────────────────────────────────

test("워터마크: 제목 · 리비전 · 시각 · 작성자를 한 줄로 잇는다", () => {
  const text = watermarkText({
    title: "1공장 배치도",
    revision: 7,
    printedAt: PRINTED_AT,
    author: "홍길동",
  });
  assert.equal(text, "1공장 배치도 · r7 · 2026-08-19 14:05 · 작성자: 홍길동");
});

test("워터마크: 없는 값은 자리를 비우지 않고 빼 버린다", () => {
  assert.equal(watermarkText({ title: "제목만" }), "제목만");
  assert.equal(watermarkText({ title: "제목", revision: 0, author: "  " }), "제목");
  assert.equal(watermarkText({}), "");
});

test("워터마크: 여러 장이면 몇 번째 장인지 함께 적는다", () => {
  const text = watermarkText({
    title: "도면",
    sheet: { index: 2, total: 8, col: 3, row: 1 },
  });
  assert.equal(text, "도면 · 3/8 (가로 3 · 세로 1)");

  // 한 장이면 쪽 번호를 넣지 않는다.
  assert.equal(watermarkText({ title: "도면", sheet: { index: 0, total: 1, col: 1, row: 1 } }), "도면");
});

test("PNG(용지 규격): 아래 여백에 워터마크를 찍는다", () => {
  const project = createProject("워터마크 용지");
  const page = project.pages[0];
  page.cols = 30;
  page.rows = 20;
  const paper = { id: "a4", orientation: "landscape", cellMm: 5, marginMm: 10 };
  const doc = layout(project);
  const plan = planPrint(page, paper, 0);

  const ctx = recordingContext();
  renderPrintSheet(ctx, doc, plan, 0, VISIBLE, [], {
    title: project.title,
    revision: 4,
    printedAt: PRINTED_AT,
    author: "김철수",
  });

  const footer = ctx.ops.find((op) => op.op === "fillText" && op.text.includes("작성자: 김철수"));
  assert.ok(footer, "워터마크가 없다");
  assert.match(footer.text, /워터마크 용지 · r4 · 2026-08-19 14:05/);
  assert.ok(footer.y > plan.pageHeight - plan.marginPx, "아래 여백에 놓인다");
});

test("PNG(격자 크기): 아래에 워터마크를 찍고, 줄 내용이 없으면 찍지 않는다", () => {
  const project = createProject("워터마크 기본");
  const page = project.pages[0];
  page.equipment["1,1"] = { status: "installed" };
  const doc = layout(project);
  const legend = legendItemsForPage(project.palette, page);

  const withMeta = recordingContext();
  renderSheet(withMeta, doc, 20, VISIBLE, legend, {
    title: project.title,
    revision: 2,
    printedAt: PRINTED_AT,
    author: "가",
  });
  assert.ok(
    withMeta.ops.some((op) => op.op === "fillText" && op.text.includes("r2") && op.text.includes("작성자: 가")),
  );

  // meta 를 주지 않으면 제목만 남는다(제목은 도면에서 가져온다).
  const bare = recordingContext();
  renderSheet(bare, doc, 20, VISIBLE, legend);
  const footers = bare.ops.filter((op) => op.op === "fillText" && op.text.includes("작성자"));
  assert.equal(footers.length, 0);
});
