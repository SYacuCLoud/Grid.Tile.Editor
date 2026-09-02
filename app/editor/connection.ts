/**
 * 장치 연결(Connection).
 *
 * "리더기 A 의 신호가 PLC B 로 간다" 같은 관계를 대장 옆에 담는다. 끝점은
 * 두 가지다 — 대장의 장치(`device`)거나, 도면의 칸(`page`+`cell`)이거나.
 * 장치 끝점은 장치를 다른 칸·페이지로 옮겨도 따라가고, 칸 끝점은 아직
 * 대장에 없는 자리(계획)도 이을 수 있다. 배선 레이어(케이블의 물리 경로
 * 그림)와는 역할이 다르다 — 배선은 도면에 항상 인쇄되는 손그림이고,
 * 연결은 호버할 때만 화면에 흐른다.
 */

import type { PageDoc, Point, ProjectDoc } from "./doc";

/** 연결의 한쪽 끝. 장치를 가리키거나, 페이지의 칸 하나를 가리킨다. */
export type ConnectionEnd = { device: string } | { page: string; cell: string };

export interface Connection {
  id: string;
  /** 흐름이 시작하는 끝. 화면의 애니메이션이 이쪽에서 `to` 로 흐른다. */
  from: ConnectionEnd;
  to: ConnectionEnd;
  /** 연결에 붙이는 한 줄. 예: RS-232 · 계량 신호 */
  label?: string;
  /** 선 색(#rrggbb). 없으면 기본색(`CONNECTION_COLOR`)으로 그린다. */
  color?: string;
}

export const MAX_CONNECTIONS = 300;
export const MAX_CONNECTION_LABEL = 60;

/** 연결선의 기본색. 배경 채움·배선 팔레트 어느 색 위에서도 눈에 걸리는 파랑. */
export const CONNECTION_COLOR = "#2563eb";

/**
 * 표시 맵(`visible`)에서 연결선이 쓰는 열쇠. 진짜 레이어는 아니지만 구역
 * (`ZONE_LAYER_ID`)과 같은 방식으로 켜고 끈다 — 화면·PNG·인쇄가 같은 맵을
 * 보므로 체크 하나로 세 곳이 함께 갈린다.
 */
export const CONNECTION_LAYER_ID = "connections";

/** 포물선 곡률. 중점에서 (두 점 사이 거리 × 이 값) 만큼 수직으로 띄운다. */
export const CONNECTION_CURVE = 0.15;

const CELL_KEY_PATTERN = /^\d+,\d+$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/**
 * 포물선의 제어점(2차 베지어). 중점에서 진행 방향의 왼쪽 법선으로 띄운다 —
 * from↔to 를 바꾸면 반대쪽으로 휘어, 곡선 모양 자체가 방향을 한 번 더 말한다.
 * 캔버스(출력)와 SVG 오버레이(호버 애니메이션)가 같은 기하를 쓴다.
 */
export function arcControlPoint(a: Point, b: Point, k = CONNECTION_CURVE): Point {
  return {
    x: (a.x + b.x) / 2 - (b.y - a.y) * k,
    y: (a.y + b.y) / 2 + (b.x - a.x) * k,
  };
}

/** 끝점을 비교 가능한 한 줄로. 같은 끝점인지, 같은 쌍인지가 전부 이 글자로 갈린다. */
export function connectionEndKey(end: ConnectionEnd): string {
  return "device" in end ? `dev:${end.device}` : `cell:${end.page}:${end.cell}`;
}

/** 방향을 무시한 쌍 열쇠. A→B 와 B→A 는 같은 연결이다 — 방향은 흐름 표시일 뿐이다. */
function pairKey(from: ConnectionEnd, to: ConnectionEnd): string {
  const a = connectionEndKey(from);
  const b = connectionEndKey(to);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * 저장 파일에서 온 끝점 하나를 다듬는다. 대장에 없는 장치 · 없는 페이지 ·
 * 모양이 아닌 칸 키는 null — 그 연결은 그릴 자리가 없다.
 * 장치 id 를 문자열로 적던 첫 판 형식도 여기서 장치 끝점으로 읽는다.
 */
function sanitizeEnd(raw: unknown, deviceIds: Set<string>, pageIds: Set<string>): ConnectionEnd | null {
  if (typeof raw === "string") return deviceIds.has(raw) ? { device: raw } : null;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { device?: unknown; page?: unknown; cell?: unknown };

  if (typeof candidate.device === "string" && candidate.device) {
    return deviceIds.has(candidate.device) ? { device: candidate.device } : null;
  }
  if (
    typeof candidate.page === "string" &&
    pageIds.has(candidate.page) &&
    typeof candidate.cell === "string" &&
    CELL_KEY_PATTERN.test(candidate.cell)
  ) {
    return { page: candidate.page, cell: candidate.cell };
  }
  return null;
}

/**
 * 저장 파일에서 온 연결 목록을 다듬는다.
 *
 * 끝점이 성치 않은 연결, 양끝이 같은 연결, 같은 쌍의 중복은 버린다.
 * 문서를 여는 길은 모두 `sanitizeProject` 를 지나므로, 위쪽 코드는
 * 여기서 나온 모양만 믿으면 된다.
 */
export function sanitizeConnections(
  raw: unknown,
  devices: ProjectDoc["devices"],
  pages: Array<{ id: string }>,
): Connection[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const deviceIds = new Set((devices ?? []).map((device) => device.id));
  const pageIds = new Set(pages.map((page) => page.id));
  const usedIds = new Set<string>();
  const usedPairs = new Set<string>();
  const out: Connection[] = [];

  for (const entry of raw) {
    if (out.length >= MAX_CONNECTIONS) break;
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { id?: unknown; from?: unknown; to?: unknown; label?: unknown; color?: unknown };
    if (typeof candidate.id !== "string" || !candidate.id || usedIds.has(candidate.id)) continue;

    const from = sanitizeEnd(candidate.from, deviceIds, pageIds);
    const to = sanitizeEnd(candidate.to, deviceIds, pageIds);
    if (!from || !to) continue;
    if (connectionEndKey(from) === connectionEndKey(to)) continue;
    if (usedPairs.has(pairKey(from, to))) continue;

    const connection: Connection = { id: candidate.id, from, to };
    if (typeof candidate.label === "string") {
      const label = candidate.label.trim().slice(0, MAX_CONNECTION_LABEL);
      if (label) connection.label = label;
    }
    if (typeof candidate.color === "string" && COLOR_PATTERN.test(candidate.color)) {
      connection.color = candidate.color.toLowerCase();
    }
    usedIds.add(connection.id);
    usedPairs.add(pairKey(from, to));
    out.push(connection);
  }

  return out.length > 0 ? out : undefined;
}

/** 쓰이지 않은 연결 ID. 시각·난수를 쓰지 않아 같은 조작이 항상 같은 결과를 낸다. */
export function nextConnectionId(connections: Connection[]): string {
  const used = new Set(connections.map((connection) => connection.id));
  for (let n = connections.length + 1; ; n += 1) {
    const candidate = `conn-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** 두 끝점 사이의 연결. 방향은 가리지 않는다. */
export function findConnection(
  connections: Connection[] | undefined,
  a: ConnectionEnd,
  b: ConnectionEnd,
): Connection | undefined {
  return connections?.find((connection) => pairKey(connection.from, connection.to) === pairKey(a, b));
}

/** 이 장치가 낀 연결들. 대장 목록이 쓴다. */
export function connectionsOfDevice(connections: Connection[] | undefined, deviceId: string): Connection[] {
  const key = connectionEndKey({ device: deviceId });
  return (connections ?? []).filter(
    (connection) => connectionEndKey(connection.from) === key || connectionEndKey(connection.to) === key,
  );
}

/**
 * 이 칸이 낀 연결들 — 칸 끝점이 이 칸이거나, 이 칸에 놓인 장치가 장치
 * 끝점인 연결. 호버 표시가 이 답을 쓴다.
 */
export function connectionsAtCell(
  connections: Connection[] | undefined,
  pageId: string,
  cellKey: string,
  deviceId?: string,
): Connection[] {
  const keys = new Set([connectionEndKey({ page: pageId, cell: cellKey })]);
  if (deviceId) keys.add(connectionEndKey({ device: deviceId }));
  return (connections ?? []).filter(
    (connection) => keys.has(connectionEndKey(connection.from)) || keys.has(connectionEndKey(connection.to)),
  );
}

/** 이 끝점이 지금 프로젝트에서 유효한가 — 장치는 대장에, 칸은 있는 페이지에. */
function isValidEnd(project: ProjectDoc, end: ConnectionEnd): boolean {
  if ("device" in end) {
    return !!end.device && (project.devices ?? []).some((device) => device.id === end.device);
  }
  return project.pages.some((page) => page.id === end.page) && CELL_KEY_PATTERN.test(end.cell);
}

/**
 * 연결을 하나 더한다.
 *
 * 성치 않은 끝점 · 양끝이 같은 것 · 이미 있는 쌍이면 그대로 돌려준다 —
 * 같은 두 끝 사이에 연결이 두 줄 생기면 지울 때 어느 줄을 지웠는지 알 수 없다.
 */
export function addConnectionToProject(
  project: ProjectDoc,
  from: ConnectionEnd,
  to: ConnectionEnd,
  extra?: { label?: string; color?: string },
): ProjectDoc {
  if (connectionEndKey(from) === connectionEndKey(to)) return project;
  if (!isValidEnd(project, from) || !isValidEnd(project, to)) return project;

  const connections = project.connections ?? [];
  if (connections.length >= MAX_CONNECTIONS) return project;
  if (findConnection(connections, from, to)) return project;

  const connection: Connection = { id: nextConnectionId(connections), from, to };
  const label = (extra?.label ?? "").trim().slice(0, MAX_CONNECTION_LABEL);
  if (label) connection.label = label;
  if (extra?.color && COLOR_PATTERN.test(extra.color)) connection.color = extra.color.toLowerCase();

  return { ...project, connections: [...connections, connection] };
}

export function removeConnectionFromProject(project: ProjectDoc, id: string): ProjectDoc {
  const connections = (project.connections ?? []).filter((connection) => connection.id !== id);
  const next = { ...project };
  if (connections.length > 0) next.connections = connections;
  else delete next.connections;
  return next;
}

/** 한 페이지에서 양끝이 풀린 연결 — 렌더러가 이 좌표(칸 단위)로 선을 긋는다. */
export interface ConnectionSegment {
  connection: Connection;
  from: Point;
  to: Point;
}

/**
 * 이 페이지에서 그릴 수 있는 연결들을 칸 좌표로 푼다.
 *
 * 장치 끝점은 그 장치가 놓인 첫 칸으로, 칸 끝점은 적힌 좌표 그대로. 한쪽이라도
 * 이 페이지에서 못 풀리면(다른 페이지 · 미배치 · 격자 밖) 그 연결은 그리지
 * 않는다 — 선이 허공을 가리키면 없는 것보다 나쁘다.
 */
export function connectionSegmentsOnPage(project: ProjectDoc, pageId: string): ConnectionSegment[] {
  if (!project.connections || project.connections.length === 0) return [];
  const page: PageDoc | undefined = project.pages.find((entry) => entry.id === pageId);
  if (!page) return [];

  // 장치 → 그 장치가 놓인 첫 칸. 같은 장치를 여러 칸이 가리켜도 선은 한 곳에서 나온다.
  const deviceCell = new Map<string, string>();
  for (const [key, cell] of Object.entries(page.equipment)) {
    if (cell.deviceId && !deviceCell.has(cell.deviceId)) deviceCell.set(cell.deviceId, key);
  }

  const resolve = (end: ConnectionEnd): Point | null => {
    const key = "device" in end ? deviceCell.get(end.device) : end.page === pageId ? end.cell : undefined;
    if (!key) return null;
    const [x, y] = key.split(",").map(Number);
    // 격자를 줄인 뒤 남은 칸 끝점은 격자 밖일 수 있다.
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= page.cols || y >= page.rows) return null;
    return { x, y };
  };

  const out: ConnectionSegment[] = [];
  for (const connection of project.connections) {
    const from = resolve(connection.from);
    const to = resolve(connection.to);
    if (from && to) out.push({ connection, from, to });
  }
  return out;
}

/**
 * 이 장치가 낀 연결을 모두 걷어 낸다. 장치를 대장에서 지울 때 함께 불린다 —
 * 없는 장치를 가리키는 연결을 남기면 문서를 열 때마다 sanitize 가 지우는
 * 것에 기대게 된다. 칸 끝점끼리의 연결은 대장과 무관하므로 그대로 남는다.
 */
export function dropConnectionsOfDevice(project: ProjectDoc, deviceId: string): ProjectDoc {
  const key = connectionEndKey({ device: deviceId });
  const before = project.connections ?? [];
  const connections = before.filter(
    (connection) => connectionEndKey(connection.from) !== key && connectionEndKey(connection.to) !== key,
  );
  if (connections.length === before.length) return project;

  const next = { ...project };
  if (connections.length > 0) next.connections = connections;
  else delete next.connections;
  return next;
}

/** 잘라낸 칸 무리가 어디서 어디로 갔는지. 붙여넣기가 칸 끝점을 따라 옮길 때 쓴다. */
export interface CellMove {
  from: { pageId: string; minX: number; minY: number; maxX: number; maxY: number };
  to: { pageId: string; origin: Point };
}

/**
 * 잘라낸 범위 안을 가리키던 칸 끝점을 붙여넣은 자리로 옮긴다.
 *
 * 장치 끝점은 `deviceId` 가 칸과 함께 옮겨지므로 저절로 따라가지만, 칸 끝점은
 * 좌표 그대로여서 잘라내기·붙여넣기 뒤에 빈 자리를 가리키게 된다. 옮긴 자리가
 * 대상 페이지 격자 밖이면(붙여넣기가 잘라낸 칸) 끝점은 그대로 둔다 — 칸 내용도
 * 옮겨지지 않았으니 "잘라내고 붙이지 않은" 것과 같다.
 *
 * 옮긴 뒤 양끝이 같아진 연결은 버리고, 같은 쌍이 둘이 되면 옮겨 온 쪽을 남긴다 —
 * 붙여넣기는 대상 블록을 통째로 바꾸므로 거기 있던 옛 연결이 밀려나는 것이 맞다.
 */
export function moveCellEndpoints(project: ProjectDoc, move: CellMove): ProjectDoc {
  const connections = project.connections ?? [];
  if (connections.length === 0) return project;
  const target = project.pages.find((page) => page.id === move.to.pageId);
  if (!target) return project;

  const dx = move.to.origin.x - move.from.minX;
  const dy = move.to.origin.y - move.from.minY;

  const relocate = (end: ConnectionEnd): ConnectionEnd | null => {
    if ("device" in end || end.page !== move.from.pageId) return null;
    const [x, y] = end.cell.split(",").map(Number);
    if (x < move.from.minX || x > move.from.maxX || y < move.from.minY || y > move.from.maxY) return null;
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= target.cols || ny >= target.rows) return null;
    return { page: move.to.pageId, cell: `${nx},${ny}` };
  };

  let changed = false;
  const moved: Connection[] = [];
  const stayed: Connection[] = [];
  for (const connection of connections) {
    const from = relocate(connection.from);
    const to = relocate(connection.to);
    if (!from && !to) {
      stayed.push(connection);
      continue;
    }
    changed = true;
    const next: Connection = { ...connection, from: from ?? connection.from, to: to ?? connection.to };
    if (connectionEndKey(next.from) !== connectionEndKey(next.to)) moved.push(next);
  }
  if (!changed) return project;

  const takenPairs = new Set(moved.map((connection) => pairKey(connection.from, connection.to)));
  // 원래 순서를 지킨다 — 이력 diff 가 자리 바뀜을 변화로 읽지 않게.
  const byId = new Map<string, Connection>();
  for (const connection of stayed) {
    if (!takenPairs.has(pairKey(connection.from, connection.to))) byId.set(connection.id, connection);
  }
  for (const connection of moved) byId.set(connection.id, connection);
  const ordered = connections.filter((connection) => byId.has(connection.id)).map((connection) => byId.get(connection.id)!);

  const next = { ...project };
  if (ordered.length > 0) next.connections = ordered;
  else delete next.connections;
  return next;
}
