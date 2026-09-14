"use client";

import { useEffect } from "react";

import { formatBytes, photoCounter, stepPhotoIndex } from "./photo";
import { videoBytes } from "./video";

interface VideoLightboxProps {
  videos: string[];
  /** 지금 보고 있는 영상. 0부터. */
  index: number;
  /** 영상 위에 적을 한 줄 — 장비 ID · 칸 자리 같은 것. */
  caption: string;
  onIndex: (index: number) => void;
  onDownload: (index: number) => void;
  onClose: () => void;
}

const CONTROL =
  "flex h-8 min-w-8 items-center justify-center border border-slate-500 bg-slate-800/80 px-2 text-[13px] text-white hover:bg-slate-700";

/**
 * 영상 재생 창. 사진 확대 보기(`PhotoLightbox`)와 같은 틀이다 — 화면 전체를 덮고,
 * 여러 편이면 그 자리에서 넘긴다. 다른 점은 안에 `<video controls>` 가 있어
 * 재생 · 멈춤 · 구간 이동을 브라우저 조절 막대가 맡는다는 것이다.
 *
 * 방향키는 영상 조절 막대(5초 건너뛰기)와 겹치므로 여기서는 `Esc` 만 받고,
 * 편 넘기기는 `◀` `▶` 단추로만 한다.
 */
export function VideoLightbox(props: VideoLightboxProps) {
  const { videos, index, onIndex, onClose } = props;
  const video = videos[index];
  const single = videos.length <= 1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!video) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="영상 재생"
      onContextMenu={(event) => event.preventDefault()}
    >
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
            <span className="px-1 text-[12px] font-semibold text-white">{photoCounter(index, videos.length)}</span>
            <span className="px-1 text-[11px] text-slate-300">{formatBytes(videoBytes(video))}</span>
            <button
              type="button"
              className={CONTROL}
              onClick={() => props.onDownload(index)}
              title="이 영상 파일로 저장"
              aria-label="이 영상 파일로 저장"
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
            onClick={() => onIndex(stepPhotoIndex(index, videos.length, -1))}
            disabled={single}
            title="이전 영상"
            aria-label="이전 영상"
            hidden={single}
          >
            ◀
          </button>

          {/* key 를 두어 편이 바뀌면 요소를 새로 만든다 — src 만 바꾸면 이전 재생 위치가 남는 브라우저가 있다. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- 현장 기록 영상이라 자막이 없다 */}
          <video
            key={index}
            src={video}
            controls
            autoPlay
            playsInline
            className="max-h-[78vh] max-w-[82vw] border border-slate-600 bg-black"
          />

          <button
            type="button"
            className={CONTROL}
            onClick={() => onIndex(stepPhotoIndex(index, videos.length, 1))}
            disabled={single}
            title="다음 영상"
            aria-label="다음 영상"
            hidden={single}
          >
            ▶
          </button>
        </div>

        <p className="text-[11px] text-slate-400">
          {single ? "Esc 닫기 · 바깥을 눌러도 닫힌다" : "◀ ▶ 넘기기 · Esc 닫기 · 바깥을 눌러도 닫힌다"}
        </p>
      </div>
    </div>
  );
}
