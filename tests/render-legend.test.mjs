import assert from "node:assert/strict";
import test from "node:test";
import { createProject } from "../app/editor/doc.ts";
import { renderDoc, renderSheet } from "../app/editor/render.ts";
import { legendItemsForProject } from "../app/editor/paletteOps.ts";
import { recordingContext, VISIBLE } from "./recording-context.mjs";


test("PNG 범례: 장비는 테두리, 상태·배선은 채움으로 그린다", () => {
  const project = createProject("범례 렌더");
  const page = project.pages[0];

  // 상태 + 장비를 한 칸에 올린다. 도면에서 상태는 채움, 장비는 테두리다.
  page.equipment["1,1"] = { status: "installed", kind: "reader" };
  page.wiring["2,2"] = "wirePurple";

  const doc = { ...page, palette: project.palette, version: 2, title: project.title };
  const legend = legendItemsForProject(project);

  const kind = project.palette.find((i) => i.id === "reader");
  const status = project.palette.find((i) => i.id === "installed");
  const wire = project.palette.find((i) => i.id === "wirePurple");

  // 범례에 세 항목이 모두 들어 있어야 비교가 성립한다.
  for (const item of [kind, status, wire]) {
    assert.ok(legend.some((i) => i.id === item.id), `범례에 ${item.name} 이 없다`);
  }

  const ctx = recordingContext();
  renderSheet(ctx, doc, 22, VISIBLE, legend);

  // 장비 색으로 칸을 채운 적이 없어야 한다. (사용자가 PNG 에서 본 증상)
  const kindFills = ctx.ops.filter((o) => o.op === "fillRect" && o.color === kind.color);
  assert.equal(kindFills.length, 0, `장비 색(${kind.color})으로 채운 사각형이 ${kindFills.length}개 있다`);

  // 대신 장비 색은 테두리로만 나온다 — 범례 견본 + 도면 칸.
  const kindStrokes = ctx.ops.filter((o) => o.op === "strokeRect" && o.color === kind.color);
  assert.ok(kindStrokes.length >= 2, `장비 테두리가 ${kindStrokes.length}개뿐이다 (범례 + 칸 = 2 이상 기대)`);
  assert.ok(kindStrokes.every((o) => o.lineWidth === 2));

  // 상태·배선은 반대로 채움으로 나온다.
  assert.ok(ctx.ops.some((o) => o.op === "fillRect" && o.color === status.color), "상태 채움이 없다");
  assert.ok(ctx.ops.some((o) => o.op === "fillRect" && o.color === wire.color), "배선 채움이 없다");
});

test("PNG 범례: 사용자가 추가한 장비도 테두리로 그린다", () => {
  const project = createProject("사용자 장비");
  const custom = {
    id: "kind-세척기",
    name: "세척기",
    layer: "equipment",
    role: "kind",
    // 기본 상태색과 겹치지 않는 색을 골라 이 장비가 만든 그리기만 세도록 한다.
    color: "#0ea5e9",
    glyph: "세척기",
  };
  project.palette.push(custom);
  project.pages[0].equipment["3,3"] = { kind: custom.id };

  const page = project.pages[0];
  const doc = { ...page, palette: project.palette, version: 2, title: project.title };

  const ctx = recordingContext();
  renderSheet(ctx, doc, 22, VISIBLE, legendItemsForProject(project));

  // 장비이므로 채우면 안 된다.
  const fills = ctx.ops.filter((o) => o.op === "fillRect" && o.color === custom.color);
  assert.equal(fills.length, 0, "사용자 장비 색으로 채운 사각형이 있다");
  assert.ok(ctx.ops.some((o) => o.op === "strokeRect" && o.color === custom.color));
});

test("PNG 범례: 디스플레이 이름과 설명을 함께 찍는다", () => {
  const project = createProject("설명 범례");
  const page = project.pages[0];
  page.equipment["1,1"] = { status: "installed", kind: "reader" };

  const doc = { ...page, palette: project.palette, version: 2, title: project.title };
  const ctx = recordingContext();
  renderSheet(ctx, doc, 22, VISIBLE, legendItemsForProject(project));

  const texts = ctx.ops.filter((o) => o.op === "fillText").map((o) => o.text);

  // 기본 항목의 디스플레이 이름과 설명이 모두 나온다.
  assert.ok(texts.includes("설치 (정상)"), "상태 디스플레이 이름이 없다");
  assert.ok(texts.includes(" — 설치 완료 · 통신 정상"), "상태 설명이 없다");
  assert.ok(texts.includes("리더"), "장비 디스플레이 이름이 없다");
  assert.ok(texts.includes(" — 식별 리더기"), "장비 설명이 없다");

  // 설명이 없는 항목은 구분선만 덩그러니 찍히지 않는다.
  assert.equal(texts.filter((t) => t === " — ").length, 0);
});

test("도면 칸: 장비는 디스플레이 이름을 찍는다", () => {
  const project = createProject("칸 글자");
  const page = project.pages[0];
  page.equipment["2,2"] = { kind: "reader" };

  const doc = { ...page, palette: project.palette, version: 2, title: project.title };
  const ctx = recordingContext();
  renderSheet(ctx, doc, 22, VISIBLE, legendItemsForProject(project));

  // 칸 글자는 가운데 정렬로 찍힌다. 설명("식별 리더기")이 아니라 이름("리더")이어야 한다.
  const cellTexts = ctx.ops.filter((o) => o.op === "fillText").map((o) => o.text);
  assert.ok(cellTexts.includes("리더"));
  assert.equal(cellTexts.includes("식별 리더기"), false, "설명이 칸에 찍혔다");
});

test("PNG 내보내기: 인쇄 경계선은 들어가지 않는다", () => {
  const project = createProject("경계선");
  const page = project.pages[0];
  page.paper = { id: "a4", orientation: "landscape", cellMm: 5, marginMm: 10 };
  page.equipment["1,1"] = { status: "installed" };

  const doc = { ...page, palette: project.palette, version: 2, title: project.title };
  const ctx = recordingContext();

  // renderSheet 는 printGuide 를 넘기지 않는다. 경계선 색이 한 번도 쓰이면 안 된다.
  renderSheet(ctx, doc, 22, VISIBLE, legendItemsForProject(project));

  assert.equal(guideLines(ctx.ops).length, 0, "PNG 에 인쇄 경계선이 그려졌다");
});

const GUIDE_COLOR = "#c026d3";

function guideLines(ops) {
  return ops.filter((o) => o.op === "stroke" && o.color === GUIDE_COLOR);
}

test("인쇄 경계선: 격자가 한 장보다 작아도 용지 테두리가 보인다", () => {
  const project = createProject("작은 격자");
  const page = project.pages[0]; // 48 x 30
  const doc = { ...page, palette: project.palette, version: 3, title: "t" };

  const cell = 22;
  const per = { cols: 55, rows: 38 }; // A4 가로 한 장
  const ctx = recordingContext();
  renderDoc(ctx, doc, { cell, visible: VISIBLE, showGrid: false, printGuide: per });

  const lines = guideLines(ctx.ops);
  // 세로선 1개(x=55), 가로선 1개(y=38) — 마지막 장의 바깥 테두리다.
  assert.equal(lines.length, 2, `경계선이 ${lines.length}개다 (2개 기대)`);

  const vertical = lines.find((l) => l.from.x === l.to.x);
  const horizontal = lines.find((l) => l.from.y === l.to.y);
  assert.ok(vertical, "세로 경계선이 없다");
  assert.ok(horizontal, "가로 경계선이 없다");

  // 격자(48칸)보다 바깥인 55칸 자리에 그려져야 한다.
  assert.ok(vertical.from.x > 48 * cell, `세로선이 ${vertical.from.x}px — 격자 안이다`);
  assert.ok(horizontal.from.y > 30 * cell, `가로선이 ${horizontal.from.y}px — 격자 안이다`);
});

test("인쇄 경계선: 여러 장에 걸치면 장마다 그린다", () => {
  const project = createProject("큰 격자");
  const page = { ...project.pages[0], cols: 120, rows: 80 };
  const doc = { ...page, palette: project.palette, version: 3, title: "t" };

  const ctx = recordingContext();
  renderDoc(ctx, doc, { cell: 22, visible: VISIBLE, showGrid: false, printGuide: { cols: 55, rows: 38 } });

  const lines = guideLines(ctx.ops);
  const vertical = lines.filter((l) => l.from.x === l.to.x);
  const horizontal = lines.filter((l) => l.from.y === l.to.y);

  // 가로 3장 -> 세로선 55·110·165, 세로 3장 -> 가로선 38·76·114
  assert.equal(vertical.length, 3, `세로선 ${vertical.length}개`);
  assert.equal(horizontal.length, 3, `가로선 ${horizontal.length}개`);
});

test("인쇄 경계선: 끄면 한 줄도 그리지 않는다", () => {
  const project = createProject("끔");
  const page = project.pages[0];
  const doc = { ...page, palette: project.palette, version: 3, title: "t" };

  const ctx = recordingContext();
  renderDoc(ctx, doc, { cell: 22, visible: VISIBLE, showGrid: true, printGuide: null });

  assert.equal(guideLines(ctx.ops).length, 0);
});

test("인쇄 경계선: 범례 띠가 도면 아래에 그려지고 경계 안에 들어간다", () => {
  const project = createProject("범례 띠");
  const page = project.pages[0]; // 48 x 30
  const doc = { ...page, palette: project.palette, version: 3, title: "t" };
  const legend = legendItemsForProject(project);

  const cell = 22;
  const ctx = recordingContext();
  renderDoc(ctx, doc, {
    cell,
    visible: VISIBLE,
    showGrid: false,
    printGuide: { cols: 55, rows: 38 },
    printLegend: { items: legend, bandCells: 3, columns: 6 },
  });

  // 범례 이름이 도면 아래쪽(30행 밑)에 찍힌다.
  const names = new Set(legend.map((item) => item.name));
  const drawn = ctx.ops.filter((o) => o.op === "fillText" && names.has(o.text));
  assert.ok(drawn.length > 0, "범례 이름이 하나도 안 그려졌다");
  assert.ok(
    drawn.every((o) => o.y >= 30 * cell),
    "범례가 도면 격자 위에 겹쳐 그려졌다",
  );

  // 경계선은 범례까지 감싼 범위(38행)에 그려진다.
  const horizontal = guideLines(ctx.ops).filter((l) => l.from.y === l.to.y);
  assert.equal(horizontal.length, 1);
  assert.ok(horizontal[0].from.y > 33 * cell, "경계선이 범례 띠보다 위에 있다");
});
