import assert from "node:assert/strict";
import test from "node:test";
import {
  addPageToProject,
  activeLayoutDoc,
  activePage,
  createProject,
  deletePageFromProject,
  paintCellsOnPage,
  renamePageInProject,
  stepPageId,
  switchActivePage,
  updateEquipmentInfoOnPage,
} from "../app/editor/doc.ts";
import { indexPalette, itemsOfRole, resolveItem } from "../app/editor/palette.ts";
import {
  addPaletteEntry,
  deleteItemInProject,
  legendItems,
  legendItemsForProject,
  usageCount,
  updatePaletteEntry,
  usageCountInProject,
  validateInput,
} from "../app/editor/paletteOps.ts";
import { parseProjectJson, projectToJson, sanitizeProject } from "../app/editor/storage.ts";

test("페이지 추가, 이름 변경, 페이지 전환 및 데이터 격리", () => {
  let project = createProject("테스트 프로젝트");
  assert.equal(project.pages.length, 1);
  assert.equal(activePage(project).name, "1층 메인 공장");

  // 페이지 1 이름 변경
  project = renamePageInProject(project, project.pages[0].id, "1층 세척 라인");
  assert.equal(activePage(project).name, "1층 세척 라인");

  // 새 페이지 추가
  project = addPageToProject(project, "2층 출하 라인");
  assert.equal(project.pages.length, 2);
  assert.equal(activePage(project).name, "2층 출하 라인");

  // 2층 페이지에 타일 칠하기
  project.pages[1] = paintCellsOnPage(project.pages[1], { id: "wall", role: "tile", name: "벽", layer: "background", color: "#000" }, [{ x: 1, y: 1 }]);
  assert.equal(project.pages[1].background["1,1"], "wall");

  // 1층으로 전환
  project = switchActivePage(project, project.pages[0].id);
  assert.equal(activePage(project).name, "1층 세척 라인");
  assert.equal(activePage(project).background["1,1"], undefined); // 1층은 영향을 받지 않음
});

test("페이지 삭제 및 최소 1페이지 보장 규칙", () => {
  let project = createProject("삭제 테스트");
  project = addPageToProject(project, "임시 페이지");
  assert.equal(project.pages.length, 2);

  const tempPageId = project.activePageId;

  // 임시 페이지 삭제 -> 1페이지로 축소 및 이전 페이지로 활성화
  project = deletePageFromProject(project, tempPageId);
  assert.equal(project.pages.length, 1);
  assert.equal(project.activePageId, project.pages[0].id);

  // 최소 1개 페이지는 삭제 시도 시 거부됨
  const lastPageId = project.pages[0].id;
  project = deletePageFromProject(project, lastPageId);
  assert.equal(project.pages.length, 1);
  assert.equal(project.pages[0].id, lastPageId);
});

test("이전 단일 문서(v1/v2) 형식 자동 마이그레이션 및 JSON 내보내기/불러오기", () => {
  const legacySinglePageJson = {
    version: 2,
    title: "구형 레거시 도면",
    cols: 30,
    rows: 20,
    background: { "0,0": "concrete" },
    equipment: { "0,0": { status: "running", kind: "reader", label: "R-1" } },
    wiring: { "0,0": "lan" },
    palette: [],
  };

  // 단일 문서 마이그레이션 테스트
  const migrated = sanitizeProject(legacySinglePageJson);
  assert.ok(migrated);
  assert.equal(migrated.pages.length, 1);
  assert.equal(migrated.pages[0].name, "구형 레거시 도면");
  assert.equal(migrated.pages[0].cols, 30);
  assert.equal(migrated.pages[0].background["0,0"], "concrete");

  // 다중 페이지 프로젝트 JSON 내보내기 & 다시 불러오기
  const jsonStr = projectToJson(migrated);
  const reloaded = parseProjectJson(jsonStr);
  assert.equal(reloaded.title, "구형 레거시 도면");
  assert.equal(reloaded.pages.length, 1);
  assert.equal(reloaded.pages[0].background["0,0"], "concrete");
});

test("팔레트 삭제: purgeCells 가 모든 페이지의 칸을 비운다 (H1)", () => {
  let project = createProject("purge");
  project = addPageToProject(project, "2페이지");

  // 두 페이지 모두에서 같은 상태 항목을 쓴다.
  project.pages[0].equipment["1,1"] = { status: "installed", kind: "pc", label: "PC-1" };
  project.pages[1].equipment["2,2"] = { status: "installed" };
  project.pages[1].background["3,3"] = "wall";

  const purged = deleteItemInProject(project, "installed", "purgeCells");

  // 정의가 사라진다.
  assert.equal(purged.palette.some((i) => i.id === "installed"), false);

  // 모든 페이지에서 해당 속성이 비워진다.
  assert.equal(purged.pages[0].equipment["1,1"]?.status, undefined);
  assert.equal(purged.pages[1].equipment["2,2"], undefined, "다른 속성이 없으면 칸 자체가 지워진다");

  // 같은 칸의 다른 속성과 무관한 칸은 남는다.
  assert.equal(purged.pages[0].equipment["1,1"]?.kind, "pc");
  assert.equal(purged.pages[0].equipment["1,1"]?.label, "PC-1");
  assert.equal(purged.pages[1].background["3,3"], "wall");
});

test("팔레트 삭제: 다른 페이지에서 쓰는 항목은 정의를 남긴다 (H2)", () => {
  let project = createProject("교차 페이지");
  project = addPageToProject(project, "2페이지");

  // 1페이지에서만 쓰고, 활성 페이지는 2페이지다.
  project.pages[0].equipment["3,3"] = { status: "installed" };
  assert.equal(activePage(project).id, project.pages[1].id);

  const installed = project.palette.find((i) => i.id === "installed");

  // 사용량은 프로젝트 전체 기준으로 세어야 한다.
  assert.equal(usageCountInProject(project, installed), 1);
  assert.equal(usageCount(activeLayoutDoc(project), installed), 0, "활성 페이지만 보면 0 이다");

  // keepCells 삭제는 정의를 지우지 않고 감춘다 — 1페이지 칸이 원래 색을 유지한다.
  const kept = deleteItemInProject(project, "installed", "keepCells");
  const keptItem = kept.palette.find((i) => i.id === "installed");
  assert.equal(keptItem?.retired, true);
  assert.equal(keptItem?.color, installed.color, "색이 보존된다");
  assert.equal(kept.pages[0].equipment["3,3"]?.status, "installed", "비활성 페이지 칸이 남는다");
  assert.equal(resolveItem(indexPalette(kept.palette), "installed", "status").name, installed.name);

  // 목록에서는 감춰진다.
  assert.equal(itemsOfRole(kept.palette, "status").some((i) => i.id === "installed"), false);

  // 어느 페이지에서도 안 쓰는 항목은 정의까지 지운다.
  const unusedId = project.palette.find((i) => i.role === "status" && i.id !== "installed").id;
  const gone = deleteItemInProject(project, unusedId, "keepCells");
  assert.equal(gone.palette.some((i) => i.id === unusedId), false);
});

test("범례: 비활성 페이지에서만 쓰이는 감춘 항목도 남는다 (L6)", () => {
  let project = createProject("범례");
  project = addPageToProject(project, "2페이지");
  project.pages[0].equipment["4,4"] = { status: "installed" };

  const kept = deleteItemInProject(project, "installed", "keepCells");

  // 활성 페이지(2페이지)만 보면 빠지지만, 프로젝트 기준에서는 남는다.
  assert.equal(legendItems(activeLayoutDoc(kept)).some((i) => i.id === "installed"), false);
  assert.equal(legendItemsForProject(kept).some((i) => i.id === "installed"), true);
});

test("페이지 추가: ID·기본 이름이 겹치지 않는다 (L1, L2)", () => {
  let project = createProject("이름");
  project = addPageToProject(project);
  project = addPageToProject(project);
  assert.deepEqual(project.pages.map((p) => p.name).slice(1), ["페이지 2", "페이지 3"]);

  // 가운데 페이지를 지우고 다시 추가해도 이름·ID 가 중복되지 않는다.
  project = deletePageFromProject(project, project.pages[1].id);
  project = addPageToProject(project);
  const ids = project.pages.map((p) => p.id);
  const names = project.pages.map((p) => p.name);
  assert.equal(new Set(ids).size, ids.length, `ID 중복: ${ids.join(",")}`);
  assert.equal(new Set(names).size, names.length, `이름 중복: ${names.join(",")}`);

  // 시각·난수를 쓰지 않으므로 같은 조작은 같은 결과를 낸다.
  const a = addPageToProject(createProject("a"));
  const b = addPageToProject(createProject("a"));
  assert.equal(a.pages[1].id, b.pages[1].id);
});

test("페이지 추가: 이름 자리에 문자열이 아닌 값이 와도 기본 이름을 쓴다", () => {
  const project = createProject("방어");

  // PageTabs 가 onClick={onAddPage} 로 넘기면 React 가 클릭 이벤트를 첫 인자로 준다.
  // 예전에는 여기서 TypeError 가 나 화면 전체가 죽었다.
  const clickEvent = { type: "click", target: {}, preventDefault() {} };
  const added = addPageToProject(project, clickEvent);

  assert.equal(added.pages.length, 2);
  assert.equal(added.pages[1].name, "페이지 2");
  assert.equal(activePage(added).id, added.pages[1].id);

  // 공백만 있는 이름도 기본 이름으로 대체한다.
  assert.equal(addPageToProject(project, "   ").pages[1].name, "페이지 2");

  // 정상적인 이름은 그대로 쓰되 앞뒤 공백은 다듬는다.
  assert.equal(addPageToProject(project, "  창고동  ").pages[1].name, "창고동");
});

test("팔레트 항목: 디스플레이 이름 + 설명 추가·수정·저장", () => {
  const project = createProject("속성");

  // 추가 — 설명은 선택 사항이다.
  const added = addPaletteEntry(project.palette, "status", {
    name: "교체 예정",
    color: "#AA00FF",
    description: "  3월 교체 예정 설비  ",
  });
  assert.equal(added.created.name, "교체 예정");
  assert.equal(added.created.description, "3월 교체 예정 설비", "앞뒤 공백은 다듬는다");

  const noDesc = addPaletteEntry(project.palette, "wire", { name: "제어선", color: "#123456", description: "  " });
  assert.equal("description" in noDesc.created, false, "빈 설명은 아예 담지 않는다");

  // 수정 — 설명만 지울 수 있다.
  const withDesc = [...project.palette, added.created];
  const cleared = updatePaletteEntry(withDesc, added.created.id, {
    name: "교체 예정",
    color: "#AA00FF",
    description: "",
  });
  assert.equal("description" in cleared.find((i) => i.id === added.created.id), false);

  // 검사 — 이름은 필수, 설명은 길이 제한만 본다.
  assert.equal(validateInput(project.palette, "status", { name: "", color: "#112233", description: "x" }), "이름을 입력해 달라.");
  assert.match(
    validateInput(project.palette, "status", { name: "새 상태", color: "#112233", description: "가".repeat(61) }),
    /설명은/,
  );
  assert.equal(validateInput(project.palette, "status", { name: "새 상태", color: "#112233", description: "" }), null);
});

test("팔레트 항목: 설명이 JSON 내보내기·불러오기로 보존된다", () => {
  let project = createProject("설명 보존");
  const added = addPaletteEntry(project.palette, "kind", {
    name: "검사기",
    color: "#0ea5e9",
    description: "출하 전 최종 검사",
  });
  project = { ...project, palette: added.palette };

  const reloaded = parseProjectJson(projectToJson(project));
  const item = reloaded.palette.find((i) => i.id === added.created.id);
  assert.equal(item.name, "검사기");
  assert.equal(item.description, "출하 전 최종 검사");

  // 기본 항목의 설명도 살아남는다.
  assert.equal(reloaded.palette.find((i) => i.id === "installed").description, "설치 완료 · 통신 정상");
});

test("칸 메모: 메모만 바꾸고 같은 칸의 다른 값은 건드리지 않는다", () => {
  const project = createProject("메모");
  const page = project.pages[0];
  page.equipment["4,4"] = { status: "installed", kind: "reader", label: "R-01" };

  // 우클릭 저장이 부르는 경로 — 메모만 넘긴다.
  const withMemo = updateEquipmentInfoOnPage(page, "4,4", { memo: "3월 점검 대상" });
  assert.equal(withMemo.equipment["4,4"].memo, "3월 점검 대상");
  assert.equal(withMemo.equipment["4,4"].status, "installed", "상태가 지워졌다");
  assert.equal(withMemo.equipment["4,4"].kind, "reader", "장비가 지워졌다");
  assert.equal(withMemo.equipment["4,4"].label, "R-01", "장비 ID 가 지워졌다");

  // 지우기 — 메모만 사라지고 나머지는 남는다.
  const cleared = updateEquipmentInfoOnPage(withMemo, "4,4", { memo: "" });
  assert.equal("memo" in cleared.equipment["4,4"], false);
  assert.equal(cleared.equipment["4,4"].label, "R-01");

  // 아무것도 없던 칸에 메모만 달 수 있다. 지우면 칸 자체가 정리된다.
  const bare = updateEquipmentInfoOnPage(page, "9,9", { memo: "배선 재작업" });
  assert.equal(bare.equipment["9,9"].memo, "배선 재작업");
  assert.equal(updateEquipmentInfoOnPage(bare, "9,9", { memo: "" }).equipment["9,9"], undefined);

  // 원본은 그대로다.
  assert.equal("memo" in page.equipment["4,4"], false);
});

test("칸 메모: 페이지마다 따로 붙는다", () => {
  let project = createProject("메모 격리");
  project = addPageToProject(project, "2페이지");

  const p1 = updateEquipmentInfoOnPage(project.pages[0], "1,1", { memo: "1페이지 메모" });
  const p2 = updateEquipmentInfoOnPage(project.pages[1], "1,1", { memo: "2페이지 메모" });

  assert.equal(p1.equipment["1,1"].memo, "1페이지 메모");
  assert.equal(p2.equipment["1,1"].memo, "2페이지 메모");
  assert.equal(project.pages[1].equipment["1,1"], undefined, "다른 페이지가 오염됐다");
});

test("칸 정보: 우클릭 저장이 장비 ID 와 메모를 함께 넣는다", () => {
  const project = createProject("칸 정보");
  const page = project.pages[0];
  page.equipment["5,5"] = { status: "installed", kind: "reader" };

  // 우클릭 상자가 부르는 경로 — 둘을 함께 넘긴다.
  const saved = updateEquipmentInfoOnPage(page, "5,5", { label: "C1101", memo: "세척 투입구" });
  assert.equal(saved.equipment["5,5"].label, "C1101");
  assert.equal(saved.equipment["5,5"].memo, "세척 투입구");
  assert.equal(saved.equipment["5,5"].status, "installed", "상태가 지워졌다");
  assert.equal(saved.equipment["5,5"].kind, "reader", "장비가 지워졌다");

  // 지우기 — 둘 다 비우되 상태·장비는 남는다.
  const cleared = updateEquipmentInfoOnPage(saved, "5,5", { label: "", memo: "" });
  assert.equal("label" in cleared.equipment["5,5"], false);
  assert.equal("memo" in cleared.equipment["5,5"], false);
  assert.equal(cleared.equipment["5,5"].status, "installed");

  // 빈 칸에 ID 만 넣었다 지우면 칸 자체가 정리된다.
  const bare = updateEquipmentInfoOnPage(page, "8,8", { label: "X-1", memo: "" });
  assert.equal(bare.equipment["8,8"].label, "X-1");
  assert.equal(updateEquipmentInfoOnPage(bare, "8,8", { label: "", memo: "" }).equipment["8,8"], undefined);
});

test("← / → 페이지 이동: 순서대로 옮기고 양끝에서 멈춘다", () => {
  let project = createProject("페이지 이동");
  project = addPageToProject(project);
  project = addPageToProject(project);
  assert.equal(project.pages.length, 3);

  const [a, b, c] = project.pages.map((p) => p.id);

  // 첫 페이지에서 왼쪽은 제자리 — 마지막으로 튀지 않는다.
  project = switchActivePage(project, a);
  assert.equal(stepPageId(project, -1), a);
  assert.equal(stepPageId(project, 1), b);

  // 가운데는 양쪽으로 움직인다.
  project = switchActivePage(project, b);
  assert.equal(stepPageId(project, -1), a);
  assert.equal(stepPageId(project, 1), c);

  // 마지막 페이지에서 오른쪽도 제자리.
  project = switchActivePage(project, c);
  assert.equal(stepPageId(project, 1), c);
  assert.equal(stepPageId(project, -1), b);

  // 페이지가 하나뿐이면 어느 쪽으로도 안 움직인다.
  const single = createProject("혼자");
  assert.equal(stepPageId(single, -1), single.pages[0].id);
  assert.equal(stepPageId(single, 1), single.pages[0].id);
});
