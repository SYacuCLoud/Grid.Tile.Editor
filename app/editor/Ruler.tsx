"use client";

import { useEffect, useRef } from "react";

import { drawRuler, RULER_THICKNESS } from "./rulerRender";

interface RulerProps {
  orientation: "horizontal" | "vertical";
  /** 칸 수 — 가로면 cols, 세로면 rows. */
  count: number;
  cell: number;
  /** 커서가 놓인 칸 번호. */
  highlight: number | null;
}

/**
 * 도면 위·왼쪽에 붙는 칸 번호 눈금자.
 *
 * 스크롤 상자 안에서 `sticky` 로 붙어 있어 스크롤을 따라 움직인다 — 자바스크립트로
 * 스크롤 위치를 따라다니게 만들면 큰 도면에서 눈금자가 한 프레임씩 늦게 따라온다.
 */
export function Ruler({ orientation, count, cell, highlight }: RulerProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const along = count * cell;
  const width = orientation === "horizontal" ? along : RULER_THICKNESS;
  const height = orientation === "horizontal" ? RULER_THICKNESS : along;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawRuler(ctx, { count, cell, orientation, highlight });
  }, [cell, count, height, highlight, orientation, width]);

  return (
    <canvas
      ref={ref}
      style={{ width, height }}
      className={`shrink-0 ${orientation === "horizontal" ? "sticky top-0 z-20" : "sticky left-0 z-20"}`}
      aria-hidden
    />
  );
}

/** 두 눈금자가 만나는 왼쪽 위 빈 칸. */
export function RulerCorner() {
  return (
    <div
      className="sticky left-0 top-0 z-30 shrink-0 border-b border-r border-slate-300 bg-slate-200"
      style={{ width: RULER_THICKNESS, height: RULER_THICKNESS }}
    />
  );
}
