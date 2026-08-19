/**
 * 칸에 붙이는 사진.
 *
 * 사진은 도면 문서 안에 data URL 로 들어간다. 그래서 그대로 넣으면 안 된다 —
 * 요즘 휴대폰 사진은 한 장이 3~5MB 이고, 브라우저 `localStorage` 는 통째로
 * 5MB 안팎이며 서버 JSON 도 그만큼 무거워진다.
 *
 * 붙일 때 긴 변을 `MAX_EDGE` 로 줄이고 JPEG 로 다시 굽는다. 도면에서 사진은
 * "그 자리가 어떻게 생겼는지" 를 알려 주는 참고용이라 이 크기로 충분하다.
 */

/** 줄인 뒤 긴 변 길이(px). */
export const MAX_EDGE = 480;
/** JPEG 품질. 0.72 면 눈에 거슬리지 않으면서 크기가 크게 줄어든다. */
export const JPEG_QUALITY = 0.72;
/** 문서에 담을 수 있는 사진 한 장의 최대 길이. 이보다 크면 받지 않는다. */
export const MAX_PHOTO_CHARS = 400_000;
/** 한 칸에 붙일 수 있는 사진 장수. 도면 한 장에 칸이 수백 개라 장수를 제한한다. */
export const MAX_CELL_PHOTOS = 8;
/**
 * 한 칸의 사진을 모두 합친 최대 길이.
 * 480px JPEG 는 보통 30~80KB(40~110k자)라 여덟 장이 이 안에 들어온다.
 * 그래도 큰 사진만 골라 붙이면 넘길 수 있으므로 총량으로 한 번 더 막는다.
 */
export const MAX_CELL_PHOTO_CHARS = 1_200_000;

const DATA_URL = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/** 문서에서 읽은 값이 우리가 담은 사진인가. 아니면 버린다. */
export function sanitizePhoto(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length > MAX_PHOTO_CHARS) return null;
  return DATA_URL.test(raw) ? raw : null;
}

/**
 * 문서에서 읽은 사진 목록을 다듬는다.
 *
 * 이전 판(`photo?: string`)으로 저장된 문서도 여기로 들어온다 — 한 장이 있으면
 * 한 칸짜리 목록으로 올려 준다. 그래서 옛 도면을 열어도 사진이 사라지지 않는다.
 *
 * 넘치는 몫은 조용히 자른다. 문서를 아예 못 여는 것보다 앞쪽 몇 장이라도
 * 보이는 편이 낫다.
 */
export function sanitizePhotos(rawPhotos: unknown, legacyPhoto?: unknown): string[] {
  const candidates = Array.isArray(rawPhotos) ? rawPhotos : [];
  const legacy = sanitizePhoto(legacyPhoto);
  // 옛 단일 사진은 목록에 없을 때만 앞에 붙인다(두 필드가 함께 있는 문서 대비).
  const all = legacy ? [legacy, ...candidates] : candidates;

  const out: string[] = [];
  let chars = 0;
  for (const candidate of all) {
    if (out.length >= MAX_CELL_PHOTOS) break;
    const photo = sanitizePhoto(candidate);
    if (!photo) continue;
    if (out.includes(photo)) continue;
    if (chars + photo.length > MAX_CELL_PHOTO_CHARS) continue;
    chars += photo.length;
    out.push(photo);
  }
  return out;
}

/** 목록에 사진을 한 장 더 붙일 수 있는가. 안 되면 사용자에게 보일 한 줄을 준다. */
export function checkPhotoRoom(photos: string[], next: string): string | null {
  if (photos.length >= MAX_CELL_PHOTOS) return `사진은 한 칸에 ${MAX_CELL_PHOTOS}장까지 붙일 수 있습니다.`;
  if (photos.includes(next)) return "같은 사진이 이미 붙어 있습니다.";
  const total = photos.reduce((sum, photo) => sum + photo.length, 0) + next.length;
  if (total > MAX_CELL_PHOTO_CHARS) {
    return `이 칸의 사진 용량(${formatBytes(photosBytes(photos))})이 한도에 닿았습니다. 먼저 몇 장을 지워 주십시오.`;
  }
  return null;
}

/** data URL 의 대략 바이트 수. base64 는 3바이트를 4글자로 적는다. */
export function photoBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.round((base64.length * 3) / 4);
}

/** 사진 여러 장을 합친 대략 바이트 수. */
export function photosBytes(photos: string[]): number {
  return photos.reduce((sum, photo) => sum + photoBytes(photo), 0);
}

/** 사람이 읽을 크기. `128KB` */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 줄인 뒤 크기. 긴 변만 맞추고 비율은 지킨다. */
export function fitSize(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * 고른 그림 파일을 도면에 담을 만한 크기로 줄여 data URL 로 돌려준다.
 * 그림이 아니거나 읽지 못하면 사용자에게 보일 한 줄과 함께 실패한다.
 */
export async function readPhotoFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("그림 파일만 붙일 수 있습니다.");

  const bitmap = await loadImage(file);
  const size = fitSize(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("그림을 줄이지 못했습니다.");
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  if (dataUrl.length > MAX_PHOTO_CHARS) {
    throw new Error("사진이 너무 큽니다. 더 작은 사진을 붙여 주십시오.");
  }
  return dataUrl;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("그림을 읽지 못했습니다."));
    };
    image.src = url;
  });
}
