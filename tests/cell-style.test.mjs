import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createProject, updateEquipmentInfoOnPage } from "../app/editor/doc.ts";
import { diffProjects } from "../app/editor/diff.ts";
import { addPaletteEntry, ensurePalette, updatePaletteEntry } from "../app/editor/paletteOps.ts";
import { pasteClipboard } from "../app/editor/range.ts";
import { renderDoc } from "../app/editor/render.ts";
import { sanitizeProject } from "../app/editor/storage.ts";
import { createStore } from "../mcp/store.ts";
import { createProjectTool, setCellTool } from "../mcp/tools/index.ts";
import { recordingContext, VISIBLE } from "./recording-context.mjs";

const CELL = 20;

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

/** globalAlpha 가 어떻게 오갔는지 기록하는 최소 캔버스(opacity.test 와 같은 방식). */
function alphaCtx() {
  const alphas = [];
  const target = {
    globalAlpha: 1,
    canvas: { width: 400, height: 400 },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    lineDashOffset: 0,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
  };
  const stack = [];
  const noop = () => {};
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop === "save") return () => stack.push(obj.globalAlpha);
      if (prop === "restore") {
        return () => {
          if (stack.length > 0) obj.globalAlpha = stack.pop();
        };
      }
      if (prop in obj) return obj[prop];
      if (prop === "measureText") return () => ({ width: 10 });
      return noop;
    },
    set(obj, prop, value) {
      if (prop === "globalAlpha") alphas.push(value);
      obj[prop] = value;
      return true;
    },
  });
  return { ctx, alphas };
}

test("칸 정보 저장: 선 모양 · 진하기는 기본값(실선 · 불투명)이면 필드를 두지 않는다", () => {
  const project = createProject("칸 모양");
  let page = project.pages[0];
  page = { ...page, equipment: { "1,1": { kind: "reader" } } };

  page = updateEquipmentInfoOnPage(page, "1,1", { memo: "", lineStyle: "dashed", opacity: 0.55 });
  assert.equal(page.equipment["1,1"].lineStyle, "dashed");
  assert.equal(page.equipment["1,1"].opacity, 0.55);

  page = updateEquipmentInfoOnPage(page, "1,1", { memo: "", lineStyle: "solid", opacity: 1 });
  assert.equal("lineStyle" in page.equipment["1,1"], false, "실선은 파일에 남기지 않는다");
  assert.equal("opacity" in page.equipment["1,1"], false, "불투명은 파일에 남기지 않는다");
  assert.equal(page.equipment["1,1"].kind, "reader", "장비는 그대로다");

  // 값을 넘기지 않으면 있던 값을 건드리지 않는다(장비 없는 칸의 상자가 이렇게 부른다).
  page = updateEquipmentInfoOnPage(page, "1,1", { memo: "", lineStyle: "dotted", opacity: 0.4 });
  page = updateEquipmentInfoOnPage(page, "1,1", { memo: "메모만" });
  assert.equal(page.equipment["1,1"].lineStyle, "dotted");
  assert.equal(page.equipment["1,1"].opacity, 0.4);

  // 모양만 남고 장비·글자·메모·사진이 없으면 빈 칸이다.
  const styleOnly = updateEquipmentInfoOnPage(
    { ...page, equipment: {} },
    "5,5",
    { memo: "", lineStyle: "dashed", opacity: 0.4 },
  );
  assert.equal("5,5" in styleOnly.equipment, false);
});

test("불러오기: 칸의 선 모양 · 진하기는 아는 값만 살리고, 장비 항목에 남은 옛 값은 칸으로 내려보낸다", () => {
  const project = createProject("옛 장비 모양");
  const page = project.pages[0];
  page.equipment["1,1"] = { kind: "reader" };
  page.equipment["2,2"] = { kind: "reader", lineStyle: "dotted", opacity: 0.4 };
  page.equipment["3,3"] = { kind: "reader", lineStyle: "zigzag", opacity: 7 };
  page.equipment["4,4"] = { kind: "plc" };
  // 예전 판 파일: 장비 항목이 선 모양 · 진하기를 들고 있었다.
  project.palette = project.palette.map((item) =>
    item.id === "reader" ? { ...item, lineStyle: "dashed", opacity: 0.7 } : item,
  );

  const restored = sanitizeProject(JSON.parse(JSON.stringify(project)));
  const cells = restored.pages[0].equipment;
  // 값이 없던 칸은 항목의 옛 값을 받는다 — 어제와 같은 모양으로 열린다.
  assert.equal(cells["1,1"].lineStyle, "dashed");
  assert.equal(cells["1,1"].opacity, 0.7);
  // 칸이 이미 정한 값이 우선이다.
  assert.equal(cells["2,2"].lineStyle, "dotted");
  assert.equal(cells["2,2"].opacity, 0.4);
  // 모르는 값은 버리고 항목의 옛 값으로 채운다.
  assert.equal(cells["3,3"].lineStyle, "dashed");
  assert.equal(cells["3,3"].opacity, 0.7);
  // 다른 장비는 건드리지 않는다.
  assert.equal("lineStyle" in cells["4,4"], false);
  assert.equal("opacity" in cells["4,4"], false);

  // 장비 항목에서는 사라진다 — 이제 팔레트가 아니라 칸이 정한다.
  const reader = restored.palette.find((item) => item.id === "reader");
  assert.equal("lineStyle" in reader, false);
  assert.equal("opacity" in reader, false);

  // 한 번 더 왕복해도 그대로다.
  const again = sanitizeProject(JSON.parse(JSON.stringify(restored)));
  assert.deepEqual(again.pages[0].equipment, cells);
});

test("팔레트 편집: 장비 항목은 선 모양 · 진하기를 받지 않고, 배선은 그대로 받는다", () => {
  const base = createProject("팔레트").palette;
  const { palette, created: kind } = addPaletteEntry(base, "kind", {
    name: "새 장비",
    color: "#0f766e",
    description: "",
    lineStyle: "dashed",
    opacity: 0.4,
  });
  assert.equal("lineStyle" in kind, false);
  assert.equal("opacity" in kind, false);

  const updated = updatePaletteEntry(palette, kind.id, {
    name: "새 장비",
    color: "#0f766e",
    description: "",
    lineStyle: "dotted",
    opacity: 0.25,
  });
  const after = updated.find((item) => item.id === kind.id);
  assert.equal("lineStyle" in after, false);
  assert.equal("opacity" in after, false);

  const { created: wire } = addPaletteEntry(base, "wire", {
    name: "새 배선",
    color: "#7c3aed",
    description: "",
    lineStyle: "dashed",
    opacity: 1,
  });
  assert.equal(wire.lineStyle, "dashed");
  assert.equal(wire.opacity, 1);

  // 저장 파일에 남은 장비 항목의 값도 읽을 때 버린다.
  const loaded = ensurePalette([{ id: "k", name: "장비", role: "kind", color: "#0f766e", lineStyle: "dashed", opacity: 0.5 }]);
  const k = loaded.find((item) => item.id === "k");
  assert.equal("lineStyle" in k, false);
  assert.equal("opacity" in k, false);
});

test("도면 렌더: 칸의 선 모양은 그 칸 테두리에만, 진하기는 테두리 · 이름에 먹이고 알파를 되돌린다", () => {
  const project = createProject("칸 렌더");
  const page = project.pages[0];
  page.equipment["1,1"] = { kind: "reader", lineStyle: "dashed" };
  page.equipment["2,2"] = { kind: "reader" };

  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell: CELL, visible: VISIBLE, showGrid: false });
  const borders = ctx.ops.filter((op) => op.op === "strokeRect" && op.color === "#0f766e");
  assert.equal(borders.length, 2);
  const dashed = borders.find((op) => op.x === 1 * CELL + 1);
  const solid = borders.find((op) => op.x === 2 * CELL + 1);
  assert.ok(dashed.dash.length > 0, "파선 칸");
  assert.equal(solid.dash.length, 0, "같은 장비라도 정하지 않은 칸은 실선");

  // 진하기 — 반투명 칸을 그리는 동안만 알파가 내려가고, 끝나면 1 로 돌아온다.
  const faded = createProject("진하기");
  faded.pages[0].equipment["1,1"] = { kind: "reader", opacity: 0.4 };
  const { ctx: actx, alphas } = alphaCtx();
  renderDoc(actx, layout(faded), { cell: CELL, visible: VISIBLE, showGrid: false });
  assert.ok(alphas.some((alpha) => Math.abs(alpha - 0.4) < 1e-9), "0.4 로 그린 구간이 있어야 한다");
  assert.equal(actx.globalAlpha, 1, "그린 뒤 알파가 돌아와야 한다");

  // 불투명 칸은 알파를 건드리지 않는다.
  const plain = createProject("불투명");
  plain.pages[0].equipment["1,1"] = { kind: "reader" };
  const { alphas: none } = alphaCtx();
  renderDoc(alphaCtx().ctx, layout(plain), { cell: CELL, visible: VISIBLE, showGrid: false });
  assert.equal(none.length, 0);
});

test("복사 · 붙여넣기와 비교: 선 모양 · 진하기가 칸과 함께 다닌다", () => {
  const project = createProject("복사");
  const doc = layout(project);
  doc.equipment["0,0"] = { kind: "reader", lineStyle: "dotted", opacity: 0.55 };

  const data = { width: 1, height: 1, cells: [{ relX: 0, relY: 0, equipment: { ...doc.equipment["0,0"] } }] };
  const { nextDoc } = pasteClipboard(doc, data, { x: 3, y: 3 });
  assert.deepEqual(nextDoc.equipment["3,3"], { kind: "reader", lineStyle: "dotted", opacity: 0.55 });

  // 진하기만 다른 붙여넣기도 "바뀐 것" 이다.
  const faded = { ...data, cells: [{ relX: 0, relY: 0, equipment: { kind: "reader", lineStyle: "dotted", opacity: 0.25 } }] };
  const { nextDoc: changed } = pasteClipboard(nextDoc, faded, { x: 3, y: 3 });
  assert.notEqual(changed, nextDoc);
  assert.equal(changed.equipment["3,3"].opacity, 0.25);

  // 이력 비교에도 한 줄로 적힌다.
  const before = createProject("비교");
  const after = JSON.parse(JSON.stringify(before));
  before.pages[0].equipment["1,1"] = { kind: "reader" };
  after.pages[0].equipment["1,1"] = { kind: "reader", lineStyle: "dashed", opacity: 0.7 };
  const diff = diffProjects(before, after);
  const change = diff.pages[0].changes.find((entry) => entry.key === "1,1");
  assert.ok(change, "바뀐 칸으로 잡혀야 한다");
  assert.match(change.after, /선=파선/);
  assert.match(change.after, /진하기=70%/);
});

test("grid_set_cell: lineStyle · opacity 로 칸 장비 테두리 모양을 정한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "grid-mcp-style-"));
  const store = createStore(dir);
  try {
    const { projectId } = createProjectTool.handler({ title: "MCP 모양", width: 10, height: 10 }, store);
    setCellTool.handler({ projectId, x: 1, y: 1, paletteId: "reader", lineStyle: "dashed", opacity: 0.4 }, store);
    let cell = store.read(projectId).pages[0].equipment["1,1"];
    assert.equal(cell.kind, "reader");
    assert.equal(cell.lineStyle, "dashed");
    assert.equal(cell.opacity, 0.4);

    // 모양만 바꿔도 부를 수 있고, 기본값으로 되돌리면 필드가 사라진다.
    setCellTool.handler({ projectId, x: 1, y: 1, lineStyle: "solid", opacity: 1 }, store);
    cell = store.read(projectId).pages[0].equipment["1,1"];
    assert.equal("lineStyle" in cell, false);
    assert.equal("opacity" in cell, false);

    assert.throws(() => setCellTool.handler({ projectId, x: 1, y: 1, lineStyle: "zigzag" }, store));
    assert.ok(existsSync(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
