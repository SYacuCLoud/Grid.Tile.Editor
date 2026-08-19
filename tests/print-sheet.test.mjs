import assert from "node:assert/strict";
import test from "node:test";

import { createProject } from "../app/editor/doc.ts";
import { defaultPaper, legendBandCells, sheetCells, sheetCount } from "../app/editor/paper.ts";
import { legendItemsForProject } from "../app/editor/paletteOps.ts";
import {
  DEFAULT_PRINT_DPI,
  MM_PER_INCH,
  mmToPx,
  planPrint,
  printSheetSuffix,
  renderPrintSheet,
} from "../app/editor/printSheet.ts";
import { recordingContext, VISIBLE } from "./recording-context.mjs";

/** 활성 페이지를 렌더러가 쓰는 단일 문서 모양으로 만든다. */
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

const A4_PORTRAIT = { ...defaultPaper("a4"), orientation: "portrait", cellMm: 5, marginMm: 10 };

test("mm→px: DPI 를 그대로 따른다", () => {
  assert.equal(mmToPx(MM_PER_INCH, 150), 150);
  assert.equal(Math.round(mmToPx(210, 150)), 1240);
  assert.equal(Math.round(mmToPx(297, 150)), 1754);
});

test("계획: 이미지 크기가 용지 크기(mm)와 정확히 맞는다", () => {
  const project = createProject("용지 일치");
  const plan = planPrint(layout(project), A4_PORTRAIT, 0, 150);

  // A4 세로 210 × 297mm @150dpi
  assert.equal(plan.pageWidth, 1240);
  assert.equal(plan.pageHeight, 1754);
  assert.equal(plan.dpi, 150);

  // 한 칸 5mm, 여백 10mm 도 같은 자로 잰다.
  assert.ok(Math.abs(plan.cellPx - mmToPx(5, 150)) < 1e-9);
  assert.ok(Math.abs(plan.marginPx - mmToPx(10, 150)) < 1e-9);
});

test("계획: 방향과 용지를 바꾸면 이미지 크기도 따라 바뀐다", () => {
  const doc = layout(createProject("방향"));

  const portrait = planPrint(doc, A4_PORTRAIT, 0);
  const landscape = planPrint(doc, { ...A4_PORTRAIT, orientation: "landscape" }, 0);
  assert.equal(portrait.pageWidth, landscape.pageHeight);
  assert.equal(portrait.pageHeight, landscape.pageWidth);

  const a3 = planPrint(doc, { ...A4_PORTRAIT, id: "a3" }, 0);
  assert.ok(a3.pageWidth > portrait.pageWidth);
  assert.ok(a3.pageHeight > portrait.pageHeight);
});

test("계획: 장수와 장당 칸 수가 화면 경계선 계산과 같다", () => {
  const project = createProject("장수 일치");
  project.pages[0].cols = 120;
  project.pages[0].rows = 80;
  const legend = legendItemsForProject(project);

  const plan = planPrint(layout(project), A4_PORTRAIT, legend.length);
  const expected = sheetCount(A4_PORTRAIT, 120, 80, legend.length);

  assert.deepEqual(plan.sheet, sheetCells(A4_PORTRAIT));
  assert.equal(plan.across, expected.across);
  assert.equal(plan.down, expected.down);
  assert.equal(plan.total, expected.total);
  assert.equal(plan.bandCells, legendBandCells(A4_PORTRAIT, legend.length));
});

test("계획: DPI 는 범위 안으로 다듬고 기본값은 150 이다", () => {
  const doc = layout(createProject("dpi"));
  assert.equal(planPrint(doc, A4_PORTRAIT, 0).dpi, DEFAULT_PRINT_DPI);
  assert.equal(planPrint(doc, A4_PORTRAIT, 0, 10).dpi, 72);
  assert.equal(planPrint(doc, A4_PORTRAIT, 0, 9999).dpi, 600);

  // DPI 를 올리면 이미지가 커지고 용지 비율은 그대로다.
  const low = planPrint(doc, A4_PORTRAIT, 0, 150);
  const high = planPrint(doc, A4_PORTRAIT, 0, 300);
  assert.equal(high.pageWidth, low.pageWidth * 2);
  assert.ok(Math.abs(high.pageWidth / high.pageHeight - low.pageWidth / low.pageHeight) < 0.001);
});

test("렌더: 종이 전체를 흰색으로 깔고 인쇄 영역만 남기고 자른다", () => {
  const project = createProject("한 장");
  const doc = layout(project);
  const plan = planPrint(doc, A4_PORTRAIT, 0);

  const ctx = recordingContext();
  renderPrintSheet(ctx, doc, plan, 0, VISIBLE, []);

  const page = ctx.ops[0];
  assert.deepEqual(
    { op: page.op, color: page.color, x: page.x, y: page.y, w: page.w, h: page.h },
    { op: "fillRect", color: "#ffffff", x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight },
  );

  const clipRect = ctx.ops.find((op) => op.op === "rect");
  assert.ok(clipRect, "인쇄 영역으로 잘라야 한다");
  assert.ok(Math.abs(clipRect.x - plan.marginPx) < 1e-9);
  assert.ok(Math.abs(clipRect.w - (plan.pageWidth - plan.marginPx * 2)) < 1e-9);
  assert.ok(ctx.ops.some((op) => op.op === "clip"));
});

test("렌더: 한 칸이 인쇄물에서 정확히 지정한 mm 로 그려진다", () => {
  const project = createProject("칸 크기");
  project.pages[0].background["0,0"] = "wall";
  const doc = layout(project);
  const plan = planPrint(doc, A4_PORTRAIT, 0);

  const ctx = recordingContext();
  renderPrintSheet(ctx, doc, plan, 0, VISIBLE, []);

  const tile = ctx.ops.find((op) => op.op === "fillRect" && op.color === "#9aa3ad");
  assert.ok(tile);
  assert.ok(Math.abs(tile.w - mmToPx(5, plan.dpi)) < 1e-9, "칸 너비가 5mm 여야 한다");
  assert.ok(Math.abs(tile.h - mmToPx(5, plan.dpi)) < 1e-9);
});

test("렌더: 인쇄 경계선(자홍색 점선)은 인쇄물에 들어가지 않는다", () => {
  const project = createProject("경계선 제외");
  project.pages[0].cols = 120;
  project.pages[0].rows = 80;
  const doc = layout(project);
  const plan = planPrint(doc, A4_PORTRAIT, 0);

  const ctx = recordingContext();
  renderPrintSheet(ctx, doc, plan, 0, VISIBLE, []);

  assert.equal(
    ctx.ops.filter((op) => op.color === "#c026d3").length,
    0,
    "경계선은 화면 안내 전용이다",
  );
});

test("렌더: 장마다 도면의 다른 조각이 인쇄 영역 왼쪽 위에 온다", () => {
  const project = createProject("여러 장");
  const page = project.pages[0];
  page.cols = 120;
  page.rows = 80;

  const plan = planPrint(layout(project), A4_PORTRAIT, 0);
  assert.ok(plan.total > 1, "이 격자는 여러 장에 걸쳐야 한다");

  // 두 번째 장이 맡는 첫 칸을 칠해 두고, 그 칸이 인쇄 영역 왼쪽 위에 오는지 본다.
  page.background[`${plan.sheet.cols},0`] = "wall";
  const doc = layout(project);

  const second = recordingContext();
  renderPrintSheet(second, doc, plan, 1, VISIBLE, []);
  const tile = second.ops.find((op) => op.op === "fillRect" && op.color === "#9aa3ad");
  assert.ok(tile, "두 번째 장에 그 칸이 있어야 한다");
  // 그리기 좌표는 밀어 둔 상태이므로, 인쇄 영역 원점에 맞춰 다시 더해 본다.
  const offsetX = plan.marginPx - plan.sheet.cols * plan.cellPx;
  assert.ok(Math.abs(tile.x + offsetX - plan.marginPx) < 1e-6);
});

test("렌더: 범례 띠가 도면 아래에 함께 실린다", () => {
  const project = createProject("범례 포함");
  const page = project.pages[0];
  page.equipment["1,1"] = { status: "installed" };
  const legend = legendItemsForProject(project);
  const doc = layout(project);
  const plan = planPrint(doc, A4_PORTRAIT, legend.length);

  assert.ok(plan.bandCells > 0);

  const ctx = recordingContext();
  renderPrintSheet(ctx, doc, plan, 0, VISIBLE, legend);

  const names = legend.map((item) => item.name);
  const printed = ctx.ops.filter((op) => op.op === "fillText").map((op) => op.text);
  assert.ok(names.some((name) => printed.includes(name)), "범례 이름이 찍혀야 한다");
});

test("렌더: 여백이 넉넉하면 쪽 번호가 여백 안에 찍힌다", () => {
  const project = createProject("쪽 번호");
  project.pages[0].cols = 120;
  project.pages[0].rows = 80;
  const doc = layout(project);
  const plan = planPrint(doc, A4_PORTRAIT, 0);

  const ctx = recordingContext();
  renderPrintSheet(ctx, doc, plan, 2, VISIBLE, []);

  const footer = ctx.ops.find((op) => op.op === "fillText" && op.text.includes(`3/${plan.total}`));
  assert.ok(footer, "몇 번째 장인지 적어야 한다");
  assert.ok(footer.text.startsWith("쪽 번호"), "제목도 함께 적는다");
  assert.ok(footer.y > plan.pageHeight - plan.marginPx, "쪽 번호는 아래 여백에 놓인다");

  // 여백이 좁으면 넣을 자리가 없으므로 넣지 않는다.
  const tight = planPrint(doc, { ...A4_PORTRAIT, marginMm: 2 }, 0);
  const tightCtx = recordingContext();
  renderPrintSheet(tightCtx, doc, tight, 0, VISIBLE, []);
  assert.equal(tightCtx.ops.filter((op) => op.op === "fillText").length, 0);
});

test("렌더: 범위 밖 index 는 있는 장으로 맞춘다", () => {
  const doc = layout(createProject("범위"));
  const plan = planPrint(doc, A4_PORTRAIT, 0);
  const ctx = recordingContext();
  assert.doesNotThrow(() => renderPrintSheet(ctx, doc, plan, 99, VISIBLE, []));
});

test("파일 이름 꼬리: 용지·방향·DPI 와 몇 번째 장인지 남긴다", () => {
  const doc = layout(createProject("이름"));
  // 30 × 30 은 A4 세로(한 장 38 × 55칸)에 한 장으로 들어간다.
  const single = planPrint({ ...doc, cols: 30, rows: 30 }, A4_PORTRAIT, 0);
  assert.equal(single.total, 1);
  assert.equal(printSheetSuffix(single, 0), "A4-세로-150dpi");

  const wide = { ...A4_PORTRAIT, orientation: "landscape", cellMm: 1 };
  const many = planPrint({ cols: 200, rows: 200 }, wide, 0, 300);
  assert.ok(many.total > 1);
  assert.match(printSheetSuffix(many, 0), /^A4-가로-300dpi-1of\d+$/);
});
