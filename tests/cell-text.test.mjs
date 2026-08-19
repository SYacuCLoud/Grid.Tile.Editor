import assert from "node:assert/strict";
import test from "node:test";

import { createProject } from "../app/editor/doc.ts";
import { renderDoc } from "../app/editor/render.ts";
import { recordingContext, VISIBLE } from "./recording-context.mjs";

/**
 * 가짜 캔버스의 글자 폭은 "글자 수 × 6px" 이라 실제 글꼴과 다르다.
 * 여기서는 폭이 정확한지가 아니라 **칸을 넘기지 않는지**를 본다 —
 * 넘치면 render 가 줄이거나 나누거나 눌러서 넣어야 한다.
 */
function measured(text, size) {
  return text.length * size * 0.5;
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

/** 이름이 name 인 장비를 하나 만들어 한 칸에 올린다. */
function withKind(name, cellLabel) {
  const project = createProject("칸 글자");
  project.palette = project.palette.map((item) =>
    item.id === "reader" ? { ...item, name } : item,
  );
  project.pages[0].equipment["2,2"] = { kind: "reader", ...(cellLabel ? { label: cellLabel } : {}) };
  return project;
}

function drawCell(project, cell) {
  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell, visible: VISIBLE, showGrid: false });
  return ctx;
}

/** 그려진 글자 조각들 — 채운 글자만(테두리는 같은 자리에 겹쳐 그린다). */
function texts(ctx) {
  return ctx.ops.filter((op) => op.op === "fillText");
}

test("짧은 이름은 예전처럼 한 줄로 그대로 찍는다", () => {
  const ctx = drawCell(withKind("리더"), 22);
  const drawn = texts(ctx).map((op) => op.text);
  assert.deepEqual(drawn, ["리더"]);
});

test("네 글자 이름은 두 줄로 나눠 칸 안에 넣는다", () => {
  const ctx = drawCell(withKind("훈련저장"), 22);
  const drawn = texts(ctx).map((op) => op.text);

  assert.deepEqual(drawn, ["훈련", "저장"], "두 글자씩 나눠야 한다");

  // 두 줄이 세로로 나뉘어 겹치지 않는다.
  const [first, second] = texts(ctx);
  assert.ok(second.y > first.y);
});

test("띄어쓰기가 있으면 그 자리에서 나눈다", () => {
  const ctx = drawCell(withKind("훈련 저장"), 22);
  assert.deepEqual(
    texts(ctx).map((op) => op.text),
    ["훈련", "저장"],
  );
});

test("장비 ID 가 함께 있으면 세로 자리가 없어 한 줄로 눌러 넣는다", () => {
  const ctx = drawCell(withKind("훈련저장", "C1101"), 26);
  const drawn = texts(ctx).map((op) => op.text);

  // 두 줄로 나누지 않는다 — 나누면 위아래 글자와 겹친다.
  assert.ok(drawn.includes("훈련저장"), `한 줄로 찍어야 한다: ${JSON.stringify(drawn)}`);
  assert.ok(drawn.includes("C1101"));
  assert.equal(drawn.includes("훈련"), false);
});

test("아주 긴 이름은 잘라내고 말줄임을 붙여 칸 안에 넣는다", () => {
  const cell = 22;
  const ctx = drawCell(withKind("아주긴장비이름입니다"), cell);
  const drawn = texts(ctx);

  assert.equal(drawn.length, 1);
  assert.ok(drawn[0].text.endsWith("…"), `말줄임이 없다: ${drawn[0].text}`);
  assert.ok(drawn[0].text.length < "아주긴장비이름입니다".length);

  // 잘라낸 글자는 칸 폭 안에 들어간다(가로로 누른 몫까지 감안).
  const fontSize = Number.parseInt(ctx.font, 10);
  assert.ok(measured(drawn[0].text, fontSize) <= cell / 0.55 + 1);
});

test("작은 배율에서는 글자를 아예 찍지 않는다", () => {
  const ctx = drawCell(withKind("훈련저장"), 10);
  assert.equal(texts(ctx).length, 0, "칸이 너무 작으면 글자를 생략한다");
});

test("글자마다 테두리를 먼저 그리고 그 위에 채운다", () => {
  const ctx = drawCell(withKind("훈련저장"), 22);
  const strokes = ctx.ops.filter((op) => op.op === "strokeText");
  const fills = texts(ctx);

  assert.equal(strokes.length, fills.length, "줄 수만큼 테두리가 있어야 한다");
  for (let i = 0; i < fills.length; i += 1) {
    const strokeAt = ctx.ops.findIndex((op) => op.op === "strokeText" && op.text === fills[i].text);
    const fillAt = ctx.ops.findIndex((op) => op.op === "fillText" && op.text === fills[i].text);
    assert.ok(strokeAt < fillAt);
  }
});

test("장비 ID 만 있는 칸은 두 줄로 나눌 자리가 있다", () => {
  const project = createProject("ID 만");
  project.pages[0].equipment["1,1"] = { label: "C1101-A" };
  const ctx = drawCell(project, 20);

  const drawn = texts(ctx).map((op) => op.text);
  assert.ok(drawn.length >= 1);
  assert.equal(drawn.join(""), "C1101-A".replace(/\s/g, ""), "글자를 잃지 않는다");
});
