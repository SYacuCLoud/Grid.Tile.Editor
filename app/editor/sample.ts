import { cellKey, createDoc, DOC_VERSION, type LayoutDoc, type PageDoc, type ProjectDoc } from "./doc";
import type { KindId, StatusId, TileId, WireId } from "./palette";

interface Span {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

function tiles(doc: LayoutDoc, tile: TileId, spans: Span[]) {
  for (const span of spans) {
    for (let dy = 0; dy < (span.h ?? 1); dy += 1) {
      for (let dx = 0; dx < (span.w ?? 1); dx += 1) {
        doc.background[cellKey(span.x + dx, span.y + dy)] = tile;
      }
    }
  }
}

function status(doc: LayoutDoc, id: StatusId, spans: Span[]) {
  for (const span of spans) {
    for (let dy = 0; dy < (span.h ?? 1); dy += 1) {
      for (let dx = 0; dx < (span.w ?? 1); dx += 1) {
        const key = cellKey(span.x + dx, span.y + dy);
        doc.equipment[key] = { ...doc.equipment[key], status: id };
      }
    }
  }
}

function device(doc: LayoutDoc, x: number, y: number, kind: KindId, label?: string, memo?: string) {
  const key = cellKey(x, y);
  doc.equipment[key] = { ...doc.equipment[key], kind, label, memo };
}

function wire(doc: LayoutDoc, id: WireId, path: Array<[number, number]>) {
  for (const [x, y] of path) doc.wiring[cellKey(x, y)] = id;
}

function wireRun(doc: LayoutDoc, id: WireId, from: [number, number], to: [number, number]) {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const path: Array<[number, number]> = [];
  const stepX = Math.sign(x1 - x0);
  const stepY = Math.sign(y1 - y0);

  for (let x = x0; x !== x1 + (stepX || 1); x += stepX || 1) {
    path.push([x, y0]);
    if (stepX === 0) break;
  }
  for (let y = y0; y !== y1 + (stepY || 1); y += stepY || 1) {
    path.push([x1, y]);
    if (stepY === 0) break;
  }

  wire(doc, id, path);
}

/** 처음 열었을 때 보이는 예시 배치도 — 세척 라인 1개와 계량대 구역. */
export function createSampleDoc(): LayoutDoc {
  const doc = createDoc(44, 26);

  // 외벽과 출입문
  tiles(doc, "wall", [
    { x: 2, y: 1, w: 40 },
    { x: 2, y: 2, h: 21 },
    { x: 41, y: 2, h: 21 },
    { x: 2, y: 23, w: 40 },
  ]);
  tiles(doc, "door", [
    { x: 20, y: 1, w: 3 },
    { x: 41, y: 8, h: 3 },
    { x: 2, y: 16, h: 3 },
  ]);
  tiles(doc, "aisle", [
    { x: 3, y: 12, w: 38, h: 2 },
    { x: 21, y: 3, w: 2, h: 20 },
  ]);

  // 세척 라인 (기존 설비)
  status(doc, "existing", [{ x: 24, y: 3, w: 14 }]);
  device(doc, 24, 3, "monitor", "세척", "세척기 제어 모니터");
  device(doc, 25, 3, "reader", "C1141", "세척 투입구 리더");

  // 계량대 1~10: 설치 완료
  status(doc, "installed", [
    { x: 6, y: 4, w: 2, h: 4 },
    { x: 12, y: 4, w: 2, h: 4 },
  ]);
  device(doc, 6, 4, "scale", "C1101", "계량대 1 저울");
  device(doc, 12, 4, "scale", "C1102", "계량대 2 저울");
  device(doc, 6, 7, "reader", "R-01");
  device(doc, 12, 7, "reader", "R-02");

  // 계량대 3~4: 배선만 남은 구역 (미연결)
  status(doc, "unlinked", [{ x: 18, y: 4, w: 2, h: 4 }]);
  device(doc, 18, 4, "scale", "C1116", "저울 설치 완료 · 통신 미연결");
  device(doc, 18, 7, "reader", "R-03");

  // 신설 예정 구역 (미설치)
  status(doc, "pending", [
    { x: 28, y: 16, w: 3, h: 3 },
    { x: 34, y: 16, w: 3, h: 3 },
  ]);
  device(doc, 28, 16, "pc", "PC-3", "신규 검사 PC 예정");
  device(doc, 34, 16, "monitor", "M-4", "출하 모니터 예정");

  // 기존 사무 구역
  status(doc, "existing", [{ x: 6, y: 16, w: 4, h: 3 }]);
  device(doc, 6, 16, "pc", "PC-1", "관리실 PC");
  device(doc, 8, 16, "monitor", "M-1");

  // 배선 경로
  wireRun(doc, "wirePurple", [6, 9], [6, 11]);
  wireRun(doc, "wirePurple", [6, 11], [18, 11]);
  wireRun(doc, "wirePurple", [12, 9], [12, 11]);
  wireRun(doc, "wirePurple", [18, 9], [18, 11]);
  wireRun(doc, "wirePurple", [18, 11], [24, 11]);
  wireRun(doc, "wirePurple", [24, 5], [24, 11]);

  wireRun(doc, "wireOrange", [6, 14], [6, 15]);
  wireRun(doc, "wireOrange", [6, 14], [34, 14]);
  wireRun(doc, "wireOrange", [28, 14], [28, 15]);
  wireRun(doc, "wireOrange", [34, 14], [34, 15]);

  doc.title = "1공장 설비 배치도";
  return doc;
}

/** 초기에 로드되는 예시 다중 페이지 프로젝트. */
export function createSampleProject(): ProjectDoc {
  const sampleDoc = createSampleDoc();
  const page1: PageDoc = {
    id: "page-1",
    name: "1공장 세척·계량 라인",
    cols: sampleDoc.cols,
    rows: sampleDoc.rows,
    background: sampleDoc.background,
    equipment: sampleDoc.equipment,
    wiring: sampleDoc.wiring,
  };

  const page2: PageDoc = {
    id: "page-2",
    name: "2공장 검사·출하 구역",
    cols: 44,
    rows: 26,
    background: {},
    equipment: {},
    wiring: {},
  };

  return {
    version: DOC_VERSION,
    title: "격자형 배치 프로젝트",
    activePageId: page1.id,
    pages: [page1, page2],
    palette: sampleDoc.palette,
  };
}
