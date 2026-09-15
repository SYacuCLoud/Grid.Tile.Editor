/**
 * 메시지 형식 프로필 저장소 — `.grid-projects/.live/{사업장}.json`.
 *
 * 매핑 설정(`.lookup/`)과 폴더를 나눈 이유: 하나는 "무엇을 이름으로 보일까", 하나는 "메시지를 어떻게 읽을까" 라
 * 층이 다르다. 프로필이 없는 사업장은 기본(v1)이므로 파일이 없어도 현황판은 그대로 돈다.
 * 파일은 mtime 으로 캐시해 요청마다 다시 읽지 않는다.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { defaultFormat, type FormatBook, isDefaultFormat, type MessageFormat, MessageFormatError, parseMessageFormat } from "../app/live/messageFormat";

export const FORMAT_DIR = ".live";

/** Windows 메모장이 앞에 붙이는 BOM. 남으면 JSON.parse 가 터진다. */
const BOM_RE = new RegExp("^" + String.fromCharCode(0xfeff));

interface Entry {
  mtimeMs: number;
  format: MessageFormat | null;
  error: string | null;
}

export interface FormatStore {
  dir: string;
  /** 파일이 있는 사업장의 프로필만. 깨진 파일은 `errors` 에. */
  book(): FormatBook & { errors: Record<string, string> };
  get(site: string): MessageFormat | null;
  /** 검증해 파일에 쓴다. 기본값과 같으면 파일을 지운다(없는 것이 곧 기본). */
  save(site: string, draft: unknown, author: string): MessageFormat;
  remove(site: string): void;
  reload(): void;
}

export interface FormatStoreOptions {
  now?: () => Date;
  log?: (message: string) => void;
}

export function createFormatStore(dir?: string, options: FormatStoreOptions = {}): FormatStore {
  const root = resolve(dir ?? ".grid-projects");
  const folder = join(root, FORMAT_DIR);
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.log(`[live-format] ${message}`));
  const entries = new Map<string, Entry>();

  function reload() {
    const seen = new Set<string>();
    if (existsSync(folder)) {
      for (const name of readdirSync(folder)) {
        if (!name.endsWith(".json") || name.startsWith(".")) continue;
        const site = basename(name, ".json");
        seen.add(site);
        const file = join(folder, name);
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(file).mtimeMs;
        } catch {
          continue;
        }
        const existing = entries.get(site);
        if (existing && existing.mtimeMs === mtimeMs) continue;
        try {
          const raw: unknown = JSON.parse(readFileSync(file, "utf8").replace(BOM_RE, ""));
          entries.set(site, { mtimeMs, format: parseMessageFormat(raw, site), error: null });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`${name}: ${message}`);
          entries.set(site, { mtimeMs, format: null, error: message });
        }
      }
    }
    for (const site of [...entries.keys()]) if (!seen.has(site)) entries.delete(site);
  }

  reload();

  return {
    dir: folder,
    book: () => {
      reload();
      const sites: Record<string, MessageFormat> = {};
      const errors: Record<string, string> = {};
      for (const [site, entry] of entries) {
        if (entry.format) sites[site] = entry.format;
        if (entry.error) errors[site] = entry.error;
      }
      return { sites, errors };
    },
    get: (site) => {
      reload();
      return entries.get(site)?.format ?? null;
    },
    save: (site, draft, author) => {
      const format = parseMessageFormat(typeof draft === "object" && draft !== null ? { ...(draft as Record<string, unknown>), site } : draft, site);
      const file = join(folder, `${site}.json`);
      if (isDefaultFormat(format)) {
        // 기본과 같으면 파일을 두지 않는다 — "설정 없음 = v1" 이 한 가지 상태로 남게.
        if (existsSync(file)) unlinkSync(file);
        reload();
        return defaultFormat(site);
      }
      format.updatedAt = now().toISOString();
      format.updatedBy = author.trim().slice(0, 40) || "익명";
      mkdirSync(folder, { recursive: true });
      writeFileSync(file, JSON.stringify(format, null, 2) + "\n", "utf8");
      reload();
      const saved = entries.get(site)?.format;
      if (!saved) throw new MessageFormatError("저장한 프로필을 다시 읽지 못했습니다.");
      return saved;
    },
    remove: (site) => {
      const file = join(folder, `${site}.json`);
      if (existsSync(file)) unlinkSync(file);
      reload();
    },
    reload,
  };
}
