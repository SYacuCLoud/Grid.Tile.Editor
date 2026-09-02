/**
 * 인쇄 용지 설정.
 *
 * 격자 칸 수나 PNG 내보내기는 건드리지 않는다. 화면에 "여기까지가 한 장" 이라는
 * 경계선만 그려 준다. 큰 도면을 여러 장에 나눠 인쇄할 때 어디서 잘리는지 미리 본다.
 */

export type PaperId = "a4" | "a3" | "a2" | "letter";
export type PaperOrientation = "portrait" | "landscape";

/**
 * 메모 본문을 어디에 실을지.
 *
 * - `off` — 싣지 않는다(기본). 도면에는 번호만 남는다.
 * - `inline` — 용지의 빈 곳에 채우고, 넘치면 다음 장에 이어 붙인다.
 * - `appendix` — 도면과 섞지 않고 뒤에 별지로 모은다.
 *
 * (자리 계산과 번호 매기기는 `memoPrint.ts`. 여기 두는 것은 용지 설정과 함께
 * 저장되기 때문이다 — 저장 · 복원 경로를 새로 만들지 않는다.)
 */
export type MemoPrintMode = "off" | "inline" | "appendix";

export const DEFAULT_MEMO_MODE: MemoPrintMode = "off";

export function sanitizeMemoMode(raw: unknown): MemoPrintMode {
  return raw === "inline" || raw === "appendix" ? raw : DEFAULT_MEMO_MODE;
}

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
  /**
   * 메모 본문을 인쇄물에 실을지. 없으면 싣지 않는다(`off`).
   *
   * 도면 칸에는 언제나 메모 번호가 찍힌다 — 이 설정은 **본문**을 어디에 싣느냐만
   * 정한다. `memoPrint.ts` 참고.
   */
  memoMode?: MemoPrintMode;
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
  const totalRows = rows + legendBand(paper, legendCount, cols, rows).bandCells;
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

  const memoMode = sanitizeMemoMode(candidate.memoMode);

  return {
    id: candidate.id as PaperId,
    orientation,
    cellMm,
    marginMm,
    // 기본값은 저장하지 않는다 — 예전 파일과 같은 모양이 유지된다.
    ...(memoMode === DEFAULT_MEMO_MODE ? {} : { memoMode }),
  };
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

/**
 * 범례를 몇 칸씩 늘어놓을 수 있는지.
 *
 * 띠는 **격자 너비**만큼만 그린다(`gridCols`). 인쇄영역 너비로 잡으면 가로 용지에서
 * 격자 오른쪽 빈 자리까지 띠가 차지해, 그 자리에 실리는 메모가 위아래로 잘린다.
 * 격자 오른쪽은 메모 몫이고 범례는 격자 아래에만 머문다. 격자가 한 장보다 넓으면
 * 띠도 그만큼 길어져 열이 늘어난다. `gridCols` 를 안 주면 인쇄영역 너비를 쓴다.
 */
export function legendColumns(paper: PagePaper, gridCols?: number): number {
  const { widthMm } = paperSizeMm(paper);
  const marginMm = Math.min(MAX_MARGIN_MM, Math.max(0, paper.marginMm));
  const cellMm = Math.min(MAX_CELL_MM, Math.max(MIN_CELL_MM, paper.cellMm));
  const bandWidthMm = gridCols !== undefined && gridCols > 0 ? gridCols * cellMm : widthMm - marginMm * 2;
  return Math.max(1, Math.floor(bandWidthMm / LEGEND_ENTRY_MM));
}

/** 범례 띠가 차지하는 격자 행 수. 항목이 없으면 0 이다. 너비는 `legendColumns` 와 같은 셈이다. */
export function legendBandCells(paper: PagePaper, legendCount: number, gridCols?: number): number {
  if (legendCount <= 0) return 0;
  const cellMm = Math.min(MAX_CELL_MM, Math.max(MIN_CELL_MM, paper.cellMm));
  const rows = Math.ceil(legendCount / legendColumns(paper, gridCols));
  return Math.ceil((LEGEND_GAP_MM + rows * LEGEND_ROW_MM) / cellMm);
}

/**
 * 띠를 줄이는 단계. 앞에서부터 시도해 마지막 장 남은 행에 들어가는 첫 단계를 쓴다.
 *
 * 항목 폭을 먼저 줄인다(열이 늘어 줄이 준다) — 글자 크기는 그대로고 이름 뒤가
 * 조금 더 접힐 뿐이다. 줄 높이는 그 다음이다 — 견본이 작아져 눈에 띈다.
 */
const LEGEND_FIT_STEPS: ReadonlyArray<{ entryMm: number; rowMm: number }> = [
  { entryMm: LEGEND_ENTRY_MM, rowMm: LEGEND_ROW_MM },
  { entryMm: 38, rowMm: LEGEND_ROW_MM },
  { entryMm: 32, rowMm: LEGEND_ROW_MM },
  { entryMm: LEGEND_ENTRY_MM, rowMm: 5 },
  { entryMm: 38, rowMm: 5 },
  { entryMm: 32, rowMm: 5 },
];

export interface LegendBand {
  /** 띠가 차지하는 격자 행 수. 항목이 없으면 0. */
  bandCells: number;
  /** 한 줄에 늘어놓는 항목 수. */
  columns: number;
  /** 원래 크기(45mm · 6mm)보다 줄여서 맞췄는가. 용지 설정 안내에 적는다. */
  compressed: boolean;
}

/**
 * 인쇄물에 실리는 범례 띠 — 마지막 장에 **남은 행에 맞춰** 크기를 정한다.
 *
 * 띠는 격자 아래에 붙는데, 격자가 장을 거의 다 채우면 띠 몇 줄이 다음 장으로
 * 넘어가 장이 하나 더 생긴다. 그 장에는 띠 조각만 실린다. 그래서 띠가 남은 행에
 * 안 들어갈 때만 항목 폭 · 줄 높이를 단계적으로 줄여 본다(`LEGEND_FIT_STEPS`).
 * 여유가 있는 도면은 원래 크기 그대로다. 아무 단계도 안 들어가면 원래 크기로 두고
 * 다음 장으로 넘긴다 — 어차피 장이 늘어나는데 읽기까지 어려워질 이유가 없다.
 *
 * 화면 미리보기 · PNG · 장수 계산 · 용지 설정 안내가 모두 이 값을 써야 한다.
 */
export function legendBand(paper: PagePaper, legendCount: number, gridCols: number, gridRows: number): LegendBand {
  if (legendCount <= 0) return { bandCells: 0, columns: legendColumns(paper, gridCols), compressed: false };

  const { widthMm } = paperSizeMm(paper);
  const marginMm = Math.min(MAX_MARGIN_MM, Math.max(0, paper.marginMm));
  const cellMm = Math.min(MAX_CELL_MM, Math.max(MIN_CELL_MM, paper.cellMm));
  const bandWidthMm = gridCols > 0 ? gridCols * cellMm : widthMm - marginMm * 2;

  const fit = (step: { entryMm: number; rowMm: number }) => {
    const columns = Math.max(1, Math.floor(bandWidthMm / step.entryMm));
    const rows = Math.ceil(legendCount / columns);
    return { columns, bandCells: Math.ceil((LEGEND_GAP_MM + rows * step.rowMm) / cellMm) };
  };

  const natural = { ...fit(LEGEND_FIT_STEPS[0]), compressed: false };

  // 격자만 놓았을 때 마지막 장에 남는 행. 장을 꽉 채웠으면 0 이다.
  const sheetRows = sheetCells(paper).rows;
  const freeRows = Math.ceil(Math.max(1, gridRows) / sheetRows) * sheetRows - gridRows;
  if (natural.bandCells <= freeRows) return natural;

  for (const step of LEGEND_FIT_STEPS.slice(1)) {
    const candidate = fit(step);
    if (candidate.bandCells <= freeRows) return { ...candidate, compressed: true };
  }
  return natural;
}
