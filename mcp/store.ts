import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ProjectDoc } from "../app/editor/doc";
import { sanitizeProject } from "../app/editor/storage";
import { ToolError } from "./types";

/**
 * 프로젝트 파일 저장소.
 *
 * 파일 하나가 프로젝트 하나이고, 내용은 편집기의 `JSON 내보내기` 와 완전히 같은
 * 형식이다. 여기서 만든 파일을 편집기에서 그대로 열 수 있고, 반대도 된다.
 */
export interface ProjectStore {
  dir: string;
  list(): ProjectSummaryFile[];
  path(projectId: string): string;
  read(projectId: string): ProjectDoc;
  write(projectId: string, project: ProjectDoc): string;
  remove(projectId: string): void;
  /** 이름에서 겹치지 않는 파일 ID 를 만든다. */
  allocateId(title: string): string;
}

export interface ProjectSummaryFile {
  projectId: string;
  title: string;
  pages: number;
  path: string;
}

export const DEFAULT_DATA_DIR = ".grid-projects";

/** 저장 폴더. 환경 변수 `GRID_TILE_DATA_DIR` 로 바꿀 수 있다. */
export function resolveDataDir(explicit?: string): string {
  return resolve(explicit || process.env.GRID_TILE_DATA_DIR || DEFAULT_DATA_DIR);
}

function slugId(title: string): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 32) : "project";
}

/** 파일 이름으로 쓸 수 없는 ID 를 걸러 낸다. 상위 폴더 탈출도 막는다. */
function assertSafeId(projectId: string): void {
  if (!/^[\p{L}\p{N}._-]+$/u.test(projectId)) {
    throw new ToolError(`쓸 수 없는 projectId 입니다: ${projectId}`);
  }
}

export function createStore(dirInput?: string): ProjectStore {
  const dir = resolveDataDir(dirInput);

  const ensureDir = () => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  };

  const path = (projectId: string) => {
    assertSafeId(projectId);
    return join(dir, `${projectId}.json`);
  };

  const read = (projectId: string): ProjectDoc => {
    const file = path(projectId);
    if (!existsSync(file)) throw new ToolError(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    const parsed = sanitizeProject(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed) throw new ToolError(`배치도 파일 형식이 아닙니다: ${file}`);
    return parsed;
  };

  const write = (projectId: string, project: ProjectDoc): string => {
    const file = path(projectId);
    ensureDir();
    writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`, "utf8");
    return file;
  };

  return {
    dir,
    path,
    read,
    write,

    list(): ProjectSummaryFile[] {
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
          const projectId = name.slice(0, -".json".length);
          try {
            const project = read(projectId);
            return { projectId, title: project.title, pages: project.pages.length, path: join(dir, name) };
          } catch {
            return { projectId, title: "(읽을 수 없는 파일)", pages: 0, path: join(dir, name) };
          }
        });
    },

    remove(projectId: string) {
      const file = path(projectId);
      if (!existsSync(file)) throw new ToolError(`프로젝트를 찾을 수 없습니다: ${projectId}`);
      rmSync(file);
    },

    allocateId(title: string): string {
      const base = slugId(title);
      if (!existsSync(join(dir, `${base}.json`))) return base;
      for (let n = 2; ; n += 1) {
        const candidate = `${base}-${n}`;
        if (!existsSync(join(dir, `${candidate}.json`))) return candidate;
      }
    },
  };
}
