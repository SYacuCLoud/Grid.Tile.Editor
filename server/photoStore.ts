/**
 * 이력 스냅샷의 사진 저장소.
 *
 * 도면은 사진을 data URL 로 안고 다닌다. 그대로 이력에 쌓으면 저장할 때마다 같은
 * 사진이 통째로 복사되어 이력 폴더가 도면 크기 × 저장 횟수로 커진다(사진은 저장
 * 사이에 거의 바뀌지 않는데도). 그래서 **이력 파일에서는** 사진을 내용 해시로
 * 이름 붙인 파일(`.grid-projects/.photos/<sha1>.<ext>`)로 빼고 `photoref:<파일>`
 * 참조만 남긴다. 같은 사진은 몇 번 저장해도 한 파일이다.
 *
 * 도면 파일 자체(`<id>.json`)는 손대지 않는다 — 편집기 · MCP · 사람이 그대로
 * 읽는 파일이라 사진이 안에 있어야 한다. 이력을 읽을 때는 참조를 다시 data URL 로
 * 채워 주므로 되돌리기 · 충돌 판정은 예전과 같은 도면을 본다.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PHOTOS_DIR = ".photos";
export const PHOTO_REF_PREFIX = "photoref:";

const DATA_URL = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;
const EXT: Record<string, string> = { png: "png", jpeg: "jpg", jpg: "jpg", webp: "webp", gif: "gif" };
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const REF_FILE = /^[0-9a-f]{40}\.(png|jpg|webp|gif)$/;

/** 이 data URL 이 저장될 파일 이름. 우리가 담는 그림이 아니면 null. */
export function photoFileName(dataUrl: string): string | null {
  const match = DATA_URL.exec(dataUrl);
  if (!match) return null;
  const hash = createHash("sha1").update(dataUrl).digest("hex");
  return `${hash}.${EXT[match[1]]}`;
}

function isRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PHOTO_REF_PREFIX) && REF_FILE.test(value.slice(PHOTO_REF_PREFIX.length));
}

/**
 * 도면(원시 JSON 객체)의 칸 사진마다 `fn` 을 적용한 사본을 만든다.
 * `fn` 이 null 을 주면 그 사진은 뺀다. 사진이 있는 자리만 새로 만들고 나머지는 그대로 둔다.
 */
function mapCellPhotos(raw: unknown, fn: (value: unknown) => string | null): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const doc = raw as Record<string, unknown>;

  const mapCell = (cell: unknown): unknown => {
    if (!cell || typeof cell !== "object") return cell;
    const data = cell as Record<string, unknown>;
    if (!("photos" in data) && !("photo" in data)) return cell;
    const next: Record<string, unknown> = { ...data };
    if (Array.isArray(data.photos)) {
      next.photos = data.photos.map(fn).filter((value): value is string => value !== null);
    }
    if ("photo" in data) {
      const mapped = fn(data.photo);
      if (mapped === null) delete next.photo;
      else next.photo = mapped;
    }
    return next;
  };

  const mapPage = (page: unknown): unknown => {
    if (!page || typeof page !== "object") return page;
    const data = page as Record<string, unknown>;
    if (!data.equipment || typeof data.equipment !== "object") return page;
    const equipment: Record<string, unknown> = {};
    for (const [key, cell] of Object.entries(data.equipment as Record<string, unknown>)) equipment[key] = mapCell(cell);
    return { ...data, equipment };
  };

  if (Array.isArray(doc.pages)) return { ...doc, pages: doc.pages.map(mapPage) };
  // 페이지가 없는 옛 단일 문서는 칸이 맨 위에 있다.
  if (doc.equipment) return mapPage(doc);
  return raw;
}

export interface PhotoStore {
  dir: string;
  /** 사진을 파일로 빼고 참조로 바꾼 사본. 파일이 이미 있으면 다시 쓰지 않는다. */
  externalize<T>(raw: T): T;
  /** 참조를 다시 data URL 로 채운 사본. 파일이 없는 참조는 뺀다(사진 한 장이 빠질 뿐 도면은 열린다). */
  inline<T>(raw: T): T;
  /** 이 도면이 쓰는 사진 파일 이름들. 참조든 data URL 이든 같은 이름으로 센다. */
  referencesOf(raw: unknown): string[];
  /** 참조되지 않는 파일을 지운다. 지운 수를 돌려준다. */
  sweep(referenced: ReadonlySet<string>): number;
  /** 지금 저장소에 있는 파일 이름들. */
  files(): string[];
}

export function createPhotoStore(dataDir: string): PhotoStore {
  const dir = join(dataDir, PHOTOS_DIR);

  const write = (name: string, dataUrl: string) => {
    const file = join(dir, name);
    if (existsSync(file)) return;
    mkdirSync(dir, { recursive: true });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    writeFileSync(file, Buffer.from(base64, "base64"));
  };

  const read = (name: string): string | null => {
    const file = join(dir, name);
    if (!existsSync(file)) return null;
    const ext = name.slice(name.lastIndexOf(".") + 1);
    return `data:${MIME[ext]};base64,${readFileSync(file).toString("base64")}`;
  };

  return {
    dir,

    externalize<T>(raw: T): T {
      return mapCellPhotos(raw, (value) => {
        if (isRef(value)) return value;
        if (typeof value !== "string") return null;
        const name = photoFileName(value);
        if (!name) return null;
        write(name, value);
        return `${PHOTO_REF_PREFIX}${name}`;
      }) as T;
    },

    inline<T>(raw: T): T {
      return mapCellPhotos(raw, (value) => {
        if (!isRef(value)) return typeof value === "string" ? value : null;
        return read(value.slice(PHOTO_REF_PREFIX.length));
      }) as T;
    },

    referencesOf(raw: unknown): string[] {
      const names = new Set<string>();
      mapCellPhotos(raw, (value) => {
        if (isRef(value)) names.add(value.slice(PHOTO_REF_PREFIX.length));
        else if (typeof value === "string") {
          const name = photoFileName(value);
          if (name) names.add(name);
        }
        return null;
      });
      return [...names];
    },

    sweep(referenced: ReadonlySet<string>): number {
      if (!existsSync(dir)) return 0;
      let removed = 0;
      for (const name of readdirSync(dir)) {
        if (!REF_FILE.test(name) || referenced.has(name)) continue;
        rmSync(join(dir, name), { force: true });
        removed += 1;
      }
      return removed;
    },

    files(): string[] {
      if (!existsSync(dir)) return [];
      return readdirSync(dir).filter((name) => REF_FILE.test(name)).sort();
    },
  };
}
