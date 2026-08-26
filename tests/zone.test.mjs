import assert from "node:assert/strict";
import test from "node:test";
import { activeLayoutDoc, createProject, resizePage } from "../app/editor/doc.ts";
import { parseProjectJson, projectToJson, sanitizeProject } from "../app/editor/storage.ts";
import {
  addZone,
  contextMenuFor,
  MAX_ZONE_NAME,
  MAX_ZONES,
  moveZoneLabel,
  nextZoneId,
  nextZoneName,
  normalizeZoneName,
  removeZone,
  sanitizeZones,
  updateZone,
  zoneArea,
  zoneLegendEntries,
  zoneLegendItems,
  zoneLegendLabel,
  zoneLabel,
  zoneLabelAt,
  zoneLabelCell,
  zoneRangeText,
  zonesAt,
} from "../app/editor/zone.ts";

test("이름 다듬기: 공백을 떼고 길이를 자른다", () => {
  assert.equal(normalizeZoneName("  입하존  "), "입하존");
  assert.equal(normalizeZoneName(""), "");
  assert.equal(normalizeZoneName("   "), "");
  assert.equal(normalizeZoneName(null), "");
  assert.equal(normalizeZoneName("가".repeat(40)).length, MAX_ZONE_NAME);
});

test("구역 추가: 이름을 비우면 기본 이름이 붙는다", () => {
  const zones = addZone(undefined, { x: 2, y: 3, w: 4, h: 5 }, "");
  assert.equal(zones.length, 1);
  assert.equal(zones[0].name, "구역 1");
  assert.equal(zones[0].id, "zone-1");
  assert.deepEqual([zones[0].x, zones[0].y, zones[0].w, zones[0].h], [2, 3, 4, 5]);
  // 색을 넘기지 않았으면 필드를 두지 않는다 — 저장 파일이 깔끔하게 남는다.
  assert.equal("color" in zones[0], false);
});

test("구역 추가: ID · 기본 이름이 겹치지 않는다", () => {
  let zones = addZone(undefined, { x: 0, y: 0, w: 2, h: 2 }, "");
  zones = addZone(zones, { x: 5, y: 5, w: 2, h: 2 }, "");
  assert.deepEqual(zones.map((z) => z.id), ["zone-1", "zone-2"]);
  assert.deepEqual(zones.map((z) => z.name), ["구역 1", "구역 2"]);

  // 가운데를 지우고 더해도 부딪히지 않는다.
  const after = addZone(removeZone(zones, "zone-1"), { x: 8, y: 8, w: 1, h: 1 }, "");
  assert.equal(new Set(after.map((z) => z.id)).size, after.length);
  assert.equal(new Set(after.map((z) => z.name)).size, after.length);
});

test("구역 추가: 상한을 넘으면 그대로 돌려준다", () => {
  let zones = [];
  for (let i = 0; i < MAX_ZONES; i += 1) zones = addZone(zones, { x: 0, y: 0, w: 1, h: 1 }, `구역${i}`);
  assert.equal(zones.length, MAX_ZONES);
  assert.equal(addZone(zones, { x: 0, y: 0, w: 1, h: 1 }, "넘침").length, MAX_ZONES);
});

test("구역 고치기: 이름을 비우면 예전 이름을 지킨다", () => {
  const zones = addZone(undefined, { x: 0, y: 0, w: 3, h: 3 }, "입하존");
  assert.equal(updateZone(zones, "zone-1", { name: "   " })[0].name, "입하존");
  assert.equal(updateZone(zones, "zone-1", { name: "출하존" })[0].name, "출하존");
  // 색을 빈 문자열로 넘기면 필드를 지운다.
  const colored = updateZone(zones, "zone-1", { color: "#0891b2" });
  assert.equal(colored[0].color, "#0891b2");
  assert.equal("color" in updateZone(colored, "zone-1", { color: "" })[0], false);
});

test("칸이 드는 구역: 좁은 쪽이 앞에 온다", () => {
  let zones = addZone(undefined, { x: 0, y: 0, w: 10, h: 10 }, "입하존");
  zones = addZone(zones, { x: 2, y: 2, w: 3, h: 3 }, "A라인");

  assert.deepEqual(zonesAt(zones, 3, 3).map((z) => z.name), ["A라인", "입하존"]);
  assert.equal(zoneLabel(zones, 3, 3), "A라인 / 입하존");
  // 큰 구역에만 드는 칸.
  assert.equal(zoneLabel(zones, 8, 8), "입하존");
  // 어느 구역에도 들지 않는 칸은 빈 문자열 — 부르는 쪽이 좌표만 쓰면 된다.
  assert.equal(zoneLabel(zones, 50, 50), "");
  assert.equal(zoneLabel(undefined, 0, 0), "");
});

test("경계: 오른쪽·아래 끝 칸은 들고, 한 칸 밖은 들지 않는다", () => {
  const zones = addZone(undefined, { x: 2, y: 3, w: 4, h: 5 }, "존");
  assert.equal(zoneLabel(zones, 2, 3), "존"); // 왼쪽 위
  assert.equal(zoneLabel(zones, 5, 7), "존"); // 오른쪽 아래 (2+4-1, 3+5-1)
  assert.equal(zoneLabel(zones, 6, 7), "");
  assert.equal(zoneLabel(zones, 5, 8), "");
  assert.equal(zoneLabel(zones, 1, 3), "");
});

test("사람이 읽는 값: 칸 수와 범위 글", () => {
  const zone = { id: "z", name: "존", x: 2, y: 3, w: 4, h: 5 };
  assert.equal(zoneArea(zone), 20);
  assert.equal(zoneRangeText(zone), "가로 3~6 · 세로 4~8");
});

test("다듬기: 이름 없는 구역은 버리고, 걸친 구역은 잘라 남긴다", () => {
  const raw = [
    { id: "a", name: "정상", x: 1, y: 1, w: 3, h: 3 },
    { id: "b", name: "  ", x: 0, y: 0, w: 2, h: 2 }, // 이름 없음 → 버림
    { name: "이름만", x: 0, y: 0, w: 2, h: 2 }, // ID 없음 → 붙여 준다
    { id: "c", name: "걸침", x: 8, y: 8, w: 50, h: 50 }, // 격자 밖까지 → 잘림
    "쓰레기",
  ];
  const zones = sanitizeZones(raw, 10, 10);
  assert.equal(zones.length, 3);
  assert.deepEqual(zones.map((z) => z.name), ["정상", "이름만", "걸침"]);
  // 격자(10x10) 안으로 잘렸다.
  const clipped = zones[2];
  assert.equal(clipped.x + clipped.w, 10);
  assert.equal(clipped.y + clipped.h, 10);
  // ID 는 겹치지 않는다.
  assert.equal(new Set(zones.map((z) => z.id)).size, 3);
});

test("다듬기: 남는 것이 없으면 undefined — 필드를 두지 않는다", () => {
  assert.equal(sanitizeZones(undefined, 10, 10), undefined);
  assert.equal(sanitizeZones([], 10, 10), undefined);
  assert.equal(sanitizeZones([{ name: "" }], 10, 10), undefined);
  assert.equal(sanitizeZones("배열아님", 10, 10), undefined);
});

test("격자를 줄이면 구역도 같은 자로 잘린다", () => {
  const project = createProject();
  const page = {
    ...project.pages[0],
    zones: [
      { id: "keep", name: "안쪽", x: 0, y: 0, w: 5, h: 5 },
      { id: "clip", name: "걸침", x: 8, y: 8, w: 20, h: 20 },
      { id: "gone", name: "밖", x: 30, y: 25, w: 3, h: 3 },
    ],
  };

  const smaller = resizePage(page, 12, 12);
  const names = smaller.zones.map((z) => z.name);
  assert.deepEqual(names, ["안쪽", "걸침"]);
  const clipped = smaller.zones[1];
  assert.equal(clipped.x + clipped.w, 12);

  // 다시 늘려도 지워진 구역이 되살아나지 않는다.
  const again = resizePage(smaller, 48, 30);
  assert.deepEqual(again.zones.map((z) => z.name), ["안쪽", "걸침"]);
});

test("격자를 줄여 구역이 다 사라지면 필드가 비워진다", () => {
  const project = createProject();
  const page = {
    ...project.pages[0],
    zones: [{ id: "gone", name: "밖", x: 40, y: 25, w: 3, h: 3 }],
  };
  const smaller = resizePage(page, 12, 12);
  assert.equal("zones" in smaller, false);
});

test("구역 없는 페이지는 리사이즈해도 필드가 생기지 않는다", () => {
  const project = createProject();
  const resized = resizePage(project.pages[0], 20, 20);
  assert.equal("zones" in resized, false);
});

test("저장 · 복원: 구역이 그대로 오간다", () => {
  const project = createProject();
  project.pages[0].zones = [
    { id: "z1", name: "입하존", x: 1, y: 1, w: 6, h: 4, color: "#0891b2" },
    { id: "z2", name: "A라인", x: 2, y: 2, w: 2, h: 2 },
  ];

  const restored = parseProjectJson(projectToJson(project));
  assert.deepEqual(restored.pages[0].zones, project.pages[0].zones);
});

test("저장 · 복원: 구역 없는 문서는 필드가 생기지 않는다", () => {
  const restored = parseProjectJson(projectToJson(createProject()));
  assert.equal("zones" in restored.pages[0], false);
});

test("복원: 형식이 틀린 구역이 섞여 있어도 문서가 열린다", () => {
  const restored = sanitizeProject({
    version: 3,
    title: "t",
    activePageId: "page-1",
    pages: [{ id: "page-1", name: "p", cols: 20, rows: 20, background: {}, equipment: {}, wiring: {}, zones: "쓰레기" }],
  });
  assert.notEqual(restored, null);
  assert.equal("zones" in restored.pages[0], false);
});

test("렌더러 뷰: 활성 페이지의 구역이 넘어간다", () => {
  const project = createProject();
  project.pages[0].zones = [{ id: "z1", name: "입하존", x: 0, y: 0, w: 3, h: 3 }];
  assert.deepEqual(activeLayoutDoc(project).zones, project.pages[0].zones);

  // 구역이 없으면 필드도 없다 — 렌더러는 undefined 를 그리지 않는다.
  const bare = createProject();
  assert.equal("zones" in activeLayoutDoc(bare), false);
});

test("ID · 이름 후보 짓기", () => {
  const zones = [
    { id: "zone-1", name: "구역 1", x: 0, y: 0, w: 1, h: 1 },
    { id: "zone-3", name: "구역 3", x: 0, y: 0, w: 1, h: 1 },
  ];
  assert.equal(nextZoneId(zones), "zone-4");
  assert.equal(nextZoneName(zones), "구역 4");
});

// ── 우클릭 갈림길 ──────────────────────────────────────────────────────
//
// 우클릭 하나가 세 가지를 뜻한다. 여기서 갈리는 값이 틀리면 사용자는 메모를 열려다
// 구역을 만들고, 구역을 고치려다 메모를 연다. 갈림길만 따로 잡아 둔다.

const range = (minX, minY, maxX, maxY) => ({
  minX,
  minY,
  maxX,
  maxY,
  width: maxX - minX + 1,
  height: maxY - minY + 1,
});

test("우클릭: 잡아 둔 범위 안이면 구역 등록", () => {
  const picked = contextMenuFor({ x: 3, y: 4 }, range(2, 3, 6, 7), undefined);
  assert.equal(picked.kind, "create");
  assert.deepEqual(picked.rect, { x: 2, y: 3, w: 5, h: 5 });
});

test("우클릭: 범위 밖이면 구역 등록이 아니다", () => {
  // 범위는 잡혀 있지만 손이 다른 자리를 눌렀다 — 그 자리는 범위와 무관하다.
  assert.equal(contextMenuFor({ x: 9, y: 9 }, range(2, 3, 6, 7), undefined).kind, "note");
});

test("우클릭: 한 칸 범위는 구역이 아니라 메모", () => {
  // 선택 도구로 칸 하나를 누른 것은 대개 "이 칸을 보겠다" 다.
  assert.equal(contextMenuFor({ x: 2, y: 3 }, range(2, 3, 2, 3), undefined).kind, "note");
});

test("우클릭: 구역 위면 그 구역을 고친다", () => {
  const zones = [{ id: "z1", name: "입하존", x: 0, y: 0, w: 5, h: 5 }];
  const picked = contextMenuFor({ x: 2, y: 2 }, null, zones);
  assert.equal(picked.kind, "zone");
  assert.equal(picked.zone.id, "z1");

  // 구역 밖은 메모다.
  assert.equal(contextMenuFor({ x: 7, y: 7 }, null, zones).kind, "note");
});

test("우클릭: 겹친 구역은 좁은 쪽이 나온다", () => {
  const zones = [
    { id: "big", name: "입하존", x: 0, y: 0, w: 10, h: 10 },
    { id: "small", name: "A라인", x: 2, y: 2, w: 3, h: 3 },
  ];
  const picked = contextMenuFor({ x: 3, y: 3 }, null, zones);
  assert.equal(picked.kind, "zone");
  assert.equal(picked.zone.id, "small");
});

test("우클릭: 범위 안이 구역 위여도 등록이 이긴다", () => {
  // 방금 끌어 놓은 범위가 더 최근의 뜻이다. 그 안에 구역이 깔려 있어도
  // 새 구역을 만들려는 것으로 읽는다.
  const zones = [{ id: "z1", name: "입하존", x: 0, y: 0, w: 10, h: 10 }];
  assert.equal(contextMenuFor({ x: 3, y: 3 }, range(2, 2, 5, 5), zones).kind, "create");
});

// ── 범례 ───────────────────────────────────────────────────────────────

test("범례: 큰 구역이 앞에 오고, 뺀 구역은 빠진다", () => {
  const zones = [
    { id: "s", name: "A라인", x: 0, y: 0, w: 2, h: 2 },
    { id: "b", name: "입하존", x: 0, y: 0, w: 5, h: 5 },
    { id: "h", name: "숨김", x: 0, y: 0, w: 9, h: 9, hideLegend: true },
  ];
  // 큰 것부터 — 도면을 처음 보는 사람은 큰 구역부터 읽는다.
  assert.deepEqual(zoneLegendItems(zones).map((z) => z.id), ["b", "s"]);
  assert.deepEqual(zoneLegendItems(undefined), []);
});

test("범례: 한 줄에 이름과 칸 수를 함께 찍는다", () => {
  assert.equal(zoneLegendLabel({ id: "z", name: "입하존", x: 0, y: 0, w: 3, h: 4 }), "입하존 (12칸)");
});

test("범례 항목: 팔레트 항목 모양으로 바뀐다", () => {
  const entries = zoneLegendEntries([
    { id: "z1", name: "입하존", x: 0, y: 0, w: 2, h: 2, color: "#0891b2" },
    { id: "z2", name: "무색", x: 0, y: 0, w: 1, h: 1 },
  ]);

  assert.equal(entries.length, 2);
  // ID 는 팔레트 ID 와 겹치지 않게 접두어를 붙인다.
  assert.equal(entries[0].id, "zone:z1");
  assert.equal(entries[0].name, "입하존 (4칸)");
  assert.equal(entries[0].color, "#0891b2");
  // 색을 정하지 않은 구역도 범례에 색이 있어야 한다 — 빈 견본은 읽을 수 없다.
  assert.equal(entries[1].color, "#7c3aed");
});

test("범례 표시는 켰다 껐다 할 수 있다", () => {
  const zones = [{ id: "z1", name: "입하존", x: 0, y: 0, w: 2, h: 2 }];

  const off = updateZone(zones, "z1", { hideLegend: true });
  assert.equal(off[0].hideLegend, true);
  assert.deepEqual(zoneLegendItems(off), []);

  // 다시 올릴 수 있어야 한다. false 를 넘기면 필드가 사라진다(파일이 깔끔해진다).
  const on = updateZone(off, "z1", { hideLegend: false });
  assert.equal("hideLegend" in on[0], false);
  assert.equal(zoneLegendItems(on).length, 1);
});

test("범례 표시가 저장·복원을 넘어 남는다", () => {
  const project = createProject();
  project.pages[0].zones = [
    { id: "z1", name: "입하존", x: 0, y: 0, w: 3, h: 3, hideLegend: true },
    { id: "z2", name: "A라인", x: 0, y: 0, w: 2, h: 2 },
  ];
  project.pages[0].zonesHidden = true;

  const back = parseProjectJson(projectToJson(project));
  assert.equal(back.pages[0].zones[0].hideLegend, true);
  assert.equal("hideLegend" in back.pages[0].zones[1], false);
  assert.equal(back.pages[0].zonesHidden, true);

  // 렌더러 뷰에도 넘어가야 그리기 판정이 문서만 보고도 선다.
  assert.equal(activeLayoutDoc(back).zonesHidden, true);
});

test("구역 숨김은 켠 문서에만 필드가 생긴다", () => {
  const bare = createProject();
  bare.pages[0].zones = [{ id: "z1", name: "입하존", x: 0, y: 0, w: 2, h: 2 }];
  const back = parseProjectJson(projectToJson(bare));
  assert.equal("zonesHidden" in back.pages[0], false);
  assert.equal("zonesHidden" in activeLayoutDoc(back), false);
});

// ── 이름표 자리 ─────────────────────────────────────────────────────────
//
// 이름표는 끌어서 옮긴다. 렌더러와 끌기 판정이 같은 계산(`zoneLabelCell`)을 써야
// 눈에 보이는 자리를 눌러 잡을 수 있다. 그 계약을 여기서 잡아 둔다.

test("이름표 자리: 기본은 구역 왼쪽 위", () => {
  assert.deepEqual(zoneLabelCell({ id: "z", name: "A", x: 3, y: 4, w: 5, h: 5 }), { x: 3, y: 4 });
});

test("이름표 자리: 오프셋은 구역 안쪽 좌표다", () => {
  const zone = { id: "z", name: "A", x: 3, y: 4, w: 5, h: 5, labelX: 2, labelY: 1 };
  assert.deepEqual(zoneLabelCell(zone), { x: 5, y: 5 });
});

test("이름표 자리: 구역 밖으로 나간 값은 안으로 끌어당긴다", () => {
  // 격자를 줄여 구역이 작아진 뒤에도 이름표가 도면에서 사라지지 않아야 한다.
  const zone = { id: "z", name: "A", x: 0, y: 0, w: 2, h: 2, labelX: 9, labelY: 9 };
  assert.deepEqual(zoneLabelCell(zone), { x: 1, y: 1 });
});

test("이름표 끌기: 구역 안으로만 옮겨진다", () => {
  const zones = [{ id: "z1", name: "입하존", x: 2, y: 2, w: 3, h: 3 }];

  const moved = moveZoneLabel(zones, "z1", 4, 3);
  assert.equal(moved[0].labelX, 2);
  assert.equal(moved[0].labelY, 1);
  assert.deepEqual(zoneLabelCell(moved[0]), { x: 4, y: 3 });

  // 구역 밖으로 끌면 경계에 붙는다 — 이름표가 자기 구역을 가리키지 않으면 뜻이 없다.
  const out = moveZoneLabel(zones, "z1", 99, -5);
  assert.deepEqual(zoneLabelCell(out[0]), { x: 4, y: 2 });
});

test("이름표 끌기: 왼쪽 위로 되돌리면 필드가 사라진다", () => {
  const zones = [{ id: "z1", name: "입하존", x: 2, y: 2, w: 3, h: 3, labelX: 2, labelY: 2 }];
  const back = moveZoneLabel(zones, "z1", 2, 2);
  assert.equal("labelX" in back[0], false);
  assert.equal("labelY" in back[0], false);
});

test("이름표 잡기: 그 칸에서만 잡히고, 겹치면 작은 구역이 이긴다", () => {
  const zones = [
    { id: "big", name: "입하존", x: 0, y: 0, w: 10, h: 10 },
    { id: "small", name: "A라인", x: 0, y: 0, w: 3, h: 3 },
  ];
  // 둘 다 이름표가 (0,0) 이다 — 위에 그려지는 작은 쪽이 잡힌다.
  assert.equal(zoneLabelAt(zones, 0, 0).id, "small");
  // 이름표가 아닌 칸은 잡히지 않는다. 그 자리는 범위 선택이어야 한다.
  assert.equal(zoneLabelAt(zones, 5, 5), null);
  assert.equal(zoneLabelAt(undefined, 0, 0), null);

  // 옮긴 이름표는 옮긴 자리에서 잡힌다.
  const moved = moveZoneLabel(zones, "small", 2, 1);
  assert.equal(zoneLabelAt(moved, 2, 1).id, "small");
  assert.equal(zoneLabelAt(moved, 0, 0).id, "big");
});

test("이름표 자리가 저장·복원을 넘어 남는다", () => {
  const project = createProject();
  project.pages[0].zones = [{ id: "z1", name: "입하존", x: 1, y: 1, w: 4, h: 4, labelX: 2, labelY: 3 }];

  const back = parseProjectJson(projectToJson(project));
  assert.equal(back.pages[0].zones[0].labelX, 2);
  assert.equal(back.pages[0].zones[0].labelY, 3);
});

test("복원: 구역 밖으로 나간 이름표 오프셋은 경계로 다듬어진다", () => {
  const cleaned = sanitizeZones(
    [{ id: "z1", name: "입하존", x: 0, y: 0, w: 3, h: 2, labelX: 99, labelY: 99 }],
    30,
    30,
  );
  assert.equal(cleaned[0].labelX, 2);
  assert.equal(cleaned[0].labelY, 1);
});

test("옮기지 않은 이름표는 파일에 자리를 차지하지 않는다", () => {
  const cleaned = sanitizeZones([{ id: "z1", name: "입하존", x: 0, y: 0, w: 3, h: 3 }], 30, 30);
  assert.equal("labelX" in cleaned[0], false);
  assert.equal("labelY" in cleaned[0], false);
});

