import { z } from "zod";

import { cellKey, type PageDoc, type ProjectDoc } from "../../app/editor/doc";
import { type PaletteItem, indexPalette, resolveItem } from "../../app/editor/palette";
import { pickPage } from "../helpers";
import type { ToolDef } from "../types";

const PreviewInput = z.object({
  projectId: z.string().describe("프로젝트 ID"),
  pageId: z.string().optional().describe("페이지 ID. 생략하면 활성 페이지"),
  format: z.enum(["ascii", "svg"]).default("ascii").describe("ascii=텍스트 다이어그램 · svg=벡터 미리보기"),
  cellPx: z.number().int().min(4).max(48).default(14).describe("svg 한 칸 크기(px)"),
  maxCols: z.number().int().min(10).max(200).default(200).describe("ascii 로 그릴 최대 가로 칸 수"),
  maxRows: z.number().int().min(10).max(200).default(200).describe("ascii 로 그릴 최대 세로 칸 수"),
});

/** 분류마다 다른 글자 묶음을 써서, 글자만 보고 무엇인지 짐작할 수 있게 한다. */
const SYMBOLS: Record<string, string> = {
  kind: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  status: "abcdefghijklmnopqrstuvwxyz",
  wire: "123456789",
  tile: "#=%@&$",
};

const EMPTY_CHAR = ".";

interface SymbolTable {
  charOf: Map<string, string>;
  legend: Array<{ char: string; id: string; name: string; role: string }>;
}

/** 페이지에 실제로 쓰인 항목에만 글자를 준다. 안 쓴 항목이 범례를 채우지 않는다. */
function buildSymbols(project: ProjectDoc, page: PageDoc): SymbolTable {
  const index = indexPalette(project.palette);
  const charOf = new Map<string, string>();
  const legend: SymbolTable["legend"] = [];
  const used: Record<string, number> = { kind: 0, status: 0, wire: 0, tile: 0 };

  const assign = (id: string, role: keyof typeof SYMBOLS) => {
    if (charOf.has(id)) return;
    const pool = SYMBOLS[role];
    const taken = used[role];
    const char = taken < pool.length ? pool[taken] : "?";
    used[role] = taken + 1;
    charOf.set(id, char);
    const item: PaletteItem = resolveItem(index, id, role as PaletteItem["role"]);
    legend.push({ char, id, name: item.name, role });
  };

  for (const id of Object.values(page.background)) assign(id, "tile");
  for (const cell of Object.values(page.equipment)) {
    if (cell.status) assign(cell.status, "status");
    if (cell.kind) assign(cell.kind, "kind");
  }
  for (const id of Object.values(page.wiring)) assign(id, "wire");

  return { charOf, legend };
}

/** 한 칸에 찍을 글자. 위에 있는 레이어가 이긴다: 장비 > 상태 > 배선 > 배경. */
function charAt(page: PageDoc, symbols: SymbolTable, x: number, y: number): string {
  const key = cellKey(x, y);
  const cell = page.equipment[key];
  if (cell?.kind) return symbols.charOf.get(cell.kind) ?? "?";
  if (cell?.status) return symbols.charOf.get(cell.status) ?? "?";
  const wire = page.wiring[key];
  if (wire) return symbols.charOf.get(wire) ?? "?";
  const tile = page.background[key];
  if (tile) return symbols.charOf.get(tile) ?? "?";
  return EMPTY_CHAR;
}

function renderAscii(
  project: ProjectDoc,
  page: PageDoc,
  maxCols: number,
  maxRows: number,
): { text: string; truncated: boolean } {
  const symbols = buildSymbols(project, page);
  const cols = Math.min(page.cols, maxCols);
  const rows = Math.min(page.rows, maxRows);
  const truncated = cols < page.cols || rows < page.rows;
  const gutter = String(rows - 1).length;

  const lines: string[] = [];
  lines.push(`${project.title} — ${page.name} (${page.cols} × ${page.rows})`);
  lines.push("");

  // 10칸마다 눈금을 찍어 좌표를 셀 수 있게 한다.
  const ruler = Array.from({ length: cols }, (_, x) => (x % 10 === 0 ? String((x / 10) % 10) : " ")).join("");
  lines.push(`${" ".repeat(gutter + 1)}${ruler}`);

  for (let y = 0; y < rows; y += 1) {
    const row = Array.from({ length: cols }, (_, x) => charAt(page, symbols, x, y)).join("");
    lines.push(`${String(y).padStart(gutter, " ")} ${row}`);
  }

  if (truncated) {
    lines.push("");
    lines.push(`※ ${cols} × ${rows} 까지만 그렸습니다. 전체는 ${page.cols} × ${page.rows} 입니다.`);
  }

  if (symbols.legend.length > 0) {
    lines.push("");
    lines.push("범례");
    for (const entry of symbols.legend) {
      lines.push(`  ${entry.char}  ${entry.name} (${entry.role} · ${entry.id})`);
    }
  }
  lines.push(`  ${EMPTY_CHAR}  빈 칸`);

  return { text: lines.join("\n"), truncated };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSvg(project: ProjectDoc, page: PageDoc, cellPx: number): string {
  const index = indexPalette(project.palette);
  const width = page.cols * cellPx;
  const height = page.rows * cellPx;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  parts.push(`<title>${escapeXml(`${project.title} — ${page.name}`)}</title>`);
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  const rect = (x: number, y: number, fill: string, opacity?: number) =>
    parts.push(
      `<rect x="${x * cellPx}" y="${y * cellPx}" width="${cellPx}" height="${cellPx}" fill="${fill}"${
        opacity === undefined ? "" : ` fill-opacity="${opacity}"`
      }/>`,
    );

  for (const [key, id] of Object.entries(page.background)) {
    const [x, y] = key.split(",").map(Number);
    rect(x, y, resolveItem(index, id, "tile").color ?? "#d7dbdf");
  }
  for (const [key, cell] of Object.entries(page.equipment)) {
    const [x, y] = key.split(",").map(Number);
    if (cell.status) rect(x, y, resolveItem(index, cell.status, "status").color ?? "#c8ced4");
  }
  for (const [key, id] of Object.entries(page.wiring)) {
    const [x, y] = key.split(",").map(Number);
    rect(x, y, resolveItem(index, id, "wire").color ?? "#94a3b8", 0.75);
  }

  // 격자선
  for (let x = 0; x <= page.cols; x += 1) {
    parts.push(`<line x1="${x * cellPx}" y1="0" x2="${x * cellPx}" y2="${height}" stroke="#e2e8f0"/>`);
  }
  for (let y = 0; y <= page.rows; y += 1) {
    parts.push(`<line x1="0" y1="${y * cellPx}" x2="${width}" y2="${y * cellPx}" stroke="#e2e8f0"/>`);
  }

  // 장비 이름과 장비 ID 는 격자선 위에 올린다.
  const fontSize = Math.max(5, Math.round(cellPx * 0.45));
  for (const [key, cell] of Object.entries(page.equipment)) {
    const text = cell.label || (cell.kind ? resolveItem(index, cell.kind, "kind").name : "");
    if (!text) continue;
    const [x, y] = key.split(",").map(Number);
    parts.push(
      `<text x="${x * cellPx + cellPx / 2}" y="${y * cellPx + cellPx / 2}" font-size="${fontSize}" ` +
        `text-anchor="middle" dominant-baseline="central" fill="#0f172a">${escapeXml(text)}</text>`,
    );
  }

  parts.push("</svg>");
  return parts.join("\n");
}

export const exportPreviewTool: ToolDef = {
  name: "grid_export_preview",
  title: "미리보기 내보내기",
  description: "도면을 ASCII 텍스트 다이어그램 또는 SVG 로 그려 돌려준다. 파일로 쓰지 않고 문자열로만 준다.",
  inputSchema: PreviewInput.shape,
  handler(rawArgs, store) {
    const args = PreviewInput.parse(rawArgs);
    const project = store.read(args.projectId);
    const page = pickPage(project, args.pageId);

    if (args.format === "svg") {
      return {
        projectId: args.projectId,
        pageId: page.id,
        format: "svg",
        cellPx: args.cellPx,
        svg: renderSvg(project, page, args.cellPx),
      };
    }

    const { text, truncated } = renderAscii(project, page, args.maxCols, args.maxRows);
    return { projectId: args.projectId, pageId: page.id, format: "ascii", truncated, ascii: text };
  },
};
