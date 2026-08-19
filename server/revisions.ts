/**
 * 로컬 폴더 기반 도면 공유와 가벼운 버전 관리.
 *
 * 저장 위치는 MCP 서버와 같은 `.grid-projects/` 다. 도면 파일 자체는 편집기가
 * 내보내는 JSON 그대로라 사람이 열어 봐도 되고, MCP 로 고친 것도 그대로 보인다.
 *
 * 이력은 그 옆 `.grid-projects/.history/<id>/<rev>_<timestamp>.json` 에 쌓는다.
 * 리비전 번호는 이력 파일에서 읽으므로 따로 관리하는 상태가 없다 — 폴더를
 * 통째로 복사해도, 다른 사람 것과 합쳐도 계산이 어긋나지 않는다.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createProject, type ProjectDoc } from "../app/editor/doc";
import { sanitizeProject } from "../app/editor/storage";
import { createStore, type ProjectStore } from "../mcp/store";

export const HISTORY_DIR = ".history";

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

export function createRevisionStore(dirInput?: string): RevisionStore {
  const projects = createStore(dirInput);
  const dir = projects.dir;
  const historyRoot = join(dir, HISTORY_DIR);

  const historyDirOf = (id: string) => {
    // 경로 검사는 프로젝트 저장소와 같은 규칙을 쓴다.
    projects.path(id);
    return join(historyRoot, id);
  };

  const readEnvelope = (file: string): HistoryEnvelope | null => {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<HistoryEnvelope> & Record<string, unknown>;
      // 봉투 없이 도면만 들어 있는 파일도 받아 준다(손으로 넣어 둔 백업 등).
      const project = sanitizeProject(raw.project ?? raw);
      if (!project) return null;
      return {
        revision: typeof raw.revision === "number" ? raw.revision : 0,
        savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date(statSync(file).mtimeMs).toISOString(),
        author: cleanAuthor(raw.author),
        project,
      };
    } catch {
      return null;
    }
  };

  const historyFiles = (id: string): Array<{ revision: number; file: string }> => {
    const folder = historyDirOf(id);
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({ revision: Number.parseInt(name.split("_")[0], 10), file: join(folder, name) }))
      .filter((entry) => Number.isFinite(entry.revision))
      .sort((a, b) => a.revision - b.revision);
  };

  const history = (id: string): RevisionMeta[] =>
    historyFiles(id)
      .map(({ revision, file }) => {
        const envelope = readEnvelope(file);
        if (!envelope) return null;
        return {
          revision,
          savedAt: envelope.savedAt,
          author: envelope.author,
          title: envelope.project.title,
          pages: envelope.project.pages.length,
          file,
        } satisfies RevisionMeta;
      })
      .filter((entry): entry is RevisionMeta => entry !== null)
      .reverse(); // 최근 것이 위로 온다.

  const latest = (id: string): RevisionMeta | null => history(id)[0] ?? null;

  const writeSnapshot = (id: string, project: ProjectDoc, revision: number, author: string, now: Date): string => {
    const folder = historyDirOf(id);
    mkdirSync(folder, { recursive: true });
    const savedAt = now.toISOString();
    const file = join(folder, `${String(revision).padStart(4, "0")}_${stampOf(now)}.json`);
    const envelope: HistoryEnvelope = { revision, savedAt, author, project };
    writeFileSync(file, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    return savedAt;
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
    return { ok: true, id, revision, savedAt, author, copied: false };
  };

  return {
    dir,
    projects,
    history,

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

      if (mode === "save" && exists) {
        const base = typeof request.baseRevision === "number" ? request.baseRevision : current;
        const outside =
          head !== null && hashOf(projects.read(request.id)) !== hashOf(readEnvelope(head.file)?.project ?? project);

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
