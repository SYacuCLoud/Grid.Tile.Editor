"use client";

import { DEFAULT_PRINT_DPI, lastSheetGrid, planPrint } from "./printSheet";
import { type MemoEntry, planMemoPages } from "./memoPrint";
import {
  DEFAULT_CELL_MM,
  DEFAULT_MARGIN_MM,
  DEFAULT_MEMO_MODE,
  defaultPaper,
  MAX_CELL_MM,
  MAX_MARGIN_MM,
  type MemoPrintMode,
  MIN_CELL_MM,
  type PagePaper,
  type PaperId,
  PAPERS,
  paperSizeMm,
  legendBandCells,
  sheetCells,
  sheetCount,
} from "./paper";

const FIELD =
  "h-7 w-full border border-slate-300 bg-white px-1.5 text-[12px] text-slate-900 outline-none focus:border-slate-600";
const LABEL = "text-[10px] font-semibold tracking-wide text-slate-500";

interface PaperFormProps {
  paper: PagePaper | undefined;
  cols: number;
  rows: number;
  /** 인쇄물에 함께 실릴 범례 항목 수. */
  legendCount: number;
  /** 이 페이지의 메모. 번호는 이미 매겨져 있다. */
  memos: MemoEntry[];
  memoCount: number;
  onChange: (paper: PagePaper | null) => void;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** 활성 페이지의 인쇄 용지 설정. 격자와 PNG 는 건드리지 않고 화면 경계선만 정한다. */
export function PaperForm(props: PaperFormProps) {
  const { paper, cols, rows } = props;

  if (!paper) {
    return (
      <>
        <button type="button" className={`${FIELD} h-8 hover:bg-slate-100`} onClick={() => props.onChange(defaultPaper())}>
          인쇄 경계선 켜기
        </button>
        <p className="mt-1 text-[11px] text-slate-500">인쇄될 장 경계를 점선으로 보여 줍니다.</p>
      </>
    );
  }

  const per = sheetCells(paper);
  const count = sheetCount(paper, cols, rows, props.legendCount);
  const band = legendBandCells(paper, props.legendCount);
  const size = paperSizeMm(paper);
  const memoMode = paper.memoMode ?? DEFAULT_MEMO_MODE;

  // 메모가 몇 장에 걸치는지 미리 보여 준다. 뽑는 쪽과 같은 계산을 쓴다.
  const plan = planPrint({ cols, rows }, paper, props.legendCount, DEFAULT_PRINT_DPI);
  const memoPages =
    memoMode === "off"
      ? []
      : planMemoPages(
          memoMode,
          props.memos,
          paper,
          memoMode === "inline" ? lastSheetGrid({ cols, rows }, plan) : null,
        );

  const update = (patch: Partial<PagePaper>) => props.onChange({ ...paper, ...patch });

  return (
    <>
      <div className="flex items-end gap-2">
        <label className={`flex-1 ${LABEL}`}>
          용지
          <select
            className={FIELD}
            value={paper.id}
            onChange={(event) => update({ id: event.target.value as PaperId })}
          >
            {PAPERS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className={`flex-1 ${LABEL}`}>
          방향
          <select
            className={FIELD}
            value={paper.orientation}
            onChange={(event) => update({ orientation: event.target.value === "portrait" ? "portrait" : "landscape" })}
          >
            <option value="landscape">가로</option>
            <option value="portrait">세로</option>
          </select>
        </label>
      </div>

      <div className="mt-2 flex items-end gap-2">
        <label className={`flex-1 ${LABEL}`}>
          한 칸 (mm)
          <input
            type="number"
            className={FIELD}
            min={MIN_CELL_MM}
            max={MAX_CELL_MM}
            step={0.5}
            value={paper.cellMm}
            onChange={(event) =>
              update({ cellMm: clamp(Number(event.target.value), MIN_CELL_MM, MAX_CELL_MM, DEFAULT_CELL_MM) })
            }
          />
        </label>
        <label className={`flex-1 ${LABEL}`}>
          여백 (mm)
          <input
            type="number"
            className={FIELD}
            min={0}
            max={MAX_MARGIN_MM}
            step={1}
            value={paper.marginMm}
            onChange={(event) =>
              update({ marginMm: clamp(Number(event.target.value), 0, MAX_MARGIN_MM, DEFAULT_MARGIN_MM) })
            }
          />
        </label>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
        {size.widthMm} × {size.heightMm}mm · 한 장에 {per.cols} × {per.rows}칸
        <br />
        {cols} × {rows} + 범례 {band}행 →{" "}
        <span className="font-semibold text-slate-900">
          {count.across} × {count.down} = {count.total}장
        </span>
      </p>

      <p className="mt-1 text-[11px] text-slate-500">
        PNG 저장: 이 규격 {DEFAULT_PRINT_DPI}dpi{count.total > 1 ? ` · 파일 ${count.total}개` : ""}
      </p>

      <label className="mt-2 flex items-center gap-1.5 text-[12px] text-slate-700">
        <input
          type="checkbox"
          checked={memoMode !== "off"}
          onChange={(event) => update({ memoMode: event.target.checked ? "inline" : "off" })}
        />
        메모 본문 인쇄
        <span className="text-[11px] text-slate-400">
          ({props.memoCount}건)
        </span>
      </label>

      {/* 켤 때만 자리를 고른다. 껐으면 고를 것이 없다. */}
      {memoMode !== "off" ? (
        <label className={`mt-1 block ${LABEL}`}>
          메모 자리
          <select
            className={FIELD}
            value={memoMode}
            onChange={(event) => update({ memoMode: event.target.value as MemoPrintMode })}
          >
            <option value="inline">빈 곳에 채움 (넘치면 다음 장)</option>
            <option value="appendix">별지로 모음</option>
          </select>
        </label>
      ) : null}

      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        {memoMode === "off"
          ? "도면 칸에는 메모 번호가 찍힙니다. 본문은 실리지 않습니다."
          : memoPages.length === 0
            ? "실을 메모가 없습니다."
            : `메모 ${props.memoCount}건 · ${
                memoPages.some((page) => page.onGridSheet)
                  ? `마지막 장 빈 곳${
                      memoPages.filter((page) => !page.onGridSheet).length > 0
                        ? ` + 추가 ${memoPages.filter((page) => !page.onGridSheet).length}장`
                        : ""
                    }`
                  : `별지 ${memoPages.length}장`
              }`}
      </p>

      <button
        type="button"
        className="mt-2 h-7 w-full border border-slate-300 bg-white text-[12px] text-slate-700 hover:bg-slate-100"
        onClick={() => props.onChange(null)}
      >
        인쇄 경계선 끄기
      </button>
    </>
  );
}
