import { z } from "zod";

import { MAX_COLS, MAX_ROWS, MIN_COLS, MIN_ROWS, createProject } from "../../app/editor/doc";
import { createRevisionStore } from "../../server/revisions";
import { defaultPaper } from "../../app/editor/paper";
import { pickPage, summarizeProject } from "../helpers";
import { ToolError, type ToolDef } from "../types";

const PAPER_IDS = ["a4", "a3", "a2", "letter"] as const;

const CreateInput = z.object({
  title: z.string().min(1).max(120).describe("프로젝트 제목"),
  width: z
    .number()
    .int()
    .min(MIN_COLS)
    .max(MAX_COLS)
    .default(48)
    .describe(`격자 가로 칸 수 (${MIN_COLS}~${MAX_COLS})`),
  height: z
    .number()
    .int()
    .min(MIN_ROWS)
    .max(MAX_ROWS)
    .default(30)
    .describe(`격자 세로 칸 수 (${MIN_ROWS}~${MAX_ROWS})`),
  pageName: z.string().min(1).max(60).optional().describe("첫 페이지 이름 (기본: 제목)"),
  paperSize: z.enum(PAPER_IDS).optional().describe("인쇄 용지. 지정하면 인쇄 경계선 설정이 붙는다"),
  orientation: z.enum(["portrait", "landscape"]).default("landscape").describe("용지 방향"),
  cellMm: z.number().min(1).max(50).default(5).describe("인쇄물에서 한 칸이 차지할 길이(mm)"),
  marginMm: z.number().min(0).max(50).default(10).describe("용지 사방 여백(mm)"),
  projectId: z.string().optional().describe("저장 파일 이름. 생략하면 제목에서 만든다"),
});

const GetInput = z.object({
  projectId: z.string().describe("프로젝트 ID"),
  pageId: z.string().optional().describe("이 페이지의 셀 내용까지 함께 받을 때 지정"),
  includeCells: z.boolean().default(false).describe("true 면 해당 페이지의 셀 맵 전체를 함께 돌려준다"),
});

const ListInput = z.object({});

export const createProjectTool: ToolDef = {
  name: "grid_create_project",
  title: "도면 만들기",
  description:
    "새 격자 배치도 프로젝트를 만들고 JSON 파일로 저장한다. 저장된 파일은 Grid Tile Editor 의 'JSON 불러오기' 로 그대로 열 수 있다.",
  inputSchema: CreateInput.shape,
  handler(rawArgs, store) {
    const args = CreateInput.parse(rawArgs);
    const project = createProject(args.title);
    const page = project.pages[0];

    page.name = args.pageName?.trim() || args.title.trim();
    page.cols = args.width;
    page.rows = args.height;
    if (args.paperSize) {
      page.paper = {
        ...defaultPaper(args.paperSize),
        orientation: args.orientation,
        cellMm: args.cellMm,
        marginMm: args.marginMm,
      };
    }

    const projectId = args.projectId?.trim() || store.allocateId(args.title);

    // 만들 때 첫 리비전(r1)을 함께 남긴다. 되돌릴 기준점이 없으면 grid_diff ·
    // grid_restore 가 쓸 자리가 없다.
    const revisions = createRevisionStore(store.dir);
    const saved = revisions.save({ id: projectId, project, mode: "overwrite", author: "MCP" });
    if (!saved.ok) throw new ToolError("도면을 만들지 못했습니다.");

    return {
      projectId,
      path: store.path(projectId),
      revision: saved.revision,
      project: summarizeProject(project),
    };
  },
};

export const getProjectTool: ToolDef = {
  name: "grid_get_project",
  title: "도면 읽기",
  description:
    "프로젝트의 메타데이터, 팔레트 목록, 페이지 목록을 돌려준다. includeCells 를 켜면 지정한 페이지의 셀 맵도 함께 준다.",
  inputSchema: GetInput.shape,
  handler(rawArgs, store) {
    const args = GetInput.parse(rawArgs);
    const project = store.read(args.projectId);
    const summary = summarizeProject(project);

    if (!args.includeCells) {
      return { projectId: args.projectId, path: store.path(args.projectId), ...summary };
    }

    const page = pickPage(project, args.pageId);
    return {
      projectId: args.projectId,
      path: store.path(args.projectId),
      ...summary,
      cells: {
        pageId: page.id,
        background: page.background,
        equipment: page.equipment,
        wiring: page.wiring,
      },
    };
  },
};

export const listProjectsTool: ToolDef = {
  name: "grid_list_projects",
  title: "도면 목록",
  description: "저장 폴더에 있는 프로젝트 목록을 돌려준다.",
  inputSchema: ListInput.shape,
  handler(_rawArgs, store) {
    return { dir: store.dir, projects: store.list() };
  },
};
