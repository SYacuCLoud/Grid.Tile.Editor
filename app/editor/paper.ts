/**
 * 인쇄 용지 설정.
 *
 * 격자 칸 수나 PNG 내보내기는 건드리지 않는다. 화면에 "여기까지가 한 장" 이라는
 * 경계선만 그려 준다. 큰 도면을 여러 장에 나눠 인쇄할 때 어디서 잘리는지 미리 본다.
 */

export type PaperId = "a4" | "a3" | "a2" | "letter";
export type PaperOrientation = "portrait" | "landscape";

export interface PaperMeta {
  id: PaperId;
  name: string;
  /** 세로 방향 기준 크기(mm). */
  widthMm: number;
  heightMm: number;
}

export const PAPERS: PaperMeta[] = [
  { id: "a4", name: "A4", widthMm: 210, heightMm: 297 },
  { id: "a3", name: "A3", widthMm: 297, heightMm: 420 },
  { id: "a2", name: "A2", widthMm: 420, heightMm: 594 },
  { id: "letter", name: "Letter", widthMm: 216, heightMm: 279 },
];

export interface PagePaper {
  id: PaperId;
  orientation: PaperOrientation;
  /** 인쇄물에서 한 칸이 차지할 길이(mm). 이 값이 있어야 한 장에 몇 칸이 들어가는지 알 수 있다. */
  cellMm: number;
  /** 사방 여백(mm). */
  marginMm: number;
}

export const DEFAULT_CELL_MM = 5;
export const DEFAULT_MARGIN_MM = 10;
export const MIN_CELL_MM = 1;
export const MAX_CELL_MM = 50;
export const MAX_MARGIN_MM = 50;

export function defaultPaper(id: PaperId = "a4"): PagePaper {
  return { id, orientation: "landscape", cellMm: DEFAULT_CELL_MM, marginMm: DEFAULT_MARGIN_MM };
}

export function paperMeta(id: PaperId): PaperMeta {
  return PAPERS.find((paper) => paper.id === id) ?? PAPERS[0];
}

/** 방향을 반영한 실제 용지 크기(mm). */
export function paperSizeMm(paper: PagePaper): { widthMm: number; heightMm: number } {
  const meta = paperMeta(paper.id);
  return paper.orientation === "landscape"
    ? { widthMm: meta.heightMm, heightMm: meta.widthMm }
    : { widthMm: meta.widthMm, heightMm: meta.heightMm };
}

/**
 * 한 장에 들어가는 칸 수.
 *
 * 여백이 용지보다 크게 잡혀도 최소 1칸은 보장한다. 0 이 되면 경계선을 그릴 때
 * 무한 반복에 빠진다.
 */
export function sheetCells(paper: PagePaper): { cols: number; rows: number } {
  const { widthMm, heightMm } = paperSizeMm(paper);
  const cellMm = Math.min(MAX_CELL_MM, Math.max(MIN_CELL_MM, paper.cellMm));
  const marginMm = Math.min(MAX_MARGIN_MM, Math.max(0, paper.marginMm));

  const usableW = widthMm - marginMm * 2;
  const usableH = heightMm - marginMm * 2;

  return {
    cols: Math.max(1, Math.floor(usableW / cellMm)),
    rows: Math.max(1, Math.floor(usableH / cellMm)),
  };
}

/**
 * 이 격자를 인쇄하면 몇 장이 나오는지.
 * 범례 띠도 인쇄물에 함께 실리므로 행 수에 더해 센다.
 */
export function sheetCount(
  paper: PagePaper,
  cols: number,
  rows: number,
  legendCount = 0,
): { across: number; down: number; total: number } {
  const per = sheetCells(paper);
  const totalRows = rows + legendBandCells(paper, legendCount);
  const across = Math.max(1, Math.ceil(cols / per.cols));
  const down = Math.max(1, Math.ceil(totalRows / per.rows));
  return { across, down, total: across * down };
}

/** 저장된 값을 다듬는다. 형식이 아니면 null — 경계선을 그리지 않는다. */
export function sanitizePaper(raw: unknown): PagePaper | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<PagePaper>;

  if (!PAPERS.some((paper) => paper.id === candidate.id)) return null;
  const orientation: PaperOrientation = candidate.orientation === "portrait" ? "portrait" : "landscape";

  const cellMm =
    typeof candidate.cellMm === "number" && Number.isFinite(candidate.cellMm)
      ? Math.min(MAX_CELL_MM, Math.max(MIN_CELL_MM, candidate.cellMm))
      : DEFAULT_CELL_MM;

  const marginMm =
    typeof candidate.marginMm === "number" && Number.isFinite(candidate.marginMm)
      ? Math.min(MAX_MARGIN_MM, Math.max(0, candidate.marginMm))
      : DEFAULT_MARGIN_MM;

  return { id: candidate.id as PaperId, orientation, cellMm, marginMm };
}

/**
 * 인쇄물에 붙는 범례 띠의 크기(mm).
 *
 * 화면 배율(칸 px)이 아니라 인쇄 치수로 잡는다. 확대·축소해도 몇 장에
 * 걸치는지가 달라지면 안 된다.
 */
export const LEGEND_ENTRY_MM = 45;
export const LEGEND_ROW_MM = 6;
export const LEGEND_GAP_MM = 4;

/** 한 장 너비에 범례를 몇 칸씩 늘어놓을 수 있는지. */
export function legendColumns(paper: PagePaper): number {
  const { widthMm } = paperSizeMm(paper);
  const marginMm = Math.min(MAX_MARGIN_MM, Math.max(0, paper.marginMm));
  return Math.max(1, Math.floor((widthMm - marginMm * 2) / LEGEND_ENTRY_MM));
}

/** 범례 띠가 차지하는 격자 행 수. 항목이 없으면 0 이다. */
export function legendBandCells(paper: PagePaper, legendCount: number): number {
  if (legendCount <= 0) return 0;
  const cellMm = Math.min(MAX_CELL_MM, Math.max(MIN_CELL_MM, paper.cellMm));
  const rows = Math.ceil(legendCount / legendColumns(paper));
  return Math.ceil((LEGEND_GAP_MM + rows * LEGEND_ROW_MM) / cellMm);
}
