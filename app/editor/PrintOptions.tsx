"use client";

import { DEFAULT_MEMO_MODE, defaultPaper, type MemoPrintMode, type PagePaper } from "./paper";

const BUTTON =
  "h-8 border border-slate-300 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white";
const FIELD =
  "h-8 border border-slate-300 bg-white px-1.5 text-[12px] text-slate-900 outline-none focus:border-slate-600 disabled:opacity-40";
const CHECK = "flex items-center gap-1 text-[12px]";

interface PrintOptionsProps {
  /** 활성 페이지의 인쇄 용지. 없으면 `인쇄 용지` 가 꺼진 상태다. */
  paper: PagePaper | undefined;
  /** 화면에 인쇄 경계선(자홍색 점선 · 범례 띠 · 메모 자리)을 그릴지. 용지가 있을 때만 뜻이 있다. */
  showGuides: boolean;
  /** 이 페이지의 메모 수. 체크박스 옆에 보인다. */
  memoCount: number;
  onPaper: (paper: PagePaper | null) => void;
  onShowGuides: (value: boolean) => void;
  /** 용지 규격 모달을 연다. */
  onOpenPaper: () => void;
}

/**
 * 툴바 둘째 줄 왼쪽의 인쇄 옵션 — 인쇄 용지 켬/끔 · 용지 설정 · 경계선 보기 · 메모 본문 인쇄.
 *
 * `인쇄 용지` 를 켜면 PNG 가 용지 규격(장 나눔 · 범례 띠 · 메모)으로 나오고, 나머지
 * 항목이 살아난다. 용지 규격 자체는 한 번 정하면 잘 안 바꾸므로 `용지 설정` 모달
 * (`PaperModal`)에 두고, 여기에는 뽑을 때마다 갈리는 것만 둔다. 콤보 상자는 꺼져도
 * 숨기지 않는다 — 자리가 그대로 있어야 무엇을 켜면 무엇이 살아나는지 보인다.
 */
export function PrintOptions(props: PrintOptionsProps) {
  const { paper } = props;
  const memoMode = paper?.memoMode ?? DEFAULT_MEMO_MODE;
  const memoOn = !!paper && memoMode !== "off";
  const update = (patch: Partial<PagePaper>) => {
    if (paper) props.onPaper({ ...paper, ...patch });
  };
  const dim = (on: boolean) => (on ? "text-slate-700" : "text-slate-400");

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label className={`${CHECK} text-slate-700`} title="켜면 PNG 가 용지 규격으로 장을 나눠 나오고 범례 띠 · 메모가 함께 실린다">
        <input
          type="checkbox"
          checked={!!paper}
          onChange={(event) => props.onPaper(event.target.checked ? defaultPaper() : null)}
        />
        인쇄 용지
      </label>

      <button
        type="button"
        className={BUTTON}
        disabled={!paper}
        onClick={props.onOpenPaper}
        title={paper ? "용지 · 방향 · 한 칸 mm · 여백 · 장수" : "먼저 `인쇄 용지` 를 켜세요"}
      >
        용지 설정
      </button>

      <label
        className={`${CHECK} ${dim(!!paper)}`}
        title={paper ? "도면 위에 인쇄될 장 경계를 자홍색 점선으로 보인다 (PNG 에는 안 들어간다)" : "인쇄 용지를 켜면 고를 수 있다"}
      >
        <input
          type="checkbox"
          checked={!!paper && props.showGuides}
          disabled={!paper}
          onChange={(event) => props.onShowGuides(event.target.checked)}
        />
        인쇄 경계선 보기
      </label>

      <label
        className={`${CHECK} ${dim(!!paper)}`}
        title={paper ? "켜면 메모 본문이 인쇄물에 실린다. 끄면 도면 칸에 번호만 찍힌다" : "인쇄 용지를 켜면 고를 수 있다"}
      >
        <input
          type="checkbox"
          checked={memoOn}
          disabled={!paper}
          onChange={(event) => update({ memoMode: event.target.checked ? "inline" : "off" })}
        />
        메모 본문 인쇄
        <span className="text-[11px] text-slate-400">({props.memoCount}건)</span>
      </label>

      <select
        className={FIELD}
        value={memoOn ? memoMode : "inline"}
        disabled={!memoOn}
        onChange={(event) => update({ memoMode: event.target.value as MemoPrintMode })}
        aria-label="메모 자리"
        title={memoOn ? "메모 본문을 어디에 실을지" : "메모 본문 인쇄를 켜면 고를 수 있다"}
      >
        <option value="inline">빈 곳에 채움 (넘치면 다음 장)</option>
        <option value="appendix">별지로 모음</option>
      </select>
    </div>
  );
}
