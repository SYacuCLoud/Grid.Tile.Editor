"use client";

interface CellNoteBubbleProps {
  text: string;
  /** 칸의 격자 좌표. */
  x: number;
  y: number;
  cell: number;
  /** 도면 전체 칸 수 — 오른쪽·아래 끝에서 말풍선이 잘리지 않게 방향을 바꾼다. */
  cols: number;
  rows: number;
}

const MAX_WIDTH = 220;

/** 메모가 있는 칸에 마우스를 올리면 뜨는 읽기 전용 말풍선. */
export function CellNoteBubble(props: CellNoteBubbleProps) {
  const { x, y, cell, cols, rows } = props;

  // 오른쪽 끝에서는 왼쪽으로, 아래 끝에서는 위로 펼친다.
  const flipX = (x + 1) * cell + MAX_WIDTH > cols * cell;
  const flipY = y > rows - 4;

  const style: React.CSSProperties = {
    maxWidth: MAX_WIDTH,
    top: flipY ? undefined : (y + 1) * cell + 6,
    bottom: flipY ? (rows - y) * cell + 6 : undefined,
    left: flipX ? undefined : x * cell,
    right: flipX ? (cols - x - 1) * cell : undefined,
  };

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] leading-snug whitespace-pre-wrap break-words text-white shadow-md"
      style={style}
    >
      {props.text}
    </div>
  );
}
