"use client";

import { useEffect, useRef, useState } from "react";

import {
  checkPhotoRoom,
  formatBytes,
  MAX_CELL_PHOTOS,
  photoBytes,
  photosBytes,
  readPhotoFile,
} from "./photo";
import { downloadPhoto, openPhotoLedger } from "./photoExport";
import { entriesFromCell, ledgerSubtitle, positionText } from "./photoLedger";

const PANEL_WIDTH = 240;

interface CellNotePopoverProps {
  /** 칸의 격자 좌표. */
  x: number;
  y: number;
  cell: number;
  cols: number;
  rows: number;
  initialLabel: string;
  initialMemo: string;
  /** 이미 붙어 있는 사진들(data URL). 없으면 빈 배열. */
  initialPhotos: string[];
  /** 사진 파일 이름과 인쇄물 머리에 적을 페이지. */
  pageId: string;
  pageName: string;
  /** 칸 위치 안내에 쓰는 한 줄 (예: "가로 3 · 세로 5 · 설치 (정상)"). */
  caption: string;
  onSave: (value: { label: string; memo: string; photos: string[] }) => void;
  onClose: () => void;
}

const BUTTON = "h-7 flex-1 border border-slate-300 bg-white text-[12px] text-slate-700 hover:bg-slate-100";
const OK_BUTTON = "h-7 flex-1 border border-slate-800 bg-slate-800 text-[12px] text-white hover:bg-slate-700";

/** 칸을 우클릭하면 그 자리에 뜨는 메모 편집 상자. */
export function CellNotePopover(props: CellNotePopoverProps) {
  const { x, y, cell, cols, rows } = props;
  const [label, setLabel] = useState(props.initialLabel);
  const [memo, setMemo] = useState(props.initialMemo);
  const [photos, setPhotos] = useState<string[]>(props.initialPhotos);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const labelRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 열린 순간 한 번만 포커스한다. 장비 ID 부터 넣는 경우가 많다.
  useEffect(() => {
    labelRef.current?.focus();
    labelRef.current?.select();
  }, []);

  // Esc 로 닫는다. (도면을 클릭하면 그리기 쪽에서 닫는다.)
  const onClose = props.onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const flipX = (x + 1) * cell + PANEL_WIDTH > cols * cell;
  const flipY = y > rows - 8;

  const style: React.CSSProperties = {
    width: PANEL_WIDTH,
    top: flipY ? undefined : (y + 1) * cell + 6,
    bottom: flipY ? (rows - y) * cell + 6 : undefined,
    left: flipX ? undefined : x * cell,
    right: flipX ? (cols - x - 1) * cell : undefined,
  };

  const save = () => props.onSave({ label, memo, photos });

  /**
   * 고른 그림들을 줄여 목록에 더한다(긴 변 480px, JPEG).
   *
   * 여러 장을 한 번에 고를 수 있으므로 한 장씩 순서대로 넣고, 막힌 장이 있으면
   * 그 장만 건너뛴 뒤 이유를 한 줄로 보인다 — 한 장 때문에 나머지를 버리지 않는다.
   */
  const attach = async (files: FileList | File[] | null | undefined) => {
    const picked = files ? Array.from(files) : [];
    if (picked.length === 0) return;

    let next = photos;
    const problems: string[] = [];

    for (const file of picked) {
      try {
        const photo = await readPhotoFile(file);
        const blocked = checkPhotoRoom(next, photo);
        if (blocked) {
          problems.push(blocked);
          continue;
        }
        next = [...next, photo];
      } catch (error) {
        problems.push(error instanceof Error ? error.message : "사진을 붙이지 못했습니다.");
      }
    }

    setPhotos(next);
    // 같은 이유가 여러 장에서 겹치므로(장수 초과 등) 한 번만 보인다.
    setPhotoError(problems.length > 0 ? [...new Set(problems)].join(" ") : null);
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
    setPhotoError(null);
  };

  const full = photos.length >= MAX_CELL_PHOTOS;

  /**
   * 지금 상자에 있는 값으로 사진 목록을 짓는다.
   *
   * 저장 전 상태를 그대로 쓴다 — 방금 붙인 사진을 저장해야만 뽑을 수 있다면
   * 사용자는 저장했는지 아닌지를 기억해야 한다.
   */
  const entries = () =>
    entriesFromCell({
      pageId: props.pageId,
      pageName: props.pageName,
      x,
      y,
      label,
      memo,
      photos,
    });

  const printPhotos = () => {
    const list = entries();
    const opened = openPhotoLedger(list, {
      title: `${label || positionText(list[0])} 칸 사진`,
      subtitle: [props.pageName, positionText(list[0]), ledgerSubtitle({ count: list.length, printedAt: new Date() })]
        .filter(Boolean)
        .join(" · "),
    });
    if (!opened) window.alert("팝업이 막혀 인쇄 창을 열지 못했습니다. 이 사이트의 팝업을 허용해 주십시오.");
  };

  return (
    <div
      className="absolute z-30 border border-slate-400 bg-white p-2 shadow-lg"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="mb-1 text-[11px] font-semibold text-slate-700">칸 정보</p>
      <p className="mb-1.5 text-[11px] text-slate-500">{props.caption}</p>

      <label className="text-[10px] font-semibold tracking-wide text-slate-500">
        장비 ID
        <input
          ref={labelRef}
          value={label}
          placeholder="예: C1101"
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
          className="mt-0.5 h-7 w-full border border-slate-300 bg-white px-2 text-[13px] text-slate-900 outline-none focus:border-slate-600"
          aria-label="장비 ID"
        />
      </label>

      <label className="mt-1.5 block text-[10px] font-semibold tracking-wide text-slate-500">
        메모
        <textarea
          value={memo}
          placeholder="예: 3월 점검 대상, 배선 재작업 필요"
          onChange={(event) => setMemo(event.target.value)}
          onKeyDown={(event) => {
            // 줄바꿈은 Shift+Enter. Enter 는 저장이다.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              save();
            }
          }}
          className="mt-0.5 h-20 w-full resize-none border border-slate-300 bg-white px-2 py-1 text-[13px] text-slate-900 outline-none focus:border-slate-600"
          aria-label="칸 메모"
        />
      </label>

      <div
        className="mt-1.5"
        onDragOver={(event) => {
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          void attach(event.dataTransfer.files);
        }}
      >
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-semibold tracking-wide text-slate-500">사진</p>
          {photos.length > 0 ? (
            <p className="text-[10px] text-slate-500">
              {photos.length}/{MAX_CELL_PHOTOS}장 · 합계 {formatBytes(photosBytes(photos))}
            </p>
          ) : null}
        </div>

        {photos.length > 0 ? (
          <ul className="mt-0.5 grid grid-cols-3 gap-1">
            {photos.map((photo, index) => (
              <li key={photo.slice(-24)} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL 미리보기라 최적화 대상이 아니다 */}
                <img
                  src={photo}
                  alt={`칸 사진 ${index + 1}`}
                  className="h-16 w-full border border-slate-300 object-cover"
                />
                <span className="absolute inset-x-0 bottom-0 bg-slate-900/70 px-0.5 text-center text-[9px] leading-tight text-white">
                  {formatBytes(photoBytes(photo))}
                </span>
                <div className="absolute top-0 right-0 flex">
                  <button
                    type="button"
                    className="h-4 w-4 border border-slate-400 bg-white text-[9px] leading-none text-slate-700 hover:bg-slate-100"
                    onClick={() => downloadPhoto(entries()[index])}
                    title={`${index + 1}번째 사진 파일로 저장`}
                    aria-label={`${index + 1}번째 사진 파일로 저장`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="h-4 w-4 border border-slate-400 border-l-0 bg-white text-[10px] leading-none text-slate-700 hover:bg-red-50 hover:text-red-700"
                    onClick={() => removePhoto(index)}
                    title={`${index + 1}번째 사진 지우기`}
                    aria-label={`${index + 1}번째 사진 지우기`}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <button
          type="button"
          className={`mt-1 h-7 w-full border border-dashed text-[12px] ${
            dropping ? "border-slate-700 bg-slate-100 text-slate-800" : "border-slate-400 bg-white text-slate-600"
          } hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400`}
          onClick={() => fileRef.current?.click()}
          disabled={full}
          title={
            full
              ? `사진은 ${MAX_CELL_PHOTOS}장까지 붙일 수 있습니다.`
              : "여러 장을 함께 고르거나 끌어다 놓을 수 있습니다."
          }
        >
          {full ? `사진 ${MAX_CELL_PHOTOS}장 (가득 찼습니다)` : "+ 사진 붙이기 (끌어다 놓기 가능)"}
        </button>

        {photos.length > 0 ? (
          <button
            type="button"
            className="mt-1 h-7 w-full border border-slate-300 bg-white text-[12px] text-slate-700 hover:bg-slate-100"
            onClick={printPhotos}
            title="이 칸의 장비 ID · 메모 · 사진을 한 장으로 모아 인쇄한다"
          >
            이 칸 사진 인쇄 ({photos.length}장)
          </button>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void attach(event.target.files);
            event.target.value = "";
          }}
        />
        {photoError ? <p className="mt-1 text-[11px] text-red-700">{photoError}</p> : null}
      </div>

      <div className="mt-2 flex gap-1">
        <button type="button" className={OK_BUTTON} onClick={save}>
          저장
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => props.onSave({ label: "", memo: "", photos: [] })}
          disabled={!props.initialLabel && !props.initialMemo && props.initialPhotos.length === 0}
          title="이 칸의 장비 ID · 메모 · 사진을 지운다"
        >
          지우기
        </button>
        <button type="button" className={BUTTON} onClick={props.onClose}>
          닫기
        </button>
      </div>

      <p className="mt-1 text-[10px] text-slate-400">Enter 저장 · Shift+Enter 줄바꿈 · Esc 닫기</p>
    </div>
  );
}
