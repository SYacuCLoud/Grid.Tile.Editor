import { z } from "zod";

import {
  MAX_COLS,
  MAX_ROWS,
  MIN_COLS,
  MIN_ROWS,
  addPageToProject,
  deletePageFromProject,
  nextPageId,
  renamePageInProject,
  resizePage,
  switchActivePage,
} from "../../app/editor/doc";
import { pickPage, replacePage, summarizeProject } from "../helpers";
import { ToolError, type ToolDef } from "../types";

const ManagePagesInput = z.object({
  projectId: z.string().describe("프로젝트 ID"),
  action: z.enum(["add", "duplicate", "delete", "rename", "activate", "resize"]).describe("할 일"),
  pageId: z.string().optional().describe("duplicate · delete · rename · activate · resize 의 대상 페이지"),
  name: z.string().min(1).max(60).optional().describe("add · duplicate · rename 에 쓸 페이지 이름"),
  width: z.number().int().min(MIN_COLS).max(MAX_COLS).optional().describe("resize 의 가로 칸 수"),
  height: z.number().int().min(MIN_ROWS).max(MAX_ROWS).optional().describe("resize 의 세로 칸 수"),
});

/** 겹치지 않는 복제본 이름. `1공장` → `1공장 사본`, 이미 있으면 `1공장 사본 2`. */
function copyName(used: Set<string>, base: string): string {
  const first = `${base} 사본`;
  if (!used.has(first)) return first;
  for (let n = 2; ; n += 1) {
    const candidate = `${first} ${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export const managePagesTool: ToolDef = {
  name: "grid_manage_pages",
  title: "페이지 관리",
  description:
    "페이지를 추가·복제·삭제·이름변경·전환·크기변경 한다. 페이지마다 격자 크기·셀·메모·용지 설정이 독립이고, 팔레트만 공용이다.",
  inputSchema: ManagePagesInput.shape,
  handler(rawArgs, store) {
    const args = ManagePagesInput.parse(rawArgs);
    const project = store.read(args.projectId);

    let next = project;

    switch (args.action) {
      case "add": {
        next = addPageToProject(project, args.name);
        break;
      }
      case "duplicate": {
        const source = pickPage(project, args.pageId);
        const id = nextPageId(project.pages);
        const used = new Set(project.pages.map((page) => page.name));
        const copy = {
          ...source,
          id,
          name: args.name?.trim() || copyName(used, source.name),
          background: { ...source.background },
          equipment: Object.fromEntries(
            Object.entries(source.equipment).map(([key, cell]) => [key, { ...cell }]),
          ),
          wiring: { ...source.wiring },
          ...(source.paper ? { paper: { ...source.paper } } : {}),
        };
        next = { ...project, pages: [...project.pages, copy], activePageId: id };
        break;
      }
      case "delete": {
        const target = pickPage(project, args.pageId);
        if (project.pages.length <= 1) throw new ToolError("페이지는 최소 1개가 남아야 합니다.");
        next = deletePageFromProject(project, target.id);
        break;
      }
      case "rename": {
        const target = pickPage(project, args.pageId);
        if (!args.name) throw new ToolError("rename 에는 name 이 필요합니다.");
        next = renamePageInProject(project, target.id, args.name);
        break;
      }
      case "activate": {
        const target = pickPage(project, args.pageId);
        next = switchActivePage(project, target.id);
        break;
      }
      case "resize": {
        const target = pickPage(project, args.pageId);
        if (args.width === undefined || args.height === undefined) {
          throw new ToolError("resize 에는 width 와 height 가 필요합니다.");
        }
        next = replacePage(project, resizePage(target, args.width, args.height));
        break;
      }
    }

    const path = store.write(args.projectId, next);
    return {
      projectId: args.projectId,
      path,
      action: args.action,
      activePageId: next.activePageId,
      pages: summarizeProject(next).pages,
    };
  },
};
