"use client";

import { DEFAULT_PRINT_DPI, planPrint, sheetGrids } from "./printSheet";
import { type MemoEntry, planMemoPages } from "./memoPrint";
import {
  DEFAULT_CELL_MM,
  DEFAULT_MARGIN_MM,
  DEFAULT_MEMO_MODE,
  defaultPaper,
  MAX_CELL_MM,
  MAX_MARGIN_MM,
  MIN_CELL_MM,
  type PagePaper,
  type PaperId,
  PAPERS,
  paperSizeMm,
  legendBand,
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

/**
 * 활성 페이지의 인쇄 용지 규격 — 용지 · 방향 · 한 칸 mm · 여백과 장수 안내.
 * 경계선 켜기/끄기와 메모 옵션은 `PrintOptions`(PNG 저장 단추 옆)가 맡는다.
 */
export function PaperForm(props: PaperFormProps) {
  const { paper, cols, rows } = props;

  if (!paper) {
    return (
      <>
        <button type="button" className={`${FIELD} h-8 hover:bg-slate-100`} onClick={() => props.onChange(defaultPaper())}>
          인쇄 경계선 켜기
        </button>
        <p className="mt-1 text-[11px] text-slate-500">인쇄될 장 경계를 점선으로 보여 줍니다. 켜면 용지 규격을 고를 수 있습니다.</p>
      </>
    );
  }

  const per = sheetCells(paper);
  const count = sheetCount(paper, cols, rows, props.legendCount);
  const legendFit = legendBand(paper, props.legendCount, cols, rows);
  const band = legendFit.bandCells;
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
          memoMode === "inline" ? sheetGrids({ cols, rows }, plan) : null,
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
        {cols} × {rows} + 범례 {band}행{legendFit.compressed ? " (줄여 맞춤)" : ""} →{" "}
        <span className="font-semibold text-slate-900">
          {count.across} × {count.down} = {count.total}장
        </span>
      </p>

      <p className="mt-1 text-[11px] text-slate-500">
        PNG 저장: 이 규격 {DEFAULT_PRINT_DPI}dpi{count.total > 1 ? ` · 파일 ${count.total}개` : ""}
      </p>

      {/* 메모 본문을 실을지 · 어디에 실을지는 PNG 저장 단추 옆에서 고른다. 여기서는 결과만 보인다. */}
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        {memoMode === "off"
          ? "메모 본문 인쇄 꺼짐 — 도면 칸에는 메모 번호만 찍힙니다."
          : memoPages.length === 0
            ? "실을 메모가 없습니다."
            : `메모 ${props.memoCount}건 · ${
                memoPages.some((page) => page.onGridSheet)
                  ? `도면 장 빈 곳${
                      memoPages.filter((page) => !page.onGridSheet).length > 0
                        ? ` + 추가 ${memoPages.filter((page) => !page.onGridSheet).length}장`
                        : ""
                    }`
                  : `별지 ${memoPages.length}장`
              }`}
      </p>
    </>
  );
}
