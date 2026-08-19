"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { CellNoteBubble } from "./CellNoteBubble";
import { cellKey, cellPhotos, type LayoutDoc, type Point } from "./doc";
import { type LayerId, type PaletteItem } from "./palette";
import { type CellRange } from "./range";
import { canvasCells, renderDoc } from "./render";
import type { WheelAnchor } from "./zoom";

interface GridCanvasProps {
  doc: LayoutDoc;
  cell: number;
  visible: Record<LayerId, boolean>;
  showGrid: boolean;
  previewPoints: Point[];
  previewItem: PaletteItem | null;
  activeLayer: LayerId;
  selectedKey: string | null;
  selectionRange: CellRange | null;
  hover: Point | null;
  cursor: string;
  onBegin: (p: Point) => void;
  onMove: (p: Point) => void;
  onEnd: (p: Point | null) => void;
  onLeave: () => void;
  /** 칸 우클릭 — 메모 편집 상자를 연다. */
  onContextMenu: (p: Point) => void;
  /** 메모 편집 상자가 열려 있으면 말풍선을 띄우지 않는다. */
  noteOpen: boolean;
  /** 인쇄 한 장에 들어가는 칸 수. 없으면 경계선을 그리지 않는다. */
  printGuide: { cols: number; rows: number } | null;
  /** 인쇄 경계선 안에 미리 그려 볼 범례. */
  printLegend: { items: PaletteItem[]; bandCells: number; columns: number } | null;
  /** 휠 확대·축소. 커서 아래 지점을 고정하려고 그 지점의 좌표를 함께 넘긴다. */
  onWheelZoom: (delta: number, anchor: WheelAnchor) => void;
  /** 메모 편집 상자 등 도면 위에 겹쳐 놓을 것. */
  children?: React.ReactNode;
}

export function GridCanvas(props: GridCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { doc, cell, visible, showGrid, previewPoints, previewItem, activeLayer, selectedKey, selectionRange, hover } = props;
  // 인쇄 경계선을 켜면 캔버스가 용지 범위까지 넓어진다. 격자보다 큰 용지도 화면에 보인다.
  const span = canvasCells(doc, props.printGuide, props.printLegend?.bandCells ?? 0);
  const size = { width: span.cols * cell, height: span.rows * cell };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    renderDoc(ctx, doc, {
      cell,
      visible,
      showGrid,
      preview: previewPoints.length > 0 ? { item: previewItem, layer: activeLayer, points: previewPoints } : null,
      selected: selectedKey,
      selectionRange,
      hover,
      printGuide: props.printGuide,
      printLegend: props.printLegend,
    });
  }, [activeLayer, cell, doc, hover, previewItem, previewPoints, props.printGuide, props.printLegend, selectedKey, selectionRange, showGrid, size.height, size.width, visible]);

  const onWheelZoom = props.onWheelZoom;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // React 의 onWheel 은 passive 로 붙을 수 있어 preventDefault 가 통하지 않는다.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();

      const rect = canvas.getBoundingClientRect();
      onWheelZoom(event.deltaY < 0 ? 1 : -1, {
        docX: (event.clientX - rect.left) / cell,
        docY: (event.clientY - rect.top) / cell,
        clientX: event.clientX,
        clientY: event.clientY,
        canvasLeft: rect.left,
        canvasTop: rect.top,
      });
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [cell, onWheelZoom]);

  const pointFromEvent = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>): Point => {
      const rect = event.currentTarget.getBoundingClientRect();
      return {
        x: Math.floor((event.clientX - rect.left) / cell),
        y: Math.floor((event.clientY - rect.top) / cell),
      };
    },
    [cell],
  );

  // 마우스를 올린 칸에 메모나 사진이 있으면 말풍선으로 보여 준다.
  const hoverCell = hover ? doc.equipment[cellKey(hover.x, hover.y)] : undefined;
  const hoverMemo = hoverCell?.memo;
  const hoverPhotos = cellPhotos(hoverCell);

  return (
    <div className="relative inline-block">
      <canvas
        ref={canvasRef}
        className="block touch-none select-none bg-white shadow-[0_1px_3px_rgba(15,23,42,0.18)]"
        style={{ cursor: props.cursor }}
        onPointerDown={(event) => {
          // 그리기는 왼쪽 버튼만. 가운데는 화면 이동, 오른쪽은 메모 상자다.
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          props.onBegin(pointFromEvent(event));
        }}
        onPointerMove={(event) => props.onMove(pointFromEvent(event))}
        onPointerUp={(event) => {
          if (event.button !== 0) return;
          props.onEnd(pointFromEvent(event));
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => props.onEnd(null)}
        onPointerLeave={() => props.onLeave()}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContextMenu(pointFromEvent(event));
        }}
      />

      {hover && (hoverMemo || hoverPhotos.length > 0) && !props.noteOpen ? (
        <CellNoteBubble
          text={hoverMemo ?? ""}
          photos={hoverPhotos}
          x={hover.x}
          y={hover.y}
          cell={cell}
          cols={doc.cols}
          rows={doc.rows}
        />
      ) : null}

      {props.children}
    </div>
  );
}
