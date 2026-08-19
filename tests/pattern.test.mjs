import assert from "node:assert/strict";
import test from "node:test";

import { createProject } from "../app/editor/doc.ts";
import { addPaletteEntry, ensurePalette, updatePaletteEntry } from "../app/editor/paletteOps.ts";
import {
  dashArray,
  fillCellPattern,
  FILL_PATTERNS,
  LINE_STYLES,
  patternCss,
  sanitizeLineStyle,
  sanitizePattern,
} from "../app/editor/pattern.ts";
import { renderDoc, renderSheet } from "../app/editor/render.ts";
import { legendItemsForProject } from "../app/editor/paletteOps.ts";
import { sanitizeProject } from "../app/editor/storage.ts";
import { recordingContext, VISIBLE } from "./recording-context.mjs";

const CELL = 20;

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

function setPattern(project, id, pattern) {
  project.palette = project.palette.map((item) => (item.id === id ? { ...item, pattern } : item));
}

function setLineStyle(project, id, lineStyle) {
  project.palette = project.palette.map((item) => (item.id === id ? { ...item, lineStyle } : item));
}

test("dash 배열: 실선은 비어 있고 점선·파선은 선 굵기에 따라 늘어난다", () => {
  assert.deepEqual(dashArray(undefined, 2), []);
  assert.deepEqual(dashArray("solid", 2), []);

  const dotted = dashArray("dotted", 2);
  const dashed = dashArray("dashed", 2);
  assert.equal(dotted.length, 2);
  assert.equal(dashed.length, 2);
  // 파선이 점선보다 길어야 눈으로 구분된다.
  assert.ok(dashed[0] > dotted[0]);
  // 굵은 선일수록 간격도 커진다.
  assert.ok(dashArray("dashed", 6)[0] > dashed[0]);
});

test("무늬·선 모양 검사: 모르는 값은 받지 않는다", () => {
  assert.equal(sanitizePattern("hatch"), "hatch");
  assert.equal(sanitizePattern("crosshatch"), "crosshatch");
  assert.equal(sanitizePattern("무늬없음"), null);
  assert.equal(sanitizePattern(3), null);

  assert.equal(sanitizeLineStyle("dashed"), "dashed");
  assert.equal(sanitizeLineStyle("wavy"), null);
});

test("솔리드 채움: 예전과 똑같이 fillRect 한 번이다", () => {
  const ctx = recordingContext();
  fillCellPattern(ctx, 0, 0, CELL, "#57a639", "solid");

  assert.deepEqual(ctx.ops, [
    { op: "fillRect", color: "#57a639", alpha: 1, x: 0, y: 0, w: CELL, h: CELL },
  ]);
});

test("빗금 채움: 옅은 바탕 위에 대각선을 긋고 칸 밖으로 넘치지 않게 자른다", () => {
  const ctx = recordingContext();
  fillCellPattern(ctx, 0, 0, CELL, "#e33a2e", "hatch");

  const tint = ctx.ops.find((op) => op.op === "fillRect");
  assert.equal(tint.color, "#e33a2e");
  assert.ok(tint.alpha < 1, "바탕은 옅게 깔려야 한다");

  // 이웃 칸을 침범하지 않도록 칸 크기로 clip 한다.
  assert.ok(ctx.ops.some((op) => op.op === "rect" && op.w === CELL && op.h === CELL));
  assert.ok(ctx.ops.some((op) => op.op === "clip"));

  const strokes = ctx.ops.filter((op) => op.op === "stroke");
  assert.ok(strokes.length >= 3, "빗금 줄이 여러 개 그어져야 한다");
  assert.ok(strokes.every((op) => op.color === "#e33a2e"));
  // 오른쪽 아래로 내려가는 방향 하나만 쓴다.
  assert.ok(strokes.every((op) => op.to.x > op.from.x));
});

test("역빗금·교차빗금: 방향이 반대이고, 교차빗금은 둘을 겹친다", () => {
  const reverse = recordingContext();
  fillCellPattern(reverse, 0, 0, CELL, "#1f6fb2", "hatchReverse");
  const reverseStrokes = reverse.ops.filter((op) => op.op === "stroke");
  assert.ok(reverseStrokes.length > 0);
  assert.ok(reverseStrokes.every((op) => op.to.x < op.from.x));

  const cross = recordingContext();
  fillCellPattern(cross, 0, 0, CELL, "#1f6fb2", "crosshatch");
  const crossStrokes = cross.ops.filter((op) => op.op === "stroke");
  assert.equal(crossStrokes.length, reverseStrokes.length * 2);
  assert.ok(crossStrokes.some((op) => op.to.x > op.from.x));
  assert.ok(crossStrokes.some((op) => op.to.x < op.from.x));
});

test("점 채움: 칸 안에 점을 격자로 찍는다", () => {
  const ctx = recordingContext();
  fillCellPattern(ctx, 0, 0, CELL, "#7e22ce", "dots");

  const dots = ctx.ops.filter((op) => op.op === "fillRect" && op.w < CELL);
  assert.ok(dots.length >= 4, "점이 여러 개 찍혀야 한다");
  assert.ok(dots.every((op) => op.x >= -1 && op.y >= -1 && op.x < CELL && op.y < CELL));
});

test("도면 렌더: 상태·배경 칸에 무늬가 적용된다", () => {
  const project = createProject("무늬 렌더");
  const page = project.pages[0];
  setPattern(project, "installed", "crosshatch");
  page.equipment["1,1"] = { status: "installed" };
  page.background["3,3"] = "wall";

  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell: CELL, visible: VISIBLE, showGrid: false });

  const strokes = ctx.ops.filter((op) => op.op === "stroke" && op.color === "#57a639");
  assert.ok(strokes.length > 0, "교차빗금이 그어져야 한다");

  // 무늬를 주지 않은 배경 타일은 통 채움 그대로다.
  assert.ok(
    ctx.ops.some((op) => op.op === "fillRect" && op.color === "#9aa3ad" && op.w === CELL && op.alpha === 1),
  );
});

test("도면 렌더: 장비 테두리와 배선이 선 모양을 따른다", () => {
  const project = createProject("선 모양 렌더");
  const page = project.pages[0];
  setLineStyle(project, "reader", "dashed");
  setLineStyle(project, "wirePurple", "dotted");
  page.equipment["2,2"] = { kind: "reader" };
  page.wiring["4,4"] = "wirePurple";
  page.wiring["5,4"] = "wirePurple";

  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell: CELL, visible: VISIBLE, showGrid: false });

  const border = ctx.ops.find((op) => op.op === "strokeRect" && op.color === "#0f766e");
  assert.ok(border, "장비 테두리를 그려야 한다");
  assert.ok(border.dash.length > 0, "파선 장비는 dash 가 걸려야 한다");

  const wire = ctx.ops.filter((op) => op.op === "stroke" && op.color === "#7c3aed");
  assert.ok(wire.length > 0, "점선 배선은 선으로 그린다");
  assert.ok(wire.every((op) => op.dash.length > 0));
});

test("도면 렌더: 실선 배선은 예전처럼 채운 띠로 그린다", () => {
  const project = createProject("실선 배선");
  const page = project.pages[0];
  page.wiring["4,4"] = "wirePurple";
  page.wiring["5,4"] = "wirePurple";

  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell: CELL, visible: VISIBLE, showGrid: false });

  assert.ok(ctx.ops.some((op) => op.op === "fillRect" && op.color === "#7c3aed"));
  assert.equal(
    ctx.ops.filter((op) => op.op === "stroke" && op.color === "#7c3aed").length,
    0,
    "실선은 선을 긋지 않는다",
  );
});

test("PNG 범례: 견본이 도면과 같은 무늬·선 모양으로 그려진다", () => {
  const project = createProject("범례 무늬");
  const page = project.pages[0];
  setPattern(project, "installed", "hatch");
  setLineStyle(project, "reader", "dotted");
  page.equipment["1,1"] = { status: "installed", kind: "reader" };

  const ctx = recordingContext();
  renderSheet(ctx, layout(project), CELL, VISIBLE, legendItemsForProject(project));

  // 상태 견본은 빗금으로 채운다.
  assert.ok(ctx.ops.some((op) => op.op === "clip"));
  assert.ok(ctx.ops.some((op) => op.op === "stroke" && op.color === "#57a639"));

  // 장비 견본은 점선 테두리로 그린다.
  const kindBox = ctx.ops.find((op) => op.op === "strokeRect" && op.color === "#0f766e");
  assert.ok(kindBox);
  assert.ok(kindBox.dash.length > 0);
});

test("팔레트 편집: 무늬·선 모양을 저장하고 기본값은 남기지 않는다", () => {
  const base = createProject("무늬 저장").palette;

  const { created } = addPaletteEntry(base, "status", {
    name: "교체 예정",
    color: "#ff66aa",
    description: "",
    pattern: "hatch",
  });
  assert.equal(created.pattern, "hatch");
  assert.equal(created.lineStyle, undefined);

  const solid = addPaletteEntry(base, "status", {
    name: "그냥 색",
    color: "#123456",
    description: "",
    pattern: "solid",
  }).created;
  // 기본값은 파일에 남기지 않아 예전 문서와 모양이 같다.
  assert.equal("pattern" in solid, false);

  const updated = updatePaletteEntry([created], created.id, {
    name: created.name,
    color: "#ff66aa",
    description: "",
    pattern: "solid",
  });
  assert.equal("pattern" in updated[0], false, "솔리드로 되돌리면 값이 지워진다");
});

test("불러오기: 아는 무늬·선 모양만 살리고 모르는 값은 버린다", () => {
  const palette = ensurePalette([
    { id: "a", name: "빗금 상태", role: "status", color: "#e33a2e", pattern: "hatch" },
    { id: "b", name: "이상한 무늬", role: "status", color: "#e33a2e", pattern: "zigzag" },
    { id: "c", name: "점선 배선", role: "wire", color: "#7c3aed", lineStyle: "dotted" },
  ]);

  const byId = Object.fromEntries(palette.map((item) => [item.id, item]));
  assert.equal(byId.a.pattern, "hatch");
  assert.equal(byId.b.pattern, undefined);
  assert.equal(byId.c.lineStyle, "dotted");
});

test("JSON 왕복: 무늬·선 모양이 저장되고 그대로 돌아온다", () => {
  const project = createProject("왕복");
  setPattern(project, "installed", "dots");
  setLineStyle(project, "wirePurple", "dashed");

  const restored = sanitizeProject(JSON.parse(JSON.stringify(project)));
  const byId = Object.fromEntries(restored.palette.map((item) => [item.id, item]));
  assert.equal(byId.installed.pattern, "dots");
  assert.equal(byId.wirePurple.lineStyle, "dashed");
});

test("CSS 견본: 무늬마다 다른 배경을 만들고 솔리드는 단색이다", () => {
  assert.deepEqual(patternCss("#57a639", "solid"), { background: "#57a639" });
  assert.deepEqual(patternCss("#57a639", undefined), { background: "#57a639" });

  const hatch = patternCss("#57a639", "hatch");
  const reverse = patternCss("#57a639", "hatchReverse");
  const cross = patternCss("#57a639", "crosshatch");
  const dots = patternCss("#57a639", "dots");

  assert.notEqual(hatch.backgroundImage, reverse.backgroundImage);
  assert.ok(cross.backgroundImage.includes("45deg") && cross.backgroundImage.includes("-45deg"));
  assert.ok(dots.backgroundImage.includes("radial-gradient"));
});

test("선택 목록: 무늬 5종과 선 모양 3종을 모두 고를 수 있다", () => {
  assert.deepEqual(
    FILL_PATTERNS.map((item) => item.id),
    ["solid", "hatch", "hatchReverse", "crosshatch", "dots"],
  );
  assert.deepEqual(
    LINE_STYLES.map((item) => item.id),
    ["solid", "dotted", "dashed"],
  );
  assert.ok(FILL_PATTERNS.every((item) => item.name.length > 0));
  assert.ok(LINE_STYLES.every((item) => item.name.length > 0));
});
