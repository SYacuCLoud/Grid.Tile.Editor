"use client";

import { useState } from "react";
import {
  cellCount,
  type EquipmentCell,
  type LayoutDoc,
  MAX_COLS,
  MAX_ROWS,
  MIN_COLS,
  MIN_ROWS,
  parseCellKey,
} from "./doc";
import { indexPalette, type PaletteItem, resolveItem } from "./palette";
import type { MemoEntry } from "./memoPrint";
import { legendLabel } from "./paletteOps";
import { PaletteSwatch } from "./PaletteSwatch";
import type { PagePaper } from "./paper";
import { PaperForm } from "./PaperForm";

import { type CellRange } from "./range";

const FIELD = "h-8 w-full border border-slate-300 bg-white px-2 text-[13px] text-slate-900 outline-none focus:border-slate-600";
const SUB_BUTTON = "h-8 w-full border border-slate-300 bg-white text-[13px] text-slate-700 hover:bg-slate-100 disabled:opacity-40";

interface InspectorPanelProps {
  doc: LayoutDoc;
  selectedKey: string | null;
  selectionRange: CellRange | null;
  /** 프로젝트 전체 기준으로 고른 범례 항목. */
  legend: PaletteItem[];
  hasClipboard: boolean;
  onInfo: (key: string, patch: { label?: string; memo?: string }) => void;
  onSize: (cols: number, rows: number) => void;
  /** 활성 페이지의 인쇄 용지 설정. */
  paper: PagePaper | undefined;
  /** 인쇄물에 함께 실릴 범례 항목 수. 장수 계산에 쓴다. */
  legendCount: number;
  /** 이 페이지의 메모. 번호는 이미 매겨져 있다. */
  memos: MemoEntry[];
  onPaper: (paper: PagePaper | null) => void;
  onPick: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
}

/** 선택한 칸의 장비 ID · 메모. 선택이 바뀌면 key 로 새로 마운트된다. */
function CellInfoForm({
  doc,
  cellKeyValue,
  cell,
  onInfo,
}: {
  doc: LayoutDoc;
  cellKeyValue: string;
  cell: EquipmentCell | undefined;
  onInfo: InspectorPanelProps["onInfo"];
}) {
  const [label, setLabel] = useState(cell?.label ?? "");
  const [memo, setMemo] = useState(cell?.memo ?? "");
  const position = parseCellKey(cellKeyValue);
  const index = indexPalette(doc.palette);

  const commit = (nextLabel: string, nextMemo: string) => {
    onInfo(cellKeyValue, { label: nextLabel.trim(), memo: nextMemo });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-slate-600">
        가로 {position.x + 1} · 세로 {position.y + 1}
        {cell?.status ? ` · ${resolveItem(index, cell.status, "status").name}` : ""}
        {cell?.kind ? ` · ${resolveItem(index, cell.kind, "kind").name}` : ""}
      </p>

      <label className="text-[11px] text-slate-600">
        장비 ID
        <input
          className={FIELD}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => commit(label, memo)}
        />
      </label>

      <label className="text-[11px] text-slate-600">
        메모
        <textarea
          className="h-20 w-full resize-none border border-slate-300 bg-white px-2 py-1 text-[13px] text-slate-900 outline-none focus:border-slate-600"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          onBlur={() => commit(label, memo)}
        />
      </label>

      <button
        type="button"
        className={SUB_BUTTON}
        onClick={() => {
          setLabel("");
          setMemo("");
          commit("", "");
        }}
      >
        ID · 메모 지우기
      </button>
    </div>
  );
}

/** 격자 크기. 문서 크기가 바뀌면 key 로 새로 마운트된다. */
function SizeForm({
  cols,
  rows,
  onSize,
}: {
  cols: number;
  rows: number;
  onSize: InspectorPanelProps["onSize"];
}) {
  const [nextCols, setNextCols] = useState(String(cols));
  const [nextRows, setNextRows] = useState(String(rows));

  return (
    <>
      <div className="flex items-end gap-2">
        <label className="flex-1 text-[11px] text-slate-600">
          가로 칸
          <input
            className={FIELD}
            type="number"
            min={MIN_COLS}
            max={MAX_COLS}
            value={nextCols}
            onChange={(event) => setNextCols(event.target.value)}
          />
        </label>
        <label className="flex-1 text-[11px] text-slate-600">
          세로 칸
          <input
            className={FIELD}
            type="number"
            min={MIN_ROWS}
            max={MAX_ROWS}
            value={nextRows}
            onChange={(event) => setNextRows(event.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className={`mt-2 ${SUB_BUTTON}`}
        onClick={() => onSize(Number(nextCols) || cols, Number(nextRows) || rows)}
      >
        크기 적용
      </button>
    </>
  );
}

export function InspectorPanel(props: InspectorPanelProps) {
  const { doc, selectedKey, selectionRange, hasClipboard } = props;
  const cell = selectedKey ? doc.equipment[selectedKey] : undefined;
  const counts = cellCount(doc);
  const isMultiCellRange = selectionRange && (selectionRange.width > 1 || selectionRange.height > 1);

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l border-slate-300 bg-slate-50 p-3">
      <section>
        <h2 className="mb-2 text-[12px] font-semibold text-slate-900">
          {isMultiCellRange ? "선택한 범위" : "선택한 칸"}
        </h2>
        {isMultiCellRange && selectionRange ? (
          <div className="mb-3 flex flex-col gap-2 rounded border border-slate-200 bg-white p-2.5 shadow-sm">
            <p className="text-[13px] font-medium text-slate-900">
              가로 {selectionRange.width} × 세로 {selectionRange.height} 셀
            </p>
            <p className="text-[11px] text-slate-500">
              위치: 가로 {selectionRange.minX + 1}~{selectionRange.maxX + 1} · 세로 {selectionRange.minY + 1}~{selectionRange.maxY + 1}
            </p>
            <div className="mt-1 grid grid-cols-3 gap-1">
              <button type="button" className={SUB_BUTTON} onClick={props.onCopy} title="Ctrl+C">
                복사
              </button>
              <button type="button" className={SUB_BUTTON} onClick={props.onCut} title="Ctrl+X">
                잘라내기
              </button>
              <button type="button" className={SUB_BUTTON} onClick={props.onPaste} disabled={!hasClipboard} title="Ctrl+V">
                붙여넣기
              </button>
            </div>
          </div>
        ) : null}

        {selectedKey ? (
          <CellInfoForm
            key={`${selectedKey}|${cell?.label ?? ""}|${cell?.memo ?? ""}`}
            doc={doc}
            cellKeyValue={selectedKey}
            cell={cell}
            onInfo={props.onInfo}
          />
        ) : (
          <button type="button" className={SUB_BUTTON} onClick={props.onPick}>
            선택 도구로 칸 고르기
          </button>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[12px] font-semibold text-slate-900">격자 크기</h2>
        <SizeForm key={`${doc.cols}x${doc.rows}`} cols={doc.cols} rows={doc.rows} onSize={props.onSize} />
        <p className="mt-1 text-[11px] text-slate-500">줄이면 바깥으로 밀려난 칸은 지워진다.</p>
      </section>

      <section>
        <h2 className="mb-2 text-[12px] font-semibold text-slate-900">인쇄 용지</h2>
        <PaperForm
          paper={props.paper}
          cols={doc.cols}
          rows={doc.rows}
          legendCount={props.legendCount}
          memos={props.memos}
          memoCount={props.memos.length}
          onChange={props.onPaper}
        />
      </section>

      <section>
        <h2 className="mb-2 text-[12px] font-semibold text-slate-900">범례</h2>
        <ul className="grid grid-cols-2 gap-1">
          {props.legend.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-[12px] text-slate-700">
              <PaletteSwatch item={item} size={16} />
              <span className="truncate" title={legendLabel(item)}>
                {legendLabel(item)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="text-[12px] text-slate-600">
        <h2 className="mb-1 text-[12px] font-semibold text-slate-900">현황</h2>
        <p>설비 칸 {counts.equipment}개</p>
        <p>배선 칸 {counts.wiring}개</p>
        <p>배경 칸 {counts.background}개</p>
      </section>
    </aside>
  );
}
