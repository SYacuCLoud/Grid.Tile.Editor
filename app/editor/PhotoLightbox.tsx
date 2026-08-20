"use client";

import { useEffect } from "react";

import { formatBytes, photoBytes, photoCounter, stepPhotoIndex } from "./photo";

interface PhotoLightboxProps {
  photos: string[];
  /** 지금 보고 있는 사진. 0부터. */
  index: number;
  /** 사진 위에 적을 한 줄 — 장비 ID · 칸 자리 같은 것. */
  caption: string;
  onIndex: (index: number) => void;
  onDownload: (index: number) => void;
  onClose: () => void;
}

const CONTROL =
  "flex h-8 min-w-8 items-center justify-center border border-slate-500 bg-slate-800/80 px-2 text-[13px] text-white hover:bg-slate-700";

/**
 * 사진 확대 보기.
 *
 * 편집 상자의 썸네일은 64px 이라 "그 자리가 어떻게 생겼는지" 를 알아보기에는
 * 작다. 눌러서 화면 가득 띄우고, 여러 장이면 그 자리에서 넘겨 본다.
 *
 * `fixed` 로 화면 전체를 덮는다 — 편집 상자 안에 그리면 240px 폭에 갇힌다.
 * 원본 비율은 `object-contain` 이 지킨다(잘리지 않고 안에 들어맞는다).
 */
export function PhotoLightbox(props: PhotoLightboxProps) {
  const { photos, index, onIndex, onClose } = props;
  const photo = photos[index];
  const single = photos.length <= 1;

  // 방향키로 넘기고 Esc 로 닫는다. 편집 상자의 Esc(상자 닫기)는 확대 보기가
  // 열려 있는 동안 쉰다 — 확대 보기를 닫으려고 누른 Esc 로 상자까지 닫히면
  // 방금 붙인 사진을 저장할 자리를 잃는다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onIndex(stepPhotoIndex(index, photos.length, -1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onIndex(stepPhotoIndex(index, photos.length, 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose, onIndex, photos.length]);

  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="사진 확대 보기"
      onContextMenu={(event) => event.preventDefault()}
    >
      {/*
        바깥 배경도 누르면 닫힌다. div 에 onClick 을 달지 않고 깔개 단추를 두는
        것은, 그래야 키보드로도 닿고 사진·단추 클릭이 배경으로 새지 않기 때문이다.
      */}
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        title="닫기"
        aria-label="배경을 눌러 닫기"
      />

      <div className="relative z-10 flex max-h-full max-w-full flex-col items-center gap-2">
        <div className="flex w-full items-center justify-between gap-2">
          <span className="truncate text-[12px] text-slate-200">{props.caption}</span>
          <div className="flex shrink-0 items-center gap-1">
            <span className="px-1 text-[12px] font-semibold text-white">{photoCounter(index, photos.length)}</span>
            <span className="px-1 text-[11px] text-slate-300">{formatBytes(photoBytes(photo))}</span>
            <button
              type="button"
              className={CONTROL}
              onClick={() => props.onDownload(index)}
              title="이 사진 파일로 저장"
              aria-label="이 사진 파일로 저장"
            >
              ↓
            </button>
            <button type="button" className={CONTROL} onClick={onClose} title="닫기 (Esc)" aria-label="닫기">
              ×
            </button>
          </div>
        </div>

        <div className="flex min-h-0 items-center gap-2">
          <button
            type="button"
            className={CONTROL}
            onClick={() => onIndex(stepPhotoIndex(index, photos.length, -1))}
            disabled={single}
            title="이전 사진 (←)"
            aria-label="이전 사진"
            hidden={single}
          >
            ◀
          </button>

          {/* eslint-disable-next-line @next/next/no-img-element -- data URL 이라 최적화 대상이 아니다 */}
          <img
            src={photo}
            alt={`${props.caption} 사진 ${index + 1}`}
            className="max-h-[78vh] max-w-[82vw] border border-slate-600 bg-slate-900 object-contain"
          />

          <button
            type="button"
            className={CONTROL}
            onClick={() => onIndex(stepPhotoIndex(index, photos.length, 1))}
            disabled={single}
            title="다음 사진 (→)"
            aria-label="다음 사진"
            hidden={single}
          >
            ▶
          </button>
        </div>

        <p className="text-[11px] text-slate-400">
          {single ? "Esc 닫기" : "← → 넘기기 · Esc 닫기 · 바깥을 눌러도 닫힌다"}
        </p>
      </div>
    </div>
  );
}
