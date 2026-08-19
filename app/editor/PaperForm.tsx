"use client";

import { DEFAULT_PRINT_DPI } from "./printSheet";
import {
  DEFAULT_CELL_MM,
  DEFAULT_MARGIN_MM,
  defaultPaper,
  MAX_CELL_MM,
  MAX_MARGIN_MM,
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
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          큰 도면이 몇 장에 걸쳐 인쇄되는지, 어디서 잘리는지 점선으로 보여 줍니다. 격자와 PNG 는 바뀌지 않습니다.
        </p>
      </>
    );
  }

  const per = sheetCells(paper);
  const count = sheetCount(paper, cols, rows, props.legendCount);
  const band = legendBandCells(paper, props.legendCount);
  const size = paperSizeMm(paper);

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
        {size.widthMm} × {size.heightMm}mm · 한 장에 가로 {per.cols} × 세로 {per.rows}칸
        <br />
        이 격자({cols} × {rows}) + 범례 {band}행은{" "}
        <span className="font-semibold text-slate-900">가로 {count.across} · 세로 {count.down} = {count.total}장</span>
      </p>

      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        `PNG 저장` 은 이 용지 규격({DEFAULT_PRINT_DPI}dpi)으로 뽑습니다.
        {count.total > 1 ? ` 장마다 파일이 나뉘어 ${count.total}개가 내려받아집니다.` : " 100% 배율로 인쇄하면 화면 경계선과 자리가 맞습니다."}
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
