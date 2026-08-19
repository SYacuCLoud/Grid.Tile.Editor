import { fillAreaTool, setCellTool } from "./cells";
import { managePagesTool } from "./pages";
import { managePaletteTool } from "./palette";
import { exportPreviewTool } from "./preview";
import { createProjectTool, getProjectTool, listProjectsTool } from "./project";
import type { ToolDef } from "../types";

/** MCP 서버가 노출하는 도구 전체. */
export const TOOLS: ToolDef[] = [
  createProjectTool,
  listProjectsTool,
  getProjectTool,
  setCellTool,
  fillAreaTool,
  managePaletteTool,
  managePagesTool,
  exportPreviewTool,
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

export {
  createProjectTool,
  listProjectsTool,
  getProjectTool,
  setCellTool,
  fillAreaTool,
  managePaletteTool,
  managePagesTool,
  exportPreviewTool,
};
