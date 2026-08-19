import { z } from "zod";

import { cellKey, eraseCellsOnPage, paintCellsOnPage, updateEquipmentInfoOnPage } from "../../app/editor/doc";
import type { LayerId } from "../../app/editor/palette";
import { rectFillPoints, rectOutlinePoints } from "../../app/editor/shapes";
import { assertInside, pickItem, pickPage, replacePage, summarizePage } from "../helpers";
import { ToolError, type ToolDef } from "../types";

const LAYERS = ["background", "equipment", "wiring"] as const;

const SetCellInput = z.object({
  projectId: z.string().describe("프로젝트 ID"),
  pageId: z.string().optional().describe("페이지 ID. 생략하면 활성 페이지"),
  x: z.number().int().min(0).describe("가로 좌표(열). 0부터"),
  y: z.number().int().min(0).describe("세로 좌표(행). 0부터"),
  paletteId: z.string().optional().describe("칠할 팔레트 항목 ID. 항목의 분류에 따라 레이어가 정해진다"),
  label: z.string().max(24).optional().describe("장비 ID. 빈 문자열이면 지운다"),
  memo: z.string().max(500).optional().describe("칸 메모. 빈 문자열이면 지운다"),
  eraseLayer: z.enum(LAYERS).optional().describe("이 레이어의 내용을 지운다"),
});

const FillAreaInput = z.object({
  projectId: z.string().describe("프로젝트 ID"),
  pageId: z.string().optional().describe("페이지 ID. 생략하면 활성 페이지"),
  x1: z.number().int().min(0).describe("시작 가로 좌표"),
  y1: z.number().int().min(0).describe("시작 세로 좌표"),
  x2: z.number().int().min(0).describe("끝 가로 좌표(포함)"),
  y2: z.number().int().min(0).describe("끝 세로 좌표(포함)"),
  paletteId: z.string().optional().describe("칠할 팔레트 항목 ID. eraseLayer 를 쓸 때는 생략"),
  outline: z.boolean().default(false).describe("true 면 테두리만 그린다"),
  eraseLayer: z.enum(LAYERS).optional().describe("칠하는 대신 이 레이어를 지운다"),
});

export const setCellTool: ToolDef = {
  name: "grid_set_cell",
  title: "칸 설정",
  description:
    "한 칸에 팔레트 항목을 칠하고 장비 ID·메모를 붙인다. paletteId · label · memo · eraseLayer 를 한 번에 섞어 쓸 수 있다.",
  inputSchema: SetCellInput.shape,
  handler(rawArgs, store) {
    const args = SetCellInput.parse(rawArgs);
    if (!args.paletteId && args.label === undefined && args.memo === undefined && !args.eraseLayer) {
      throw new ToolError("paletteId · label · memo · eraseLayer 중 하나는 있어야 합니다.");
    }

    const project = store.read(args.projectId);
    let page = pickPage(project, args.pageId);
    assertInside(page, args.x, args.y);

    const point = { x: args.x, y: args.y };

    if (args.eraseLayer) {
      page = eraseCellsOnPage(page, args.eraseLayer as LayerId, [point]);
    }
    if (args.paletteId) {
      page = paintCellsOnPage(page, pickItem(project, args.paletteId), [point]);
    }
    if (args.label !== undefined || args.memo !== undefined) {
      page = updateEquipmentInfoOnPage(page, cellKey(args.x, args.y), {
        ...(args.label !== undefined ? { label: args.label } : {}),
        ...(args.memo !== undefined ? { memo: args.memo } : {}),
      });
    }

    const next = replacePage(project, page);
    const path = store.write(args.projectId, next);

    return {
      projectId: args.projectId,
      path,
      pageId: page.id,
      cell: {
        x: args.x,
        y: args.y,
        background: page.background[cellKey(args.x, args.y)] ?? null,
        equipment: page.equipment[cellKey(args.x, args.y)] ?? null,
        wiring: page.wiring[cellKey(args.x, args.y)] ?? null,
      },
    };
  },
};

export const fillAreaTool: ToolDef = {
  name: "grid_fill_area",
  title: "영역 채우기",
  description:
    "직사각형 영역을 팔레트 항목으로 한 번에 채우거나(outline 이면 테두리만) 특정 레이어를 한 번에 지운다.",
  inputSchema: FillAreaInput.shape,
  handler(rawArgs, store) {
    const args = FillAreaInput.parse(rawArgs);
    if (!args.paletteId && !args.eraseLayer) {
      throw new ToolError("paletteId 또는 eraseLayer 가 있어야 합니다.");
    }

    const project = store.read(args.projectId);
    let page = pickPage(project, args.pageId);
    assertInside(page, args.x1, args.y1);
    assertInside(page, args.x2, args.y2);

    const a = { x: args.x1, y: args.y1 };
    const b = { x: args.x2, y: args.y2 };
    const points = args.outline ? rectOutlinePoints(a, b) : rectFillPoints(a, b);

    if (args.eraseLayer) {
      page = eraseCellsOnPage(page, args.eraseLayer as LayerId, points);
    } else if (args.paletteId) {
      page = paintCellsOnPage(page, pickItem(project, args.paletteId), points);
    }

    const next = replacePage(project, page);
    const path = store.write(args.projectId, next);

    return {
      projectId: args.projectId,
      path,
      pageId: page.id,
      affectedCells: points.length,
      page: summarizePage(page),
    };
  },
};
