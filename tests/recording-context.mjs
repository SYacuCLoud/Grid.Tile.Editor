/**
 * 그리기 호출을 받아 적는 가짜 캔버스.
 * 브라우저 없이 "무엇을 어떤 색·무늬로 그렸는지" 를 확인하려는 것이다.
 *
 * 실제 Canvas 2D 와 이름·인자를 맞춰 둔다. 렌더러가 쓰는 메서드가 여기 없으면
 * 테스트는 그리기 오류가 아니라 TypeError 로 죽는다.
 */
export function recordingContext() {
  const ops = [];
  const path = [];
  /** 지금 경로에 쌓인 사각형. `fill()` 이 오면 칠로 기록된다. */
  const rects = [];
  const stack = [];
  const state = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineDash: [],
    lineDashOffset: 0,
    globalAlpha: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
  };

  return {
    ops,
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v) {
      state.fillStyle = v;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v) {
      state.strokeStyle = v;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v) {
      state.lineWidth = v;
    },
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(v) {
      state.globalAlpha = v;
    },
    get lineCap() {
      return state.lineCap;
    },
    set lineCap(v) {
      state.lineCap = v;
    },
    get lineJoin() {
      return state.lineJoin;
    },
    set lineJoin(v) {
      state.lineJoin = v;
    },
    get miterLimit() {
      return state.miterLimit;
    },
    set miterLimit(v) {
      state.miterLimit = v;
    },
    get lineDashOffset() {
      return state.lineDashOffset;
    },
    set lineDashOffset(v) {
      state.lineDashOffset = v;
    },
    font: "",
    textAlign: "",
    textBaseline: "",
    fillRect: (x, y, w, h) =>
      ops.push({ op: "fillRect", color: state.fillStyle, alpha: state.globalAlpha, x, y, w, h }),
    strokeRect: (x, y, w, h) =>
      ops.push({
        op: "strokeRect",
        color: state.strokeStyle,
        lineWidth: state.lineWidth,
        dash: [...state.lineDash],
        x,
        y,
        w,
        h,
      }),
    fillText: (text, x, y) => ops.push({ op: "fillText", text, x, y }),
    strokeText: (text, x, y) =>
      ops.push({ op: "strokeText", text, x, y, color: state.strokeStyle, lineWidth: state.lineWidth }),
    // 글자 폭은 글꼴 크기에 비례한다고 본다. 실제 글꼴은 아니지만, 크기를 줄이면
    // 좁아진다는 성질이 같아야 렌더러의 "줄여서 넣기" 를 시험할 수 있다.
    measureText(text) {
      const size = Number.parseInt(this.font, 10) || 12;
      return { width: text.length * size * 0.55 };
    },
    save() {
      stack.push({ ...state, lineDash: [...state.lineDash] });
    },
    restore() {
      const previous = stack.pop();
      if (previous) Object.assign(state, previous);
    },
    translate() {},
    scale() {},
    setTransform() {},
    beginPath() {
      path.length = 0;
      rects.length = 0;
    },
    // 경로에 쌓아 두고 `fill()` 에서 한꺼번에 기록한다. 실제 캔버스도 그렇게
    // 동작한다 — 겹쳐 담아도 칠은 한 겹이다.
    rect: (x, y, w, h) => {
      rects.push({ x, y, w, h });
      ops.push({ op: "rect", x, y, w, h });
    },
    clip: () => ops.push({ op: "clip" }),
    closePath() {},
    moveTo: (x, y) => path.push({ x, y }),
    lineTo: (x, y) => path.push({ x, y }),
    stroke() {
      if (path.length >= 2) {
        ops.push({
          op: "stroke",
          color: state.strokeStyle,
          lineWidth: state.lineWidth,
          dash: [...state.lineDash],
          dashOffset: state.lineDashOffset,
          from: { ...path[0] },
          to: { ...path[path.length - 1] },
        });
      }
    },
    /**
     * 경로를 채운다.
     *
     * 경로에 담긴 사각형마다 `fillRect` 와 같은 op 를 남긴다 — 사각형 여러 개를
     * 한 경로에 모아 한 번 채우는 그림을, 낱개로 채우던 예전 그림과 같은 눈으로
     * 확인할 수 있어야 하기 때문이다. `filled: true` 로 갈라볼 수 있게 표시해 둔다.
     */
    fill() {
      for (const r of rects) {
        ops.push({
          op: "fillRect",
          filled: true,
          color: state.fillStyle,
          alpha: state.globalAlpha,
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
        });
      }
      rects.length = 0;
    },
    arc() {},
    setLineDash: (dash) => {
      state.lineDash = [...dash];
    },
    getLineDash: () => [...state.lineDash],
  };
}

export const VISIBLE = { background: true, equipment: true, wiring: true };
