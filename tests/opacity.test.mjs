import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WIRE_OPACITY,
  OPACITY_STEPS,
  itemOpacity,
  sanitizeOpacity,
} from "../app/editor/palette.ts";
import { addPaletteEntry, ensurePalette, updatePaletteEntry } from "../app/editor/paletteOps.ts";
import { createProject, paintCellsOnPage } from "../app/editor/doc.ts";
import { renderDoc } from "../app/editor/render.ts";

/** globalAlpha 가 어떻게 오갔는지 기록하는 최소 캔버스. */
function recordingCtx() {
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
  // save/restore 를 흉내 낸다 — 그리는 쪽이 이것으로 알파를 되돌리므로,
  // 대역이 무시하면 되돌림을 확인할 수 없다.
  const stack = [];
  const noop = () => {};
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop === "save") {
        return () => {
          stack.push(obj.globalAlpha);
        };
      }
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

test("기본값: 배선만 반투명하고 나머지는 불투명하다", () => {
  assert.equal(itemOpacity({ role: "wire" }), DEFAULT_WIRE_OPACITY);
  assert.ok(DEFAULT_WIRE_OPACITY > 0 && DEFAULT_WIRE_OPACITY < 1, "기본값이 반투명이 아니다");

  assert.equal(itemOpacity({ role: "tile" }), 1);
  assert.equal(itemOpacity({ role: "status" }), 1);
  assert.equal(itemOpacity({ role: "kind" }), 1);

  // 지정이 있으면 그 값이 기본값을 덮는다.
  assert.equal(itemOpacity({ role: "wire", opacity: 1 }), 1);
  assert.equal(itemOpacity({ role: "tile", opacity: 0.4 }), 0.4);

  // 고를 수 있는 눈금에 기본값이 들어 있어야 되돌릴 자리가 있다.
  assert.ok(OPACITY_STEPS.includes(DEFAULT_WIRE_OPACITY), "눈금에 기본값이 없다");
  assert.ok(OPACITY_STEPS.every((s) => s > 0 && s <= 1));
});

test("진하기 값 검사: 범위를 벗어난 값은 받지 않는다", () => {
  assert.equal(sanitizeOpacity(0.55), 0.55);
  assert.equal(sanitizeOpacity(1), 1);
  // 소수점 둘째 자리까지만 남는다.
  assert.equal(sanitizeOpacity(0.5549), 0.55);

  // 0 은 아예 안 보이므로 받지 않는다 — 감추려면 레이어를 숨긴다.
  assert.equal(sanitizeOpacity(0), null);
  assert.equal(sanitizeOpacity(-0.5), null);
  assert.equal(sanitizeOpacity(1.5), null);
  assert.equal(sanitizeOpacity("0.5"), null);
  assert.equal(sanitizeOpacity(NaN), null);
  assert.equal(sanitizeOpacity(undefined), null);
});

test("진하기 저장: 기본값과 같으면 파일에 남기지 않는다", () => {
  // 배선 기본값을 그대로 고르면 필드가 생기지 않는다(예전 파일과 같은 모양).
  const { created: plain } = addPaletteEntry([], "wire", {
    name: "신호선",
    color: "#7c3aed",
    description: "",
    opacity: DEFAULT_WIRE_OPACITY,
  });
  assert.equal("opacity" in plain, false, "기본값이 파일에 적혔다");
  assert.equal(itemOpacity(plain), DEFAULT_WIRE_OPACITY, "그래도 반투명으로 그려져야 한다");

  // 기본값과 다르면 남긴다.
  const { palette, created } = addPaletteEntry([], "wire", {
    name: "전원선",
    color: "#f2622a",
    description: "",
    opacity: 1,
  });
  assert.equal(created.opacity, 1);
  assert.equal(itemOpacity(created), 1);

  // 편집으로 기본값으로 되돌리면 필드가 사라진다.
  const back = updatePaletteEntry(palette, created.id, {
    name: "전원선",
    color: "#f2622a",
    description: "",
    opacity: DEFAULT_WIRE_OPACITY,
  });
  assert.equal("opacity" in back[0], false);

  // 저장된 문서를 다시 열어도 살아 있고, 이상한 값은 버린다.
  // (ensurePalette 는 빠진 기본 배경 항목을 앞에 되채우므로 ID 로 찾는다.)
  const find = (raw) => ensurePalette([raw]).find((i) => i.id === created.id);
  assert.equal(find({ ...created }).opacity, 1);
  assert.equal("opacity" in find({ ...created, opacity: 9 }), false);
  assert.equal("opacity" in find({ ...created, opacity: 0 }), false);
});

test("배선 그리기: 반투명으로 그리고 알파를 되돌린다", () => {
  const project = createProject("배선 투명도");
  const wire = project.palette.find((i) => i.role === "wire");
  assert.ok(wire, "기본 팔레트에 배선이 없다");
  assert.equal("opacity" in wire, false, "기본 항목에 진하기가 박혀 있다");

  const page = paintCellsOnPage(project.pages[0], wire, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ]);

  const doc = {
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

  const { ctx, alphas } = recordingCtx();
  renderDoc(ctx, doc, {
    cell: 22,
    visible: Object.fromEntries(project.layers.map((l) => [l.id, true])),
    showGrid: true,
    preview: null,
    selected: null,
    selectionRange: null,
    hover: null,
  });

  // 배선을 그리는 동안 1 보다 옅은 알파가 쓰였어야 한다.
  assert.ok(
    alphas.some((a) => a > 0 && a < 1),
    `배선이 불투명하게 그려졌다 (쓰인 알파: ${alphas.join(", ")})`,
  );

  // 그리고 나서는 되돌려 두어야 다음 레이어가 옅어지지 않는다.
  assert.equal(ctx.globalAlpha, 1, "알파를 되돌리지 않아 뒤에 그리는 것까지 옅어진다");
});

test("배선 그리기: 진하기 1 을 고르면 알파를 건드리지 않는다", () => {
  const project = createProject("불투명 배선");
  const base = project.palette.find((i) => i.role === "wire");
  const opaque = { ...base, opacity: 1 };
  const palette = project.palette.map((i) => (i.id === base.id ? opaque : i));

  const page = paintCellsOnPage(project.pages[0], opaque, [{ x: 1, y: 1 }]);
  const doc = {
    version: project.version,
    title: project.title,
    cols: page.cols,
    rows: page.rows,
    background: page.background,
    equipment: page.equipment,
    wiring: page.wiring,
    layerCells: page.layerCells,
    layers: project.layers,
    palette,
  };

  const { ctx, alphas } = recordingCtx();
  renderDoc(ctx, doc, {
    cell: 22,
    visible: Object.fromEntries(project.layers.map((l) => [l.id, true])),
    showGrid: false,
    preview: null,
    selected: null,
    selectionRange: null,
    hover: null,
  });

  assert.equal(
    alphas.some((a) => a > 0 && a < 1),
    false,
    `불투명 배선인데 알파를 건드렸다 (${alphas.join(", ")})`,
  );
  assert.equal(ctx.globalAlpha, 1);
});

/**
 * 배선 한 줄을 실제로 그려 보고, 같은 자리를 두 번 **칠했는지** 센다.
 *
 * 반투명 배선은 겹쳐 칠하면 그 자리만 진해진다 — 칸마다 따로 칠하던 판에서는
 * 칸 경계마다 진한 이음매가 줄줄이 남았다.
 *
 * 겹침은 **칠 호출 단위**로 센다. 경로 하나에 사각형을 여러 개 담아 `fill` 을
 * 한 번 부르면 캔버스는 그 합집합을 한 겹만 칠하므로(nonzero 규칙), 경로 안에서
 * 사각형이 겹치는 것은 문제가 아니다. 문제는 칠을 **여러 번** 부르면서 같은
 * 자리를 다시 덮는 것이다.
 */
function paintCounter(onlyColor) {
  const painted = new Map();

  /** 이번 칠 호출이 덮은 자리. 합집합이므로 한 번만 센다. */
  const commit = (rects) => {
    const covered = new Set();
    for (const [x, y, w, h] of rects) {
      // 반 픽셀 좌표까지 세도록 2배 격자에 찍는다.
      for (let px = Math.round(x * 2); px < Math.round((x + w) * 2); px += 1) {
        for (let py = Math.round(y * 2); py < Math.round((y + h) * 2); py += 1) {
          covered.add(`${px},${py}`);
        }
      }
    }
    for (const key of covered) painted.set(key, (painted.get(key) ?? 0) + 1);
  };

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

  // 진행 중인 경로에 쌓인 사각형. `fill()` 이 오면 합집합으로 한 번 센다.
  let pending = [];

  // 이 색으로 칠한 것만 센다 — 종이 바탕처럼 도면 전체를 덮는 칠은 무시한다.
  const mine = () => target.fillStyle.toLowerCase() === onlyColor.toLowerCase();

  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop === "beginPath") {
        return () => {
          pending = [];
        };
      }
      if (prop === "rect") {
        return (x, y, w, h) => {
          pending.push([x, y, w, h]);
        };
      }
      if (prop === "fill") {
        return () => {
          if (mine()) commit(pending);
          pending = [];
        };
      }
      // 경로 없이 부르는 낱개 사각형 — 한 번의 칠로 센다.
      if (prop === "fillRect") {
        return (x, y, w, h) => {
          if (mine()) commit([[x, y, w, h]]);
        };
      }
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop in obj) return obj[prop];
      return () => {};
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  });

  return { ctx, painted };
}

test("배선 실선: 반투명이어도 같은 자리를 두 번 칠하지 않는다", () => {
  const project = createProject("이음매");
  const wire = project.palette.find((i) => i.role === "wire");

  // 가로 다섯 칸 + 모퉁이에서 아래로 세 칸 — 직선 · 모퉁이 · 끝이 모두 들어간다.
  const points = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 2 },
    { x: 5, y: 3 },
  ];
  const page = paintCellsOnPage(project.pages[0], wire, points);

  const doc = {
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

  const { ctx, painted } = paintCounter(wire.color);
  renderDoc(ctx, doc, {
    cell: 22,
    // 배선만 그린다 — 격자·배경이 세는 것을 흐리지 않게.
    visible: Object.fromEntries(project.layers.map((l) => [l.id, l.id === "wiring"])),
    showGrid: false,
    preview: null,
    selected: null,
    selectionRange: null,
    hover: null,
  });

  assert.ok(painted.size > 0, "배선을 아예 그리지 않았다");

  const twice = [...painted.entries()].filter(([, n]) => n > 1);
  assert.equal(
    twice.length,
    0,
    `${twice.length}개 자리가 두 번 칠해졌다 — 반투명일 때 이음매가 진해진다 (예: ${twice
      .slice(0, 5)
      .map(([k, n]) => `${k}×${n}`)
      .join(", ")})`,
  );
});
