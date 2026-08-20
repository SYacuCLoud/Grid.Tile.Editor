"use client";

import { TOOLS, type ToolId } from "./useEditor";

const BUTTON = "h-8 px-3 border border-slate-300 bg-white text-[13px] text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white";
const BUTTON_ON = "h-8 px-3 border border-slate-800 bg-slate-800 text-[13px] text-white";

interface ToolbarProps {
  title: string;
  tool: ToolId;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  hasClipboard: boolean;
  showGrid: boolean;
  showRuler: boolean;
  cell: number;
  onTitle: (value: string) => void;
  onTool: (tool: ToolId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onShowGrid: (value: boolean) => void;
  onShowRuler: (value: boolean) => void;
  onZoom: (delta: number) => void;
  onExportJson: () => void;
  onImportJson: () => void;
  onExportPng: () => void;
  /** 도면에 붙은 사진 총 장수. 0 이면 사진 대장 단추를 잠근다. */
  photoCount: number;
  onPrintPhotoLedger: () => void;
  onDownloadPhotos: () => void;
  onLoadSample: () => void;
  onReset: () => void;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-300 bg-slate-50 px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500">배치도 이름</span>
        <input
          value={props.title}
          onChange={(event) => props.onTitle(event.target.value)}
          className="h-8 w-56 border border-slate-300 bg-white px-2 text-[13px] text-slate-900 outline-none focus:border-slate-600"
          aria-label="배치도 이름"
        />
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="도구">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.hint}
            onClick={() => props.onTool(item.id)}
            className={props.tool === item.id ? BUTTON_ON : BUTTON}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button type="button" className={BUTTON} onClick={props.onUndo} disabled={!props.canUndo} title="Ctrl+Z">
          되돌리기
        </button>
        <button type="button" className={BUTTON} onClick={props.onRedo} disabled={!props.canRedo} title="Ctrl+Y">
          다시 실행
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={props.onCopy}
          disabled={!props.hasSelection}
          title={props.hasSelection ? "선택 범위 복사 (Ctrl+C)" : "복사할 칸 범위를 먼저 선택하세요"}
        >
          복사
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={props.onCut}
          disabled={!props.hasSelection}
          title={props.hasSelection ? "선택 범위 잘라내기 (Ctrl+X)" : "잘라낼 칸 범위를 먼저 선택하세요"}
        >
          잘라내기
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={props.onPaste}
          disabled={!props.hasClipboard}
          title={props.hasClipboard ? "복사/잘라낸 범위 붙여넣기 (Ctrl+V)" : "복사하거나 잘라낸 내용이 없습니다"}
        >
          붙여넣기
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button type="button" className={BUTTON} onClick={() => props.onZoom(-1)} title="축소 (도면 위에서 휠 아래로)">
          축소
        </button>
        <span className="w-14 text-center text-[12px] text-slate-600">{props.cell}px</span>
        <button type="button" className={BUTTON} onClick={() => props.onZoom(1)} title="확대 (도면 위에서 휠 위로)">
          확대
        </button>
        <label className="ml-2 flex items-center gap-1 text-[12px] text-slate-700">
          <input type="checkbox" checked={props.showGrid} onChange={(event) => props.onShowGrid(event.target.checked)} />
          격자선
        </label>
        <label className="flex items-center gap-1 text-[12px] text-slate-700" title="도면 위·왼쪽에 칸 번호를 붙인다">
          <input
            type="checkbox"
            checked={props.showRuler}
            onChange={(event) => props.onShowRuler(event.target.checked)}
          />
          눈금자
        </label>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button type="button" className={BUTTON} onClick={props.onExportPng} title="현재 선택된 페이지의 배치도 및 범례를 PNG 이미지로 내보냅니다">
          PNG 저장 (현재 페이지)
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={props.onPrintPhotoLedger}
          disabled={props.photoCount === 0}
          title={
            props.photoCount === 0
              ? "칸에 붙은 사진이 없습니다"
              : `붙어 있는 사진 ${props.photoCount}장을 좌표 · 장비 ID · 메모와 함께 A4 대장으로 인쇄합니다`
          }
        >
          사진 대장 인쇄{props.photoCount > 0 ? ` (${props.photoCount}장)` : ""}
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={props.onDownloadPhotos}
          disabled={props.photoCount === 0}
          title={
            props.photoCount === 0
              ? "칸에 붙은 사진이 없습니다"
              : "붙어 있는 사진을 좌표 · 장비 ID 가 담긴 파일 이름으로 낱장 저장합니다"
          }
        >
          사진 일괄 저장
        </button>
        <button type="button" className={BUTTON} onClick={props.onExportJson}>
          JSON 내보내기
        </button>
        <button type="button" className={BUTTON} onClick={props.onImportJson}>
          JSON 불러오기
        </button>
        <button type="button" className={BUTTON} onClick={props.onLoadSample}>
          예시 다시 넣기
        </button>
        <button
          type="button"
          className="h-8 border border-red-300 bg-white px-3 text-[13px] text-red-700 hover:bg-red-50"
          onClick={props.onReset}
        >
          전체 초기화
        </button>
      </div>
    </header>
  );
}
