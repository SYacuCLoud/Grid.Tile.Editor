"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { LayoutDoc, Point } from "../editor/doc";
import type { LayerId } from "../editor/palette";
import { renderDoc } from "../editor/render";
import {
  cellAt,
  centerOn,
  clampCell,
  clampOffset,
  distance,
  fitCell,
  MAX_CANVAS_PX,
  midpoint,
  type Offset,
  zoomAbout,
} from "./mobileView";

/** 부모가 손으로 부르는 것들. 메모 목록에서 칸으로 건너가기, 전체 보기. */
export interface MobileCanvasHandle {
  /** 이 칸을 화면 가운데로 가져온다. 너무 작으면 손톱만큼은 보이게 키운다. */
  focusCell: (point: Point) => void;
  /** 도면 전체가 보이게 되돌린다. */
  fit: () => void;
}

interface MobileCanvasProps {
  doc: LayoutDoc;
  visible: Record<LayerId, boolean>;
  memoIndex: Record<string, number>;
  /** 누른 칸. 도면에 테두리로 표시한다. */
  selected: string | null;
  /** 칸을 짧게 눌렀다. 도면 밖이면 null. */
  onTap: (point: Point | null) => void;
  ref?: React.Ref<MobileCanvasHandle>;
}

/** 이보다 조금 움직인 것은 손 떨림으로 보고 탭으로 친다. */
const TAP_SLOP_PX = 8;
/** 두 번 두드림으로 볼 간격. */
const DOUBLE_TAP_MS = 320;
/** 두 번 두드리면 이 배율로 키운다(맞춤 크기 기준). */
const DOUBLE_TAP_ZOOM = 3;
/** 화면을 아직 재지 못했을 때의 임시 칸 크기. 첫 그리기 한 번에만 쓰인다. */
const FALLBACK_CELL = 8;

interface Pointer {
  x: number;
  y: number;
}

interface View {
  cell: number;
  offset: Offset;
}

/**
 * 손가락으로 보는 도면.
 *
 * 한 손가락은 끌어 옮기기, 두 손가락은 키우기·줄이기, 짧게 누르면 칸 고르기,
 * 두 번 두드리면 그 자리를 키우고 다시 두드리면 전체가 보이게 돌아온다.
 * 브라우저의 스크롤·확대는 끄고(`touch-none`) 여기서 다 맡는다 — 그래야 두
 * 손가락이 페이지를 키우지 않고 도면만 키운다.
 *
 * 배율·위치(`view`)가 없으면 "전체가 보이는 크기" 를 그때그때 계산해 쓴다. 그래서
 * 화면을 처음 재거나 돌렸을 때 따로 맞출 일이 없고, 부모가 `key` 로 페이지를
 * 바꾸면 상태가 비워져 새 페이지도 전체가 보이게 시작한다.
 */
export function MobileCanvas({ ref, ...props }: MobileCanvasProps) {
  const { doc, visible, memoIndex, selected, onTap } = props;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View | null>(null);

  const measured = viewSize.width > 0 && viewSize.height > 0;
  const fitted = measured ? fitCell(doc.cols, doc.rows, viewSize.width, viewSize.height) : FALLBACK_CELL;
  const cell = view?.cell ?? fitted;
  const canvasW = doc.cols * cell;
  const canvasH = doc.rows * cell;
  const offset = view?.offset ?? clampOffset({ x: 0, y: 0 }, canvasW, canvasH, viewSize.width, viewSize.height);

  // 화면 크기를 잰다. 회전하거나 주소창이 접히면 다시 잰다.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setViewSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** 배율을 바꾸되 화면의 한 점은 고정한다. */
  const zoomTo = useCallback(
    (nextCellRaw: number, anchor: Offset, from: View) => {
      const nextCell = clampCell(nextCellRaw, doc.cols, doc.rows);
      const nextOffset = clampOffset(
        zoomAbout(from.offset, from.cell, nextCell, anchor),
        doc.cols * nextCell,
        doc.rows * nextCell,
        viewSize.width,
        viewSize.height,
      );
      setView({ cell: nextCell, offset: nextOffset });
    },
    [doc.cols, doc.rows, viewSize.height, viewSize.width],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit: () => setView(null),
      focusCell: (point) => {
        if (!measured) return;
        // 칸이 손톱만큼은 보이도록 키운다. 이미 크면 그대로 둔다.
        const nextCell = clampCell(Math.max(cell, fitted * 2, 24), doc.cols, doc.rows);
        setView({
          cell: nextCell,
          offset: clampOffset(
            centerOn(point, nextCell, viewSize.width, viewSize.height),
            doc.cols * nextCell,
            doc.rows * nextCell,
            viewSize.width,
            viewSize.height,
          ),
        });
      },
    }),
    [cell, doc.cols, doc.rows, fitted, measured, viewSize.height, viewSize.width],
  );

  // 그리기. 배율이 바뀔 때마다 그 크기로 다시 그린다 — CSS 로 늘리면 글자가 뭉갠다.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasW === 0 || canvasH === 0) return;

    const dpr = window.devicePixelRatio || 1;
    // 기기 배율을 살리되 캔버스 상한은 넘지 않는다.
    const ratio = Math.min(2, dpr, MAX_CANVAS_PX / Math.max(canvasW, canvasH));
    canvas.width = Math.round(canvasW * ratio);
    canvas.height = Math.round(canvasH * ratio);
    canvas.style.width = `${canvasW}px`;
    canvas.style.height = `${canvasH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    renderDoc(ctx, doc, {
      cell,
      visible,
      // 아주 작을 때 격자선은 회색 판이 될 뿐이다.
      showGrid: cell >= 6,
      selected,
      memoIndex,
    });
  }, [canvasH, canvasW, cell, doc, memoIndex, selected, visible]);

  // ---- 손가락 ----
  // 손가락 상태는 그리기와 무관하므로 ref 에 둔다. 이벤트 처리기는 매 렌더마다
  // 새로 만들어져 최신 cell · offset 을 그대로 본다.
  const pointers = useRef(new Map<number, Pointer>());
  /** 한 손가락 끌기의 시작점과 그때의 배율·위치. */
  const drag = useRef<{ start: Pointer; from: View; moved: boolean } | null>(null);
  /** 두 손가락 시작 상태. */
  const pinch = useRef<{ dist: number; mid: Offset; from: View } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  const current: View = { cell, offset };

  const local = (event: React.PointerEvent): Pointer => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = local(event);
    pointers.current.set(event.pointerId, p);

    if (pointers.current.size === 1) {
      drag.current = { start: p, from: current, moved: false };
      pinch.current = null;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: distance(a, b), mid: midpoint(a, b), from: current };
      drag.current = null;
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const p = local(event);
    pointers.current.set(event.pointerId, p);

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const start = pinch.current;
      const ratio = distance(a, b) / Math.max(1, start.dist);
      const nextCell = clampCell(start.from.cell * ratio, doc.cols, doc.rows);
      const mid = midpoint(a, b);
      // 시작할 때 손가락 사이에 있던 칸이 지금 손가락 사이에 그대로 오게 한다.
      const scaled = zoomAbout(start.from.offset, start.from.cell, nextCell, start.mid);
      const followed = { x: scaled.x + (mid.x - start.mid.x), y: scaled.y + (mid.y - start.mid.y) };
      setView({
        cell: nextCell,
        offset: clampOffset(followed, doc.cols * nextCell, doc.rows * nextCell, viewSize.width, viewSize.height),
      });
      return;
    }

    if (drag.current) {
      const dx = p.x - drag.current.start.x;
      const dy = p.y - drag.current.start.y;
      if (!drag.current.moved && Math.hypot(dx, dy) > TAP_SLOP_PX) drag.current.moved = true;
      if (drag.current.moved) {
        const from = drag.current.from;
        setView({
          cell: from.cell,
          offset: clampOffset(
            { x: from.offset.x + dx, y: from.offset.y + dy },
            doc.cols * from.cell,
            doc.rows * from.cell,
            viewSize.width,
            viewSize.height,
          ),
        });
      }
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const p = local(event);
    const wasDrag = drag.current;
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (pointers.current.size === 1) {
      // 두 손가락에서 하나를 뗐다. 남은 손가락으로 이어서 끌 수 있게 새로 잡는다.
      const [rest] = [...pointers.current.values()];
      drag.current = { start: rest, from: current, moved: true };
      pinch.current = null;
      return;
    }
    if (pointers.current.size > 0) return;

    pinch.current = null;
    drag.current = null;
    if (!wasDrag || wasDrag.moved) return;

    // 짧게 눌렀다. 두 번이면 키우기/되돌리기, 한 번이면 칸 고르기.
    const now = Date.now();
    const last = lastTap.current;
    if (last && now - last.at < DOUBLE_TAP_MS && Math.hypot(last.x - p.x, last.y - p.y) < TAP_SLOP_PX * 3) {
      lastTap.current = null;
      if (cell > fitted * 1.5) setView(null);
      else zoomTo(fitted * DOUBLE_TAP_ZOOM, p, current);
      return;
    }
    lastTap.current = { at: now, x: p.x, y: p.y };
    onTap(cellAt(p, offset, cell, doc.cols, doc.rows));
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      drag.current = null;
      pinch.current = null;
    }
  };

  // 마우스 휠(책상에서 확인할 때). 손가락과 같은 셈이다.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomTo(cell * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top }, { cell, offset });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [cell, offset, zoomTo]);

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-slate-200"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <canvas
        ref={canvasRef}
        className="absolute left-0 top-0 block bg-white shadow-[0_1px_4px_rgba(15,23,42,0.25)]"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      />
    </div>
  );
}
