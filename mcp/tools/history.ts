import { z } from "zod";

import { diffProjects, summarizeDiff } from "../../app/editor/diff";
import { createRevisionStore, type RevisionStore } from "../../server/revisions";
import type { ProjectStore } from "../store";
import { ToolError, type ToolDef } from "../types";

/**
 * 이력 도구는 도면 파일 옆의 `.history/` 를 함께 본다.
 *
 * 다른 도구는 프로젝트 파일만 다루므로 `ProjectStore` 를 받는다. 여기서는 같은
 * 폴더를 가리키는 리비전 저장소를 그 자리에서 만들어 쓴다 — 편집기의 `서버 저장`
 * 과 완전히 같은 이력을 본다.
 */
function revisions(store: ProjectStore): RevisionStore {
  return createRevisionStore(store.dir);
}

const HistoryInput = z.object({
  projectId: z.string().describe("프로젝트 ID"),
  limit: z.number().int().min(1).max(200).default(30).describe("최근 몇 건까지 볼지"),
});

const RestoreInput = z.object({
  projectId: z.string().describe("프로젝트 ID"),
  revision: z.number().int().min(1).describe("되돌릴 리비전 번호"),
  author: z.string().max(24).optional().describe("되돌린 사람 이름. 이력에 남는다"),
});

const DiffInput = z.object({
  projectId: z.string().describe("프로젝트 ID"),
  from: z.number().int().min(1).describe("비교 기준 리비전"),
  to: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("비교 대상 리비전. 생략하면 지금 파일(저장 안 된 바깥 수정까지 포함)과 비교한다"),
  includeCells: z.boolean().default(false).describe("true 면 달라진 칸 목록까지 돌려준다"),
  maxCells: z.number().int().min(1).max(2000).default(200).describe("칸 목록을 최대 몇 개까지 담을지"),
});

export const historyTool: ToolDef = {
  name: "grid_history",
  title: "버전 이력",
  description: "도면의 리비전 목록을 최근 순으로 돌려준다. 저장 시각 · 작성자 · 제목 · 페이지 수를 함께 준다.",
  inputSchema: HistoryInput.shape,
  handler(rawArgs, store) {
    const args = HistoryInput.parse(rawArgs);
    const revision = revisions(store);
    const loaded = revision.read(args.projectId);
    const all = revision.history(args.projectId);

    return {
      projectId: args.projectId,
      current: loaded.revision,
      /** 이력과 실제 파일이 다르면 편집기 밖에서(MCP · 손편집) 고쳐진 것이다. */
      externalChange: loaded.externalChange,
      total: all.length,
      revisions: all.slice(0, args.limit).map((entry) => ({
        revision: entry.revision,
        savedAt: entry.savedAt,
        author: entry.author,
        title: entry.title,
        pages: entry.pages,
      })),
    };
  },
};

export const restoreTool: ToolDef = {
  name: "grid_restore",
  title: "과거 버전 복원",
  description:
    "고른 리비전의 내용으로 도면을 되돌린다. 이력을 지우지 않고 그 내용을 새 리비전으로 다시 쌓으므로 되돌리기도 되돌릴 수 있다.",
  inputSchema: RestoreInput.shape,
  handler(rawArgs, store) {
    const args = RestoreInput.parse(rawArgs);
    const revision = revisions(store);
    const before = revision.read(args.projectId);
    const result = revision.restore(args.projectId, args.revision, args.author ?? "MCP");
    const after = revision.read(args.projectId);

    return {
      projectId: args.projectId,
      restoredFrom: args.revision,
      revision: result.revision,
      savedAt: result.savedAt,
      author: result.author,
      /** 되돌리기로 무엇이 바뀌었는지 한 줄 요약. */
      summary: summarizeDiff(diffProjects(before.project, after.project)),
    };
  },
};

const CheckpointInput = z.object({
  projectId: z.string().describe("프로젝트 ID"),
  author: z.string().max(24).optional().describe("남길 사람 이름. 이력에 적힌다"),
});

export const checkpointTool: ToolDef = {
  name: "grid_checkpoint",
  title: "지금 상태를 리비전으로 남기기",
  description:
    "지금 파일 내용을 새 리비전으로 이력에 남긴다. 다른 도구(칸 칠하기 · 팔레트 · 페이지)는 파일만 고치고 이력을 만들지 않으므로, 되돌릴 자리를 잡아 두려면 이 도구를 부른다.",
  inputSchema: CheckpointInput.shape,
  handler(rawArgs, store) {
    const args = CheckpointInput.parse(rawArgs);
    const revision = revisions(store);
    const loaded = revision.read(args.projectId);
    const saved = revision.save({
      id: args.projectId,
      project: loaded.project,
      mode: "overwrite",
      author: args.author ?? "MCP",
    });
    if (!saved.ok) throw new ToolError("리비전을 남기지 못했습니다.");

    return { projectId: args.projectId, revision: saved.revision, savedAt: saved.savedAt, author: saved.author };
  },
};

export const diffTool: ToolDef = {
  name: "grid_diff",
  title: "리비전 비교",
  description:
    "두 리비전(또는 한 리비전과 지금 파일)을 칸 단위로 비교한다. 추가 · 삭제 · 변경 칸 수와 페이지 · 팔레트 변화를 돌려준다.",
  inputSchema: DiffInput.shape,
  handler(rawArgs, store) {
    const args = DiffInput.parse(rawArgs);
    const revision = revisions(store);

    const pick = (target: number) => {
      const entry = revision.history(args.projectId).find((item) => item.revision === target);
      if (!entry) throw new ToolError(`리비전을 찾을 수 없습니다: ${target}`);
      return revision.snapshot(args.projectId, target);
    };

    const before = pick(args.from);
    const after = args.to === undefined ? revision.read(args.projectId).project : pick(args.to);

    const diff = diffProjects(before, after);
    const cells = diff.pages.flatMap((page) =>
      page.changes.map((change) => ({ pageId: page.pageId, ...change })),
    );

    return {
      projectId: args.projectId,
      from: args.from,
      to: args.to ?? "현재 파일",
      summary: summarizeDiff(diff),
      counts: diff.counts,
      title: diff.title,
      pages: diff.pages.map((page) => ({
        pageId: page.pageId,
        name: page.name,
        status: page.status,
        size: page.size,
        paper: page.paper,
        counts: page.counts,
      })),
      palette: diff.palette,
      ...(args.includeCells
        ? {
            cells: cells.slice(0, args.maxCells),
            /** 잘라낸 몫을 숨기지 않는다. 다 봤다고 오해하면 안 된다. */
            cellsOmitted: Math.max(0, cells.length - args.maxCells),
          }
        : {}),
    };
  },
};
