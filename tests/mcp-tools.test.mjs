import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createStore } from "../mcp/store.ts";
import {
  createProjectTool,
  exportPreviewTool,
  fillAreaTool,
  getProjectTool,
  listProjectsTool,
  managePagesTool,
  managePaletteTool,
  setCellTool,
} from "../mcp/tools/index.ts";
import { TOOLS } from "../mcp/tools/index.ts";

/** 테스트마다 빈 임시 폴더를 쓴다. 서로의 파일을 보지 않는다. */
function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "grid-mcp-"));
  return { store: createStore(dir), dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function newProject(store, overrides = {}) {
  return createProjectTool.handler({ title: "테스트 공장", width: 20, height: 12, ...overrides }, store);
}

test("도구 목록: 이름이 겹치지 않고 grid_ 접두어를 쓴다", () => {
  const names = TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.every((name) => name.startsWith("grid_")));
  for (const tool of TOOLS) {
    assert.ok(tool.description.length > 0, `${tool.name} 설명이 비었다`);
    assert.equal(typeof tool.handler, "function");
  }
});

test("grid_create_project: 파일을 만들고 격자 크기를 반영한다", () => {
  const { store, cleanup } = freshStore();
  try {
    const created = newProject(store);
    assert.equal(created.project.pages[0].cols, 20);
    assert.equal(created.project.pages[0].rows, 12);
    assert.ok(existsSync(created.path));

    // 저장된 파일은 편집기 JSON 형식 그대로다.
    const saved = JSON.parse(readFileSync(created.path, "utf8"));
    assert.equal(saved.version, 3);
    assert.equal(saved.title, "테스트 공장");
    assert.ok(Array.isArray(saved.palette) && saved.palette.length > 0);
  } finally {
    cleanup();
  }
});

test("grid_create_project: paperSize 를 주면 인쇄 용지 설정이 붙는다", () => {
  const { store, cleanup } = freshStore();
  try {
    const created = newProject(store, { paperSize: "a3", orientation: "portrait", cellMm: 8, marginMm: 5 });
    assert.deepEqual(created.project.pages[0].paper, {
      id: "a3",
      orientation: "portrait",
      cellMm: 8,
      marginMm: 5,
    });
  } finally {
    cleanup();
  }
});

test("grid_create_project: 같은 제목이면 ID 가 겹치지 않는다", () => {
  const { store, cleanup } = freshStore();
  try {
    const first = newProject(store);
    const second = newProject(store);
    assert.notEqual(first.projectId, second.projectId);
    assert.equal(listProjectsTool.handler({}, store).projects.length, 2);
  } finally {
    cleanup();
  }
});

test("grid_get_project: 메타·팔레트·페이지를 주고, includeCells 로 셀 맵까지 준다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);
    setCellTool.handler({ projectId, x: 1, y: 1, paletteId: "installed" }, store);

    const summary = getProjectTool.handler({ projectId }, store);
    assert.equal(summary.pages.length, 1);
    assert.ok(summary.palette.some((item) => item.id === "installed"));
    assert.equal(summary.cells, undefined);

    const full = getProjectTool.handler({ projectId, includeCells: true }, store);
    assert.deepEqual(full.cells.equipment["1,1"], { status: "installed" });
  } finally {
    cleanup();
  }
});

test("grid_set_cell: 분류에 따라 알맞은 레이어에 칠한다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);

    const painted = setCellTool.handler({ projectId, x: 2, y: 3, paletteId: "wall" }, store);
    assert.equal(painted.cell.background, "wall");

    const wired = setCellTool.handler({ projectId, x: 4, y: 3, paletteId: "wirePurple" }, store);
    assert.equal(wired.cell.wiring, "wirePurple");

    const kind = setCellTool.handler({ projectId, x: 5, y: 3, paletteId: "reader" }, store);
    assert.equal(kind.cell.equipment.kind, "reader");
  } finally {
    cleanup();
  }
});

test("grid_set_cell: 상태색과 장비 ID·메모를 한 번에 넣는다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);
    const result = setCellTool.handler(
      { projectId, x: 6, y: 6, paletteId: "installed", label: "C1101", memo: "3월 점검 대상" },
      store,
    );
    assert.deepEqual(result.cell.equipment, {
      status: "installed",
      label: "C1101",
      memo: "3월 점검 대상",
    });
  } finally {
    cleanup();
  }
});

test("grid_set_cell: 빈 label 은 지우고, eraseLayer 는 해당 레이어만 비운다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);
    setCellTool.handler({ projectId, x: 1, y: 1, paletteId: "installed", label: "C1" }, store);

    const cleared = setCellTool.handler({ projectId, x: 1, y: 1, label: "" }, store);
    assert.equal(cleared.cell.equipment.label, undefined);
    assert.equal(cleared.cell.equipment.status, "installed");

    setCellTool.handler({ projectId, x: 1, y: 1, paletteId: "wall" }, store);
    const erased = setCellTool.handler({ projectId, x: 1, y: 1, eraseLayer: "equipment" }, store);
    assert.equal(erased.cell.equipment, null);
    assert.equal(erased.cell.background, "wall");
  } finally {
    cleanup();
  }
});

test("grid_set_cell: 격자 밖 좌표와 없는 팔레트 ID 는 거부한다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);
    assert.throws(() => setCellTool.handler({ projectId, x: 99, y: 0, paletteId: "wall" }, store), /격자 밖/);
    assert.throws(() => setCellTool.handler({ projectId, x: 0, y: 0, paletteId: "없음" }, store), /찾을 수 없습니다/);
    assert.throws(() => setCellTool.handler({ projectId, x: 0, y: 0 }, store), /하나는 있어야/);
  } finally {
    cleanup();
  }
});

test("grid_fill_area: 직사각형을 채우고, outline 은 테두리만 칠한다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);

    const filled = fillAreaTool.handler({ projectId, x1: 0, y1: 0, x2: 3, y2: 2, paletteId: "wall" }, store);
    assert.equal(filled.affectedCells, 12);
    assert.equal(filled.page.cells.background, 12);

    const outlined = fillAreaTool.handler(
      { projectId, x1: 10, y1: 5, x2: 13, y2: 8, paletteId: "aisle", outline: true },
      store,
    );
    assert.equal(outlined.affectedCells, 12); // 4×4 테두리
    assert.equal(outlined.page.cells.background, 24);
  } finally {
    cleanup();
  }
});

test("grid_fill_area: eraseLayer 로 영역을 비운다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);
    fillAreaTool.handler({ projectId, x1: 0, y1: 0, x2: 4, y2: 4, paletteId: "installed" }, store);
    const erased = fillAreaTool.handler({ projectId, x1: 0, y1: 0, x2: 4, y2: 4, eraseLayer: "equipment" }, store);
    assert.equal(erased.page.cells.equipment, 0);
  } finally {
    cleanup();
  }
});

test("grid_manage_palette: 항목을 추가·수정하고 중복 이름을 막는다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);

    const added = managePaletteTool.handler(
      { projectId, action: "add", role: "status", name: "교체 예정", color: "#ff66aa", description: "3월 교체" },
      store,
    );
    assert.equal(added.item.role, "status");
    assert.equal(added.item.layer, "equipment");
    assert.equal(added.item.description, "3월 교체");

    assert.throws(
      () =>
        managePaletteTool.handler(
          { projectId, action: "add", role: "status", name: "교체 예정", color: "#123456" },
          store,
        ),
      /같은 디스플레이 이름/,
    );

    const updated = managePaletteTool.handler(
      { projectId, action: "update", paletteId: added.item.id, name: "교체 필요" },
      store,
    );
    assert.equal(updated.item.name, "교체 필요");
    assert.equal(updated.item.color, "#ff66aa"); // 안 준 값은 그대로 둔다
  } finally {
    cleanup();
  }
});

test("grid_manage_palette: 쓰이는 항목은 keepCells 로 지워도 정의가 남는다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);
    managePagesTool.handler({ projectId, action: "add", name: "2공장" }, store);

    const pages = getProjectTool.handler({ projectId }, store).pages;
    fillAreaTool.handler(
      { projectId, pageId: pages[0].id, x1: 0, y1: 0, x2: 2, y2: 1, paletteId: "installed" },
      store,
    );

    const kept = managePaletteTool.handler(
      { projectId, action: "delete", paletteId: "installed", deleteMode: "keepCells" },
      store,
    );
    assert.equal(kept.usedCells, 6);
    assert.equal(kept.definitionKept, true);

    // 다른 페이지에서 지워도 첫 페이지의 칸은 그대로다.
    const cells = getProjectTool.handler({ projectId, pageId: pages[0].id, includeCells: true }, store).cells;
    assert.equal(cells.equipment["0,0"].status, "installed");
  } finally {
    cleanup();
  }
});

test("grid_manage_palette: purgeCells 는 모든 페이지의 칸을 비운다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);
    const added = managePagesTool.handler({ projectId, action: "add", name: "2공장" }, store);
    const [first, second] = added.pages;

    fillAreaTool.handler({ projectId, pageId: first.id, x1: 0, y1: 0, x2: 1, y2: 1, paletteId: "installed" }, store);
    fillAreaTool.handler({ projectId, pageId: second.id, x1: 0, y1: 0, x2: 1, y2: 1, paletteId: "installed" }, store);

    const purged = managePaletteTool.handler(
      { projectId, action: "delete", paletteId: "installed", deleteMode: "purgeCells" },
      store,
    );
    assert.equal(purged.definitionKept, false);
    for (const page of [first, second]) {
      const cells = getProjectTool.handler({ projectId, pageId: page.id, includeCells: true }, store).cells;
      assert.deepEqual(cells.equipment, {});
    }
  } finally {
    cleanup();
  }
});

test("grid_manage_palette: 배경 타일은 고정 항목이라 고치거나 지울 수 없다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);
    assert.throws(
      () => managePaletteTool.handler({ projectId, action: "update", paletteId: "wall", name: "벽체" }, store),
      /고정 항목/,
    );
    assert.throws(
      () => managePaletteTool.handler({ projectId, action: "delete", paletteId: "wall" }, store),
      /고정 항목/,
    );
  } finally {
    cleanup();
  }
});

test("grid_manage_pages: 추가·이름변경·전환·크기변경", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);

    const added = managePagesTool.handler({ projectId, action: "add", name: "2공장" }, store);
    assert.equal(added.pages.length, 2);
    assert.equal(added.activePageId, added.pages[1].id);

    const renamed = managePagesTool.handler(
      { projectId, action: "rename", pageId: added.pages[1].id, name: "2공장 출하" },
      store,
    );
    assert.equal(renamed.pages[1].name, "2공장 출하");

    const activated = managePagesTool.handler({ projectId, action: "activate", pageId: added.pages[0].id }, store);
    assert.equal(activated.activePageId, added.pages[0].id);

    const resized = managePagesTool.handler(
      { projectId, action: "resize", pageId: added.pages[0].id, width: 60, height: 40 },
      store,
    );
    assert.equal(resized.pages[0].cols, 60);
    assert.equal(resized.pages[0].rows, 40);
  } finally {
    cleanup();
  }
});

test("grid_manage_pages: 복제는 셀을 그대로 옮기되 원본과 끊어져 있다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);
    const pages = getProjectTool.handler({ projectId }, store).pages;
    setCellTool.handler({ projectId, x: 2, y: 2, paletteId: "installed", label: "C1" }, store);

    const duplicated = managePagesTool.handler({ projectId, action: "duplicate", pageId: pages[0].id }, store);
    assert.equal(duplicated.pages.length, 2);
    const copy = duplicated.pages[1];
    assert.equal(copy.name, `${pages[0].name} 사본`);
    assert.equal(copy.cells.equipment, 1);

    // 복제본을 고쳐도 원본은 그대로다.
    setCellTool.handler({ projectId, pageId: copy.id, x: 2, y: 2, eraseLayer: "equipment" }, store);
    const originalCells = getProjectTool.handler({ projectId, pageId: pages[0].id, includeCells: true }, store).cells;
    assert.equal(originalCells.equipment["2,2"].label, "C1");
  } finally {
    cleanup();
  }
});

test("grid_manage_pages: 마지막 한 장은 지울 수 없다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store);
    const pages = getProjectTool.handler({ projectId }, store).pages;
    assert.throws(
      () => managePagesTool.handler({ projectId, action: "delete", pageId: pages[0].id }, store),
      /최소 1개/,
    );

    const added = managePagesTool.handler({ projectId, action: "add" }, store);
    const deleted = managePagesTool.handler({ projectId, action: "delete", pageId: added.pages[1].id }, store);
    assert.equal(deleted.pages.length, 1);
    assert.equal(deleted.activePageId, pages[0].id);
  } finally {
    cleanup();
  }
});

test("grid_export_preview: ASCII 는 격자와 범례를 함께 그린다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store, { width: 10, height: 10 });
    fillAreaTool.handler({ projectId, x1: 0, y1: 0, x2: 9, y2: 0, paletteId: "wall" }, store);
    setCellTool.handler({ projectId, x: 3, y: 5, paletteId: "reader" }, store);

    const preview = exportPreviewTool.handler({ projectId, format: "ascii" }, store);
    const lines = preview.ascii.split("\n");
    assert.equal(preview.truncated, false);
    assert.ok(preview.ascii.includes("테스트 공장"));

    // 첫 행은 전부 벽, 그 아래 줄은 비어 있어야 한다.
    const rowOf = (y) => lines.find((line) => line.startsWith(`${y} `)).slice(2);
    assert.equal(rowOf(0), "#".repeat(10));
    assert.equal(rowOf(1), ".".repeat(10));
    assert.equal(rowOf(5)[3], "A"); // 장비는 대문자
    assert.ok(preview.ascii.includes("범례"));
    assert.ok(preview.ascii.includes("리더"));
  } finally {
    cleanup();
  }
});

test("grid_export_preview: maxCols 를 넘으면 잘라내고 잘랐다고 알린다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store, { width: 60, height: 40 });
    const preview = exportPreviewTool.handler({ projectId, format: "ascii", maxCols: 20, maxRows: 10 }, store);
    assert.equal(preview.truncated, true);
    assert.ok(preview.ascii.includes("전체는 60 × 40"));
  } finally {
    cleanup();
  }
});

test("grid_export_preview: SVG 는 칸 색과 장비 글자를 담는다", () => {
  const { store, cleanup } = freshStore();
  try {
    const { projectId } = newProject(store, { width: 10, height: 10 });
    setCellTool.handler({ projectId, x: 1, y: 1, paletteId: "installed", label: "C1101" }, store);

    const preview = exportPreviewTool.handler({ projectId, format: "svg", cellPx: 10 }, store);
    assert.ok(preview.svg.startsWith("<svg"));
    assert.ok(preview.svg.includes('width="100" height="100"'));
    assert.ok(preview.svg.includes("#57a639")); // 설치(정상) 색
    assert.ok(preview.svg.includes("C1101"));
  } finally {
    cleanup();
  }
});

test("store: 없는 프로젝트와 상위 폴더 탈출을 거부한다", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.throws(() => store.read("없는-프로젝트"), /찾을 수 없습니다/);
    assert.throws(() => store.read("../secret"), /쓸 수 없는 projectId/);
  } finally {
    cleanup();
  }
});
