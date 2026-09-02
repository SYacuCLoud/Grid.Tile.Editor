"use client";

import { useEffect } from "react";
import type { MemoEntry } from "./memoPrint";
import type { PagePaper } from "./paper";
import { PaperForm } from "./PaperForm";

const BUTTON = "h-7 border border-slate-300 bg-white px-2 text-[12px] text-slate-700 hover:bg-slate-100";

interface PaperModalProps {
  open: boolean;
  /** 활성 페이지 이름. 머리에 적어 어느 페이지의 용지인지 보인다 — 용지는 페이지마다 따로다. */
  pageName: string;
  paper: PagePaper | undefined;
  cols: number;
  rows: number;
  legendCount: number;
  memos: MemoEntry[];
  onChange: (paper: PagePaper | null) => void;
  onClose: () => void;
}

/**
 * 인쇄 용지 규격 모달. 툴바 둘째 줄의 `용지 설정` 단추로 연다(`인쇄 용지` 를 켠 뒤).
 *
 * 용지 규격은 한 번 정하면 잘 안 바꾸는 값이라 늘 보이는 패널 자리를 차지할
 * 이유가 없다. 자주 갈리는 경계선 보기 · 메모 옵션은 툴바(`PrintOptions`)에 있다.
 */
export function PaperModal(props: PaperModalProps) {
  const { open, onClose } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="인쇄 용지">
      <div className="flex w-[320px] max-w-full flex-col border border-slate-400 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
          <p className="text-[12px] font-semibold text-slate-800">인쇄 용지 — {props.pageName}</p>
          <button type="button" className={BUTTON} onClick={onClose} title="닫기 (Esc)">
            닫기
          </button>
        </div>
        <div className="px-3 py-2">
          <PaperForm
            paper={props.paper}
            cols={props.cols}
            rows={props.rows}
            legendCount={props.legendCount}
            memos={props.memos}
            memoCount={props.memos.length}
            onChange={props.onChange}
          />
          <p className="mt-2 text-[11px] text-slate-500">
            경계선 보기 · 메모 본문 인쇄는 툴바 둘째 줄에서 고릅니다. 용지는 페이지마다 따로 저장됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}
