"use client";

import { useEffect, useRef, useState } from "react";
import { type Device, deviceLabel } from "./device";

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
import { PhotoLightbox } from "./PhotoLightbox";
import { downloadDataUrl } from "./storage";
import {
  checkVideoRoom,
  formatSeconds,
  MAX_CELL_VIDEOS,
  MAX_VIDEO_SECONDS,
  readVideoFile,
  type ShrinkProgress,
  videoBytes,
  videoFileName,
  videosBytes,
} from "./video";
import { VideoLightbox } from "./VideoLightbox";

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
  /** 이미 붙어 있는 영상들(data URL). 없으면 빈 배열. */
  initialVideos: string[];
  /** 사진 파일 이름과 인쇄물 머리에 적을 페이지. */
  pageId: string;
  pageName: string;
  /** 칸 위치 안내에 쓰는 한 줄 (예: "가로 3 · 세로 5 · 설치 (정상)"). */
  caption: string;
  /**
   * 연결된 장치를 부르는 한 줄. 있으면 식별자 입력을 접는다 — 그 칸의 글자는
   * 장치 대장의 S/N 이 맡으므로 여기서 고치면 두 곳이 어긋난다.
   */
  deviceText?: string;
  /** 연결된 장치 블록을 눌렀을 때 — 장치 대장 수정 모달로 간다. */
  onOpenDevice?: () => void;
  /** 대장의 장치들. 연결 안 된 칸에서 고를 목록이다. */
  devices?: Device[];
  /** 연결 안 된 칸을 기존 장치와 잇는다. */
  onLinkDevice?: (deviceId: string) => void;
  /** 연결 안 된 칸을 새 장치로 등록한다. 식별자가 S/N 으로 옮겨진다. */
  onRegisterDevice?: () => void;
  /** 이 칸이 낀 장치 연결들. 방향과 상대편을 적은 한 줄씩이다. */
  cellConnections?: Array<{ id: string; text: string }>;
  /** 이 칸을 출발점으로 연결 긋기를 시작한다. 다음에 누르는 칸이 도착점이다. */
  onStartConnect?: () => void;
  /** 연결 하나를 지운다. */
  onRemoveConnection?: (id: string) => void;
  onSave: (value: { label?: string; memo: string; photos: string[]; videos: string[] }) => void;
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
  /** 확대해서 보는 사진의 순번. 닫혀 있으면 null. */
  const [zoomed, setZoomed] = useState<number | null>(null);
  const [videos, setVideos] = useState<string[]>(props.initialVideos);
  const [videoError, setVideoError] = useState<string | null>(null);
  /** 영상을 다시 굽는 중이면 그 진행. 아니면 null. 굽는 동안은 단추를 잠근다. */
  const [shrinking, setShrinking] = useState<ShrinkProgress | null>(null);
  /** 재생 창에 띄운 영상의 순번. 닫혀 있으면 null. */
  const [playing, setPlaying] = useState<number | null>(null);
  const labelRef = useRef<HTMLInputElement | null>(null);
  const memoRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const videoFileRef = useRef<HTMLInputElement | null>(null);

  // 열린 순간 한 번만 포커스한다. 식별자부터 넣는 경우가 많다 —
  // 장치가 연결된 칸은 식별자 자리가 없으므로 메모로 간다.
  useEffect(() => {
    if (labelRef.current) {
      labelRef.current.focus();
      labelRef.current.select();
    } else {
      memoRef.current?.focus();
    }
  }, []);

  // Esc 로 닫는다. (도면을 클릭하면 그리기 쪽에서 닫는다.)
  // 확대 보기가 열려 있으면 그쪽이 Esc 를 먼저 쓴다 — 한 번의 Esc 로 확대 보기와
  // 상자가 함께 닫히면 방금 붙인 사진을 저장할 자리를 잃는다.
  const onClose = props.onClose;
  const zoomOpen = zoomed !== null || playing !== null;
  useEffect(() => {
    if (zoomOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoomOpen]);

  const flipX = (x + 1) * cell + PANEL_WIDTH > cols * cell;
  const flipY = y > rows - 8;

  const style: React.CSSProperties = {
    width: PANEL_WIDTH,
    top: flipY ? undefined : (y + 1) * cell + 6,
    bottom: flipY ? (rows - y) * cell + 6 : undefined,
    left: flipX ? undefined : x * cell,
    right: flipX ? (cols - x - 1) * cell : undefined,
  };

  // 연결된 칸은 글자(label)를 넘기지 않는다 — 대장이 맡은 값을 덮지 않는다.
  const save = () => props.onSave(props.deviceText ? { memo, photos, videos } : { label, memo, photos, videos });

  /**
   * 상자 안 어디에 포커스가 있어도 Enter 는 저장이다.
   *
   * 식별자·메모 입력은 제 손으로 Enter 를 처리하고(메모는 Shift+Enter 줄바꿈),
   * 선택 상자와 진짜 단추(저장 · 닫기 · 사진 …)는 Enter 가 제 일을 해야 한다.
   * 그 밖 — 토글 칩(`aria-pressed`)이나 상자의 빈 자리 — 에서 Enter 를 치면
   * 저장한다. 포커스가 입력 밖에 있다고 Enter 가 죽으면 "저장이 안 된다" 로 보인다.
   */
  const onEnterAnywhere = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    const target = event.target as HTMLElement;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (tag === "BUTTON" && !target.hasAttribute("aria-pressed")) return;
    event.preventDefault();
    save();
  };

  /**
   * 고른 그림들을 줄여 목록에 더한다(긴 변 480px, JPEG).
   *
   * 여러 장을 한 번에 고를 수 있으므로 한 장씩 순서대로 넣고, 막힌 장이 있으면
   * 그 장만 건너뛴 뒤 이유를 한 줄로 보인다 — 한 장 때문에 나머지를 버리지 않는다.
   */
  const attachPhotos = async (picked: File[]) => {
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

  /**
   * 고른 영상들을 목록에 더한다. 한도를 넘는 영상은 브라우저 안에서 다시 굽는데
   * 영상 길이만큼 걸리므로, 그동안 진행(`n초 / 전체`)을 보이고 단추를 잠근다.
   */
  const attachVideos = async (picked: File[]) => {
    if (picked.length === 0) return;

    let next = videos;
    const problems: string[] = [];
    setVideoError(null);

    for (const file of picked) {
      try {
        const video = await readVideoFile(file, setShrinking);
        const blocked = checkVideoRoom(next, video);
        if (blocked) {
          problems.push(blocked);
          continue;
        }
        next = [...next, video];
      } catch (error) {
        problems.push(error instanceof Error ? error.message : "영상을 붙이지 못했습니다.");
      } finally {
        setShrinking(null);
      }
    }

    setVideos(next);
    setVideoError(problems.length > 0 ? [...new Set(problems)].join(" ") : null);
  };

  /**
   * 파일을 종류대로 나눠 붙인다. 사진 자리에 영상을 끌어다 놓아도(그 반대도)
   * 제 자리로 간다 — 어느 단추 위에 놓았는지는 사용자가 신경 쓸 일이 아니다.
   */
  const attach = async (files: FileList | File[] | null | undefined) => {
    const picked = files ? Array.from(files) : [];
    if (picked.length === 0) return;
    const images = picked.filter((file) => file.type.startsWith("image/"));
    const clips = picked.filter((file) => file.type.startsWith("video/"));
    const others = picked.length - images.length - clips.length;
    await attachPhotos(images);
    await attachVideos(clips);
    if (others > 0) setVideoError((current) => [current, "그림 · 영상 파일만 붙일 수 있습니다."].filter(Boolean).join(" "));
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
    setPhotoError(null);
    // 보고 있던 장이 사라지면 순번이 어긋난다. 확대 보기를 닫아 버린다.
    setZoomed(null);
  };

  const removeVideo = (index: number) => {
    setVideos(videos.filter((_, i) => i !== index));
    setVideoError(null);
    setPlaying(null);
  };

  const full = photos.length >= MAX_CELL_PHOTOS;
  const videosFull = videos.length >= MAX_CELL_VIDEOS;

  /** 영상 파일 이름. 사진 이름과 같은 짜임(페이지_세로_가로_식별자_video_순번). */
  const downloadVideo = (index: number) => {
    const video = videos[index];
    if (!video) return;
    downloadDataUrl(video, videoFileName({ pageName: props.pageName, x, y, label, index: index + 1, video }));
  };
  const cellPosition = `가로 ${x + 1} · 세로 ${y + 1}`;

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
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- 상자 어디서나 Enter 로 저장하는 단축키다. 안의 입력·단추는 제 접근성을 그대로 갖는다.
    <div
      className="absolute z-30 border border-slate-400 bg-white p-2 shadow-lg outline-none"
      style={style}
      role="dialog"
      aria-label="칸 정보"
      // 빈 자리를 눌러도 상자가 포커스를 받아 Enter 저장이 통한다.
      tabIndex={-1}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onEnterAnywhere}
    >
      <p className="mb-1 text-[11px] font-semibold text-slate-700">칸 정보</p>
      <p className="mb-1.5 text-[11px] text-slate-500">{props.caption}</p>

      {props.deviceText ? (
        <button
          type="button"
          className="block w-full border border-slate-300 bg-slate-50 px-2 py-1 text-left hover:border-slate-500 hover:bg-slate-100"
          onClick={props.onOpenDevice}
          title="장치 대장에서 이 장치의 명세를 고칩니다"
        >
          <p className="text-[10px] font-semibold tracking-wide text-slate-500">연결된 장치</p>
          <p className="text-[12px] text-slate-800">{props.deviceText}</p>
          <p className="text-[10px] text-slate-500">클릭하면 수정 모달이 열립니다</p>
        </button>
      ) : (
        <>
          <label className="text-[10px] font-semibold tracking-wide text-slate-500">
            식별자
            <input
              ref={labelRef}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  save();
                }
              }}
              className="mt-0.5 h-7 w-full border border-slate-300 bg-white px-2 text-[13px] text-slate-900 outline-none focus:border-slate-600"
              aria-label="식별자"
            />
          </label>

          <div className="mt-1.5 flex gap-1">
            {props.devices && props.devices.length > 0 && props.onLinkDevice ? (
              <select
                className="h-7 min-w-0 flex-1 border border-slate-300 bg-white px-1 text-[12px] text-slate-700"
                value=""
                onChange={(event) => {
                  if (event.target.value) props.onLinkDevice?.(event.target.value);
                }}
                aria-label="기존 장치와 연결"
              >
                <option value="">장치 연결…</option>
                {props.devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {deviceLabel(device)}
                  </option>
                ))}
              </select>
            ) : null}
            {props.onRegisterDevice ? (
              <button
                type="button"
                className="h-7 shrink-0 border border-slate-300 bg-white px-2 text-[12px] text-slate-700 hover:bg-slate-100"
                onClick={props.onRegisterDevice}
                title="이 칸을 장치 대장에 올립니다. 식별자가 S/N 으로 옮겨집니다."
              >
                새 장치로 등록
              </button>
            ) : null}
          </div>
        </>
      )}

      {props.onStartConnect ? (
        <div className="mt-1.5">
          <p className="text-[10px] font-semibold tracking-wide text-slate-500">연결</p>
          {props.cellConnections && props.cellConnections.length > 0 ? (
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {props.cellConnections.map((connection) => (
                <li
                  key={connection.id}
                  className="flex items-center gap-1 border border-slate-200 bg-slate-50 px-1.5 py-0.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700" title={connection.text}>
                    {connection.text}
                  </span>
                  <button
                    type="button"
                    className="h-4 w-4 shrink-0 border border-slate-400 bg-white text-[10px] leading-none text-slate-700 hover:bg-red-50 hover:text-red-700"
                    onClick={() => props.onRemoveConnection?.(connection.id)}
                    title="이 연결을 지운다"
                    aria-label={`연결 지우기: ${connection.text}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="mt-0.5 h-7 w-full border border-slate-300 bg-white text-[12px] text-slate-700 hover:bg-slate-100"
            onClick={props.onStartConnect}
            title="이 칸에서 다른 칸·장치로 연결을 긋습니다. 다음에 클릭하는 칸이 도착점입니다 (Esc 취소)."
          >
            + 연결 긋기
          </button>
        </div>
      ) : null}

      <label className="mt-1.5 block text-[10px] font-semibold tracking-wide text-slate-500">
        메모
        <textarea
          ref={memoRef}
          value={memo}
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
                <button
                  type="button"
                  className="group block w-full cursor-pointer"
                  onClick={() => setZoomed(index)}
                  title={`${index + 1}번째 사진 — 클릭하여 확대`}
                  aria-label={`${index + 1}번째 사진 확대해서 보기`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL 미리보기라 최적화 대상이 아니다 */}
                  <img
                    src={photo}
                    alt={`칸 사진 ${index + 1}`}
                    className="h-16 w-full border border-slate-300 object-cover"
                  />
                  {/* 올려 놓으면 확대할 수 있다는 것이 보인다. 평소에는 사진을 가리지 않는다. */}
                  <span className="absolute inset-0 flex items-center justify-center text-[15px] text-transparent transition-colors group-hover:bg-slate-900/35 group-hover:text-white">
                    🔍
                  </span>
                </button>

                {/* 크기 표시는 썸네일 위에 얹히므로 눌러도 확대가 막히지 않게 해 둔다. */}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-900/70 px-0.5 text-center text-[9px] leading-tight text-white">
                  {formatBytes(photoBytes(photo))}
                </span>

                {/* 저장·삭제는 썸네일 단추의 형제다. 눌러도 확대로 이어지지 않는다. */}
                <div className="absolute top-0 right-0 flex">
                  <button
                    type="button"
                    className="h-4 w-4 border border-slate-400 bg-white text-[9px] leading-none text-slate-700 hover:bg-slate-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      downloadPhoto(entries()[index]);
                    }}
                    title={`${index + 1}번째 사진 파일로 저장`}
                    aria-label={`${index + 1}번째 사진 파일로 저장`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="h-4 w-4 border border-slate-400 border-l-0 bg-white text-[10px] leading-none text-slate-700 hover:bg-red-50 hover:text-red-700"
                    onClick={(event) => {
                      event.stopPropagation();
                      removePhoto(index);
                    }}
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
            title="이 칸의 식별자 · 메모 · 사진을 한 장으로 모아 인쇄한다"
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
          <p className="text-[10px] font-semibold tracking-wide text-slate-500">영상</p>
          {videos.length > 0 ? (
            <p className="text-[10px] text-slate-500">
              {videos.length}/{MAX_CELL_VIDEOS}편 · 합계 {formatBytes(videosBytes(videos))}
            </p>
          ) : null}
        </div>

        {videos.length > 0 ? (
          <ul className="mt-0.5 grid grid-cols-3 gap-1">
            {videos.map((video, index) => (
              <li key={video.slice(-24)} className="relative">
                <button
                  type="button"
                  className="group block w-full cursor-pointer"
                  onClick={() => setPlaying(index)}
                  title={`${index + 1}번째 영상 — 클릭하여 재생`}
                  aria-label={`${index + 1}번째 영상 재생`}
                >
                  {/* 첫 프레임만 보인다. metadata 까지만 읽어 상자가 무거워지지 않게 한다. */}
                  <video
                    src={video}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-16 w-full border border-slate-300 bg-slate-900 object-cover"
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-[15px] text-white/90 drop-shadow transition-colors group-hover:bg-slate-900/35">
                    ▶
                  </span>
                </button>

                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-900/70 px-0.5 text-center text-[9px] leading-tight text-white">
                  {formatBytes(videoBytes(video))}
                </span>

                <div className="absolute top-0 right-0 flex">
                  <button
                    type="button"
                    className="h-4 w-4 border border-slate-400 bg-white text-[9px] leading-none text-slate-700 hover:bg-slate-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      downloadVideo(index);
                    }}
                    title={`${index + 1}번째 영상 파일로 저장`}
                    aria-label={`${index + 1}번째 영상 파일로 저장`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="h-4 w-4 border border-slate-400 border-l-0 bg-white text-[10px] leading-none text-slate-700 hover:bg-red-50 hover:text-red-700"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeVideo(index);
                    }}
                    title={`${index + 1}번째 영상 지우기`}
                    aria-label={`${index + 1}번째 영상 지우기`}
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
          onClick={() => videoFileRef.current?.click()}
          disabled={videosFull || shrinking !== null}
          title={
            videosFull
              ? `영상은 ${MAX_CELL_VIDEOS}편까지 붙일 수 있습니다.`
              : `${formatSeconds(MAX_VIDEO_SECONDS)} 안의 영상. 큰 영상은 붙일 때 480p 로 줄입니다(영상 길이만큼 걸립니다).`
          }
        >
          {shrinking
            ? `영상 줄이는 중… ${formatSeconds(shrinking.done)} / ${formatSeconds(shrinking.total)}`
            : videosFull
              ? `영상 ${MAX_CELL_VIDEOS}편 (가득 찼습니다)`
              : "+ 영상 붙이기 (끌어다 놓기 가능)"}
        </button>

        <input
          ref={videoFileRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void attach(event.target.files);
            event.target.value = "";
          }}
        />
        {videoError ? <p className="mt-1 text-[11px] text-red-700">{videoError}</p> : null}
      </div>

      <div className="mt-2 flex gap-1">
        <button type="button" className={OK_BUTTON} onClick={save}>
          저장
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() =>
            props.onSave(
              props.deviceText
                ? { memo: "", photos: [], videos: [] }
                : { label: "", memo: "", photos: [], videos: [] },
            )
          }
          disabled={
            props.deviceText
              ? !props.initialMemo && props.initialPhotos.length === 0 && props.initialVideos.length === 0
              : !props.initialLabel &&
                !props.initialMemo &&
                props.initialPhotos.length === 0 &&
                props.initialVideos.length === 0
          }
          title={
            props.deviceText
              ? "이 칸의 메모 · 사진 · 영상을 지운다 (장치 연결은 남는다)"
              : "이 칸의 식별자 · 메모 · 사진 · 영상을 지운다"
          }
        >
          지우기
        </button>
        <button type="button" className={BUTTON} onClick={props.onClose}>
          닫기
        </button>
      </div>

      <p className="mt-1 text-[10px] text-slate-400">Enter 저장 · Shift+Enter 줄바꿈 · Esc 닫기</p>

      {zoomed !== null ? (
        <PhotoLightbox
          photos={photos}
          index={zoomed}
          caption={[label || null, props.pageName, positionText(entries()[0])].filter(Boolean).join(" · ")}
          onIndex={setZoomed}
          onDownload={(index) => downloadPhoto(entries()[index])}
          onClose={() => setZoomed(null)}
        />
      ) : null}

      {playing !== null ? (
        <VideoLightbox
          videos={videos}
          index={playing}
          caption={[label || null, props.pageName, cellPosition].filter(Boolean).join(" · ")}
          onIndex={setPlaying}
          onDownload={downloadVideo}
          onClose={() => setPlaying(null)}
        />
      ) : null}
    </div>
  );
}
