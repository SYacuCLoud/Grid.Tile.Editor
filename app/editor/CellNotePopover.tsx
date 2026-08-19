"use client";

import { useEffect, useRef, useState } from "react";

const PANEL_WIDTH = 240;

interface CellNotePopoverProps {
  /** 칸의 격자 좌표. */
  x: number;
  y: number;
  cell: number;
  cols: number;
  rows: number;
  initialLabel: string;
  initialMemo: string;
  /** 칸 위치 안내에 쓰는 한 줄 (예: "가로 3 · 세로 5 · 설치 (정상)"). */
  caption: string;
  onSave: (value: { label: string; memo: string }) => void;
  onClose: () => void;
}

const BUTTON = "h-7 flex-1 border border-slate-300 bg-white text-[12px] text-slate-700 hover:bg-slate-100";
const OK_BUTTON = "h-7 flex-1 border border-slate-800 bg-slate-800 text-[12px] text-white hover:bg-slate-700";

/** 칸을 우클릭하면 그 자리에 뜨는 메모 편집 상자. */
export function CellNotePopover(props: CellNotePopoverProps) {
  const { x, y, cell, cols, rows } = props;
  const [label, setLabel] = useState(props.initialLabel);
  const [memo, setMemo] = useState(props.initialMemo);
  const labelRef = useRef<HTMLInputElement | null>(null);

  // 열린 순간 한 번만 포커스한다. 장비 ID 부터 넣는 경우가 많다.
  useEffect(() => {
    labelRef.current?.focus();
    labelRef.current?.select();
  }, []);

  // Esc 로 닫는다. (도면을 클릭하면 그리기 쪽에서 닫는다.)
  const onClose = props.onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const flipX = (x + 1) * cell + PANEL_WIDTH > cols * cell;
  const flipY = y > rows - 8;

  const style: React.CSSProperties = {
    width: PANEL_WIDTH,
    top: flipY ? undefined : (y + 1) * cell + 6,
    bottom: flipY ? (rows - y) * cell + 6 : undefined,
    left: flipX ? undefined : x * cell,
    right: flipX ? (cols - x - 1) * cell : undefined,
  };

  const save = () => props.onSave({ label, memo });

  return (
    <div
      className="absolute z-30 border border-slate-400 bg-white p-2 shadow-lg"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="mb-1 text-[11px] font-semibold text-slate-700">칸 정보</p>
      <p className="mb-1.5 text-[11px] text-slate-500">{props.caption}</p>

      <label className="text-[10px] font-semibold tracking-wide text-slate-500">
        장비 ID
        <input
          ref={labelRef}
          value={label}
          placeholder="예: C1101"
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
          className="mt-0.5 h-7 w-full border border-slate-300 bg-white px-2 text-[13px] text-slate-900 outline-none focus:border-slate-600"
          aria-label="장비 ID"
        />
      </label>

      <label className="mt-1.5 block text-[10px] font-semibold tracking-wide text-slate-500">
        메모
        <textarea
          value={memo}
          placeholder="예: 3월 점검 대상, 배선 재작업 필요"
          onChange={(event) => setMemo(event.target.value)}
          onKeyDown={(event) => {
            // 줄바꿈은 Shift+Enter. Enter 는 저장이다.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              save();
            }
          }}
          className="mt-0.5 h-20 w-full resize-none border border-slate-300 bg-white px-2 py-1 text-[13px] text-slate-900 outline-none focus:border-slate-600"
          aria-label="칸 메모"
        />
      </label>

      <div className="mt-2 flex gap-1">
        <button type="button" className={OK_BUTTON} onClick={save}>
          저장
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => props.onSave({ label: "", memo: "" })}
          disabled={!props.initialLabel && !props.initialMemo}
          title="이 칸의 장비 ID 와 메모를 지운다"
        >
          지우기
        </button>
        <button type="button" className={BUTTON} onClick={props.onClose}>
          닫기
        </button>
      </div>

      <p className="mt-1 text-[10px] text-slate-400">Enter 저장 · Shift+Enter 줄바꿈 · Esc 닫기</p>
    </div>
  );
}
