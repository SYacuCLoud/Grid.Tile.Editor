/**
 * 레이어 — 구성 · 관리 · 잠금 · 하위 호환성.
 *
 * 여기서 지키려는 첫 줄은 하나다: **레이어 목록이 없던 예전 문서가 그대로 열린다.**
 * 기본 3종은 칸을 담는 자리가 문서 구조에 박혀 있어서, 목록에서 빠지면 이미
 * 그려 둔 칸이 화면에서 사라진다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { diffProjects } from "../app/editor/diff.ts";
import {
  clearLayerOnPage,
  createProject,
  dropLayerFromPage,
  eraseCellsOnPage,
  layerCellCount,
  paintCellsOnPage,
  paintedCells,
  resizePage,
  usedLayerIds,
  withLayerCells,
} from "../app/editor/doc.ts";
import {
  addLayer,
  canEditLayer,
  defaultLayers,
  deleteLayer,
  isBuiltinLayerId,
  layerById,
  layerSections,
  lockedLayerIds,
  MAX_LAYERS,
  moveLayer,
  nextLayerId,
  renameLayer,
  sanitizeLayers,
  sectionKey,
  setLayerFlag,
  toggleLayerFlag,
  validateLayerName,
  visibleMap,
} from "../app/editor/layers.ts";
import { addPaletteEntry, usageCountInProject, validateInput } from "../app/editor/paletteOps.ts";
import { copyRange, cutRange, normalizeRange, pasteClipboard } from "../app/editor/range.ts";
import { renderDoc } from "../app/editor/render.ts";
import { floodFillPoints } from "../app/editor/shapes.ts";
import { sanitizeProject } from "../app/editor/storage.ts";
import { recordingContext, VISIBLE } from "./recording-context.mjs";

/** 사용자 채움 레이어 하나를 붙인 프로젝트. */
function withZoneLayer(title = "구역") {
  const project = createProject(title);
  const { layers, created } = addLayer(project.layers, { name: "구역", kind: "fill", hint: "작업 구역" });
  project.layers = layers;

  const { palette, created: item } = addPaletteEntry(
    project.palette,
    "tile",
    { name: "A구역", color: "#1f6fb2", description: "" },
    created.id,
  );
  project.palette = palette;
  return { project, layer: created, item };
}

function layoutOf(project) {
  const page = project.pages[0];
  return {
    version: project.version,
    title: project.title,
    cols: page.cols,
    rows: page.rows,
    background: page.background,
    equipment: page.equipment,
    wiring: page.wiring,
    layerCells: page.layerCells,
    layers: project.layers,
    palette: project.palette,
  };
}

// ── 기본 구성과 하위 호환성 ─────────────────────────────────────────

test("기본 레이어: 배경 · 설비 · 배선 순서로 셋이다", () => {
  const layers = defaultLayers();
  assert.deepEqual(
    layers.map((layer) => layer.id),
    ["background", "equipment", "wiring"],
  );
  assert.deepEqual(
    layers.map((layer) => layer.kind),
    ["fill", "equipment", "wire"],
  );
  assert.ok(layers.every((layer) => layer.builtin === true));
  assert.ok(["background", "equipment", "wiring"].every(isBuiltinLayerId));
  assert.equal(isBuiltinLayerId("layer-1"), false);
});

test("하위 호환: 레이어 목록이 없던 문서는 기본 3종을 받는다", () => {
  assert.deepEqual(
    sanitizeLayers(undefined).map((layer) => layer.id),
    ["background", "equipment", "wiring"],
  );
  assert.deepEqual(sanitizeLayers("레이어 아님").length, 3);
  assert.deepEqual(sanitizeLayers([]).length, 3);
  assert.deepEqual(sanitizeLayers([{ id: 3 }, null, {}]).length, 3, "쓸 만한 것이 없으면 기본으로 되돌린다");
});

test("하위 호환: 기본 3종이 빠져 있으면 되채운다", () => {
  const layers = sanitizeLayers([{ id: "wiring", name: "배선", kind: "wire" }]);
  assert.deepEqual(
    layers.map((layer) => layer.id),
    ["background", "equipment", "wiring"],
    "빠진 기본 레이어는 아래에 되채운다",
  );
});

test("레이어 검사: 사용자 레이어는 채움·선 둘 중 하나여야 한다", () => {
  const layers = sanitizeLayers([
    { id: "background", name: "배경", kind: "fill" },
    { id: "equipment", name: "설비", kind: "equipment" },
    { id: "wiring", name: "배선", kind: "wire" },
    { id: "layer-1", name: "구역", kind: "fill", hidden: true },
    { id: "layer-2", name: "설비 둘", kind: "equipment" },
    { id: "layer-3", name: "방식 없음" },
    { id: "나쁜 아이디!", name: "이름", kind: "fill" },
    { id: "layer-1", name: "겹친 ID", kind: "fill" },
  ]);

  assert.deepEqual(
    layers.map((layer) => layer.id),
    ["background", "equipment", "wiring", "layer-1"],
  );
  assert.equal(layerById(layers, "layer-1").hidden, true, "숨김 표시는 살아남는다");
  assert.equal(layerById(layers, "layer-1").builtin, undefined, "사용자 레이어는 기본 표시가 없다");
});

test("레이어 검사: 기본 레이어의 그리는 방식은 파일이 뭐라 해도 고정이다", () => {
  const layers = sanitizeLayers([{ id: "background", name: "배경", kind: "wire" }]);
  assert.equal(layerById(layers, "background").kind, "fill");
});

test("레이어 검사: 이름과 순서는 파일에 적힌 대로 살린다", () => {
  const layers = sanitizeLayers([
    { id: "wiring", name: "전선", kind: "wire" },
    { id: "background", name: "바닥", kind: "fill" },
    { id: "equipment", name: "설비", kind: "equipment" },
  ]);
  assert.deepEqual(
    layers.map((layer) => `${layer.id}=${layer.name}`),
    ["wiring=전선", "background=바닥", "equipment=설비"],
  );
});

test("레이어 검사: 최대 개수를 넘기지 않는다", () => {
  const many = Array.from({ length: MAX_LAYERS + 5 }, (_, n) => ({
    id: `layer-${n + 1}`,
    name: `구역 ${n + 1}`,
    kind: "fill",
  }));
  assert.equal(sanitizeLayers(many).length, MAX_LAYERS);
});

// ── 관리 ────────────────────────────────────────────────────────────

test("레이어 추가: 맨 위에 얹히고 ID 는 겹치지 않는다", () => {
  const first = addLayer(defaultLayers(), { name: "구역", kind: "fill" });
  assert.equal(first.created.id, "layer-1");
  assert.equal(first.layers[first.layers.length - 1].id, "layer-1", "새 레이어는 맨 위(뒤)에 온다");

  const second = addLayer(first.layers, { name: "안전선", kind: "wire" });
  assert.equal(second.created.id, "layer-2");
  assert.equal(second.created.kind, "wire");
  assert.equal(nextLayerId(second.layers), "layer-3");
});

test("레이어 추가: 이름·설명은 길이를 맞춰 자른다", () => {
  const { created } = addLayer(defaultLayers(), {
    name: "아".repeat(40),
    kind: "fill",
    hint: "설".repeat(40),
  });
  assert.equal(created.name.length, 16);
  assert.equal(created.hint.length, 24);
});

test("레이어 이름 검사: 빈 이름 · 너무 긴 이름 · 겹치는 이름을 막는다", () => {
  const layers = defaultLayers();
  assert.equal(validateLayerName(layers, "구역"), null);
  assert.match(validateLayerName(layers, "  "), /입력/);
  assert.match(validateLayerName(layers, "아".repeat(20)), /16자/);
  assert.match(validateLayerName(layers, "배경"), /이미 있다/);
  assert.equal(validateLayerName(layers, "배경", "background"), null, "자기 이름은 겹침이 아니다");
});

test("레이어 이름 변경: 빈 이름은 무시하고 원본을 건드리지 않는다", () => {
  const layers = defaultLayers();
  const renamed = renameLayer(layers, "background", "바닥");
  assert.equal(layerById(renamed, "background").name, "바닥");
  assert.equal(layerById(layers, "background").name, "배경", "원본은 그대로");
  assert.equal(renameLayer(layers, "background", "  "), layers, "빈 이름은 아무 일도 하지 않는다");
});

test("레이어 순서: 위·아래로 한 칸씩 옮기고 끝에서는 멈춘다", () => {
  const layers = defaultLayers();
  const ids = (list) => list.map((layer) => layer.id);

  assert.deepEqual(ids(moveLayer(layers, "background", 1)), ["equipment", "background", "wiring"]);
  assert.deepEqual(ids(moveLayer(layers, "wiring", -1)), ["background", "wiring", "equipment"]);
  assert.equal(moveLayer(layers, "background", -1), layers, "맨 아래에서 더 내려가지 않는다");
  assert.equal(moveLayer(layers, "wiring", 1), layers, "맨 위에서 더 올라가지 않는다");
  assert.equal(moveLayer(layers, "없는레이어", 1), layers);
});

test("표시·잠금: 켜면 표시가 남고 끄면 자리를 비운다", () => {
  let layers = defaultLayers();
  assert.deepEqual(visibleMap(layers), { background: true, equipment: true, wiring: true });

  layers = toggleLayerFlag(layers, "wiring", "hidden");
  assert.equal(layerById(layers, "wiring").hidden, true);
  assert.equal(visibleMap(layers).wiring, false);

  layers = toggleLayerFlag(layers, "wiring", "hidden");
  assert.equal("hidden" in layerById(layers, "wiring"), false, "끄면 표시를 지운다 — 파일이 깔끔해진다");

  layers = setLayerFlag(layers, "background", "locked", true);
  assert.deepEqual(lockedLayerIds(layers), ["background"]);
  assert.equal(canEditLayer(layers, "background"), false);
  assert.equal(canEditLayer(layers, "equipment"), true);
  assert.equal(canEditLayer(layers, "없는레이어"), false, "없는 레이어에는 그릴 수 없다");
});

test("레이어 삭제: 기본 3종은 지울 수 없다", () => {
  const { layers } = addLayer(defaultLayers(), { name: "구역", kind: "fill" });

  assert.equal(deleteLayer(layers, "background"), layers);
  assert.equal(deleteLayer(layers, "equipment"), layers);
  assert.equal(deleteLayer(layers, "wiring"), layers);
  assert.deepEqual(
    deleteLayer(layers, "layer-1").map((layer) => layer.id),
    ["background", "equipment", "wiring"],
  );
});

test("팔레트 분류: 기본 레이어는 예전대로, 사용자 레이어는 하나다", () => {
  const layers = addLayer(defaultLayers(), { name: "구역", kind: "wire" }).layers;

  assert.deepEqual(
    layerSections(layerById(layers, "equipment")).map((section) => section.role),
    ["status", "kind"],
  );
  assert.deepEqual(
    layerSections(layerById(layers, "background")).map((section) => [section.role, section.editable]),
    [["tile", false]],
    "배경은 예전처럼 고정 분류다",
  );

  const custom = layerSections(layerById(layers, "layer-1"));
  assert.equal(custom.length, 1);
  assert.equal(custom[0].role, "wire", "선 잇기 레이어는 배선과 같은 방식으로 그린다");
  assert.equal(custom[0].editable, true);
  assert.equal(custom[0].key, sectionKey("layer-1", "wire"));
});

// ── 칸 ─────────────────────────────────────────────────────────────

test("사용자 레이어 칸: 칠하면 자기 자리에 담기고 기본 3종은 건드리지 않는다", () => {
  const { project, layer, item } = withZoneLayer();
  const page = paintCellsOnPage(project.pages[0], item, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ]);

  assert.deepEqual(page.layerCells[layer.id], { "1,1": item.id, "2,1": item.id });
  assert.deepEqual(page.background, {}, "배경은 그대로 비어 있다");
  assert.deepEqual(usedLayerIds(page), [layer.id]);
  assert.deepEqual(paintedCells(page, layer.id), { "1,1": item.id, "2,1": item.id });
});

test("사용자 레이어 칸: 지우면 빠지고 다 지우면 자리 자체가 없어진다", () => {
  const { project, layer, item } = withZoneLayer();
  let page = paintCellsOnPage(project.pages[0], item, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ]);

  page = eraseCellsOnPage(page, layer.id, [{ x: 1, y: 1 }]);
  assert.deepEqual(page.layerCells[layer.id], { "2,1": item.id });

  page = eraseCellsOnPage(page, layer.id, [{ x: 2, y: 1 }]);
  assert.equal(page.layerCells, undefined, "빈 레이어는 자리를 비운다 — 파일 모양이 예전과 같아진다");
});

test("사용자 레이어 칸: 격자를 줄이면 밖으로 나간 칸을 버린다", () => {
  const { project, layer, item } = withZoneLayer();
  let page = paintCellsOnPage(project.pages[0], item, [
    { x: 1, y: 1 },
    { x: 40, y: 25 },
  ]);

  page = resizePage(page, 12, 12);
  assert.deepEqual(page.layerCells[layer.id], { "1,1": item.id });

  page = resizePage(page, 48, 30);
  assert.deepEqual(page.layerCells[layer.id], { "1,1": item.id }, "다시 늘려도 되살아나지 않는다");
});

test("레이어 비우기 · 버리기: 칸만 사라지고 셈이 맞는다", () => {
  const { project, layer, item } = withZoneLayer();
  project.pages[0] = paintCellsOnPage(project.pages[0], item, [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 3 },
  ]);
  project.pages[0].background["0,0"] = "wall";

  assert.equal(layerCellCount(project, layer.id), 3);
  assert.equal(layerCellCount(project, "background"), 1);
  assert.equal(layerCellCount(project, "equipment"), 0);

  const cleared = clearLayerOnPage(project.pages[0], layer.id);
  assert.equal(cleared.layerCells, undefined);
  assert.deepEqual(cleared.background, { "0,0": "wall" }, "다른 레이어는 그대로");

  const dropped = dropLayerFromPage(project.pages[0], layer.id);
  assert.equal(dropped.layerCells, undefined);
  assert.equal(dropLayerFromPage(cleared, layer.id), cleared, "버릴 것이 없으면 같은 페이지를 돌려준다");
});

test("칸 맵 갈아 끼우기: 기본 3종은 제자리, 사용자 레이어는 layerCells", () => {
  const { project, layer } = withZoneLayer();
  const page = project.pages[0];

  assert.deepEqual(withLayerCells(page, "background", { "1,1": "wall" }).background, { "1,1": "wall" });
  assert.deepEqual(withLayerCells(page, "wiring", { "1,1": "wirePurple" }).wiring, { "1,1": "wirePurple" });
  assert.deepEqual(withLayerCells(page, layer.id, { "1,1": "x" }).layerCells, { [layer.id]: { "1,1": "x" } });
  assert.equal(withLayerCells(page, "equipment", { "1,1": "x" }), page, "설비는 값 모양이 달라 이 길을 쓰지 않는다");
});

test("채우기 도구: 사용자 레이어에서도 이어진 같은 칸을 찾는다", () => {
  const { project, layer, item } = withZoneLayer();
  project.pages[0] = paintCellsOnPage(project.pages[0], item, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ]);

  const filled = floodFillPoints(layoutOf(project), layer.id, { x: 1, y: 1 });
  assert.equal(filled.length, 2, "같은 항목으로 이어진 두 칸");

  const empty = floodFillPoints(layoutOf(project), layer.id, { x: 10, y: 10 });
  assert.ok(empty.length > 2, "빈 칸에서 시작하면 빈 영역 전체를 잡는다");
});

// ── 저장 ────────────────────────────────────────────────────────────

test("저장: 레이어 구성과 사용자 레이어 칸이 다시 열어도 살아 있다", () => {
  const { project, layer, item } = withZoneLayer();
  project.pages[0] = paintCellsOnPage(project.pages[0], item, [{ x: 2, y: 3 }]);

  const restored = sanitizeProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(
    restored.layers.map((entry) => entry.id),
    ["background", "equipment", "wiring", layer.id],
  );
  assert.equal(layerById(restored.layers, layer.id).name, "구역");
  assert.equal(layerById(restored.layers, layer.id).hint, "작업 구역");
  assert.deepEqual(restored.pages[0].layerCells[layer.id], { "2,3": item.id });

  const restoredItem = restored.palette.find((entry) => entry.id === item.id);
  assert.equal(restoredItem.layer, layer.id, "팔레트 항목의 레이어를 분류에서 되짚어 뒤섞지 않는다");
});

test("저장: 목록에 없는 레이어의 칸은 버린다", () => {
  const { project, item } = withZoneLayer();
  project.pages[0] = paintCellsOnPage(project.pages[0], item, [{ x: 2, y: 3 }]);

  const raw = JSON.parse(JSON.stringify(project));
  raw.layers = raw.layers.filter((entry) => entry.id !== "layer-1");
  raw.pages[0].layerCells["없는레이어"] = { "1,1": "x" };

  const restored = sanitizeProject(raw);
  assert.equal(restored.pages[0].layerCells, undefined, "그릴 자리가 없는 칸은 파일에 쌓이지 않는다");
});

test("저장: 레이어를 몰랐던 예전 문서도 그대로 열린다", () => {
  const legacy = {
    version: 3,
    title: "예전 문서",
    cols: 20,
    rows: 15,
    background: { "1,1": "wall" },
    equipment: { "2,2": { status: "installed" } },
    wiring: { "3,3": "wirePurple" },
  };

  const restored = sanitizeProject(legacy);
  assert.deepEqual(
    restored.layers.map((layer) => layer.id),
    ["background", "equipment", "wiring"],
  );
  assert.deepEqual(restored.pages[0].background, { "1,1": "wall" });
  assert.deepEqual(restored.pages[0].wiring, { "3,3": "wirePurple" });
  assert.equal(restored.pages[0].layerCells, undefined);
});

// ── 팔레트 ──────────────────────────────────────────────────────────

test("팔레트: 사용자 레이어 항목은 레이어 ID 를 접두어로 쓴다", () => {
  const { item } = withZoneLayer();
  assert.match(item.id, /^layer-1-/);
  assert.equal(item.layer, "layer-1");
  assert.equal(item.role, "tile");
});

test("팔레트: 같은 이름은 같은 레이어 안에서만 막는다", () => {
  const { project } = withZoneLayer();
  const input = { name: "A구역", color: "#1f6fb2", description: "" };

  assert.match(validateInput(project.palette, "tile", input, undefined, "layer-1"), /이미 있다/);
  assert.equal(validateInput(project.palette, "tile", input, undefined, "background"), null, "다른 레이어면 겹치지 않는다");
});

test("팔레트: 사용자 레이어 항목의 사용량도 센다", () => {
  const { project, item } = withZoneLayer();
  project.pages[0] = paintCellsOnPage(project.pages[0], item, [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ]);
  assert.equal(usageCountInProject(project, item), 2);
});

// ── 복사 · 붙여넣기 · 잠금 ──────────────────────────────────────────

test("복사·붙여넣기: 사용자 레이어 칸도 함께 옮긴다", () => {
  const { project, layer, item } = withZoneLayer();
  project.pages[0] = paintCellsOnPage(project.pages[0], item, [{ x: 0, y: 0 }]);

  const doc = layoutOf(project);
  const range = normalizeRange({ x: 0, y: 0 }, { x: 0, y: 0 }, doc);
  const data = copyRange(doc, range);
  assert.deepEqual(data.cells[0].layers, { [layer.id]: item.id });

  const { nextDoc } = pasteClipboard(doc, data, { x: 5, y: 5 });
  assert.equal(nextDoc.layerCells[layer.id]["5,5"], item.id);
});

test("잠금: 잘라내기·붙여넣기가 잠긴 레이어를 건드리지 않는다", () => {
  const { project, layer, item } = withZoneLayer();
  project.pages[0] = paintCellsOnPage(project.pages[0], item, [{ x: 0, y: 0 }]);
  project.pages[0].background["0,0"] = "wall";

  const doc = layoutOf(project);
  const range = normalizeRange({ x: 0, y: 0 }, { x: 0, y: 0 }, doc);

  const guard = { locked: ["background", layer.id] };
  const { nextDoc, data } = cutRange(doc, range, guard);
  assert.equal(nextDoc.background["0,0"], "wall", "잠긴 배경은 지워지지 않는다");
  assert.equal(nextDoc.layerCells[layer.id]["0,0"], item.id, "잠긴 사용자 레이어도 그대로");
  assert.deepEqual(data.cells[0].layers, { [layer.id]: item.id }, "베끼기는 잠금과 무관하다");

  const pasted = pasteClipboard(doc, data, { x: 5, y: 5 }, guard).nextDoc;
  assert.equal(pasted.background["5,5"], undefined, "잠긴 레이어에는 붙지 않는다");
  assert.equal(pasted.layerCells[layer.id]["5,5"], undefined);
});

// ── 비교 ────────────────────────────────────────────────────────────

test("비교: 사용자 레이어의 칸 변화를 레이어 이름으로 잡는다", () => {
  const { project, layer, item } = withZoneLayer();
  const before = sanitizeProject(JSON.parse(JSON.stringify(project)));
  project.pages[0] = paintCellsOnPage(project.pages[0], item, [{ x: 4, y: 6 }]);
  const after = sanitizeProject(JSON.parse(JSON.stringify(project)));

  const diff = diffProjects(before, after);
  assert.deepEqual(diff.counts, { added: 1, removed: 0, changed: 0 });

  const change = diff.pages[0].changes[0];
  assert.equal(change.layer, layer.id);
  assert.deepEqual({ x: change.x, y: change.y, kind: change.kind }, { x: 4, y: 6, kind: "added" });
  assert.equal(change.after, item.id);
});

// ── 렌더 ────────────────────────────────────────────────────────────

/** 이 색으로 칠한 칸을 세어 돌려준다. */
function fillsOfColor(ops, color) {
  return ops.filter((op) => op.op === "fillRect" && op.color === color);
}

test("렌더: 사용자 채움 레이어를 고른 색으로 칠한다", () => {
  const { project, item } = withZoneLayer();
  project.pages[0] = paintCellsOnPage(project.pages[0], item, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ]);

  const ctx = recordingContext();
  renderDoc(ctx, layoutOf(project), { cell: 24, visible: VISIBLE, showGrid: false });
  assert.equal(fillsOfColor(ctx.ops, "#1f6fb2").length, 2);
});

test("렌더: 숨긴 레이어는 그리지 않는다", () => {
  const { project, layer, item } = withZoneLayer();
  project.pages[0] = paintCellsOnPage(project.pages[0], item, [{ x: 1, y: 1 }]);
  project.layers = setLayerFlag(project.layers, layer.id, "hidden", true);

  const ctx = recordingContext();
  renderDoc(ctx, layoutOf(project), { cell: 24, visible: visibleMap(project.layers), showGrid: false });
  assert.equal(fillsOfColor(ctx.ops, "#1f6fb2").length, 0);

  // 잠금은 그리기와 무관하다 — 잠긴 레이어도 보인다.
  project.layers = setLayerFlag(project.layers, layer.id, "hidden", false);
  project.layers = setLayerFlag(project.layers, layer.id, "locked", true);
  const ctx2 = recordingContext();
  renderDoc(ctx2, layoutOf(project), { cell: 24, visible: visibleMap(project.layers), showGrid: false });
  assert.equal(fillsOfColor(ctx2.ops, "#1f6fb2").length, 1);
});

test("렌더: 목록에 없는 레이어도 표시 맵에 없으면 보이는 것으로 본다", () => {
  const { project, item } = withZoneLayer();
  project.pages[0] = paintCellsOnPage(project.pages[0], item, [{ x: 1, y: 1 }]);

  // 예전 호출부는 기본 3종만 담은 맵을 넘긴다. 그 때문에 새 레이어가 사라지면 안 된다.
  const ctx = recordingContext();
  renderDoc(ctx, layoutOf(project), { cell: 24, visible: VISIBLE, showGrid: false });
  assert.equal(fillsOfColor(ctx.ops, "#1f6fb2").length, 1);
});

test("렌더: 레이어 순서대로 그린다 — 위에 있는 레이어가 나중에 칠해진다", () => {
  const { project, layer, item } = withZoneLayer();
  project.pages[0] = paintCellsOnPage(project.pages[0], item, [{ x: 1, y: 1 }]);
  project.pages[0].background["1,1"] = "wall";

  const indexOfColor = (ops, color) => ops.findIndex((op) => op.op === "fillRect" && op.color === color);

  const above = recordingContext();
  renderDoc(above, layoutOf(project), { cell: 24, visible: VISIBLE, showGrid: false });
  assert.ok(
    indexOfColor(above.ops, "#1f6fb2") > indexOfColor(above.ops, "#9aa3ad"),
    "구역이 배경 위에 있으므로 나중에 칠해진다",
  );

  // 아래로 내리면 순서가 뒤집힌다.
  project.layers = moveLayer(moveLayer(moveLayer(project.layers, layer.id, -1), layer.id, -1), layer.id, -1);
  assert.equal(project.layers[0].id, layer.id);

  const below = recordingContext();
  renderDoc(below, layoutOf(project), { cell: 24, visible: VISIBLE, showGrid: false });
  assert.ok(
    indexOfColor(below.ops, "#1f6fb2") < indexOfColor(below.ops, "#9aa3ad"),
    "맨 아래로 내리면 배경보다 먼저 칠해진다",
  );
});

test("렌더: 격자선은 채움 위, 표식 아래에 한 번만 긋는다", () => {
  const { project } = withZoneLayer();
  project.pages[0].background["1,1"] = "wall";
  // 이웃한 두 칸이어야 선으로 그려진다(외톨이 칸은 점으로 찍힌다).
  project.pages[0].wiring["2,2"] = "wirePurple";
  project.pages[0].wiring["3,2"] = "wirePurple";

  const ctx = recordingContext();
  renderDoc(ctx, layoutOf(project), { cell: 24, visible: VISIBLE, showGrid: true });

  const gridLines = ctx.ops.filter((op) => op.op === "stroke" && op.color === "#d3d9df");
  const firstGrid = ctx.ops.findIndex((op) => op.op === "stroke" && op.color === "#d3d9df");
  const fill = ctx.ops.findIndex((op) => op.op === "fillRect" && op.color === "#9aa3ad");
  // 실선 배선은 칸을 가로지르는 작은 네모로 그린다.
  const wire = ctx.ops.findIndex((op) => op.op === "fillRect" && op.color === "#7c3aed");

  assert.ok(gridLines.length > 0, "격자선을 그린다");
  assert.ok(fill < firstGrid, "채움 레이어가 격자선보다 먼저");
  assert.ok(firstGrid < wire, "격자선이 배선보다 먼저");
});

test("렌더: 레이어 목록이 없는 문서도 기본 3종으로 그린다", () => {
  const project = createProject("목록 없음");
  project.pages[0].background["1,1"] = "wall";
  const doc = layoutOf(project);
  delete doc.layers;

  const ctx = recordingContext();
  assert.doesNotThrow(() => renderDoc(ctx, doc, { cell: 24, visible: VISIBLE, showGrid: false }));
  assert.equal(fillsOfColor(ctx.ops, "#9aa3ad").length, 1);
});
