"use client";

import { type EquipmentCell, type LayoutDoc, parseCellKey } from "./doc";
import { type Device, deviceById, deviceLabel } from "./device";
import { indexPalette, OPACITY_STEPS, resolveItem } from "./palette";
import { LineStylePicker, OpacityPicker } from "./PaletteStyleOptions";
import { DEFAULT_LINE_STYLE, type LineStyle } from "./pattern";

import { type CellRange } from "./range";
import { type Zone, zoneLabel } from "./zone";

const SUB_BUTTON = "h-8 w-full border border-slate-300 bg-white text-[13px] text-slate-700 hover:bg-slate-100 disabled:opacity-40";

/** 칸 진하기 눈금. 25% 아래는 인쇄하면 사라지므로 두지 않는다. */
const CELL_OPACITY_STEPS = OPACITY_STEPS.filter((step) => step >= 0.25);

/** 칸 장비 테두리의 선 모양 · 진하기 고침. */
export type CellStylePatch = { lineStyle?: LineStyle; opacity?: number };

interface InspectorPanelProps {
  doc: LayoutDoc;
  selectedKey: string | null;
  selectionRange: CellRange | null;
  hasClipboard: boolean;
  /** 프로젝트의 장치 대장. 칸을 골랐을 때 연결된 장치 한 줄을 보여 주는 데만 쓴다.
   *  등록·연결·수정은 칸 우클릭이 맡는다 — 손이 캔버스에 있을 때 끝난다. */
  devices: Device[];
  /** 활성 페이지의 구역. 칸을 골랐을 때 그 칸이 드는 구역 이름을 보여 주는 데만 쓴다.
   *  구역을 만들고 고치는 일은 도면 우클릭이 맡는다 — 손이 캔버스에 있을 때 끝난다. */
  zones: Zone[];
  onPick: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  /** 고른 칸의 장비 테두리(선 모양 · 진하기)를 바로 고친다. 칩을 누를 때마다 한 값씩. */
  onCellStyle: (key: string, patch: CellStylePatch) => void;
}

/**
 * 선택한 칸의 요약 한 눈. 글자 · 메모 · 장치 등록은 여기서 하지 않는다 — 칸
 * 우클릭 상자가 맡는다. 요약이 두 곳에서 편집되면 서로 어긋난다.
 *
 * 장비 테두리의 선 모양 · 진하기만 여기서 고친다. 값이 몇 개 안 되는 칩이라
 * 저장 단추 없이 누르는 즉시 도면에 먹고, 우클릭 상자를 열지 않아도 된다.
 */
function CellInfoView({
  doc,
  cellKeyValue,
  cell,
  zones,
  devices,
  onCellStyle,
}: {
  doc: LayoutDoc;
  cellKeyValue: string;
  cell: EquipmentCell | undefined;
  zones: Zone[];
  devices: Device[];
  onCellStyle: InspectorPanelProps["onCellStyle"];
}) {
  const position = parseCellKey(cellKeyValue);
  const index = indexPalette(doc.palette);
  // 이 칸이 드는 구역. 좌표보다 사람이 부르는 이름이 먼저 읽힌다.
  const zoneText = zoneLabel(zones, position.x, position.y);
  const linked = deviceById(devices, cell?.deviceId);
  // 장비가 놓인 칸만 테두리가 있다. 없는 칸에는 고를 것이 없다.
  const kind = cell?.kind ? resolveItem(index, cell.kind, "kind") : null;

  return (
    <div className="flex flex-col gap-1">
      {zoneText ? <p className="text-[12px] font-medium text-slate-900">{zoneText}</p> : null}
      <p className="text-[12px] text-slate-600">
        가로 {position.x + 1} · 세로 {position.y + 1}
        {cell?.status ? ` · ${resolveItem(index, cell.status, "status").name}` : ""}
        {kind ? ` · ${kind.name}` : ""}
      </p>
      {cell?.label ? <p className="text-[12px] text-slate-700">식별자: {cell.label}</p> : null}
      {linked ? <p className="text-[12px] text-slate-700">장치: {deviceLabel(linked)}</p> : null}
      {cell?.memo ? <p className="whitespace-pre-wrap text-[12px] text-slate-500">{cell.memo}</p> : null}
      <p className="text-[11px] text-slate-400">글자 · 메모 · 사진 편집은 칸 우클릭</p>

      {kind ? (
        <div className="mt-1 rounded border border-slate-200 bg-white p-2 shadow-sm">
          <p className="text-[11px] font-semibold text-slate-700">장비 테두리 (이 칸만)</p>
          <LineStylePicker
            color={kind.color ?? "#64748b"}
            value={cell?.lineStyle ?? DEFAULT_LINE_STYLE}
            onPick={(lineStyle) => onCellStyle(cellKeyValue, { lineStyle })}
            hint="칸 테두리"
          />
          <OpacityPicker
            color={kind.color ?? "#64748b"}
            value={cell?.opacity ?? 1}
            onPick={(opacity) => onCellStyle(cellKeyValue, { opacity })}
            fallback={1}
            steps={CELL_OPACITY_STEPS}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * 오른쪽 패널 — 선택한 칸(또는 범위)만 다룬다.
 * 격자 크기는 페이지 줄(`PageTabs`), 인쇄 용지는 서버 도면 줄의 모달(`PaperModal`),
 * 경계선 · 메모 인쇄 옵션은 PNG 저장 단추 옆(`PrintOptions`)으로 갔다.
 */
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
            onCellStyle={props.onCellStyle}
          />
        ) : (
          <button type="button" className={SUB_BUTTON} onClick={props.onPick}>
            선택 도구로 칸 고르기
          </button>
        )}
      </section>
    </aside>
  );
}
