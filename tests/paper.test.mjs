import assert from "node:assert/strict";
import test from "node:test";
import { createProject } from "../app/editor/doc.ts";
import {
  defaultPaper,
  legendBandCells,
  legendColumns,
  paperSizeMm,
  sanitizePaper,
  sheetCells,
  sheetCount,
} from "../app/editor/paper.ts";
import { canvasCells, printExtentCells } from "../app/editor/render.ts";
import { parseProjectJson, projectToJson, sanitizeProject } from "../app/editor/storage.ts";

test("용지 크기: 방향에 따라 가로·세로가 바뀐다", () => {
  assert.deepEqual(paperSizeMm({ ...defaultPaper("a4"), orientation: "portrait" }), {
    widthMm: 210,
    heightMm: 297,
  });
  assert.deepEqual(paperSizeMm({ ...defaultPaper("a4"), orientation: "landscape" }), {
    widthMm: 297,
    heightMm: 210,
  });
});

test("한 장에 들어가는 칸 수", () => {
  // A4 가로 297 x 210, 여백 10 씩 -> 쓸 수 있는 넓이 277 x 190, 한 칸 5mm
  const a4 = { ...defaultPaper("a4"), orientation: "landscape", cellMm: 5, marginMm: 10 };
  assert.deepEqual(sheetCells(a4), { cols: 55, rows: 38 });

  // 칸을 키우면 한 장에 덜 들어간다.
  assert.deepEqual(sheetCells({ ...a4, cellMm: 10 }), { cols: 27, rows: 19 });

  // 여백을 없애면 더 들어간다.
  assert.deepEqual(sheetCells({ ...a4, marginMm: 0 }), { cols: 59, rows: 42 });
});

test("한 장에 들어가는 칸 수: 여백이 용지보다 커도 최소 1칸", () => {
  // 0 이 되면 경계선을 그릴 때 무한 반복에 빠진다.
  const absurd = { ...defaultPaper("a4"), cellMm: 50, marginMm: 50 };
  const per = sheetCells(absurd);
  assert.ok(per.cols >= 1, `cols 가 ${per.cols}`);
  assert.ok(per.rows >= 1, `rows 가 ${per.rows}`);
});

test("몇 장에 걸치는지 센다", () => {
  const a4 = { ...defaultPaper("a4"), orientation: "landscape", cellMm: 5, marginMm: 10 };
  // 한 장 = 55 x 38 칸
  assert.deepEqual(sheetCount(a4, 55, 38), { across: 1, down: 1, total: 1 });
  assert.deepEqual(sheetCount(a4, 56, 38), { across: 2, down: 1, total: 2 });
  assert.deepEqual(sheetCount(a4, 110, 76), { across: 2, down: 2, total: 4 });
  // 격자가 아주 작아도 1장은 나온다.
  assert.deepEqual(sheetCount(a4, 10, 10), { across: 1, down: 1, total: 1 });
});

test("용지 설정 정리: 형식이 아니면 null", () => {
  assert.equal(sanitizePaper(undefined), null);
  assert.equal(sanitizePaper(null), null);
  assert.equal(sanitizePaper({}), null);
  assert.equal(sanitizePaper({ id: "b5" }), null, "모르는 용지는 받지 않는다");

  // 값이 튀어도 범위 안으로 다듬는다.
  const fixed = sanitizePaper({ id: "a3", orientation: "세로", cellMm: 9999, marginMm: -5 });
  assert.equal(fixed.id, "a3");
  assert.equal(fixed.orientation, "landscape", "모르는 방향은 가로로 둔다");
  assert.equal(fixed.cellMm, 50);
  assert.equal(fixed.marginMm, 0);
});

test("용지 설정: 페이지마다 따로 저장되고 JSON 왕복에서 보존된다", () => {
  const project = createProject("용지");
  project.pages.push({
    id: "page-2",
    name: "2페이지",
    cols: 40,
    rows: 30,
    background: {},
    equipment: {},
    wiring: {},
  });

  // 1페이지에만 용지를 설정한다.
  project.pages[0].paper = { id: "a3", orientation: "portrait", cellMm: 8, marginMm: 15 };

  const reloaded = parseProjectJson(projectToJson(project));
  assert.deepEqual(reloaded.pages[0].paper, { id: "a3", orientation: "portrait", cellMm: 8, marginMm: 15 });
  assert.equal("paper" in reloaded.pages[1], false, "설정하지 않은 페이지에는 붙지 않는다");
});

test("용지 설정: 이전 저장 문서는 용지 없이 그대로 열린다", () => {
  const legacy = {
    version: 2,
    title: "이전 프로젝트",
    activePageId: "page-1",
    pages: [
      { id: "page-1", name: "1층", cols: 48, rows: 30, background: { "1,1": "wall" }, equipment: {}, wiring: {} },
    ],
  };

  const project = sanitizeProject(legacy);
  assert.equal(project.pages.length, 1);
  assert.equal("paper" in project.pages[0], false, "없던 설정이 임의로 생기면 안 된다");
  assert.equal(project.pages[0].background["1,1"], "wall");
});

test("인쇄 범위: 격자가 한 장보다 작아도 용지 크기까지 넓힌다", () => {
  // 격자 48 x 30, A4 가로 한 장 = 55 x 38 칸 -> 경계선이 격자 밖에 있다.
  const per = { cols: 55, rows: 38 };
  assert.deepEqual(printExtentCells(48, 30, per), { cols: 55, rows: 38 });

  // 캔버스도 그만큼 넓어져야 경계선을 그릴 자리가 생긴다.
  assert.deepEqual(canvasCells({ cols: 48, rows: 30 }, per), { cols: 55, rows: 38 });

  // 여러 장에 걸치면 마지막 장의 바깥 테두리까지 올림한다.
  assert.deepEqual(printExtentCells(120, 80, per), { cols: 165, rows: 114 });

  // 딱 맞아떨어지면 그대로다.
  assert.deepEqual(printExtentCells(110, 76, per), { cols: 110, rows: 76 });

  // 경계선을 끄면 격자 그대로다.
  assert.deepEqual(canvasCells({ cols: 48, rows: 30 }, null), { cols: 48, rows: 30 });
});

test("범례 띠: 인쇄 치수로 잡아 화면 배율과 무관하다", () => {
  const a4 = { ...defaultPaper("a4"), orientation: "landscape", cellMm: 5, marginMm: 10 };

  // A4 가로 쓸 수 있는 너비 277mm / 항목 45mm -> 6칸씩
  assert.equal(legendColumns(a4), 6);

  // 항목이 없으면 자리를 잡지 않는다.
  assert.equal(legendBandCells(a4, 0), 0);

  // 6개까지는 한 줄: (여백 4 + 줄 6) / 5mm = 2행
  assert.equal(legendBandCells(a4, 6), 2);
  // 7개면 두 줄: (4 + 12) / 5 = 3.2 -> 4행
  assert.equal(legendBandCells(a4, 7), 4);

  // 한 칸을 크게 잡으면 같은 범례가 더 적은 행을 차지한다.
  assert.equal(legendBandCells({ ...a4, cellMm: 10 }, 6), 1);
});

test("장수 계산: 범례 띠를 행 수에 더한다", () => {
  const a4 = { ...defaultPaper("a4"), orientation: "landscape", cellMm: 5, marginMm: 10 };
  // 한 장 = 55 x 38 칸, 범례 6개 -> 2행

  // 격자만 보면 38행에 딱 맞지만, 범례 2행이 더해져 다음 장으로 넘어간다.
  assert.equal(sheetCount(a4, 55, 38, 0).down, 1);
  assert.equal(sheetCount(a4, 55, 38, 6).down, 2);

  // 범례를 넣어도 여유가 있으면 그대로 한 장이다.
  assert.equal(sheetCount(a4, 55, 30, 6).down, 1);
});

test("인쇄 범위: 범례 띠까지 감싼다", () => {
  const per = { cols: 55, rows: 38 };
  // 격자 48 x 30 + 범례 2행 = 32행 -> 한 장 안이다.
  assert.deepEqual(canvasCells({ cols: 48, rows: 30 }, per, 2), { cols: 55, rows: 38 });
  // 격자 48 x 37 + 범례 2행 = 39행 -> 두 장으로 넘어간다.
  assert.deepEqual(canvasCells({ cols: 48, rows: 37 }, per, 2), { cols: 55, rows: 76 });
});
