import { type PageDoc, type ProjectDoc, cellCount } from "../app/editor/doc";
import type { PaletteId, PaletteItem } from "../app/editor/palette";
import { ToolError } from "./types";

/** `pageId` 가 없으면 활성 페이지를 쓴다. */
export function pickPage(project: ProjectDoc, pageId?: string): PageDoc {
  if (!pageId) {
    const active = project.pages.find((page) => page.id === project.activePageId);
    if (!active) throw new ToolError("활성 페이지를 찾을 수 없습니다.");
    return active;
  }
  const page = project.pages.find((item) => item.id === pageId);
  if (!page) {
    const known = project.pages.map((item) => item.id).join(", ");
    throw new ToolError(`페이지를 찾을 수 없습니다: ${pageId} (있는 페이지: ${known})`);
  }
  return page;
}

/** 페이지 하나를 project 안에서 바꾼 새 프로젝트를 만든다. */
export function replacePage(project: ProjectDoc, next: PageDoc): ProjectDoc {
  return { ...project, pages: project.pages.map((page) => (page.id === next.id ? next : page)) };
}

export function pickItem(project: ProjectDoc, paletteId: PaletteId): PaletteItem {
  const item = project.palette.find((entry) => entry.id === paletteId);
  if (!item) {
    const known = project.palette.map((entry) => entry.id).join(", ");
    throw new ToolError(`팔레트 항목을 찾을 수 없습니다: ${paletteId} (있는 항목: ${known})`);
  }
  return item;
}

export function assertInside(page: PageDoc, x: number, y: number): void {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new ToolError("좌표는 정수여야 합니다.");
  }
  if (x < 0 || y < 0 || x >= page.cols || y >= page.rows) {
    throw new ToolError(`좌표가 격자 밖입니다: (${x}, ${y}) — 격자는 ${page.cols} × ${page.rows} 입니다.`);
  }
}

export interface PageSummary {
  id: string;
  name: string;
  cols: number;
  rows: number;
  cells: { background: number; equipment: number; wiring: number };
  paper: PageDoc["paper"] | null;
}

export function summarizePage(page: PageDoc): PageSummary {
  return {
    id: page.id,
    name: page.name,
    cols: page.cols,
    rows: page.rows,
    cells: cellCount(page),
    paper: page.paper ?? null,
  };
}

export interface ProjectSummary {
  title: string;
  version: number;
  activePageId: string;
  pages: PageSummary[];
  palette: Array<Pick<PaletteItem, "id" | "name" | "role" | "layer" | "color" | "description" | "retired">>;
}

export function summarizeProject(project: ProjectDoc): ProjectSummary {
  return {
    title: project.title,
    version: project.version,
    activePageId: project.activePageId,
    pages: project.pages.map(summarizePage),
    palette: project.palette.map((item) => ({
      id: item.id,
      name: item.name,
      role: item.role,
      layer: item.layer,
      color: item.color,
      description: item.description,
      retired: item.retired,
    })),
  };
}
