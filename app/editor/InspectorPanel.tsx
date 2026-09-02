"use client";

import { useState } from "react";
import {
  type EquipmentCell,
  type LayoutDoc,
  MAX_COLS,
  MAX_ROWS,
  MIN_COLS,
  MIN_ROWS,
  parseCellKey,
} from "./doc";
import { type Device, deviceById, deviceLabel } from "./device";
import { indexPalette, resolveItem } from "./palette";
import type { MemoEntry } from "./memoPrint";
import type { PagePaper } from "./paper";
import { PaperForm } from "./PaperForm";

import { type CellRange } from "./range";
import { type Zone, zoneLabel } from "./zone";

const FIELD = "h-8 w-full border border-slate-300 bg-white px-2 text-[13px] text-slate-900 outline-none focus:border-slate-600";
const SUB_BUTTON = "h-8 w-full border border-slate-300 bg-white text-[13px] text-slate-700 hover:bg-slate-100 disabled:opacity-40";

interface InspectorPanelProps {
  doc: LayoutDoc;
  selectedKey: string | null;
  selectionRange: CellRange | null;
  hasClipboard: boolean;
  /** 프로젝트의 장치 대장. 칸을 골랐을 때 연결된 장치 한 줄을 보여 주는 데만 쓴다.
   *  등록·연결·수정은 칸 우클릭이 맡는다 — 손이 캔버스에 있을 때 끝난다. */
  devices: Device[];
  onSize: (cols: number, rows: number) => void;
  /** 활성 페이지의 인쇄 용지 설정. */
  paper: PagePaper | undefined;
  /** 인쇄물에 함께 실릴 범례 항목 수. 장수 계산에 쓴다. */
  legendCount: number;
  /** 이 페이지의 메모. 번호는 이미 매겨져 있다. */
  memos: MemoEntry[];
  onPaper: (paper: PagePaper | null) => void;
  /** 활성 페이지의 구역. 칸을 골랐을 때 그 칸이 드는 구역 이름을 보여 주는 데만 쓴다.
   *  구역을 만들고 고치는 일은 도면 우클릭이 맡는다 — 손이 캔버스에 있을 때 끝난다. */
  zones: Zone[];
  onPick: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
}

/**
 * 선택한 칸의 요약 한 눈. 편집은 여기서 하지 않는다 — 장비 ID · 메모 · 장치
 * 등록은 칸 우클릭 상자가 맡는다. 요약이 두 곳에서 편집되면 서로 어긋난다.
 */
function CellInfoView({
  doc,
  cellKeyValue,
  cell,
  zones,
  devices,
}: {
  doc: LayoutDoc;
  cellKeyValue: string;
  cell: EquipmentCell | undefined;
  zones: Zone[];
  devices: Device[];
}) {
  const position = parseCellKey(cellKeyValue);
  const index = indexPalette(doc.palette);
  // 이 칸이 드는 구역. 좌표보다 사람이 부르는 이름이 먼저 읽힌다.
  const zoneText = zoneLabel(zones, position.x, position.y);
  const linked = deviceById(devices, cell?.deviceId);

  return (
    <div className="flex flex-col gap-1">
      {zoneText ? <p className="text-[12px] font-medium text-slate-900">{zoneText}</p> : null}
      <p className="text-[12px] text-slate-600">
        가로 {position.x + 1} · 세로 {position.y + 1}
        {cell?.status ? ` · ${resolveItem(index, cell.status, "status").name}` : ""}
        {cell?.kind ? ` · ${resolveItem(index, cell.kind, "kind").name}` : ""}
      </p>
      {cell?.label ? <p className="text-[12px] text-slate-700">식별자: {cell.label}</p> : null}
      {linked ? <p className="text-[12px] text-slate-700">장치: {deviceLabel(linked)}</p> : null}
      {cell?.memo ? <p className="whitespace-pre-wrap text-[12px] text-slate-500">{cell.memo}</p> : null}
      <p className="text-[11px] text-slate-400">편집은 칸 우클릭</p>
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
          <CellInfoView
            doc={doc}
            cellKeyValue={selectedKey}
            cell={cell}
            zones={props.zones}
            devices={props.devices}
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
    </aside>
  );
}
