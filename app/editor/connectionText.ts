/**
 * 연결을 사람에게 보이는 글로. `connection.ts` 는 대장(`device.ts`)을 부를 수
 * 없으므로(저쪽이 이쪽을 부른다) 이름 짓기는 이 작은 모듈이 맡는다 —
 * 우클릭 상자 · 장치 대장 · 연결 배너가 같은 표기를 쓴다.
 */

import { type Connection, type ConnectionEnd, connectionEndKey } from "./connection";
import { deviceById, deviceLabel } from "./device";
import { parseCellKey, type ProjectDoc } from "./doc";

/** 끝점을 부르는 한 줄 — 장치는 대장의 이름으로, 칸은 "페이지 (가로, 세로)" 로. */
export function connectionEndText(project: ProjectDoc, end: ConnectionEnd): string {
  if ("device" in end) {
    const device = deviceById(project.devices, end.device);
    return device ? deviceLabel(device) : end.device;
  }
  const page = project.pages.find((entry) => entry.id === end.page);
  const point = parseCellKey(end.cell);
  return `${page?.name ?? end.page} (${point.x + 1}, ${point.y + 1})`;
}

/**
 * 한쪽 편에서 본 연결 한 줄. 내 쪽(`myKeys`, `connectionEndKey` 값들)에서
 * 나가는 연결은 "→ 상대", 들어오는 연결은 "← 상대" 로 적는다.
 */
export function connectionTextFor(
  project: ProjectDoc,
  connection: Connection,
  myKeys: Set<string>,
): string {
  return myKeys.has(connectionEndKey(connection.from))
    ? `→ ${connectionEndText(project, connection.to)}`
    : `← ${connectionEndText(project, connection.from)}`;
}
