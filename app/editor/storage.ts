import { type EquipmentCell, DOC_VERSION, type PageDoc, type ProjectDoc } from "./doc";
import { ensurePalette } from "./paletteOps";
import { type PagePaper, sanitizePaper } from "./paper";
import { sanitizePhotos } from "./photo";

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

export function sanitizeProject(input: unknown): ProjectDoc | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

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
      palette: ensurePalette(raw.palette),
    };
  }

  return null;
}

export interface LoadedProject {
  project: ProjectDoc;
  /** 이전 v1 단일 문서 키에서 읽어 이관한 결과인가. */
  fromLegacy: boolean;
}

export function loadLocal(): LoadedProject | null {
  if (typeof window === "undefined") return null;
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (text) {
      const project = sanitizeProject(JSON.parse(text));
      if (project) return { project, fromLegacy: false };
    }

    // 이전 v1 단일 문서 자동 마이그레이션 시도
    const legacyText = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyText) {
      const project = sanitizeProject(JSON.parse(legacyText));
      if (project) return { project, fromLegacy: true };
    }

    return null;
  } catch {
    return null;
  }
}

export function saveLocal(project: ProjectDoc) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // 저장 용량 초과 등은 편집을 막지 않는다.
  }
}

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
