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
  setLineStyle(project, "wirePurple", "dashed");
  page.equipment["1,1"] = { status: "installed", kind: "reader" };
  page.wiring["2,2"] = "wirePurple";

  const ctx = recordingContext();
  renderSheet(ctx, layout(project), CELL, VISIBLE, legendItemsForProject(project));

  // 상태 견본은 빗금으로 채운다.
  assert.ok(ctx.ops.some((op) => op.op === "clip"));
  assert.ok(ctx.ops.some((op) => op.op === "stroke" && op.color === "#57a639"));

  // 장비 견본은 점선 테두리로 그린다.
  const kindBox = ctx.ops.find((op) => op.op === "strokeRect" && op.color === "#0f766e");
  assert.ok(kindBox);
  assert.ok(kindBox.dash.length > 0);

  // 배선 견본은 칸을 채우지 않고 가로지르는 파선으로 그린다.
  const wireLine = ctx.ops.find((op) => op.op === "stroke" && op.color === "#7c3aed");
  assert.ok(wireLine, "배선 견본은 선으로 그린다");
  assert.ok(wireLine.dash.length > 0);
  assert.equal(wireLine.from.y, wireLine.to.y, "가로지르는 선이다");
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

test("배선 무늬: 배선은 무늬를 쓰지 않는다 — 저장 파일에 남아 있어도 무시한다", () => {
  const project = createProject("배선 무늬 무시");
  const page = project.pages[0];
  // 예전 판에서 저장된 무늬가 남아 있는 상황.
  setPattern(project, "wirePurple", "hatch");
  page.wiring["4,4"] = "wirePurple";
  page.wiring["5,4"] = "wirePurple";

  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell: CELL, visible: VISIBLE, showGrid: false });

  // 무늬 줄을 긋지 않고 예전처럼 띠로만 채운다.
  assert.equal(ctx.ops.filter((op) => op.op === "stroke" && op.color === "#7c3aed").length, 0);
  assert.ok(ctx.ops.some((op) => op.op === "fillRect" && op.color === "#7c3aed" && op.alpha === 1));
});

test("배선 무늬: 팔레트에 넣어도 저장되지 않는다", () => {
  const base = createProject("배선 무늬 저장").palette;
  const { created } = addPaletteEntry(base, "wire", {
    name: "새 배선",
    color: "#7c3aed",
    description: "",
    pattern: "hatch",
    lineStyle: "dashed",
  });
  assert.equal("pattern" in created, false, "배선에는 무늬를 남기지 않는다");
  assert.equal(created.lineStyle, "dashed");

  // 예전 파일에 남은 배선 무늬도 불러올 때 버린다.
  const palette = ensurePalette([
    { id: "w", name: "옛 배선", role: "wire", color: "#7c3aed", pattern: "dots", lineStyle: "dotted" },
  ]);
  const wire = palette.find((item) => item.id === "w");
  assert.equal(wire.pattern, undefined);
  assert.equal(wire.lineStyle, "dotted");
});

test("배선 점선: 이웃 칸과 위상이 이어지고 곧게 지나가는 칸은 매듭을 넣지 않는다", () => {
  const project = createProject("배선 점선");
  const page = project.pages[0];
  setLineStyle(project, "wirePurple", "dotted");
  // 가로로 곧게 이어지는 세 칸.
  page.wiring["3,4"] = "wirePurple";
  page.wiring["4,4"] = "wirePurple";
  page.wiring["5,4"] = "wirePurple";

  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell: CELL, visible: VISIBLE, showGrid: false });

  const strokes = ctx.ops.filter((op) => op.op === "stroke" && op.color === "#7c3aed");
  assert.ok(strokes.length > 0);
  // 언제나 왼쪽→오른쪽으로 긋고, dash 위상을 그 선의 절대 좌표에 맞춘다.
  assert.ok(strokes.every((op) => op.to.x >= op.from.x && op.to.y >= op.from.y));
  assert.ok(strokes.every((op) => op.dashOffset === op.from.x || op.dashOffset === op.from.y));

  // 가운데 칸(4,4)은 곧게 지나가므로 매듭을 채우지 않는다.
  const knots = ctx.ops.filter((op) => op.op === "fillRect" && op.color === "#7c3aed");
  const center = { x: 4 * CELL + CELL / 2, y: 4 * CELL + CELL / 2 };
  assert.equal(
    knots.filter((op) => Math.abs(op.x + op.w / 2 - center.x) < 0.01 && Math.abs(op.y + op.h / 2 - center.y) < 0.01)
      .length,
    0,
  );
  // 양 끝 칸은 끝맺음이므로 매듭이 있다.
  assert.ok(knots.length >= 2);
});

test("배선 점선: 모퉁이에는 매듭을 채워 끊겨 보이지 않게 한다", () => {
  const project = createProject("배선 모퉁이");
  const page = project.pages[0];
  setLineStyle(project, "wirePurple", "dashed");
  // (4,4) 에서 오른쪽과 아래로 꺾인다.
  page.wiring["4,4"] = "wirePurple";
  page.wiring["5,4"] = "wirePurple";
  page.wiring["4,5"] = "wirePurple";

  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell: CELL, visible: VISIBLE, showGrid: false });

  const center = { x: 4 * CELL + CELL / 2, y: 4 * CELL + CELL / 2 };
  const knot = ctx.ops.find(
    (op) =>
      op.op === "fillRect" &&
      op.color === "#7c3aed" &&
      Math.abs(op.x + op.w / 2 - center.x) < 0.01 &&
      Math.abs(op.y + op.h / 2 - center.y) < 0.01,
  );
  assert.ok(knot, "모퉁이 칸에는 매듭이 있어야 한다");
});

test("글자 시인성: 밝은 바탕이든 어두운 바탕이든 반대색 테두리를 두른다", () => {
  const project = createProject("글자 대비");
  const page = project.pages[0];
  // 밝은 노랑(미연결) 위에는 검은 글자 + 흰 테두리.
  page.equipment["1,1"] = { status: "unlinked", label: "C1" };
  // 어두운 파랑(기존 장비) 위에는 흰 글자 + 검은 테두리.
  page.equipment["3,1"] = { status: "existing", label: "C2" };

  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell: 32, visible: VISIBLE, showGrid: false });

  const halo = (text) => ctx.ops.find((op) => op.op === "strokeText" && op.text === text);
  assert.ok(halo("C1"), "글자마다 테두리를 먼저 그린다");
  assert.ok(halo("C1").color.includes("255, 255, 255"));
  assert.ok(halo("C2").color.includes("16, 20, 24"));
  assert.ok(halo("C1").lineWidth > 0);

  // 테두리를 그린 뒤에 글자를 채운다. 순서가 뒤집히면 글자가 가려진다.
  const strokeAt = ctx.ops.findIndex((op) => op.op === "strokeText" && op.text === "C1");
  const fillAt = ctx.ops.findIndex((op) => op.op === "fillText" && op.text === "C1");
  assert.ok(strokeAt < fillAt);
});

test("글자 시인성: 무늬 칸 위의 장비 이름에도 테두리가 붙는다", () => {
  const project = createProject("무늬 위 글자");
  const page = project.pages[0];
  setPattern(project, "installed", "crosshatch");
  page.equipment["2,2"] = { status: "installed", kind: "reader" };

  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell: 32, visible: VISIBLE, showGrid: false });

  assert.ok(ctx.ops.some((op) => op.op === "strokeText" && op.text === "리더"));
});
