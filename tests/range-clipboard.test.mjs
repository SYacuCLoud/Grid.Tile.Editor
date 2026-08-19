import assert from "node:assert/strict";
import test from "node:test";
import { createDoc } from "../app/editor/doc.ts";
import {
  copyRange,
  cutRange,
  normalizeRange,
  pasteClipboard,
} from "../app/editor/range.ts";

test("normalizeRange: 정규화 및 격자 경계 클램핑", () => {
  const doc = createDoc(20, 15);

  // 대각선 상단 우측 -> 하단 좌측 드래그 정규화
  const range1 = normalizeRange({ x: 5, y: 10 }, { x: 2, y: 4 }, doc);
  assert.deepEqual(range1, {
    minX: 2,
    minY: 4,
    maxX: 5,
    maxY: 10,
    width: 4,
    height: 7,
  });

  // 격자 경계를 벗어나는 드래그 클램핑
  const range2 = normalizeRange({ x: -3, y: -2 }, { x: 25, y: 20 }, doc);
  assert.deepEqual(range2, {
    minX: 0,
    minY: 0,
    maxX: 19,
    maxY: 14,
    width: 20,
    height: 15,
  });
});

test("copyRange: 3개 레이어 및 장비 ID·메모 메타 복사", () => {
  const doc = createDoc(10, 10);
  doc.background["2,3"] = "concrete";
  doc.equipment["2,3"] = {
    status: "running",
    kind: "pc",
    label: "PC-01",
    memo: "검사 PC",
  };
  doc.wiring["2,3"] = "lan";

  const range = { minX: 2, minY: 3, maxX: 3, maxY: 4, width: 2, height: 2 };
  const clipboard = copyRange(doc, range);

  assert.equal(clipboard.width, 2);
  assert.equal(clipboard.height, 2);
  assert.equal(clipboard.cells.length, 1);

  const cell = clipboard.cells[0];
  assert.deepEqual(cell, {
    relX: 0,
    relY: 0,
    background: "concrete",
    equipment: {
      status: "running",
      kind: "pc",
      label: "PC-01",
      memo: "검사 PC",
    },
    wiring: "lan",
  });
});

test("cutRange: 복사 데이터 생성 및 원본 범위 3개 레이어/메타 지우기", () => {
  const doc = createDoc(10, 10);
  doc.background["4,4"] = "asphalt";
  doc.equipment["4,4"] = { status: "error", kind: "reader", label: "RF-99" };
  doc.wiring["4,4"] = "power";

  const range = { minX: 4, minY: 4, maxX: 4, maxY: 4, width: 1, height: 1 };
  const { nextDoc, data } = cutRange(doc, range);

  // 클립보드 데이터 확인
  assert.equal(data.cells.length, 1);
  assert.equal(data.cells[0].equipment?.label, "RF-99");

  // 원본 문서에서 셀 데이터 제거 확인
  assert.equal(nextDoc.background["4,4"], undefined);
  assert.equal(nextDoc.equipment["4,4"], undefined);
  assert.equal(nextDoc.wiring["4,4"], undefined);
});

test("pasteClipboard: 대상 위치 붙여넣기, 경계 클리핑, 붙인 범위 반환", () => {
  const doc = createDoc(10, 10);
  const data = {
    width: 3,
    height: 2,
    cells: [
      {
        relX: 0,
        relY: 0,
        background: "walkway",
        equipment: { kind: "scale", label: "SC-01", memo: "저울1" },
        wiring: "lan",
      },
      {
        relX: 2,
        relY: 1,
        background: "wall",
      },
    ],
  };

  // (8, 9) 원점에 붙여넣기 (relX=2, relY=1 셀인 10,10 은 격자 밖이므로 안전하게 클리핑)
  const origin = { x: 8, y: 9 };
  const { nextDoc, pastedRange } = pasteClipboard(doc, data, origin);

  // 붙여넣은 범위 확인
  assert.deepEqual(pastedRange, {
    minX: 8,
    minY: 9,
    maxX: 9,
    maxY: 9,
    width: 2,
    height: 1,
  });

  // (8,9) 셀 데이터 주입 확인
  assert.equal(nextDoc.background["8,9"], "walkway");
  assert.deepEqual(nextDoc.equipment["8,9"], {
    kind: "scale",
    label: "SC-01",
    memo: "저울1",
  });
  assert.equal(nextDoc.wiring["8,9"], "lan");

  // 격자 밖(10,10)은 주입되지 않음
  assert.equal(nextDoc.background["10,10"], undefined);
});

test("pasteClipboard: 원본의 빈 칸이 대상을 지운다 (블록 단위 교체)", () => {
  const doc = createDoc(20, 20);

  // 원본 2x2 — 좌상단 한 칸만 내용이 있고 나머지 3칸은 완전히 빈 칸
  doc.background["0,0"] = "wall";

  // 대상 2x2 — 네 칸 모두 채워져 있다
  doc.background["10,10"] = "wall";
  doc.background["11,10"] = "wall";
  doc.background["10,11"] = "wall";
  doc.background["11,11"] = "wall";
  doc.equipment["11,11"] = { status: "installed", label: "OLD-1", memo: "이전 내용" };
  doc.wiring["10,11"] = "wirePurple";

  const clipboard = copyRange(doc, normalizeRange({ x: 0, y: 0 }, { x: 1, y: 1 }, doc));

  // 빈 칸은 클립보드에 담기지 않는다. 그래도 붙여넣기는 블록 전체를 교체해야 한다.
  assert.equal(clipboard.cells.length, 1);
  assert.equal(clipboard.width, 2);
  assert.equal(clipboard.height, 2);

  const { nextDoc } = pasteClipboard(doc, clipboard, { x: 10, y: 10 });

  // 내용이 있던 칸은 그대로 옮겨진다.
  assert.equal(nextDoc.background["10,10"], "wall");

  // 원본에서 비어 있던 3칸은 대상에서 비워진다.
  assert.equal(nextDoc.background["11,10"], undefined);
  assert.equal(nextDoc.background["10,11"], undefined);
  assert.equal(nextDoc.background["11,11"], undefined);
  assert.equal(nextDoc.equipment["11,11"], undefined);
  assert.equal(nextDoc.wiring["10,11"], undefined);

  // 블록 밖은 건드리지 않는다.
  doc.background["12,12"] = "wall";
  const { nextDoc: outside } = pasteClipboard(doc, clipboard, { x: 10, y: 10 });
  assert.equal(outside.background["12,12"], "wall");
});

test("pasteClipboard: 실질 변화가 없으면 같은 문서를 돌려준다 (no-op 되돌리기 방지)", () => {
  const doc = createDoc(10, 10);
  doc.background["3,3"] = "wall";

  // 빈 영역을 복사해 빈 영역에 붙여넣기 — 바뀌는 것이 없다.
  const emptyClip = copyRange(doc, normalizeRange({ x: 0, y: 0 }, { x: 1, y: 1 }, doc));
  assert.equal(emptyClip.cells.length, 0);

  const noop = pasteClipboard(doc, emptyClip, { x: 6, y: 6 });
  assert.equal(noop.nextDoc, doc, "변화가 없으면 원본 참조를 그대로 돌려준다");

  // 같은 내용을 제자리에 붙여넣어도 변화가 없다.
  const sameClip = copyRange(doc, normalizeRange({ x: 3, y: 3 }, { x: 3, y: 3 }, doc));
  const samePlace = pasteClipboard(doc, sameClip, { x: 3, y: 3 });
  assert.equal(samePlace.nextDoc, doc, "같은 내용 제자리 붙여넣기도 변화 없음");

  // 반대로 실제로 지워지는 경우에는 새 문서를 만든다.
  const clearing = pasteClipboard(doc, emptyClip, { x: 3, y: 3 });
  assert.notEqual(clearing.nextDoc, doc);
  assert.equal(clearing.nextDoc.background["3,3"], undefined);
});

test("cutRange: 빈 범위는 같은 문서를 돌려준다 (no-op 되돌리기 방지)", () => {
  const doc = createDoc(10, 10);
  doc.background["1,1"] = "wall";

  // 아무 내용도 없는 범위를 잘라낸다.
  const emptyRange = normalizeRange({ x: 5, y: 5 }, { x: 6, y: 6 }, doc);
  const { nextDoc, data } = cutRange(doc, emptyRange);

  assert.equal(nextDoc, doc, "지울 것이 없으면 원본 참조를 그대로 돌려준다");

  // 클립보드 반환 의미는 그대로 — 빈 데이터라도 크기 정보는 유지한다.
  assert.equal(data.cells.length, 0);
  assert.equal(data.width, 2);
  assert.equal(data.height, 2);

  // 범위 밖 내용은 그대로 남는다.
  assert.equal(nextDoc.background["1,1"], "wall");
});

test("cutRange: 내용이 있으면 새 문서를 만들고 원본 범위를 지운다", () => {
  const doc = createDoc(10, 10);
  doc.background["2,2"] = "wall";
  doc.equipment["3,2"] = { status: "installed", kind: "pc", label: "PC-7", memo: "메모" };
  doc.wiring["2,3"] = "wireOrange";
  doc.background["9,9"] = "wall";

  const range = normalizeRange({ x: 2, y: 2 }, { x: 3, y: 3 }, doc);
  const { nextDoc, data } = cutRange(doc, range);

  assert.notEqual(nextDoc, doc, "실제로 지웠으면 새 문서를 만든다");

  // 범위 안 세 레이어가 모두 비워진다.
  assert.equal(nextDoc.background["2,2"], undefined);
  assert.equal(nextDoc.equipment["3,2"], undefined);
  assert.equal(nextDoc.wiring["2,3"], undefined);

  // 범위 밖은 그대로.
  assert.equal(nextDoc.background["9,9"], "wall");

  // 클립보드에는 잘라낸 내용이 담긴다.
  assert.equal(data.cells.length, 3);
  const pc = data.cells.find((cell) => cell.equipment?.label === "PC-7");
  assert.deepEqual(pc.equipment, { status: "installed", kind: "pc", label: "PC-7", memo: "메모" });

  // 원본 문서는 바뀌지 않는다.
  assert.equal(doc.background["2,2"], "wall");
});
