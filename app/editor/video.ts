/**
 * 칸에 붙이는 영상.
 *
 * 사진(`photo.ts`)과 같은 길로 간다 — 영상도 도면 문서 안에 data URL 로 들어가고,
 * 서버 이력에서는 `.photos/` 파일로 빠져 참조만 남는다(`server/photoStore.ts`).
 *
 * 다만 영상은 사진과 자릿수가 다르다. 휴대폰으로 10초를 찍으면 1080p 로 20MB 가
 * 넘는다. 그대로 담으면 도면 한 장이 저장·전송 한도(64MB)에 금방 닿으므로
 *
 * - 한 편 한도(약 12MB)를 넘는 영상은 브라우저 안에서 **480p 급 · 낮은 비트레이트
 *   WebM** 으로 다시 굽는다(`shrinkVideo`). 캔버스에 실시간으로 그려 다시 녹화하는
 *   방식이라 영상 길이만큼 시간이 걸린다 — 그래서 길이도 제한한다.
 * - 다시 굽기를 못하는 브라우저(Safari 등)에서는 한도 안의 파일만 받는다.
 *
 * 현장 영상은 "저울 표시가 어떻게 흔들리는지 · 컨베이어가 어디서 걸리는지" 를
 * 남기려고 붙이는 것이라, 화질보다 **그 순간이 남는 것** 이 먼저다.
 */

import { fitSize, formatBytes, photoBytes } from "./photo";

/** 문서에 담을 수 있는 영상 한 편의 최대 길이(약 12MB). base64 는 3바이트가 4글자다. */
export const MAX_VIDEO_CHARS = 16_000_000;
/** 한 칸에 붙일 수 있는 영상 편수. */
export const MAX_CELL_VIDEOS = 3;
/** 한 칸의 영상을 모두 합친 최대 길이(약 24MB). */
export const MAX_CELL_VIDEO_CHARS = 32_000_000;
/**
 * 받을 수 있는 영상 길이(초). 다시 굽기가 실시간으로 도는 데다, 이보다 길면
 * 480p 로 줄여도 한 편 한도를 넘는다.
 */
export const MAX_VIDEO_SECONDS = 90;

/** 다시 구울 때의 크기 상한. 854×480(16:9) · 640×480(4:3) 이 된다. */
export const SHRINK_MAX_EDGE = 854;
export const SHRINK_MAX_SHORT_EDGE = 480;
/** 다시 구울 때의 영상 비트레이트(bps). 480p 에서 90초가 한 편 한도(12MB) 안에 든다. */
export const SHRINK_VIDEO_BPS = 900_000;
export const SHRINK_AUDIO_BPS = 64_000;
/** 다시 구울 때의 초당 프레임. 현장 영상은 24 로 충분하고 용량이 그만큼 준다. */
export const SHRINK_FPS = 24;

/**
 * 우리가 담는 영상 형식. 브라우저 `<video>` 가 바로 재생하는 것들이다.
 * quicktime(.mov)은 iPhone 기본 형식이라 받되, HEVC 로 찍힌 것은 PC 크롬에서
 * 재생이 안 될 수 있다 — 그때는 한도를 넘겨 다시 굽는 길로 보내면 WebM 이 된다.
 */
const DATA_URL = /^data:video\/(mp4|webm|quicktime|ogg|x-m4v);base64,[A-Za-z0-9+/=]+$/;

/** 문서에서 읽은 값이 우리가 담은 영상인가. 아니면 버린다. */
export function sanitizeVideo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length > MAX_VIDEO_CHARS) return null;
  return DATA_URL.test(raw) ? raw : null;
}

/**
 * 문서에서 읽은 영상 목록을 다듬는다. 넘치는 몫은 조용히 자른다 —
 * 문서를 아예 못 여는 것보다 앞쪽 몇 편이라도 보이는 편이 낫다.
 */
export function sanitizeVideos(rawVideos: unknown): string[] {
  const candidates = Array.isArray(rawVideos) ? rawVideos : [];
  const out: string[] = [];
  let chars = 0;
  for (const candidate of candidates) {
    if (out.length >= MAX_CELL_VIDEOS) break;
    const video = sanitizeVideo(candidate);
    if (!video) continue;
    if (out.includes(video)) continue;
    if (chars + video.length > MAX_CELL_VIDEO_CHARS) continue;
    chars += video.length;
    out.push(video);
  }
  return out;
}

/** 목록에 영상을 한 편 더 붙일 수 있는가. 안 되면 사용자에게 보일 한 줄을 준다. */
export function checkVideoRoom(videos: string[], next: string): string | null {
  if (videos.length >= MAX_CELL_VIDEOS) return `영상은 한 칸에 ${MAX_CELL_VIDEOS}편까지 붙일 수 있습니다.`;
  if (videos.includes(next)) return "같은 영상이 이미 붙어 있습니다.";
  const total = videos.reduce((sum, video) => sum + video.length, 0) + next.length;
  if (total > MAX_CELL_VIDEO_CHARS) {
    return `이 칸의 영상 용량(${formatBytes(videosBytes(videos))})이 한도에 닿았습니다. 먼저 한 편을 지워 주십시오.`;
  }
  return null;
}

/** data URL 의 대략 바이트 수. */
export function videoBytes(dataUrl: string): number {
  return photoBytes(dataUrl);
}

/** 영상 여러 편을 합친 대략 바이트 수. */
export function videosBytes(videos: string[]): number {
  return videos.reduce((sum, video) => sum + videoBytes(video), 0);
}

/** data URL 이 말하는 확장자. `quicktime` 은 `.mov` 로 적는다. */
export function videoExtension(dataUrl: string): string {
  const match = /^data:video\/([a-z0-9-]+);/.exec(dataUrl);
  const type = match ? match[1] : "mp4";
  if (type === "quicktime") return "mov";
  if (type === "x-m4v") return "m4v";
  if (type === "ogg") return "ogv";
  return type;
}

/**
 * 영상 파일 이름. `1층-메인-공장_5_3_C1101_video_2.webm`
 * 사진 이름(`photoLedger.photoFileName`)과 같은 짜임이라 한 폴더에 내려받아도
 * 같은 칸의 사진·영상이 나란히 놓인다.
 */
export function videoFileName(entry: {
  pageName: string;
  x: number;
  y: number;
  label: string;
  index: number;
  video: string;
}): string {
  const parts = [namePart(entry.pageName), entry.y + 1, entry.x + 1, namePart(entry.label)];
  return `${parts.join("_")}_video_${entry.index}.${videoExtension(entry.video)}`;
}

function namePart(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-");
  return cleaned.length > 0 ? cleaned : "-";
}

/** 파일 크기(바이트)가 data URL 로 바뀌면 몇 글자가 되는가. 머리말 몫을 조금 더한다. */
export function dataUrlChars(bytes: number): number {
  return Math.ceil(bytes / 3) * 4 + 32;
}

/** 이 파일이 다시 굽지 않고 그대로 들어갈 크기인가. */
export function fitsAsIs(bytes: number): boolean {
  return dataUrlChars(bytes) <= MAX_VIDEO_CHARS;
}

/** 사람이 읽는 길이. `1:05` */
export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** 다시 굽는 동안 상자에 보일 진행 상황. */
export interface ShrinkProgress {
  /** 지금까지 구운 초. */
  done: number;
  /** 전체 길이(초). */
  total: number;
}

/** 이 브라우저가 영상을 다시 구울 수 있는가(캔버스 녹화 + MediaRecorder). */
export function canShrinkVideo(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof MediaRecorder === "undefined") return false;
  const canvas = document.createElement("canvas");
  return typeof (canvas as HTMLCanvasElement & { captureStream?: unknown }).captureStream === "function";
}

/**
 * 고른 영상 파일을 도면에 담을 만한 크기로 data URL 로 돌려준다.
 *
 * 한도 안이면 그대로 읽고, 넘으면 다시 굽는다(`onProgress` 로 진행을 알린다).
 * 영상이 아니거나 너무 길거나 다시 구워도 크면 사용자에게 보일 한 줄과 함께 실패한다.
 */
export async function readVideoFile(file: File, onProgress?: (progress: ShrinkProgress) => void): Promise<string> {
  if (!file.type.startsWith("video/")) throw new Error("영상 파일만 붙일 수 있습니다.");

  if (fitsAsIs(file.size)) {
    const dataUrl = await readAsDataUrl(file);
    if (!sanitizeVideo(dataUrl)) {
      // 브라우저가 형식을 다르게 말한 경우(예: video/x-matroska). 다시 구우면 WebM 이 된다.
      if (canShrinkVideo()) return shrinkVideo(file, onProgress);
      throw new Error("이 영상 형식은 붙일 수 없습니다. MP4 · WebM · MOV 파일을 써 주십시오.");
    }
    return dataUrl;
  }

  if (!canShrinkVideo()) {
    throw new Error(
      `영상이 너무 큽니다(${formatBytes(file.size)}). 이 브라우저는 줄이지 못하므로 ${formatBytes(
        (MAX_VIDEO_CHARS * 3) / 4,
      )} 안의 파일을 붙여 주십시오.`,
    );
  }
  return shrinkVideo(file, onProgress);
}

/**
 * 영상을 480p 급 WebM 으로 다시 굽는다.
 *
 * `<video>` 에 틀어 놓고 프레임마다 작은 캔버스에 그린 뒤, 그 캔버스의 스트림과
 * 원본의 소리 트랙을 `MediaRecorder` 로 녹화한다. 실시간으로 도니 영상 길이만큼
 * 걸린다. 소리가 새지 않게 요소는 `muted` 로 둔다 — 캡처 스트림은 요소의
 * 소리 크기·묵음과 무관하다(spec: mediacapture-fromelement).
 */
export async function shrinkVideo(file: File, onProgress?: (progress: ShrinkProgress) => void): Promise<string> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  try {
    await loadedMetadata(video);
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("영상 길이를 읽지 못했습니다.");
    if (duration > MAX_VIDEO_SECONDS) {
      throw new Error(`영상은 ${formatSeconds(MAX_VIDEO_SECONDS)} 안이어야 합니다 (이 영상 ${formatSeconds(duration)}).`);
    }

    const size = fitSize(video.videoWidth, video.videoHeight, SHRINK_MAX_EDGE, SHRINK_MAX_SHORT_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("영상을 줄이지 못했습니다.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const stream = canvas.captureStream(SHRINK_FPS);
    // 원본 소리 트랙을 함께 넣는다. 못 잡는 브라우저는 그림만 남는다.
    const source = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    for (const track of source?.getAudioTracks() ?? []) stream.addTrack(track);

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: SHRINK_VIDEO_BPS,
      audioBitsPerSecond: SHRINK_AUDIO_BPS,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    const blob = await new Promise<Blob>((resolve, reject) => {
      let stopped = false;
      const finish = () => {
        if (stopped) return;
        stopped = true;
        if (recorder.state !== "inactive") recorder.stop();
      };
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
      recorder.onerror = () => reject(new Error("영상을 다시 굽는 중 오류가 났습니다."));

      let frame = 0;
      const draw = () => {
        if (stopped) return;
        ctx.drawImage(video, 0, 0, size.width, size.height);
        onProgress?.({ done: video.currentTime, total: duration });
        if (video.ended) {
          finish();
          return;
        }
        frame = requestAnimationFrame(draw);
      };

      video.onended = () => {
        cancelAnimationFrame(frame);
        // 마지막 프레임을 한 번 더 그리고 닫는다.
        ctx.drawImage(video, 0, 0, size.width, size.height);
        onProgress?.({ done: duration, total: duration });
        finish();
      };
      video.onerror = () => {
        cancelAnimationFrame(frame);
        stopped = true;
        if (recorder.state !== "inactive") recorder.stop();
        reject(new Error("이 영상은 브라우저가 재생하지 못해 줄일 수 없습니다."));
      };

      recorder.start(1000);
      video.play().then(
        () => {
          frame = requestAnimationFrame(draw);
        },
        () => {
          stopped = true;
          if (recorder.state !== "inactive") recorder.stop();
          reject(new Error("영상을 재생하지 못해 줄일 수 없습니다."));
        },
      );
    });

    for (const track of stream.getTracks()) track.stop();

    const dataUrl = await readAsDataUrl(blob);
    if (dataUrl.length > MAX_VIDEO_CHARS) {
      throw new Error(`줄여도 영상이 너무 큽니다(${formatBytes(blob.size)}). 더 짧게 잘라 붙여 주십시오.`);
    }
    if (!sanitizeVideo(dataUrl)) throw new Error("다시 구운 영상 형식을 담을 수 없습니다.");
    return dataUrl;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** 브라우저가 만들 수 있는 WebM 코덱 중 가장 작은 것. */
function pickMimeType(): string | null {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

function loadedMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("이 영상은 브라우저가 열지 못합니다."));
  });
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("영상을 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}
