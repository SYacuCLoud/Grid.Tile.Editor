import { z } from "zod";

import {
  addPaletteEntry,
  deleteItemInProject,
  updatePaletteEntry,
  usageCountInProject,
  validateInput,
} from "../../app/editor/paletteOps";
import { pickItem, summarizeProject } from "../helpers";
import { ToolError, type ToolDef } from "../types";

const EDITABLE_ROLES = ["status", "kind", "wire"] as const;

const ManagePaletteInput = z.object({
  projectId: z.string().describe("프로젝트 ID"),
  action: z.enum(["add", "update", "delete"]).describe("할 일"),
  role: z
    .enum(EDITABLE_ROLES)
    .optional()
    .describe("add 일 때 필수. status=상태색 · kind=장비 이름 · wire=배선"),
  paletteId: z.string().optional().describe("update · delete 일 때 필수"),
  name: z.string().max(24).optional().describe("디스플레이 이름. 장비는 이 이름이 칸에 찍힌다"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "색은 #rrggbb 형식이어야 합니다.")
    .optional()
    .describe("색 (#rrggbb)"),
  description: z.string().max(60).optional().describe("설명. PNG 범례에 이름과 함께 나온다"),
  deleteMode: z
    .enum(["keepCells", "purgeCells"])
    .default("keepCells")
    .describe("delete 일 때: keepCells=칸은 그대로 두고 목록에서만 숨김 · purgeCells=배치된 칸까지 비움"),
});

export const managePaletteTool: ToolDef = {
  name: "grid_manage_palette",
  title: "팔레트 관리",
  description:
    "커스텀 상태·장비·배선 팔레트 항목을 추가·수정·삭제한다. 팔레트는 프로젝트 공용이라 모든 페이지가 함께 쓴다.",
  inputSchema: ManagePaletteInput.shape,
  handler(rawArgs, store) {
    const args = ManagePaletteInput.parse(rawArgs);
    const project = store.read(args.projectId);

    if (args.action === "add") {
      if (!args.role) throw new ToolError("add 에는 role 이 필요합니다.");
      if (!args.name) throw new ToolError("add 에는 name 이 필요합니다.");
      const input = { name: args.name, color: args.color ?? "#1f6fb2", description: args.description ?? "" };
      const problem = validateInput(project.palette, args.role, input);
      if (problem) throw new ToolError(problem);

      const { palette, created } = addPaletteEntry(project.palette, args.role, input);
      const next = { ...project, palette };
      const path = store.write(args.projectId, next);
      return { projectId: args.projectId, path, action: "add", item: created };
    }

    if (!args.paletteId) throw new ToolError(`${args.action} 에는 paletteId 가 필요합니다.`);
    const target = pickItem(project, args.paletteId);

    if (args.action === "update") {
      if (target.role === "tile") throw new ToolError("배경 타일은 고정 항목이라 고칠 수 없습니다.");
      const input = {
        name: args.name ?? target.name,
        color: args.color ?? target.color ?? "#1f6fb2",
        description: args.description ?? target.description ?? "",
      };
      const problem = validateInput(project.palette, target.role, input, target.id);
      if (problem) throw new ToolError(problem);

      const palette = updatePaletteEntry(project.palette, target.id, input);
      const next = { ...project, palette };
      const path = store.write(args.projectId, next);
      return {
        projectId: args.projectId,
        path,
        action: "update",
        item: palette.find((item) => item.id === target.id),
      };
    }

    // delete
    if (target.role === "tile") throw new ToolError("배경 타일은 고정 항목이라 지울 수 없습니다.");
    const usedCells = usageCountInProject(project, target);
    const next = deleteItemInProject(project, target.id, args.deleteMode);
    const path = store.write(args.projectId, next);

    return {
      projectId: args.projectId,
      path,
      action: "delete",
      deleteMode: args.deleteMode,
      usedCells,
      /** keepCells 로 지운 사용 중 항목은 정의가 남는다(retired). */
      definitionKept: next.palette.some((item) => item.id === target.id),
      palette: summarizeProject(next).palette,
    };
  },
};
