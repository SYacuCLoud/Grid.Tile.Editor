"use client";

import pkg from "../../package.json";
import { BUILT_AT } from "./buildInfo";
import { TOOLS, type ToolId } from "./useEditor";

const BUTTON = "h-8 px-3 border border-slate-300 bg-white text-[13px] text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white";
/** 아이콘 단추. 뜻은 title 로 남는다 — 글자가 없으니 크기는 정사각형으로 고정한다. */
const ICON_BUTTON = "flex h-8 w-8 items-center justify-center border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white";
const ICON_BUTTON_ON = "flex h-8 w-8 items-center justify-center border border-slate-800 bg-slate-800 text-white";

/**
 * 16×16 선 아이콘. 외부 아이콘 폰트를 들이지 않는다 — 정적 파일만으로 도는
 * 앱이라 의존성 하나가 배포물 전체를 무겁게 한다.
 */
function Icon({ id }: { id: ToolId | "undo" | "redo" | "copy" | "cut" | "paste" | "zoomOut" | "zoomIn" }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {id === "brush" ? (
        <g {...stroke}>
          <path d="M10 2l4 4-6 6-4-4z" />
          <path d="M4 8l-2 4 2 2 4-2" />
        </g>
      ) : id === "eraser" ? (
        <g {...stroke}>
          <path d="M6 13L2 9l7-7 5 5-6 6z" />
          <path d="M6 13h8" />
        </g>
      ) : id === "line" ? (
        <g {...stroke}>
          <path d="M2 14L14 2" />
        </g>
      ) : id === "rect" ? (
        <g {...stroke}>
          <rect x="2.75" y="3.75" width="10.5" height="8.5" />
        </g>
      ) : id === "rectFill" ? (
        <g>
          <rect x="2.75" y="3.75" width="10.5" height="8.5" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
        </g>
      ) : id === "fill" ? (
        <g {...stroke}>
          <path d="M7 2l6 6-5 5a1.5 1.5 0 01-2 0L3 10a1.5 1.5 0 010-2z" />
          <path d="M13.5 11.5s1 1.2 1 2a1 1 0 01-2 0c0-.8 1-2 1-2z" fill="currentColor" />
        </g>
      ) : id === "pick" ? (
        <g {...stroke} strokeDasharray="2 1.5">
          <rect x="2.75" y="2.75" width="8.5" height="8.5" />
          <path d="M9 9l5 5" strokeDasharray="none" />
        </g>
      ) : id === "undo" ? (
        <g {...stroke}>
          <path d="M5 3L2 6l3 3" />
          <path d="M2 6h8a4 4 0 010 8H7" />
        </g>
      ) : id === "redo" ? (
        <g {...stroke}>
          <path d="M11 3l3 3-3 3" />
          <path d="M14 6H6a4 4 0 000 8h3" />
        </g>
      ) : id === "copy" ? (
        <g {...stroke}>
          <rect x="5.75" y="5.75" width="8" height="8" />
          <path d="M3 10V2.75h7" />
        </g>
      ) : id === "cut" ? (
        <g {...stroke}>
          <circle cx="4" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M5.5 10.5L13 2M10.5 10.5L3 2" />
        </g>
      ) : id === "paste" ? (
        <g {...stroke}>
          <rect x="3.75" y="3" width="8.5" height="11" />
          <path d="M6 3h4v2H6z" />
        </g>
      ) : id === "zoomOut" ? (
        <g {...stroke}>
          <circle cx="7" cy="7" r="4.25" />
          <path d="M10.5 10.5L14 14M5 7h4" />
        </g>
      ) : (
        <g {...stroke}>
          <circle cx="7" cy="7" r="4.25" />
          <path d="M10.5 10.5L14 14M5 7h4M7 5v4" />
        </g>
      )}
    </svg>
  );
}

interface ToolbarProps {
  title: string;
  tool: ToolId;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  hasClipboard: boolean;
  showGrid: boolean;
  showRuler: boolean;
  /** 연결선을 항상 표시(PNG·인쇄 포함). 꺼도 칸에 호버하면 그 칸의 연결은 흐른다. */
  showConnections: boolean;
  /** 프로젝트의 연결 수. 체크박스 옆에 함께 보인다. */
  connectionCount: number;
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
  onShowConnections: (value: boolean) => void;
  onZoom: (delta: number) => void;
  onExportJson: () => void;
  onImportJson: () => void;
  onExportPng: () => void;
  /** 도면에 붙은 사진 총 장수. 0 이면 사진 대장 단추를 잠근다. */
  photoCount: number;
  onPrintPhotoLedger: () => void;
  onDownloadPhotos: () => void;
  /** 장치 대장에 오른 장치 수. 단추에 함께 보인다. */
  deviceCount: number;
  onOpenDevices: () => void;
  onLoadSample: () => void;
  onReset: () => void;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <header className="flex flex-col gap-2 border-b border-slate-300 bg-slate-50 px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
              title={`${item.name} — ${item.hint}`}
              aria-label={item.name}
              onClick={() => props.onTool(item.id)}
              className={props.tool === item.id ? ICON_BUTTON_ON : ICON_BUTTON}
            >
              <Icon id={item.id} />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button type="button" className={ICON_BUTTON} onClick={props.onUndo} disabled={!props.canUndo} title="되돌리기 (Ctrl+Z)" aria-label="되돌리기">
            <Icon id="undo" />
          </button>
          <button type="button" className={ICON_BUTTON} onClick={props.onRedo} disabled={!props.canRedo} title="다시 실행 (Ctrl+Y)" aria-label="다시 실행">
            <Icon id="redo" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={props.onCopy}
            disabled={!props.hasSelection}
            title={props.hasSelection ? "선택 범위 복사 (Ctrl+C)" : "복사할 칸 범위를 먼저 선택하세요"}
            aria-label="복사"
          >
            <Icon id="copy" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={props.onCut}
            disabled={!props.hasSelection}
            title={props.hasSelection ? "선택 범위 잘라내기 (Ctrl+X)" : "잘라낼 칸 범위를 먼저 선택하세요"}
            aria-label="잘라내기"
          >
            <Icon id="cut" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={props.onPaste}
            disabled={!props.hasClipboard}
            title={props.hasClipboard ? "복사/잘라낸 범위 붙여넣기 (Ctrl+V)" : "복사하거나 잘라낸 내용이 없습니다"}
            aria-label="붙여넣기"
          >
            <Icon id="paste" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button type="button" className={ICON_BUTTON} onClick={() => props.onZoom(-1)} title="축소 (도면 위에서 휠 아래로)" aria-label="축소">
            <Icon id="zoomOut" />
          </button>
          <span className="w-11 text-center text-[12px] text-slate-600">{props.cell}px</span>
          <button type="button" className={ICON_BUTTON} onClick={() => props.onZoom(1)} title="확대 (도면 위에서 휠 위로)" aria-label="확대">
            <Icon id="zoomIn" />
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
          <label
            className="flex items-center gap-1 text-[12px] text-slate-700"
            title="장치 연결선을 항상 표시하고 PNG·인쇄에도 싣는다. 꺼도 칸에 마우스를 올리면 그 칸의 연결이 보인다"
          >
            <input
              type="checkbox"
              checked={props.showConnections}
              onChange={(event) => props.onShowConnections(event.target.checked)}
            />
            연결{props.connectionCount > 0 ? ` (${props.connectionCount})` : ""}
          </label>
        </div>

        {/* 서버 프로그램(Grid Tile Editor)의 버전과 빌드 시각. 도면 리비전(rN)과는
            다른 값이다 — 버전은 기능 단위로 올리고, 빌드 시각은 매 빌드 자동 갱신된다. */}
        <span className="ml-auto text-[11px] text-slate-400" title={`Grid Tile Editor v${pkg.version} · 빌드 ${BUILT_AT}`}>
          v{pkg.version} · {BUILT_AT}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1">
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
              : `붙어 있는 사진 ${props.photoCount}장을 좌표 · 식별자 · 메모와 함께 A4 대장으로 인쇄합니다`
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
              : "붙어 있는 사진을 좌표 · 식별자가 담긴 파일 이름으로 낱장 저장합니다"
          }
        >
          사진 일괄 저장
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={props.onOpenDevices}
          title="리더기 · 저울 · PLC 등 장치의 S/N · IP · PORT 를 한 표에서 관리합니다"
        >
          장치 대장{props.deviceCount > 0 ? ` (${props.deviceCount}대)` : ""}
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
