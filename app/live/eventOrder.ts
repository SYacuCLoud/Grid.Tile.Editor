/**
 * 이벤트 정렬 — 서버 조회와 화면 짝짓기가 같은 순서를 써야 한다.
 *
 * 최신이 앞. 같은 자리(receivedAt)면 발행 시각, 그것도 같으면 **등장이 제거보다 앞**(= 뒤에 일어난 것).
 * 감시 PC 는 태그가 바뀌면 제거(옛 태그)와 등장(새 태그)을 같은 밀리초에 찍는다. 이 둘의 순서가 흔들리면
 * 짝짓기(제거 → 그 앞의 같은 UID 등장)가 어긋나 "놓여 있음" 과 "-" 가 따로 노는 이력이 된다(2026-09-18 발견).
 */

import type { LoggedEvent } from "../../server/eventLog";

function laterFirst(e: LoggedEvent): number {
  return e.kind === "APPEAR" ? 1 : 0;
}

export function newestFirst(a: LoggedEvent, b: LoggedEvent): number {
  return b.receivedAt - a.receivedAt || b.time.localeCompare(a.time) || laterFirst(b) - laterFirst(a);
}
