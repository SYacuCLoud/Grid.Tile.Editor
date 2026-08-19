import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cellPhotos, createProject, updateEquipmentInfoOnPage } from "../app/editor/doc.ts";
import { diffProjects, summarizeDiff } from "../app/editor/diff.ts";
import {
  checkPhotoRoom,
  fitSize,
  formatBytes,
  MAX_CELL_PHOTO_CHARS,
  MAX_CELL_PHOTOS,
  MAX_PHOTO_CHARS,
  photoBytes,
  photosBytes,
  sanitizePhoto,
  sanitizePhotos,
} from "../app/editor/photo.ts";
import { renderDoc } from "../app/editor/render.ts";
import { sanitizeProject } from "../app/editor/storage.ts";
import { createStore } from "../mcp/store.ts";
import { checkpointTool, createProjectTool, diffTool, historyTool, restoreTool, setCellTool } from "../mcp/tools/index.ts";
import { createRevisionStore } from "../server/revisions.ts";
import { recordingContext, VISIBLE } from "./recording-context.mjs";

/** 아주 작은 1×1 PNG. 실제 그림 파일이 없어도 검사 규칙을 시험할 수 있다. */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

/** 서로 다른 사진 여러 장. 검사·비교는 내용이 아니라 문자열이 갈리는지만 본다. */
function photo(seed) {
  return `${TINY_PNG.slice(0, -4)}${seed}A/w==`;
}

/** 한 장이 한도에 꽉 찬 사진. 칸 총량 한도를 시험할 때 쓴다. */
function heavyPhoto(seed) {
  const head = `data:image/png;base64,${seed}`;
  return head + "A".repeat(MAX_PHOTO_CHARS - head.length);
}

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "grid-diff-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function at(minute) {
  return new Date(Date.UTC(2026, 7, 19, 3, minute, 0));
}

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

// ── diff ────────────────────────────────────────────────────────────

test("diff: 같은 도면끼리는 달라진 곳이 없다", () => {
  const project = createProject("같음");
  project.pages[0].background["1,1"] = "wall";
  const copy = sanitizeProject(JSON.parse(JSON.stringify(project)));

  const diff = diffProjects(project, copy);
  assert.deepEqual(diff.counts, { added: 0, removed: 0, changed: 0 });
  assert.deepEqual(diff.pages, []);
  assert.deepEqual(diff.palette, []);
  assert.equal(summarizeDiff(diff), "달라진 곳이 없습니다.");
});

test("diff: 추가 · 삭제 · 변경을 갈라 센다", () => {
  const before = createProject("변화");
  before.pages[0].background["1,1"] = "wall";
  before.pages[0].background["2,2"] = "aisle";
  before.pages[0].equipment["3,3"] = { status: "installed" };

  const after = sanitizeProject(JSON.parse(JSON.stringify(before)));
  delete after.pages[0].background["2,2"]; // 삭제
  after.pages[0].background["4,4"] = "door"; // 추가
  after.pages[0].equipment["3,3"] = { status: "pending" }; // 변경

  const diff = diffProjects(before, after);
  assert.deepEqual(diff.counts, { added: 1, removed: 1, changed: 1 });

  const page = diff.pages[0];
  assert.equal(page.status, "changed");
  const kinds = Object.fromEntries(page.changes.map((change) => [change.key, change.kind]));
  assert.equal(kinds["4,4"], "added");
  assert.equal(kinds["2,2"], "removed");
  assert.equal(kinds["3,3"], "changed");

  // 변경 칸은 이전·이후 값을 사람이 읽을 수 있게 담는다.
  const changed = page.changes.find((change) => change.key === "3,3");
  assert.match(changed.before, /상태=installed/);
  assert.match(changed.after, /상태=pending/);
  assert.match(summarizeDiff(diff), /추가 1칸 · 삭제 1칸 · 변경 1칸/);
});

test("diff: 좌표와 레이어를 함께 알려 준다", () => {
  const before = createProject("좌표");
  const after = sanitizeProject(JSON.parse(JSON.stringify(before)));
  after.pages[0].wiring["7,9"] = "wirePurple";

  const change = diffProjects(before, after).pages[0].changes[0];
  assert.deepEqual(
    { x: change.x, y: change.y, layer: change.layer, kind: change.kind },
    { x: 7, y: 9, layer: "wiring", kind: "added" },
  );
});

test("diff: 페이지가 늘거나 줄면 그것도 잡는다", () => {
  const before = createProject("페이지");
  const after = sanitizeProject(JSON.parse(JSON.stringify(before)));
  after.pages.push({ ...before.pages[0], id: "page-2", name: "2공장", background: {}, equipment: {}, wiring: {} });

  const diff = diffProjects(before, after);
  const added = diff.pages.find((page) => page.pageId === "page-2");
  assert.equal(added.status, "added");
  assert.equal(added.size.before, null);
  assert.equal(added.size.after, "48 × 30");
});

test("diff: 격자 크기 · 용지 · 팔레트 변화도 알려 준다", () => {
  const before = createProject("설정");
  const after = sanitizeProject(JSON.parse(JSON.stringify(before)));
  after.pages[0].cols = 60;
  after.pages[0].paper = { id: "a3", orientation: "portrait", cellMm: 7, marginMm: 8 };
  after.palette = after.palette.map((item) => (item.id === "installed" ? { ...item, name: "설치 완료" } : item));

  const diff = diffProjects(before, after);
  const page = diff.pages[0];
  assert.equal(page.size.before, "48 × 30");
  assert.equal(page.size.after, "60 × 30");
  assert.equal(page.paper.before, null);
  assert.match(page.paper.after, /^a3 portrait 7mm/);

  const palette = diff.palette.find((entry) => entry.id === "installed");
  assert.equal(palette.kind, "changed");
  assert.match(palette.after, /설치 완료/);
});

// ── MCP 이력 도구 ───────────────────────────────────────────────────

test("grid_history: 리비전 목록을 최근 순으로 준다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const revisions = createRevisionStore(dir);
    const created = revisions.create("이력 도구", "홍길동", at(0));
    const project = revisions.read(created.id).project;
    project.title = "이력 도구 2";
    revisions.save({ id: created.id, project, baseRevision: 1, author: "김철수", now: at(5) });

    const result = historyTool.handler({ projectId: created.id }, createStore(dir));
    assert.equal(result.current, 2);
    assert.equal(result.total, 2);
    assert.equal(result.externalChange, false);
    assert.deepEqual(
      result.revisions.map((entry) => entry.revision),
      [2, 1],
    );
    assert.equal(result.revisions[0].author, "김철수");
    assert.equal(result.revisions[0].title, "이력 도구 2");
  } finally {
    cleanup();
  }
});

test("grid_history: limit 으로 최근 몇 건만 본다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const revisions = createRevisionStore(dir);
    const created = revisions.create("여러 판", "가", at(0));
    for (let n = 0; n < 4; n += 1) {
      const project = revisions.read(created.id).project;
      project.title = `판 ${n}`;
      revisions.save({ id: created.id, project, baseRevision: n + 1, author: "가", now: at(n + 1) });
    }

    const result = historyTool.handler({ projectId: created.id, limit: 2 }, createStore(dir));
    assert.equal(result.total, 5);
    assert.equal(result.revisions.length, 2);
  } finally {
    cleanup();
  }
});

test("grid_restore: 과거 내용으로 되돌리고 무엇이 바뀌었는지 요약한다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const revisions = createRevisionStore(dir);
    const created = revisions.create("복원", "가", at(0));
    const store = createStore(dir);

    setCellTool.handler({ projectId: created.id, x: 1, y: 1, paletteId: "wall" }, store);
    const project = revisions.read(created.id).project;
    revisions.save({ id: created.id, project, mode: "overwrite", author: "가", now: at(1) });

    const result = restoreTool.handler({ projectId: created.id, revision: 1, author: "나" }, store);
    assert.equal(result.restoredFrom, 1);
    assert.equal(result.revision, 3, "되돌리기도 새 리비전으로 쌓인다");
    assert.match(result.author, /r1 복원/);
    assert.match(result.summary, /삭제 1칸/);

    // 실제로 그 칸이 비워졌다.
    assert.equal(revisions.read(created.id).project.pages[0].background["1,1"], undefined);
  } finally {
    cleanup();
  }
});

test("grid_diff: 두 리비전을 비교하고 칸 목록은 요청할 때만 담는다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const revisions = createRevisionStore(dir);
    const created = revisions.create("비교", "가", at(0));
    const store = createStore(dir);

    setCellTool.handler({ projectId: created.id, x: 2, y: 2, paletteId: "wall", label: "C1" }, store);
    revisions.save({ id: created.id, project: revisions.read(created.id).project, mode: "overwrite", now: at(1) });

    const summary = diffTool.handler({ projectId: created.id, from: 1, to: 2 }, store);
    assert.equal(summary.counts.added, 2, "배경 한 칸 + 장비 ID 한 칸");
    assert.equal(summary.cells, undefined);
    assert.match(summary.summary, /추가 2칸/);

    const detailed = diffTool.handler({ projectId: created.id, from: 1, to: 2, includeCells: true }, store);
    assert.equal(detailed.cells.length, 2);
    assert.equal(detailed.cellsOmitted, 0);
    assert.ok(detailed.cells.every((cell) => cell.pageId && cell.kind === "added"));
  } finally {
    cleanup();
  }
});

test("grid_diff: to 를 생략하면 지금 파일과 비교한다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const revisions = createRevisionStore(dir);
    const created = revisions.create("현재 비교", "가", at(0));
    const store = createStore(dir);

    // 저장하지 않고 파일만 바꾼다(MCP 가 고친 상황).
    setCellTool.handler({ projectId: created.id, x: 5, y: 5, paletteId: "aisle" }, store);

    const result = diffTool.handler({ projectId: created.id, from: 1 }, store);
    assert.equal(result.to, "현재 파일");
    assert.equal(result.counts.added, 1);
  } finally {
    cleanup();
  }
});

test("grid_diff: 잘라낸 칸 수를 숨기지 않는다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const revisions = createRevisionStore(dir);
    const created = revisions.create("많은 변화", "가", at(0));
    const store = createStore(dir);

    for (let x = 0; x < 10; x += 1) {
      setCellTool.handler({ projectId: created.id, x, y: 0, paletteId: "wall" }, store);
    }

    const result = diffTool.handler(
      { projectId: created.id, from: 1, includeCells: true, maxCells: 3 },
      store,
    );
    assert.equal(result.cells.length, 3);
    assert.equal(result.cellsOmitted, 7);
  } finally {
    cleanup();
  }
});

test("grid_diff · grid_restore: 없는 리비전은 거부한다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const revisions = createRevisionStore(dir);
    const created = revisions.create("없는 판", "가", at(0));
    const store = createStore(dir);

    assert.throws(() => diffTool.handler({ projectId: created.id, from: 9 }, store), /리비전을 찾을 수 없습니다/);
    assert.throws(
      () => restoreTool.handler({ projectId: created.id, revision: 9 }, store),
      /리비전을 찾을 수 없습니다/,
    );
  } finally {
    cleanup();
  }
});

// ── 사진 ────────────────────────────────────────────────────────────

test("사진 검사: 그림 data URL 만 받는다", () => {
  assert.equal(sanitizePhoto(TINY_PNG), TINY_PNG);
  assert.equal(sanitizePhoto("https://example.com/a.png"), null, "바깥 링크는 담지 않는다");
  assert.equal(sanitizePhoto("data:text/html;base64,PHNjcmlwdD4="), null, "그림이 아닌 것은 거른다");
  assert.equal(sanitizePhoto(123), null);
  assert.equal(sanitizePhoto(`data:image/png;base64,${"A".repeat(MAX_PHOTO_CHARS)}`), null, "너무 크면 거른다");
});

test("사진 크기: 긴 변만 맞추고 비율은 지킨다", () => {
  assert.deepEqual(fitSize(4032, 3024, 480), { width: 480, height: 360 });
  assert.deepEqual(fitSize(1000, 2000, 480), { width: 240, height: 480 });
  // 이미 작으면 건드리지 않는다.
  assert.deepEqual(fitSize(300, 200, 480), { width: 300, height: 200 });
});

test("사진 크기 표시: 사람이 읽는 단위로 바꾼다", () => {
  assert.equal(formatBytes(512), "512B");
  assert.equal(formatBytes(2048), "2KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0MB");
  assert.ok(photoBytes(TINY_PNG) > 0);
});

test("사진 저장: 문서에 남고 다시 열어도 살아 있다", () => {
  const project = createProject("사진 저장");
  // 이전 판 호출부처럼 photo 한 장만 넘겨도 목록으로 들어간다.
  project.pages[0] = updateEquipmentInfoOnPage(project.pages[0], "2,2", {
    label: "C1",
    memo: "현장 사진",
    photo: TINY_PNG,
  });
  assert.deepEqual(project.pages[0].equipment["2,2"].photos, [TINY_PNG]);

  const restored = sanitizeProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.pages[0].equipment["2,2"].photos, [TINY_PNG]);
});

test("사진 저장: 이상한 값이 섞여 들어오면 사진만 버린다", () => {
  const project = createProject("이상한 사진");
  project.pages[0].equipment["1,1"] = { label: "C9", photo: "javascript:alert(1)" };

  const restored = sanitizeProject(JSON.parse(JSON.stringify(project)));
  assert.equal(restored.pages[0].equipment["1,1"].photo, undefined);
  assert.equal(restored.pages[0].equipment["1,1"].photos, undefined);
  assert.equal(restored.pages[0].equipment["1,1"].label, "C9", "나머지 값은 그대로 남는다");
});

test("사진 지우기: 빈 값을 주면 칸에서 사진이 빠진다", () => {
  const project = createProject("사진 지우기");
  let page = updateEquipmentInfoOnPage(project.pages[0], "1,1", { label: "", memo: "", photo: TINY_PNG });
  assert.deepEqual(page.equipment["1,1"].photos, [TINY_PNG]);

  page = updateEquipmentInfoOnPage(page, "1,1", { label: "", memo: "", photo: "" });
  assert.equal(page.equipment["1,1"], undefined, "남은 값이 없으면 칸 자체가 비워진다");
});

test("도면 렌더: 사진이 붙은 칸에 표시를 남긴다", () => {
  const project = createProject("사진 표시");
  const page = project.pages[0];
  // 이전 판 모양(단일 photo)으로도 표시가 나와야 한다.
  page.equipment["1,1"] = { status: "installed", photo: TINY_PNG };
  page.equipment["3,1"] = { status: "installed" };

  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell: 24, visible: VISIBLE, showGrid: false });

  // 사진 표시는 칸 왼쪽 아래에 작은 네모로 그린다.
  const marks = ctx.ops.filter((op) => op.op === "strokeRect" && op.color === "#111827");
  assert.equal(marks.length, 1, "사진이 있는 칸에만 표시가 있어야 한다");
  assert.ok(marks[0].x >= 24 && marks[0].x < 24 + 12, "왼쪽 아래 자리");
  assert.ok(marks[0].w < 24);
});

test("grid_create_project: 만들 때 첫 리비전을 함께 남긴다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createStore(dir);
    const created = createProjectTool.handler({ title: "기준점", width: 12, height: 10 }, store);
    assert.equal(created.revision, 1, "되돌릴 기준점이 있어야 한다");

    const history = historyTool.handler({ projectId: created.projectId }, store);
    assert.equal(history.total, 1);
    assert.equal(history.revisions[0].author, "MCP");
  } finally {
    cleanup();
  }
});

test("grid_checkpoint: 지금 파일을 새 리비전으로 남긴다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createStore(dir);
    const created = createProjectTool.handler({ title: "체크포인트", width: 12, height: 10 }, store);

    // 다른 도구는 파일만 고친다 — 그래서 바깥 수정으로 잡힌다.
    setCellTool.handler({ projectId: created.projectId, x: 1, y: 1, paletteId: "wall" }, store);
    assert.equal(historyTool.handler({ projectId: created.projectId }, store).externalChange, true);

    const cp = checkpointTool.handler({ projectId: created.projectId, author: "에이전트" }, store);
    assert.equal(cp.revision, 2);
    assert.equal(cp.author, "에이전트");

    const after = historyTool.handler({ projectId: created.projectId }, store);
    assert.equal(after.total, 2);
    assert.equal(after.externalChange, false, "리비전을 남긴 뒤에는 이력과 파일이 같다");
  } finally {
    cleanup();
  }
});

// ── 사진 여러 장 ────────────────────────────────────────────────────

test("사진 목록 검사: 그림만 남기고 같은 사진은 한 번만 담는다", () => {
  const a = photo("aa");
  const b = photo("bb");

  assert.deepEqual(sanitizePhotos([a, b]), [a, b]);
  assert.deepEqual(sanitizePhotos([a, a, b]), [a, b], "같은 사진은 한 번만");
  assert.deepEqual(sanitizePhotos([a, "javascript:alert(1)", b]), [a, b], "그림이 아닌 것만 빠진다");
  assert.deepEqual(sanitizePhotos("사진 아님"), [], "배열이 아니면 빈 목록");
  assert.deepEqual(sanitizePhotos(undefined), []);
});

test("사진 목록 검사: 장수 한도를 넘기면 앞쪽만 담는다", () => {
  const many = Array.from({ length: MAX_CELL_PHOTOS + 3 }, (_, n) => photo(`p${n}`));
  const kept = sanitizePhotos(many);

  assert.equal(kept.length, MAX_CELL_PHOTOS);
  assert.deepEqual(kept, many.slice(0, MAX_CELL_PHOTOS), "앞에서부터 담는다");
});

test("사진 목록 검사: 칸 총 용량 한도를 넘기는 장은 빼고 담는다", () => {
  const fit = Math.floor(MAX_CELL_PHOTO_CHARS / MAX_PHOTO_CHARS);
  const heavy = Array.from({ length: fit + 2 }, (_, n) => heavyPhoto(`h${n}`));

  const kept = sanitizePhotos(heavy);
  assert.equal(kept.length, fit, "총량 안에 들어가는 만큼만 담는다");
  assert.ok(
    kept.reduce((sum, one) => sum + one.length, 0) <= MAX_CELL_PHOTO_CHARS,
    "담긴 사진을 합쳐도 한도를 넘지 않는다",
  );
});

test("사진 붙이기 검사: 막힐 이유를 미리 알려 준다", () => {
  const a = photo("aa");
  assert.equal(checkPhotoRoom([], a), null, "빈 칸에는 붙는다");
  assert.match(checkPhotoRoom([a], a), /이미 붙어 있습니다/);

  const full = Array.from({ length: MAX_CELL_PHOTOS }, (_, n) => photo(`f${n}`));
  assert.match(checkPhotoRoom(full, a), new RegExp(`${MAX_CELL_PHOTOS}장`));

  const fit = Math.floor(MAX_CELL_PHOTO_CHARS / MAX_PHOTO_CHARS);
  const heavy = Array.from({ length: fit }, (_, n) => heavyPhoto(`h${n}`));
  assert.match(checkPhotoRoom(heavy, heavyPhoto("x")), /용량/);
});

test("사진 용량: 여러 장을 합쳐 센다", () => {
  const two = [photo("aa"), photo("bb")];
  assert.equal(photosBytes(two), photoBytes(two[0]) + photoBytes(two[1]));
  assert.equal(photosBytes([]), 0);
});

test("이전 판 호환: 사진 한 장만 있던 문서를 열면 목록으로 올라온다", () => {
  const project = createProject("옛 문서");
  // 이전 판이 저장한 모양 그대로 — photos 가 없고 photo 만 있다.
  project.pages[0].equipment["1,1"] = { label: "C1", photo: TINY_PNG };

  const restored = sanitizeProject(JSON.parse(JSON.stringify(project)));
  const cell = restored.pages[0].equipment["1,1"];
  assert.deepEqual(cell.photos, [TINY_PNG], "목록으로 옮겨진다");
  assert.equal(cell.photo, undefined, "옛 필드는 남지 않는다");
  assert.equal(cell.label, "C1");
});

test("이전 판 호환: 두 필드가 함께 있으면 옛 사진을 앞에 세우고 겹치지 않게 합친다", () => {
  const project = createProject("섞인 문서");
  const a = photo("aa");
  const b = photo("bb");
  project.pages[0].equipment["2,2"] = { photo: a, photos: [b, a] };

  const cell = sanitizeProject(JSON.parse(JSON.stringify(project))).pages[0].equipment["2,2"];
  assert.deepEqual(cell.photos, [a, b]);
});

test("이전 판 호환: cellPhotos 는 어느 모양이든 목록으로 읽는다", () => {
  assert.deepEqual(cellPhotos(undefined), []);
  assert.deepEqual(cellPhotos({}), []);
  assert.deepEqual(cellPhotos({ photo: TINY_PNG }), [TINY_PNG]);
  assert.deepEqual(cellPhotos({ photos: [TINY_PNG] }), [TINY_PNG]);
  assert.deepEqual(cellPhotos({ photos: [], photo: TINY_PNG }), [TINY_PNG], "빈 목록이면 옛 필드를 본다");
});

test("사진 여러 장 저장: 넣은 순서대로 남고 다시 열어도 살아 있다", () => {
  const a = photo("aa");
  const b = photo("bb");
  const project = createProject("여러 장");
  project.pages[0] = updateEquipmentInfoOnPage(project.pages[0], "3,3", {
    label: "C2",
    memo: "앞·뒤 사진",
    photos: [a, b],
  });

  const restored = sanitizeProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.pages[0].equipment["3,3"].photos, [a, b]);
});

test("사진 여러 장 지우기: 한 장만 빼도 되고 다 빼면 칸이 비워진다", () => {
  const a = photo("aa");
  const b = photo("bb");
  let page = updateEquipmentInfoOnPage(createProject("지우기").pages[0], "1,1", {
    label: "",
    memo: "",
    photos: [a, b],
  });

  page = updateEquipmentInfoOnPage(page, "1,1", { label: "", memo: "", photos: [b] });
  assert.deepEqual(page.equipment["1,1"].photos, [b], "고른 한 장만 빠진다");

  page = updateEquipmentInfoOnPage(page, "1,1", { label: "", memo: "", photos: [] });
  assert.equal(page.equipment["1,1"], undefined, "남은 값이 없으면 칸 자체가 비워진다");
});

test("사진 여러 장 편집: 사진 자리를 비워 둔 patch 는 사진을 건드리지 않는다", () => {
  const a = photo("aa");
  let page = updateEquipmentInfoOnPage(createProject("메모만").pages[0], "4,4", {
    label: "C3",
    memo: "",
    photos: [a],
  });

  page = updateEquipmentInfoOnPage(page, "4,4", { memo: "메모만 고침" });
  assert.deepEqual(page.equipment["4,4"].photos, [a]);
  assert.equal(page.equipment["4,4"].memo, "메모만 고침");
});

test("diff: 사진 장수와 갈아 끼운 장을 함께 잡는다", () => {
  const a = photo("aa");
  const b = photo("bb");
  const c = photo("cc");

  const before = createProject("사진 비교");
  before.pages[0].equipment["1,1"] = { status: "installed", photos: [a] };

  const added = sanitizeProject(JSON.parse(JSON.stringify(before)));
  added.pages[0].equipment["1,1"] = { status: "installed", photos: [a, b] };
  const addedChange = diffProjects(before, added).pages[0].changes[0];
  assert.match(addedChange.before, /사진=1장/);
  assert.match(addedChange.after, /사진=2장/);

  // 장수가 같아도 다른 사진으로 바꾸면 변경으로 잡힌다.
  const swapped = sanitizeProject(JSON.parse(JSON.stringify(before)));
  swapped.pages[0].equipment["1,1"] = { status: "installed", photos: [c] };
  const swap = diffProjects(before, swapped);
  assert.equal(swap.counts.changed, 1);
  assert.notEqual(swap.pages[0].changes[0].before, swap.pages[0].changes[0].after);

  // 다 지우면 사진 항목 자체가 빠진다.
  const cleared = sanitizeProject(JSON.parse(JSON.stringify(before)));
  cleared.pages[0].equipment["1,1"] = { status: "installed" };
  const clearedChange = diffProjects(before, cleared).pages[0].changes[0];
  assert.doesNotMatch(clearedChange.after, /사진=/);
});

test("diff: 옛 단일 사진과 한 장짜리 목록은 같은 것으로 본다", () => {
  const before = createProject("호환 비교");
  before.pages[0].equipment["1,1"] = { status: "installed", photo: TINY_PNG };

  const after = createProject("호환 비교");
  after.pages[0].equipment["1,1"] = { status: "installed", photos: [TINY_PNG] };

  assert.deepEqual(diffProjects(before, after).counts, { added: 0, removed: 0, changed: 0 });
});

test("도면 렌더: 사진이 두 장 이상이면 장수를 함께 적는다", () => {
  const project = createProject("장수 표시");
  const page = project.pages[0];
  page.equipment["1,1"] = { status: "installed", photos: [photo("aa"), photo("bb"), photo("cc")] };
  page.equipment["3,1"] = { status: "installed", photos: [photo("dd")] };

  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell: 24, visible: VISIBLE, showGrid: false });

  const marks = ctx.ops.filter((op) => op.op === "strokeRect" && op.color === "#111827");
  assert.equal(marks.length, 2, "사진이 있는 두 칸 모두 표시가 있다");

  const counts = ctx.ops.filter((op) => op.op === "fillText" && op.text === "3");
  assert.equal(counts.length, 1, "세 장인 칸에만 장수를 적는다");
  assert.equal(ctx.ops.filter((op) => op.op === "fillText" && op.text === "1").length, 0, "한 장이면 적지 않는다");
});
