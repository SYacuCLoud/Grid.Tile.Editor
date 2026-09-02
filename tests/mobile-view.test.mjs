import assert from "node:assert/strict";
import test from "node:test";
import { cellKey, createProject, updateEquipmentInfoOnPage } from "../app/editor/doc.ts";
import { linkDeviceToCell, upsertDeviceInProject } from "../app/editor/device.ts";
import {
  cellAt,
  cellSummary,
  centerOn,
  clampCell,
  clampOffset,
  fitCell,
  isEmptyCell,
  MAX_CANVAS_PX,
  MAX_VIEW_CELL,
  MIN_VIEW_CELL,
  maxCellFor,
  zoomAbout,
} from "../app/m/mobileView.ts";

test("맞춤 크기: 도면 전체가 화면에 들어가고 0.5px 단위다", () => {
  // 48x30 도면, 390x600 화면(여백 16) → 가로 374/48=7.79, 세로 584/30=19.4 → 7.5
  const cell = fitCell(48, 30, 390, 600);
  assert.equal(cell, 7.5);
  assert.ok(48 * cell <= 390 - 16 && 30 * cell <= 600 - 16, "도면이 화면을 넘는다");
  assert.equal(cell * 2, Math.floor(cell * 2), "0.5px 단위가 아니다");
});

test("칸 크기 한계: 아래로는 읽을 수 없고 위로는 캔버스 상한을 넘지 않는다", () => {
  assert.equal(clampCell(0.1, 48, 30), MIN_VIEW_CELL);
  assert.equal(clampCell(999, 48, 30), MAX_VIEW_CELL);
  // 200칸 도면은 64px 로 키우면 12800px 라 상한(4096)에서 막힌다.
  assert.equal(maxCellFor(200, 200), Math.floor(MAX_CANVAS_PX / 200));
  assert.ok(200 * maxCellFor(200, 200) <= MAX_CANVAS_PX);
  assert.equal(clampCell(Number.NaN, 48, 30), MIN_VIEW_CELL);
});

test("오프셋 한계: 작은 축은 가운데, 큰 축은 여백이 보이지 않는 범위", () => {
  // 캔버스 200x900, 화면 400x600 → x 는 가운데(100), y 는 [-300, 0]
  assert.deepEqual(clampOffset({ x: -50, y: 50 }, 200, 900, 400, 600), { x: 100, y: 0 });
  assert.deepEqual(clampOffset({ x: 999, y: -999 }, 200, 900, 400, 600), { x: 100, y: -300 });
  assert.deepEqual(clampOffset({ x: 0, y: -120 }, 200, 900, 400, 600), { x: 100, y: -120 });
});

test("확대 기준점: 손가락 아래 칸은 배율이 바뀌어도 그 자리에 있다", () => {
  const offset = { x: -40, y: -70 };
  const anchor = { x: 150, y: 220 };
  const oldCell = 10;
  const newCell = 25;
  const docPoint = { x: (anchor.x - offset.x) / oldCell, y: (anchor.y - offset.y) / oldCell };

  const next = zoomAbout(offset, oldCell, newCell, anchor);
  const after = { x: (anchor.x - next.x) / newCell, y: (anchor.y - next.y) / newCell };
  assert.ok(Math.abs(after.x - docPoint.x) < 1e-9 && Math.abs(after.y - docPoint.y) < 1e-9, "기준점 아래 칸이 움직였다");
});

test("가운데 맞춤과 칸 찾기가 서로 맞는다", () => {
  const cell = 20;
  const view = { w: 400, h: 600 };
  const offset = centerOn({ x: 7, y: 3 }, cell, view.w, view.h);
  // 화면 가운데를 누르면 그 칸이 잡힌다.
  assert.deepEqual(cellAt({ x: view.w / 2, y: view.h / 2 }, offset, cell, 48, 30), { x: 7, y: 3 });
  // 도면 밖은 null.
  assert.equal(cellAt({ x: -5, y: 10 }, { x: 0, y: 0 }, cell, 48, 30), null);
  assert.equal(cellAt({ x: 48 * cell + 1, y: 10 }, { x: 0, y: 0 }, cell, 48, 30), null);
});

test("칸 요약: 팔레트 항목 · 장비 ID · 메모 · 장치를 한데 모은다", () => {
  let project = createProject("모바일");
  const page0 = project.pages[0];
  const tile = project.palette.find((item) => item.role === "tile");
  const status = project.palette.find((item) => item.role === "status");
  const kind = project.palette.find((item) => item.role === "kind");
  assert.ok(tile && status && kind, "기본 팔레트에 항목이 없다");

  const key = cellKey(3, 4);
  let page = { ...page0, background: { ...page0.background, [key]: tile.id } };
  page = { ...page, equipment: { ...page.equipment, [key]: { status: status.id, kind: kind.id } } };
  page = updateEquipmentInfoOnPage(page, key, { label: "C1101", memo: "점검 대상" });
  project = { ...project, pages: [page] };
  project = upsertDeviceInProject(project, { id: "dev-1", type: "RFID 리더기", serial: "RR657-002219", ip: "10.0.0.5" });
  project = linkDeviceToCell(project, key, "dev-1");

  const summary = cellSummary(project, project.pages[0], 3, 4);
  assert.equal(summary.key, key);
  assert.equal(isEmptyCell(summary), false);
  // 장치를 연결하면 칸 글자는 장치 S/N 을 따른다.
  assert.equal(summary.label, "RR657-002219");
  assert.equal(summary.memo, "점검 대상");
  assert.deepEqual(
    summary.items.map((entry) => entry.item.id),
    [tile.id, status.id, kind.id],
  );
  assert.ok(summary.items.every((entry) => entry.layer.length > 0), "레이어 이름이 비었다");
  assert.equal(summary.device?.id, "dev-1");
  assert.equal(summary.device?.ip, "10.0.0.5");

  // 아무것도 없는 칸.
  const empty = cellSummary(project, project.pages[0], 0, 0);
  assert.equal(isEmptyCell(empty), true);
});
