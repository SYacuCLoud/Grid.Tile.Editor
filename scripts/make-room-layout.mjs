/**
 * 사진(IMG_3132 · IMG_3133)으로 판독한 수산물 가공장 배치도를 만든다.
 *
 * 두 장 모두 도면이 아니라 실내 사진이라, 눈에 보이는 것(벽·출입구·작업대 줄·
 * 적치 구역·수조·동결고·배수로·천장 배선)을 평면으로 옮긴 재구성이다. 치수는
 * 실측이 아니라 사람·상자·작업대 크기로 어림한 값이다.
 *
 * 한 칸 = 0.5m, 40 × 24칸 = 20m × 12m.
 *
 * 다시 만들려면: node scripts/make-room-layout.mjs
 */

import { cellKey, createProject } from "../app/editor/doc.ts";
import { addPaletteEntry } from "../app/editor/paletteOps.ts";
import { exportPreviewTool } from "../mcp/tools/index.ts";
import { createRevisionStore } from "../server/revisions.ts";

const COLS = 40;
const ROWS = 24;
const PROJECT_ID = "가공장-배치도";
const AUTHOR = "사진 판독";

const project = createProject("수산물 가공장 배치도 (사진 판독)");
const page = project.pages[0];
page.name = "1층 가공장";
page.cols = COLS;
page.rows = ROWS;
page.paper = { id: "a3", orientation: "landscape", cellMm: 8, marginMm: 10 };

// ── 팔레트 ──────────────────────────────────────────────────────────
// 기본 팔레트(벽·통로·문·리더·저울·모니터·PC·배선)에 이 현장에서 필요한 것만 더한다.
const id = {};
function add(role, name, color, description, extra = {}) {
  const result = addPaletteEntry(project.palette, role, { name, color, description, ...extra });
  project.palette = result.palette;
  id[name] = result.created.id;
}

add("status", "가공 구역", "#dbe9f7", "선별 · 손질 작업대가 놓인 자리");
add("status", "보관 구역", "#fde8cf", "오렌지 상자 적치", { pattern: "dots" });
add("status", "세척 구역", "#d8f0e4", "세척대 · 수조 · 드럼", { pattern: "hatch" });
add("status", "사무 구역", "#ece0f5", "유리창 사무실", { pattern: "crosshatch" });

add("kind", "작업대", "#334155", "스테인리스 선별 작업대");
add("kind", "세척", "#0f766e", "세척대 · 싱크");
add("kind", "수조", "#1d4ed8", "파란 원형 수조");
add("kind", "적치", "#b45309", "플라스틱 상자 적치");
add("kind", "동결", "#0891b2", "동결고 단열문");
add("kind", "드럼", "#64748b", "스테인리스 드럼통");
add("kind", "선풍", "#7e22ce", "이동식 선풍기");
add("kind", "분전", "#be123c", "분전반 · 제어반");
add("kind", "CCTV", "#111827", "천장 돔 카메라");
add("kind", "냉방", "#2563eb", "천장형 냉방기");
add("kind", "대차", "#a16207", "이동식 작업 대차");

add("wire", "배수로", "#2563eb", "바닥 파란 배수 통로");
add("wire", "전원선", "#f2622a", "천장 배선 · 전원 릴", { lineStyle: "dotted" });

// ── 칸 놓기 도우미 ──────────────────────────────────────────────────
const tile = (x, y, value) => {
  page.background[cellKey(x, y)] = value;
};
const zone = (x, y, statusId) => {
  const key = cellKey(x, y);
  if (page.background[key] === "aisle" || page.background[key] === "wall") return;
  page.equipment[key] = { ...page.equipment[key], status: statusId };
};
const put = (x, y, kindId, label, memo) => {
  const key = cellKey(x, y);
  page.equipment[key] = {
    ...page.equipment[key],
    kind: kindId,
    ...(label ? { label } : {}),
    ...(memo ? { memo } : {}),
  };
};
const wire = (x, y, wireId) => {
  page.wiring[cellKey(x, y)] = wireId;
};

const forRect = (x0, y0, x1, y1, fn) => {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) fn(x, y);
};
const forLine = (x0, y0, x1, y1, fn) => {
  if (y0 === y1) for (let x = x0; x <= x1; x += 1) fn(x, y0);
  else for (let y = y0; y <= y1; y += 1) fn(x0, y);
};

// ── 벽과 출입구 ─────────────────────────────────────────────────────
forLine(0, 0, COLS - 1, 0, (x, y) => tile(x, y, "wall"));
forLine(0, ROWS - 1, COLS - 1, ROWS - 1, (x, y) => tile(x, y, "wall"));
forLine(0, 0, 0, ROWS - 1, (x, y) => tile(x, y, "wall"));
forLine(COLS - 1, 0, COLS - 1, ROWS - 1, (x, y) => tile(x, y, "wall"));

// 사무실 칸막이 (오른쪽 아래 유리창 사무실)
forLine(31, 17, 38, 17, (x, y) => tile(x, y, "wall"));
forLine(31, 17, 31, ROWS - 1, (x, y) => tile(x, y, "wall"));

// 세척 구역 쪽 기둥 — 사진에서 분전반이 붙어 있던 자리
tile(26, 1, "wall");
tile(26, 2, "wall");

// 출입구: 오른쪽 대형 셔터 · 아래 사람 출입문 · 사무실 문
forLine(COLS - 1, 10, COLS - 1, 13, (x, y) => tile(x, y, "door"));
forLine(6, ROWS - 1, 7, ROWS - 1, (x, y) => tile(x, y, "door"));
tile(31, 20, "door");

// ── 통로 (사진의 파란 바닥 띠) ──────────────────────────────────────
forLine(15, 1, 15, 22, (x, y) => tile(x, y, "aisle"));
forLine(16, 1, 16, 22, (x, y) => tile(x, y, "aisle"));
forRect(1, 20, 30, 21, (x, y) => tile(x, y, "aisle"));
// 셔터와 사무실 앞 통행 구간
forRect(27, 17, 30, 22, (x, y) => tile(x, y, "aisle"));

// ── 구역 색칠 ───────────────────────────────────────────────────────
forRect(1, 1, 26, 22, (x, y) => zone(x, y, id["가공 구역"]));
forRect(27, 1, 38, 6, (x, y) => zone(x, y, id["세척 구역"]));
forRect(27, 7, 38, 16, (x, y) => zone(x, y, id["보관 구역"]));
forRect(32, 18, 38, 22, (x, y) => zone(x, y, id["사무 구역"]));

// ── 작업대 ─────────────────────────────────────────────────────────
// 사진 IMG_3132: 왼쪽 벽을 따라 긴 작업대가 줄지어 있고 양쪽에 사람이 선다.
const benches = [
  { y: 4, x0: 2, x1: 13, label: "B-01", memo: "IMG_3132 왼쪽 첫 번째 선별 작업대" },
  { y: 8, x0: 2, x1: 13, label: "B-02" },
  { y: 12, x0: 2, x1: 13, label: "B-03" },
  { y: 16, x0: 2, x1: 13, label: "B-04" },
  { y: 5, x0: 18, x1: 24, label: "B-05", memo: "IMG_3133 오렌지 상자를 올려 둔 작업대" },
  { y: 11, x0: 18, x1: 24, label: "B-06" },
];
for (const bench of benches) {
  forLine(bench.x0, bench.y, bench.x1, bench.y, (x, y) => put(x, y, id["작업대"]));
  put(bench.x0, bench.y, id["작업대"], bench.label, bench.memo);
}

// 이동식 작업 대차 (IMG_3133 가운데 바퀴 달린 손질대)
forLine(18, 16, 22, 16, (x, y) => put(x, y, id["대차"]));
put(18, 16, id["대차"], "C-01", "IMG_3133 가운데 이동식 손질 대차");

// ── 보관 구역 상자 적치 ─────────────────────────────────────────────
const stacks = [
  { y: 8, label: "S-01" },
  { y: 10, label: "S-02" },
  { y: 12, label: "S-03" },
  { y: 14, label: "S-04" },
];
for (const stack of stacks) {
  forLine(28, stack.y, 37, stack.y, (x, y) => put(x, y, id["적치"]));
  put(28, stack.y, id["적치"], stack.label);
}
put(28, 8, id["적치"], "S-01", "IMG_3132 오른쪽 오렌지 상자 적치열");

// ── 세척 구역 ───────────────────────────────────────────────────────
forLine(28, 2, 33, 2, (x, y) => put(x, y, id["세척"]));
put(28, 2, id["세척"], "W-01", "IMG_3133 안쪽 세척대");
forRect(35, 3, 37, 4, (x, y) => put(x, y, id["수조"]));
put(35, 3, id["수조"], "T-01", "IMG_3133 좌측 파란 원형 수조");
forLine(28, 5, 30, 5, (x, y) => put(x, y, id["드럼"]));
put(28, 5, id["드럼"], "D-01", "스테인리스 드럼통 3기");

// ── 동결고 · 그 밖의 설비 ───────────────────────────────────────────
forLine(21, 1, 24, 1, (x, y) => put(x, y, id["동결"]));
put(21, 1, id["동결"], "F-01", "IMG_3133 안쪽 대형 단열문(동결고)");

put(8, 1, id.CCTV, "CC-01");
put(20, 1, id.CCTV, "CC-02", "IMG_3132 천장 돔 카메라");
put(30, 1, id.CCTV, "CC-03");
put(1, 2, id["냉방"], "AC-01", "IMG_3132 왼쪽 위 천장형 냉방기");
put(1, 6, id["분전"], "P-01");
put(26, 3, id["분전"], "P-02", "IMG_3132 기둥 분전반");
put(14, 10, id["선풍"], "FA-1");
put(17, 14, id["선풍"], "FA-2", "IMG_3132 바닥 이동식 선풍기");

// 기본 팔레트 항목 — 모니터 · 저울 · 리더 · PC
put(25, 2, "monitor", "M-01", "IMG_3132 벽걸이 모니터");
put(17, 19, "scale", "SC-01", "계량대");
put(38, 11, "reader", "R-01", "셔터 출입구 리더");
put(7, 22, "reader", "R-02", "출입문 리더");
put(34, 19, "pc", "PC-01", "IMG_3133 우측 유리창 사무실");

// ── 배수로와 천장 배선 ──────────────────────────────────────────────
forLine(15, 1, 15, 22, (x, y) => wire(x, y, id["배수로"]));
forLine(1, 21, 30, 21, (x, y) => wire(x, y, id["배수로"]));
forLine(17, 2, 38, 2, (x, y) => wire(x, y, id["전원선"]));
forLine(26, 2, 26, 6, (x, y) => wire(x, y, id["전원선"]));

// ── 저장 (이력 스냅샷까지) ──────────────────────────────────────────
const store = createRevisionStore();
const saved = store.save({ id: PROJECT_ID, project, mode: "overwrite", author: AUTHOR });
if (!saved.ok) throw new Error("저장하지 못했다.");

const preview = exportPreviewTool.handler({ projectId: PROJECT_ID, format: "ascii" }, store.projects);
console.log(preview.ascii);
console.log("");
console.log(`저장: ${store.projects.path(PROJECT_ID)} (r${saved.revision})`);
console.log(`이력: ${store.history(PROJECT_ID).length}건`);
