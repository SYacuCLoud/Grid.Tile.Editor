"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { LayoutDoc } from "../editor/doc";
import type { LayerId } from "../editor/palette";
import { renderDoc } from "../editor/render";
import { fitCell, MAX_CANVAS_PX } from "../m/mobileView";
import { fitLabel, type Flash, flashAlpha, LIVE_COLORS, type PlacedReader, readerPaint, shortUid } from "./liveState";

interface LiveCanvasProps {
  doc: LayoutDoc;
  visible: Record<LayerId, boolean>;
  placed: PlacedReader[];
  flashes: Record<string, Flash>;
  /** 잔상 계산 기준 시각. 부모가 틱마다 올려 준다. */
  now: number;
  /** 리더 id → 칸에 적을 실물 이름. 기준정보에서 찾은 것만 들어 있다. */
  labels?: Record<string, string>;
  /** 리더 id → 잔상 글자(마지막에 있던 태그). 유지 시간 안의 것만 들어 있다. */
  ghosts?: Record<string, string>;
}

/**
 * 현황판의 도면.
 *
 * 벽에 걸어 두는 화면이라 끌기 · 키우기는 없다 — 페이지 전체가 화면에 들어가는 크기로
 * 맞춘다. 캔버스는 둘을 겹친다: 아래는 도면(문서가 바뀔 때만 다시 그림), 위는 리더
 * 상태 오버레이(메시지 · 틱마다 다시 그림). 한 장에 그리면 잔상 한 번에 도면 전체를
 * 다시 그려야 한다.
 */
export function LiveCanvas(props: LiveCanvasProps) {
  const { doc, visible, placed, flashes, now, labels, ghosts } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const measured = size.width > 0 && size.height > 0;
  const cell = measured ? fitCell(doc.cols, doc.rows, size.width, size.height, 12) : 8;
  const canvasW = doc.cols * cell;
  const canvasH = doc.rows * cell;
  const ratio = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, MAX_CANVAS_PX / Math.max(1, canvasW, canvasH));

  // 도면. 문서 · 배율이 바뀔 때만.
  useLayoutEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || canvasW === 0 || canvasH === 0) return;
    canvas.width = Math.round(canvasW * ratio);
    canvas.height = Math.round(canvasH * ratio);
    canvas.style.width = `${canvasW}px`;
    canvas.style.height = `${canvasH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    renderDoc(ctx, doc, { cell, visible, showGrid: cell >= 6 });
  }, [canvasH, canvasW, cell, doc, ratio, visible]);

  // 오버레이. 리더 상태 · 잔상 · 틱마다.
  useLayoutEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || canvasW === 0 || canvasH === 0) return;
    canvas.width = Math.round(canvasW * ratio);
    canvas.height = Math.round(canvasH * ratio);
    canvas.style.width = `${canvasW}px`;
    canvas.style.height = `${canvasH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, canvasW, canvasH);
    drawOverlay(ctx, cell, placed, flashes, now, labels, ghosts);
  }, [canvasH, canvasW, cell, flashes, ghosts, labels, now, placed, ratio]);

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <div className="absolute" style={{ left: Math.max(0, (size.width - canvasW) / 2), top: Math.max(0, (size.height - canvasH) / 2) }}>
        <canvas ref={baseRef} className="block bg-white" />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 block" aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * 리더가 놓인 칸마다 상태 색과 실물 이름(또는 UID), 방금 일어난 이벤트의 잔상을 얹는다.
 *
 * 글자는 칸마다 찍지 않고 그 리더의 칸들을 감싸는 네모 한가운데에 한 번 찍는다 — 한 장치가
 * 여러 칸에 걸쳐 있으면 그만큼 넓게 쓸 수 있다. 이름이 그 폭에 안 들어가면 글자를 줄이고,
 * 그래도 안 되면 짧은 UID 로 물러난다. 벽걸이 화면에서 잘린 글자는 없는 것보다 나쁘다.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  cell: number,
  placed: PlacedReader[],
  flashes: Record<string, Flash>,
  now: number,
  labels?: Record<string, string>,
  ghosts?: Record<string, string>,
) {
  for (const { reader, cells } of placed) {
    const paint = readerPaint(reader, labels?.[reader.id], ghosts?.[reader.id]);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of cells) {
      const px = point.x * cell;
      const py = point.y * cell;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px + cell);
      maxY = Math.max(maxY, py + cell);

      if (paint.fill) {
        ctx.globalAlpha = paint.fillAlpha;
        ctx.fillStyle = paint.fill;
        ctx.fillRect(px, py, cell, cell);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = paint.stroke;
      ctx.lineWidth = paint.strokeWidth;
      ctx.setLineDash(paint.dashed ? [3, 3] : []);
      const inset = paint.strokeWidth / 2;
      ctx.strokeRect(px + inset, py + inset, cell - paint.strokeWidth, cell - paint.strokeWidth);
      ctx.setLineDash([]);
    }

    if (paint.text && cell >= 14 && cells.length > 0) {
      const box = fitLabel(ctx, paint.text, shortUid(paint.ghost ? reader.lastUid : reader.uid), maxX - minX - 4, maxY - minY - 4, cell);
      ctx.font = box.font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      const cx = (minX + maxX) / 2;
      const top = (minY + maxY) / 2 - ((box.lines.length - 1) * box.lineHeight) / 2;
      if (paint.ghost) {
        // 잔상 — 마지막에 있던 태그. 옅은 회색 채움 위에 진한 회색 글자와 흰 테. 태그 있음(녹색 위 흰 글씨)과 갈리되 멀리서도 읽힌다.
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = Math.max(2, box.fontSize * 0.28);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
        box.lines.forEach((line, index) => {
          const cy = top + index * box.lineHeight;
          ctx.strokeText(line, cx, cy);
          ctx.fillStyle = LIVE_COLORS.ghost;
          ctx.fillText(line, cx, cy);
        });
        ctx.globalAlpha = 1;
      } else {
        ctx.lineWidth = Math.max(2, box.fontSize * 0.28);
        ctx.strokeStyle = "rgba(15, 23, 42, 0.85)";
        box.lines.forEach((line, index) => {
          const cy = top + index * box.lineHeight;
          ctx.strokeText(line, cx, cy);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(line, cx, cy);
        });
      }
    }

    // 잔상 — 칸 둘레에서 바깥으로 퍼지며 옅어지는 테.
    const flash = flashes[reader.id];
    const alpha = flashAlpha(flash, now);
    if (flash && alpha > 0) {
      const grow = (1 - alpha) * cell * 0.6;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = flash.kind === "APPEAR" ? LIVE_COLORS.appear : LIVE_COLORS.remove;
      ctx.lineWidth = Math.max(2, cell * 0.12);
      for (const point of cells) {
        const px = point.x * cell;
        const py = point.y * cell;
        ctx.strokeRect(px - grow, py - grow, cell + grow * 2, cell + grow * 2);
      }
      ctx.globalAlpha = 1;
    }
  }
}
