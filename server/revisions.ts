/**
 * 로컬 폴더 기반 도면 공유와 가벼운 버전 관리.
 *
 * 저장 위치는 MCP 서버와 같은 `.grid-projects/` 다. 도면 파일 자체는 편집기가
 * 내보내는 JSON 그대로라 사람이 열어 봐도 되고, MCP 로 고친 것도 그대로 보인다.
 *
 * 이력은 그 옆 `.grid-projects/.history/<id>/<rev>_<timestamp>.json` 에 쌓는다.
 * 리비전 번호는 이력 파일에서 읽으므로 따로 관리하는 상태가 없다 — 폴더를
 * 통째로 복사해도, 다른 사람 것과 합쳐도 계산이 어긋나지 않는다.
 *
 * 이력이 끝없이 커지지 않게 세 가지를 한다.
 * - 마지막 판과 **같은 내용**이면 새 판을 만들지 않는다.
 * - 스냅샷의 **사진은 `.photos/` 에 한 번만** 두고 참조만 남긴다(`photoStore.ts`).
 * - 최근 `keepRecent` 판은 모두 남기고, 그 앞은 **하루 한 판**만 남기며, 그래도
 *   `maxBytes` 를 넘으면 오래된 판부터 지운다. 지워진 판만 쓰던 사진 파일도 함께 지운다.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createProject, type ProjectDoc } from "../app/editor/doc";
import { sanitizeProject } from "../app/editor/storage";
import { createStore, type ProjectStore } from "../mcp/store";
import { createPhotoStore } from "./photoStore";

export const HISTORY_DIR = ".history";

/** 최근 몇 판은 무조건 남기는가. 그 앞은 하루 한 판으로 줄인다. */
export const HISTORY_KEEP_RECENT = 30;
/** 프로젝트 하나의 이력 총량 상한(바이트). 최근 판은 넘어도 지우지 않는다. */
export const HISTORY_MAX_BYTES = 100 * 1024 * 1024;

export interface HistoryOptions {
  keepRecent?: number;
  maxBytes?: number;
}

export interface RevisionMeta {
  revision: number;
  savedAt: string;
  author: string;
  title: string;
  pages: number;
  file: string;
}

export interface ProjectListEntry {
  id: string;
  title: string;
  pages: number;
  revision: number;
  savedAt: string | null;
  author: string | null;
}

export interface LoadedProject {
  id: string;
  project: ProjectDoc;
  revision: number;
  savedAt: string | null;
  author: string | null;
  /** 마지막 이력과 실제 파일이 다른가 — MCP 나 손편집으로 바뀌었다는 뜻이다. */
  externalChange: boolean;
}

export type SaveMode = "save" | "overwrite" | "copy";

export interface SaveRequest {
  id: string;
  project: unknown;
  /** 클라이언트가 열람한 리비전. 서버가 더 앞서 있으면 충돌이다. */
  baseRevision?: number;
  author?: string;
  mode?: SaveMode;
  /** 저장 시각. 테스트에서 고정할 수 있도록 밖에서 넣는다. */
  now?: Date;
}

export interface SaveConflict {
  ok: false;
  reason: "conflict";
  /** 지금 서버에 있는 리비전. */
  revision: number;
  savedAt: string | null;
  author: string | null;
  externalChange: boolean;
  message: string;
}

export interface SaveSuccess {
  ok: true;
  id: string;
  revision: number;
  savedAt: string;
  author: string;
  /** `copy` 로 저장해 새 도면이 만들어졌는가. */
  copied: boolean;
  /** 마지막 판과 같은 내용이어서 새 판을 만들지 않았는가. 리비전은 그대로다. */
  unchanged?: boolean;
}

export type SaveResult = SaveSuccess | SaveConflict;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface RevisionStore {
  dir: string;
  projects: ProjectStore;
  list(): ProjectListEntry[];
  read(id: string): LoadedProject;
  save(request: SaveRequest): SaveResult;
  history(id: string): RevisionMeta[];
  /** 그 리비전에 저장해 둔 도면 내용. */
  snapshot(id: string, revision: number): ProjectDoc;
  restore(id: string, revision: number, author?: string, now?: Date): SaveSuccess;
  create(title: string, author?: string, now?: Date): SaveSuccess & { project: ProjectDoc };
  /**
   * 이력을 지금 다듬는다(옛 스냅샷 옮기기 · 보관 규칙 · 사진 정리). 저장할 때마다
   * 저절로 하는 일이지만, 규칙을 바꿨거나 옛 폴더를 물려받았을 때 한 번에 정리하려고 부른다.
   */
  compact(id: string): void;
}

function hashOf(project: ProjectDoc): string {
  return createHash("sha1").update(JSON.stringify(project)).digest("hex");
}

/** 파일 이름으로 쓸 수 있는 시각. 콜론은 윈도에서 쓸 수 없다. */
function stampOf(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function cleanAuthor(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  return text ? text.slice(0, 24) : "익명";
}

interface HistoryEnvelope {
  revision: number;
  savedAt: string;
  author: string;
  project: ProjectDoc;
}

export function createRevisionStore(dirInput?: string, options: HistoryOptions = {}): RevisionStore {
  const projects = createStore(dirInput);
  const dir = projects.dir;
  const historyRoot = join(dir, HISTORY_DIR);
  const photos = createPhotoStore(dir);
  // 최근 판은 적어도 하나(지금 판)는 남겨야 리비전 번호가 이어진다.
  const keepRecent = Math.max(1, Math.floor(options.keepRecent ?? HISTORY_KEEP_RECENT));
  const maxBytes = Math.max(0, options.maxBytes ?? HISTORY_MAX_BYTES);

  const historyDirOf = (id: string) => {
    // 경로 검사는 프로젝트 저장소와 같은 규칙을 쓴다.
    projects.path(id);
    return join(historyRoot, id);
  };

  /** 검사 전의 스냅샷 파일 내용. `project` 는 아직 도면인지 모르는 원시 값이다. */
  interface RawEnvelope {
    revision?: unknown;
    savedAt?: unknown;
    author?: unknown;
    project: unknown;
  }

  /** 파일의 원시 JSON. 봉투 없이 도면만 들어 있는 파일(손으로 넣어 둔 백업)도 봉투 모양으로 맞춘다. */
  const readRaw = (file: string): RawEnvelope | null => {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      if (!raw || typeof raw !== "object") return null;
      const wrapped = "project" in raw && raw.project && typeof raw.project === "object";
      return wrapped ? (raw as unknown as RawEnvelope) : { project: raw };
    } catch {
      return null;
    }
  };

  const savedAtOf = (raw: RawEnvelope, file: string): string =>
    typeof raw.savedAt === "string" ? raw.savedAt : new Date(statSync(file).mtimeMs).toISOString();

  /** 스냅샷을 도면으로 읽는다 — 사진 참조를 다시 채운 뒤 검사한다. */
  const readEnvelope = (file: string): HistoryEnvelope | null => {
    const raw = readRaw(file);
    if (!raw) return null;
    const project = sanitizeProject(photos.inline(raw.project));
    if (!project) return null;
    return {
      revision: typeof raw.revision === "number" ? raw.revision : 0,
      savedAt: savedAtOf(raw, file),
      author: cleanAuthor(raw.author),
      project,
    };
  };

  /**
   * 목록에 보일 요약만 읽는다 — 사진 파일을 열지 않는다. 이력 목록은 판마다
   * 한 번씩 부르므로 여기서 도면 전체를 살리면 판 수만큼 사진을 읽게 된다.
   */
  const readMeta = (file: string, revision: number): RevisionMeta | null => {
    const raw = readRaw(file);
    if (!raw) return null;
    const project = raw.project as Record<string, unknown>;
    if (!project || typeof project !== "object") return null;
    const pages = Array.isArray(project.pages) ? project.pages.length : project.equipment ? 1 : 0;
    if (pages === 0) return null;
    return {
      revision,
      savedAt: savedAtOf(raw, file),
      author: cleanAuthor(raw.author),
      title: typeof project.title === "string" ? project.title : "",
      pages,
      file,
    };
  };

  const historyFiles = (id: string): Array<{ revision: number; file: string; name: string }> => {
    const folder = historyDirOf(id);
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({ revision: Number.parseInt(name.split("_")[0], 10), file: join(folder, name), name }))
      .filter((entry) => Number.isFinite(entry.revision))
      .sort((a, b) => a.revision - b.revision);
  };

  const history = (id: string): RevisionMeta[] =>
    historyFiles(id)
      .map(({ revision, file }) => readMeta(file, revision))
      .filter((entry): entry is RevisionMeta => entry !== null)
      .reverse(); // 최근 것이 위로 온다.

  const latest = (id: string): RevisionMeta | null => history(id)[0] ?? null;

  const writeSnapshot = (id: string, project: ProjectDoc, revision: number, author: string, now: Date): string => {
    const folder = historyDirOf(id);
    mkdirSync(folder, { recursive: true });
    const savedAt = now.toISOString();
    const file = join(folder, `${String(revision).padStart(4, "0")}_${stampOf(now)}.json`);
    // 사진은 .photos/ 로 빼고 참조만 남긴다. 들여쓰기도 하지 않는다 — 사람이 읽는 파일은 도면 파일 쪽이다.
    const envelope: HistoryEnvelope = { revision, savedAt, author, project: photos.externalize(project) };
    writeFileSync(file, `${JSON.stringify(envelope)}\n`, "utf8");
    return savedAt;
  };

  /** 사진이 안에 든 옛 형식 스냅샷을 참조 형식으로 옮긴다. 이미 옮긴 파일은 건드리지 않는다. */
  const migrateSnapshot = (entry: { revision: number; file: string }) => {
    let text: string;
    try {
      text = readFileSync(entry.file, "utf8");
    } catch {
      return;
    }
    if (!text.includes('"data:image/')) return;
    const raw = readRaw(entry.file);
    if (!raw) return;
    const envelope: HistoryEnvelope = {
      revision: typeof raw.revision === "number" ? raw.revision : entry.revision,
      savedAt: savedAtOf(raw, entry.file),
      author: cleanAuthor(raw.author),
      project: photos.externalize(raw.project) as ProjectDoc,
    };
    writeFileSync(entry.file, `${JSON.stringify(envelope)}\n`, "utf8");
  };

  /** 파일 이름의 시각(UTC 날짜)으로 하루 단위를 잡는다. 이름에 시각이 없으면 수정 시각. */
  const dayOf = (entry: { file: string; name: string }): string => {
    const stamp = entry.name.split("_")[1] ?? "";
    if (/^\d{4}-\d{2}-\d{2}/.test(stamp)) return stamp.slice(0, 10);
    return new Date(statSync(entry.file).mtimeMs).toISOString().slice(0, 10);
  };

  /** 아무 스냅샷도 쓰지 않는 사진 파일을 지운다. 도면 파일이 아직 안고 있는 사진은 남긴다. */
  const sweepPhotos = () => {
    const referenced = new Set<string>();
    const collect = (raw: unknown) => {
      for (const name of photos.referencesOf(raw)) referenced.add(name);
    };
    for (const entry of projects.list()) {
      try {
        collect(JSON.parse(readFileSync(entry.path, "utf8")));
      } catch {
        // 읽을 수 없는 도면 파일은 사진도 없다.
      }
      for (const snapshot of historyFiles(entry.projectId)) {
        const raw = readRaw(snapshot.file);
        if (raw) collect(raw.project);
      }
    }
    photos.sweep(referenced);
  };

  /**
   * 이력을 다듬는다 — 저장할 때마다 한 번.
   * 1) 옛 형식 스냅샷을 참조 형식으로 옮긴다.
   * 2) 최근 `keepRecent` 판은 모두 남기고, 그 앞은 하루에 마지막 한 판만 남긴다.
   * 3) 그래도 `maxBytes` 를 넘으면 오래된 판부터 지운다(최근 판은 지우지 않는다).
   */
  const prune = (id: string) => {
    const files = historyFiles(id);
    if (files.length === 0) return;
    for (const entry of files) migrateSnapshot(entry);

    const recent = files.slice(-keepRecent);
    const older = files.slice(0, Math.max(0, files.length - keepRecent));
    const keep = new Set(recent.map((entry) => entry.file));

    const lastOfDay = new Map<string, string>();
    for (const entry of older) lastOfDay.set(dayOf(entry), entry.file); // 오름차순이라 마지막이 남는다.
    for (const file of lastOfDay.values()) keep.add(file);

    let removed = 0;
    for (const entry of older) {
      if (keep.has(entry.file)) continue;
      rmSync(entry.file, { force: true });
      removed += 1;
    }

    const survivors = files.filter((entry) => keep.has(entry.file));
    let total = survivors.reduce((sum, entry) => sum + statSync(entry.file).size, 0);
    for (const entry of survivors) {
      if (total <= maxBytes) break;
      if (recent.some((r) => r.file === entry.file)) break;
      total -= statSync(entry.file).size;
      rmSync(entry.file, { force: true });
      removed += 1;
    }

    if (removed > 0) sweepPhotos();
  };

  const read = (id: string): LoadedProject => {
    const project = projects.read(id);
    const head = latest(id);
    return {
      id,
      project,
      revision: head?.revision ?? 0,
      savedAt: head?.savedAt ?? null,
      author: head?.author ?? null,
      externalChange: head ? hashOf(project) !== hashOf(readEnvelope(head.file)?.project ?? project) : false,
    };
  };

  const commit = (id: string, project: ProjectDoc, author: string, now: Date, revision: number): SaveSuccess => {
    const savedAt = writeSnapshot(id, project, revision, author, now);
    projects.write(id, project);
    prune(id);
    return { ok: true, id, revision, savedAt, author, copied: false };
  };

  return {
    dir,
    projects,
    history,
    compact: prune,

    list(): ProjectListEntry[] {
      return projects.list().map((entry) => {
        const head = latest(entry.projectId);
        return {
          id: entry.projectId,
          title: entry.title,
          pages: entry.pages,
          revision: head?.revision ?? 0,
          savedAt: head?.savedAt ?? null,
          author: head?.author ?? null,
        };
      });
    },

    read,

    snapshot(id: string, revision: number): ProjectDoc {
      const target = history(id).find((entry) => entry.revision === revision);
      if (!target) throw new ApiError(404, `리비전을 찾을 수 없습니다: ${revision}`);
      const envelope = readEnvelope(target.file);
      if (!envelope) throw new ApiError(500, "이력 파일을 읽을 수 없습니다.");
      return envelope.project;
    },

    save(request: SaveRequest): SaveResult {
      const project = sanitizeProject(request.project);
      if (!project) throw new ApiError(400, "배치도 형식이 아닙니다.");

      const author = cleanAuthor(request.author);
      const now = request.now ?? new Date();
      const mode: SaveMode = request.mode ?? "save";
      const exists = existsSync(projects.path(request.id));

      // 사본으로 저장 — 남의 작업을 건드리지 않고 내 것으로 떼어 낸다.
      if (mode === "copy") {
        const id = projects.allocateId(`${request.id}-사본`);
        return { ...commit(id, project, author, now, 1), copied: true };
      }

      const head = exists ? latest(request.id) : null;
      const current = head?.revision ?? 0;
      const headProject = head ? (readEnvelope(head.file)?.project ?? null) : null;
      const headHash = headProject ? hashOf(headProject) : null;
      // 도면 파일이 마지막 판과 다르면 편집기 밖에서(MCP · 손편집) 바뀐 것이다.
      const outside = exists && headHash !== null && hashOf(projects.read(request.id)) !== headHash;

      if (mode === "save" && exists) {
        const base = typeof request.baseRevision === "number" ? request.baseRevision : current;

        if (base !== current || outside) {
          return {
            ok: false,
            reason: "conflict",
            revision: current,
            savedAt: head?.savedAt ?? null,
            author: head?.author ?? null,
            externalChange: outside,
            message: outside
              ? "이 도면이 편집기 밖에서(MCP · 파일 편집) 바뀌었습니다. 덮어쓸지 사본으로 저장할지 골라 주십시오."
              : `${head?.author ?? "다른 사용자"} 님이 먼저 저장했습니다(리비전 ${current}). 덮어쓸지 사본으로 저장할지 골라 주십시오.`,
          };
        }
      }

      // 마지막 판과 같은 내용이고 도면 파일도 그 판 그대로면 새 판을 만들지 않는다 —
      // 같은 스냅샷이 쌓이면 이력이 길어지기만 하고 되돌릴 곳은 늘지 않는다.
      if (head && headHash !== null && !outside && hashOf(project) === headHash) {
        return {
          ok: true,
          id: request.id,
          revision: current,
          savedAt: head.savedAt,
          author: head.author,
          copied: false,
          unchanged: true,
        };
      }

      return commit(request.id, project, author, now, current + 1);
    },

    restore(id: string, revision: number, author?: string, now?: Date): SaveSuccess {
      const target = history(id).find((entry) => entry.revision === revision);
      if (!target) throw new ApiError(404, `리비전을 찾을 수 없습니다: ${revision}`);

      const envelope = readEnvelope(target.file);
      if (!envelope) throw new ApiError(500, "이력 파일을 읽을 수 없습니다.");

      // 되돌리기도 하나의 저장이다. 이력을 지우지 않고 새 리비전으로 쌓는다.
      const stamp = now ?? new Date();
      const next = (latest(id)?.revision ?? 0) + 1;
      return commit(id, envelope.project, `${cleanAuthor(author)} (r${revision} 복원)`, stamp, next);
    },

    create(title: string, author?: string, now?: Date) {
      const clean = typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : "격자형 배치 프로젝트";
      const id = projects.allocateId(clean);
      // 편집기와 같은 초기 문서(첫 페이지 · 기본 팔레트)를 쓴다. 여기서만 다른
      // 기본값을 만들면 화면에서 새로 만든 도면과 달라진다.
      const project = createProject(clean);
      return { ...commit(id, project, cleanAuthor(author), now ?? new Date(), 1), project };
    },
  };
}
