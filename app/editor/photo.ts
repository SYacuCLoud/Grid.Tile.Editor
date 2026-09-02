/**
 * 칸에 붙이는 사진.
 *
 * 사진은 도면 문서 안에 data URL 로 들어간다. 그래서 그대로 넣으면 안 된다 —
 * 요즘 휴대폰 사진은 한 장이 3~5MB 이고, 서버 JSON 과 저장 때마다 쌓이는
 * 이력 스냅샷이 그만큼 무거워진다.
 *
 * 붙일 때 **720p 급**(짧은 변 720px · 긴 변 1280px 안)으로 줄이고 WebP 로 다시
 * 굽는다(브라우저가 WebP 를 못 만들면 JPEG). 현장 사진은 라벨 · 명판 · 포트
 * 번호를 읽으려고 붙이는 것이라 글자가 남을 만큼은 커야 한다 — 480px 로 줄였을
 * 때는 글자가 뭉개져 사진의 쓸모가 없었다.
 */

/** 줄인 뒤 긴 변 상한(px). 16:9 사진은 1280×720, 4:3 사진은 960×720 이 된다. */
export const MAX_EDGE = 1280;
/** 줄인 뒤 짧은 변 상한(px). "720p" 의 720 이다. */
export const MAX_SHORT_EDGE = 720;
/**
 * 다시 굽는 품질(WebP · JPEG 공통). 0.82 면 글자 가장자리가 살고 크기는 원본의
 * 1/10 안쪽이다. 그보다 낮추면 잔글씨부터 번진다.
 */
export const PHOTO_QUALITY = 0.82;
/** 이전 이름. `PHOTO_QUALITY` 를 쓴다. */
export const JPEG_QUALITY = PHOTO_QUALITY;
/**
 * 문서에 담을 수 있는 사진 한 장의 최대 길이(약 600KB).
 * 720p WebP 는 보통 80~250KB(110~340k자)다. 넘으면 `SHRINK_STEPS` 로 더 줄여 본다.
 */
export const MAX_PHOTO_CHARS = 800_000;
/** 한 칸에 붙일 수 있는 사진 장수. 도면 한 장에 칸이 수백 개라 장수를 제한한다. */
export const MAX_CELL_PHOTOS = 8;
/**
 * 한 칸의 사진을 모두 합친 최대 길이(약 3MB).
 * 보통 크기라면 여덟 장이 이 안에 들어온다. 큰 사진만 골라 붙이면 넘길 수 있으므로
 * 총량으로 한 번 더 막는다.
 */
export const MAX_CELL_PHOTO_CHARS = 4_000_000;

/**
 * 한 장 한도를 넘는 사진을 더 줄여 보는 순서.
 *
 * 품질을 먼저 낮추고 그다음 크기를 줄인다 — 같은 용량이면 크기를 지키고 품질을
 * 조금 낮춘 쪽이 글자가 더 잘 읽힌다. 마지막 단계도 넘으면 받지 않는다.
 */
const SHRINK_STEPS: ReadonlyArray<{ maxEdge: number; maxShort: number; quality: number }> = [
  { maxEdge: MAX_EDGE, maxShort: MAX_SHORT_EDGE, quality: PHOTO_QUALITY },
  { maxEdge: MAX_EDGE, maxShort: MAX_SHORT_EDGE, quality: 0.7 },
  { maxEdge: 960, maxShort: 540, quality: 0.75 },
  { maxEdge: 640, maxShort: 480, quality: 0.72 },
];

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

/**
 * 확대 보기에서 한 장 넘긴 뒤의 순번.
 *
 * 끝에서 끝으로 돈다 — 마지막 장에서 `▶` 를 눌렀을 때 아무 일도 일어나지 않으면
 * 단추가 죽은 줄로 보인다. 장수가 없으면 0 을 준다(부르는 쪽이 빈 목록을
 * 따로 다루지 않아도 되게).
 */
export function stepPhotoIndex(index: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  // 두 번 나머지를 취해 음수와 -0 을 한꺼번에 없앤다.
  return (((Math.trunc(index) + Math.trunc(delta)) % total) + total) % total;
}

/** 사람이 읽는 순번. `2 / 5` */
export function photoCounter(index: number, total: number): string {
  return `${Math.min(total, Math.max(0, index) + 1)} / ${total}`;
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

/**
 * 줄인 뒤 크기. 긴 변과 짧은 변이 각각 상한 안에 들도록 비율을 지키며 줄인다.
 * 이미 작으면 건드리지 않는다(키우지 않는다).
 */
export function fitSize(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
  maxShort = MAX_SHORT_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  const shortest = Math.max(1, Math.min(width, height));
  const scale = Math.min(1, maxEdge / Math.max(1, longest), maxShort / shortest);
  if (scale >= 1) return { width: Math.round(width), height: Math.round(height) };
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * 캔버스를 WebP 로 굽는다. 못 만드는 브라우저(Safari 등)는 PNG 를 돌려주므로
 * 그때는 JPEG 로 굽는다. 같은 품질에서 WebP 가 JPEG 보다 3할쯤 작고 글자
 * 가장자리도 덜 번진다.
 */
export function encodePhoto(canvas: HTMLCanvasElement, quality: number): string {
  const webp = canvas.toDataURL("image/webp", quality);
  if (webp.startsWith("data:image/webp")) return webp;
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * 고른 그림 파일을 도면에 담을 만한 크기로 줄여 data URL 로 돌려준다.
 * 그림이 아니거나 읽지 못하면 사용자에게 보일 한 줄과 함께 실패한다.
 */
export async function readPhotoFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("그림 파일만 붙일 수 있습니다.");

  const bitmap = await loadImage(file);

  for (const step of SHRINK_STEPS) {
    const size = fitSize(bitmap.width, bitmap.height, step.maxEdge, step.maxShort);

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("그림을 줄이지 못했습니다.");
    // 한 번에 크게 줄이므로 보간 품질을 올린다 — 잔글씨가 계단으로 깨지지 않게.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);

    const dataUrl = encodePhoto(canvas, step.quality);
    if (dataUrl.length <= MAX_PHOTO_CHARS) return dataUrl;
  }

  throw new Error("사진이 너무 큽니다. 더 작은 사진을 붙여 주십시오.");
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
