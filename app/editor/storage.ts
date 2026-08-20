import { type EquipmentCell, DOC_VERSION, type LayerCells, type PageDoc, type ProjectDoc } from "./doc";
import { type LayerDef, sanitizeLayers } from "./layers";
import { ensurePalette } from "./paletteOps";
import { type PagePaper, sanitizePaper } from "./paper";
import { sanitizePhotos } from "./photo";

/**
 * 예전 판이 도면을 자동 저장해 두던 브라우저 열쇠.
 *
 * 지금은 도면을 브라우저에 저장하지 않는다 — 저장하는 곳은 서버 한 곳이다.
 * 두 곳에 두면 어느 쪽이 최신인지 아무도 모른다: 이 브라우저에서 고친 것이
 * 서버 것보다 새롭고, 옆자리 사람이 서버에 올린 것은 또 그보다 새롭다.
 * 그래서 첫 화면에 무엇을 띄울지부터 답이 없어진다.
 *
 * 열쇠 이름만 남겨 두는 것은 `전체 초기화` 로 옛 데이터를 지워 주기 위해서다.
 */
export const STORAGE_KEY = "rfid-grid-editor:project:v2";
export const LEGACY_STORAGE_KEY = "rfid-grid-editor:doc:v1";

/**
 * 설비 칸을 다듬는다.
 *
 * 사진만 검사한다. 도면에 함께 담기는 값이라, 그림이 아닌 문자열이나 지나치게
 * 큰 값이 섞여 들어오면 문서를 열 때마다 그 무게를 그대로 짊어진다.
 * 나머지 값(상태 · 장비 · ID · 메모)은 팔레트 조회와 렌더러가 알아서 감당한다.
 *
 * 여기가 사진 한 장(`photo`)만 담던 이전 판 문서를 목록(`photos`)으로 옮기는
 * 자리이기도 하다. 문서를 여는 길은 모두 이 함수를 지나므로, 위쪽 코드는
 * `photos` 하나만 보면 된다.
 */
function sanitizeEquipment(raw: unknown): Record<string, EquipmentCell> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, EquipmentCell> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const cell = { ...(value as EquipmentCell) };
    const photos = sanitizePhotos(cell.photos, cell.photo);
    delete cell.photo;
    if (photos.length > 0) cell.photos = photos;
    else delete cell.photos;
    out[key] = cell;
  }

  return out;
}

/**
 * 사용자 레이어의 칸을 다듬는다.
 *
 * 목록에 없는 레이어의 칸은 버린다. 레이어를 지우고 저장한 뒤 그 칸만 남으면
 * 화면에 그릴 자리도 없이 파일만 무거워진다. 값은 팔레트 ID 문자열이어야 한다 —
 * 없는 ID 는 렌더러가 회색 대체 항목으로 그리므로 여기서 걸러 내지 않는다.
 */
function sanitizeLayerCells(raw: unknown, layers: LayerDef[]): LayerCells | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const known = new Set(layers.filter((layer) => !layer.builtin).map((layer) => layer.id));
  const out: LayerCells = {};

  for (const [layerId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(layerId) || !value || typeof value !== "object") continue;
    const cells: Record<string, string> = {};
    for (const [key, id] of Object.entries(value as Record<string, unknown>)) {
      if (typeof id === "string" && id.length > 0) cells[key] = id;
    }
    if (Object.keys(cells).length > 0) out[layerId] = cells;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizeProject(input: unknown): ProjectDoc | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  // 레이어 목록이 없는 이전 문서는 기본 3종을 받는다.
  const layers = sanitizeLayers(raw.layers);

  // 다중 페이지 형식인가? (pages 배열 존재)
  if (Array.isArray(raw.pages) && raw.pages.length > 0) {
    const pages: PageDoc[] = raw.pages.map((p, idx) => {
      const rawPage = (p && typeof p === "object" ? p : {}) as Partial<PageDoc>;
      return {
        id: typeof rawPage.id === "string" ? rawPage.id : `page-${idx + 1}`,
        name: typeof rawPage.name === "string" ? rawPage.name : `페이지 ${idx + 1}`,
        cols: typeof rawPage.cols === "number" ? Math.max(10, Math.min(200, rawPage.cols)) : 48,
        rows: typeof rawPage.rows === "number" ? Math.max(10, Math.min(200, rawPage.rows)) : 30,
        background: (rawPage.background ?? {}) as PageDoc["background"],
        equipment: sanitizeEquipment(rawPage.equipment),
        wiring: (rawPage.wiring ?? {}) as PageDoc["wiring"],
        ...(sanitizeLayerCells(rawPage.layerCells, layers)
          ? { layerCells: sanitizeLayerCells(rawPage.layerCells, layers) as LayerCells }
          : {}),
        ...(sanitizePaper(rawPage.paper) ? { paper: sanitizePaper(rawPage.paper) as PagePaper } : {}),
      };
    });

    const activePageId =
      typeof raw.activePageId === "string" && pages.some((p) => p.id === raw.activePageId)
        ? raw.activePageId
        : pages[0].id;

    return {
      version: typeof raw.version === "number" ? raw.version : DOC_VERSION,
      title: typeof raw.title === "string" ? raw.title : "격자형 배치 프로젝트",
      activePageId,
      pages,
      layers,
      palette: ensurePalette(raw.palette),
    };
  }

  // 단일 문서 이전 형식 호환 처리 (cols/rows 직접 소유)
  if (typeof raw.cols === "number" || typeof raw.rows === "number" || raw.background || raw.equipment || raw.wiring) {
    const legacyPage: PageDoc = {
      id: "page-1",
      name: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "페이지 1",
      cols: typeof raw.cols === "number" ? Math.max(10, Math.min(200, raw.cols)) : 48,
      rows: typeof raw.rows === "number" ? Math.max(10, Math.min(200, raw.rows)) : 30,
      background: (raw.background ?? {}) as PageDoc["background"],
      equipment: sanitizeEquipment(raw.equipment),
      wiring: (raw.wiring ?? {}) as PageDoc["wiring"],
    };

    return {
      version: DOC_VERSION,
      title: typeof raw.title === "string" ? raw.title : "격자형 배치 프로젝트",
      activePageId: legacyPage.id,
      pages: [legacyPage],
      layers,
      palette: ensurePalette(raw.palette),
    };
  }

  return null;
}

/** 예전 판이 브라우저에 남겨 둔 도면을 지운다. */
export function clearLocal() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // 무시
  }
}

export function parseProjectJson(text: string): ProjectDoc {
  const parsed = sanitizeProject(JSON.parse(text));
  if (!parsed) throw new Error("배치도 파일 형식이 아닙니다.");
  return parsed;
}

export function projectToJson(project: ProjectDoc): string {
  return JSON.stringify(project, null, 2);
}

function triggerDownload(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function downloadJson(project: ProjectDoc, filename: string) {
  const blob = new Blob([projectToJson(project)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL("image/png");
  triggerDownload(url, filename);
}

/** data URL 하나를 파일로 내려받는다. 칸 사진이 이 길로 나간다. */
export function downloadDataUrl(dataUrl: string, filename: string) {
  triggerDownload(dataUrl, filename);
}

/** 파일 이름으로 쓸 수 있게 다듬는다. 남는 것이 없으면 `배치도`. */
export function safeFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-");
  return cleaned.length > 0 ? cleaned : "배치도";
}

export function fileStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}
