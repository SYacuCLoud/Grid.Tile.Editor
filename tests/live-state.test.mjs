/**
 * 실시간 현황판 — 토픽 해석 · 모델 갱신 · 도면 칸과 잇기 · 잔상 · 그리기 규칙.
 * 브라우저 · 브로커 없이 순수 계산만 본다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createProject, updateEquipmentInfoOnPage } from "../app/editor/doc.ts";
import { linkDeviceToCell, upsertDeviceInProject } from "../app/editor/device.ts";
import {
  applyMessage,
  defaultBrokerUrl,
  EMPTY_LIVE,
  FLASH_MS,
  flashAlpha,
  formatAgo,
  formatDwell,
  hasLiveFlash,
  matchReaders,
  MAX_EVENTS,
  parseTopic,
  pruneFlashes,
  readerPaint,
  shortUid,
  subscriptionTopics,
} from "../app/live/liveState.ts";

const STATE_PRESENT = JSON.stringify({
  type: "state", host: "PC-1", reader: "1번 저울", alias: "1번 저울", readerName: "ACS ACR1552 1",
  serial: "RR657-005592", present: true, online: true, uid: "E0040150ABCDEF01", tech: "ISO 15693", state: "PRESENT",
  time: "2026-09-14T15:32:32.931+09:00",
});
const STATE_EMPTY = JSON.stringify({ type: "state", host: "PC-1", reader: "1번 저울", serial: "RR657-005592", present: false, online: true, uid: "", state: "EMPTY", time: "2026-09-14T15:32:40.000+09:00" });
const EVENT_APPEAR = JSON.stringify({ type: "event", time: "2026-09-14T15:32:32.931+09:00", kind: "APPEAR", reader: "1번 저울", serial: "RR657-005592", uid: "E0040150ABCDEF01", host: "PC-1" });
const EVENT_REMOVE = JSON.stringify({ type: "event", time: "2026-09-14T15:32:40.000+09:00", kind: "REMOVE", reader: "1번 저울", serial: "RR657-005592", uid: "E0040150ABCDEF01", dwellMs: 7069, host: "PC-1" });
const STATUS_ON = JSON.stringify({ type: "status", online: true, host: "PC-1", time: "2026-09-14T15:32:33.931+09:00", version: "0.3.2", readerCount: 2, onlineReaders: 2, presentReaders: 1, appearToday: 5, removeToday: 4 });
const STATUS_OFF = JSON.stringify({ type: "status", online: false, host: "PC-1" });

test("토픽 해석: reader/state · reader/event · host/status, 다른 것은 null", () => {
  assert.deepEqual(parseTopic("rfid/site-a/reader/RR657-005592/state"), { kind: "state", site: "site-a", key: "RR657-005592" });
  assert.deepEqual(parseTopic("x/s1/reader/K/event"), { kind: "event", site: "s1", key: "K" });
  assert.deepEqual(parseTopic("rfid/site-a/host/PC-1/status"), { kind: "status", site: "site-a", host: "PC-1" });
  assert.equal(parseTopic("rfid/site-a/reader/K"), null);
  assert.equal(parseTopic("rfid/site-a/reader/K/unknown"), null);
  assert.equal(parseTopic("rfid//reader/K/state"), null);
});

test("모델 갱신: 상태 · 이벤트 · PC 상태가 쌓이고 빈 retained 는 지운다", () => {
  const t0 = 1_000_000;
  let m = applyMessage(EMPTY_LIVE, "rfid/s/reader/RR657-005592/state", STATE_PRESENT, t0);
  assert.equal(Object.keys(m.readers).length, 1);
  const r = m.readers["s/RR657-005592"];
  assert.equal(r.present, true);
  assert.equal(r.uid, "E0040150ABCDEF01");
  assert.equal(r.reader, "1번 저울");
  assert.equal(r.receivedAt, t0);
  assert.equal(r.at, "2026-09-14T15:32:32.931+09:00", "v1 은 time 필드");
  // 스키마 확정 전 시험판은 `at` 으로 냈다. 그것도 읽는다.
  const legacy = applyMessage(EMPTY_LIVE, "rfid/s/reader/K/state", JSON.stringify({ present: false, at: "2026-09-14T10:00:00+09:00" }), t0);
  assert.equal(legacy.readers["s/K"].at, "2026-09-14T10:00:00+09:00");

  m = applyMessage(m, "rfid/s/reader/RR657-005592/event", EVENT_APPEAR, t0 + 10);
  assert.equal(m.events.length, 1);
  assert.equal(m.events[0].kind, "APPEAR");
  assert.deepEqual(m.flashes["s/RR657-005592"], { kind: "APPEAR", at: t0 + 10 });

  // QoS 1 재전송으로 같은 이벤트가 두 번 와도 한 번만.
  m = applyMessage(m, "rfid/s/reader/RR657-005592/event", EVENT_APPEAR, t0 + 20);
  assert.equal(m.events.length, 1);

  m = applyMessage(m, "rfid/s/reader/RR657-005592/event", EVENT_REMOVE, t0 + 30);
  assert.equal(m.events.length, 2);
  assert.equal(m.events[0].kind, "REMOVE", "최신이 앞");
  assert.equal(m.events[0].dwellMs, 7069);

  m = applyMessage(m, "rfid/s/reader/RR657-005592/state", STATE_EMPTY, t0 + 40);
  assert.equal(m.readers["s/RR657-005592"].present, false);

  m = applyMessage(m, "rfid/s/host/PC-1/status", STATUS_ON, t0 + 50);
  assert.equal(m.hosts["s/PC-1"].online, true);
  assert.equal(m.hosts["s/PC-1"].appearToday, 5);
  m = applyMessage(m, "rfid/s/host/PC-1/status", STATUS_OFF, t0 + 60);
  assert.equal(m.hosts["s/PC-1"].online, false);

  // 빈 페이로드 = retained 지움.
  m = applyMessage(m, "rfid/s/reader/RR657-005592/state", "", t0 + 70);
  assert.equal("s/RR657-005592" in m.readers, false);
  m = applyMessage(m, "rfid/s/host/PC-1/status", "", t0 + 80);
  assert.equal("s/PC-1" in m.hosts, false);

  // 깨진 JSON · 모르는 토픽은 모델을 흔들지 않는다(받은 수만 오른다).
  const before = m;
  m = applyMessage(m, "rfid/s/reader/X/state", "{not json", t0 + 90);
  assert.deepEqual(m.readers, before.readers);
  assert.equal(m.received, before.received + 1);
  assert.equal(applyMessage(m, "other/topic", "{}", t0), m);
});

test("이벤트 목록은 MAX_EVENTS 에서 끊긴다", () => {
  let m = EMPTY_LIVE;
  for (let i = 0; i < MAX_EVENTS + 10; i++) {
    const payload = JSON.stringify({ type: "event", time: `2026-09-14T10:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}+09:00`, kind: "APPEAR", reader: "R", uid: `U${i}` });
    m = applyMessage(m, "rfid/s/reader/R/event", payload, i);
  }
  assert.equal(m.events.length, MAX_EVENTS);
  assert.equal(m.events[0].uid, `U${MAX_EVENTS + 9}`);
});

test("잔상: 시간이 지나며 옅어지고 끝나면 정리된다", () => {
  const flash = { kind: "APPEAR", at: 1000 };
  assert.equal(flashAlpha(flash, 1000), 1);
  assert.ok(Math.abs(flashAlpha(flash, 1000 + FLASH_MS / 2) - 0.5) < 1e-9);
  assert.equal(flashAlpha(flash, 1000 + FLASH_MS), 0);
  assert.equal(flashAlpha(undefined, 0), 0);

  const m = { ...EMPTY_LIVE, flashes: { a: { kind: "APPEAR", at: 1000 }, b: { kind: "REMOVE", at: 5000 } } };
  assert.equal(hasLiveFlash(m, 1000 + FLASH_MS + 1), true, "b 는 아직 살아 있다");
  const pruned = pruneFlashes(m, 1000 + FLASH_MS + 1);
  assert.deepEqual(Object.keys(pruned.flashes), ["b"]);
  assert.equal(pruneFlashes(pruned, 1000 + FLASH_MS + 2), pruned, "지울 것이 없으면 같은 객체");
});

test("도면과 잇기: 장치 대장 S/N → 칸, 없으면 식별자 글자, 둘 다 없으면 미배치", () => {
  let project = createProject("현황판");
  const page0 = project.pages[0];
  // 대장 장치 하나를 (3,4) 에 놓는다.
  project = upsertDeviceInProject(project, { id: "dev-1", type: "RFID 리더기", serial: "rr657-005592" });
  project = { ...project, pages: [{ ...project.pages[0], equipment: { ...project.pages[0].equipment, "3,4": { status: "installed" }, "3,5": { status: "installed" } } }] };
  project = linkDeviceToCell(project, "3,4", "dev-1");
  project = linkDeviceToCell(project, "3,5", "dev-1");
  // 대장 없이 식별자만 있는 칸.
  const withLabel = updateEquipmentInfoOnPage(project.pages[0], "7,1", { label: "SCALE-2", memo: "" });
  project = { ...project, pages: [withLabel] };
  const page = project.pages[0];
  assert.equal(page.id, page0.id);

  const readers = [
    { id: "s/RR657-005592", site: "s", key: "RR657-005592", host: "PC-1", reader: "1번 저울", alias: "1번 저울", readerName: "", serial: "RR657-005592", present: true, online: true, uid: "E004", tech: "", state: "PRESENT", at: "", receivedAt: 0 },
    { id: "s/SCALE-2", site: "s", key: "SCALE-2", host: "PC-1", reader: "2번 저울", alias: "2번 저울", readerName: "", serial: "", present: false, online: true, uid: "", tech: "", state: "EMPTY", at: "", receivedAt: 0 },
    { id: "s/UNKNOWN", site: "s", key: "UNKNOWN", host: "PC-2", reader: "떠돌이", alias: "", readerName: "", serial: "ZZZ", present: false, online: false, uid: "", tech: "", state: "뽑힘", at: "", receivedAt: 0 },
  ];
  const match = matchReaders(project, page, readers);
  assert.equal(match.placed.length, 2);
  const first = match.placed.find((p) => p.reader.key === "RR657-005592");
  assert.equal(first.deviceId, "dev-1");
  assert.deepEqual(first.cells, [{ x: 3, y: 4 }, { x: 3, y: 5 }], "장치가 놓인 칸 모두, 위→아래 순");
  const second = match.placed.find((p) => p.reader.key === "SCALE-2");
  assert.equal(second.deviceId, null, "식별자 글자로 찾았다");
  assert.deepEqual(second.cells, [{ x: 7, y: 1 }]);
  assert.deepEqual(match.unplaced.map((r) => r.key), ["UNKNOWN"]);
});

test("그리기 규칙: 감지 = 채움 + UID, 비어 있음 = 테두리만, 오프라인 = 회색 점선", () => {
  const base = { id: "s/k", site: "s", key: "k", host: "", reader: "", alias: "", readerName: "", serial: "", tech: "", state: "", at: "", receivedAt: 0 };
  const present = readerPaint({ ...base, present: true, online: true, uid: "E0040150ABCDEF01" });
  assert.ok(present.fill && present.text === "CDEF01");
  const empty = readerPaint({ ...base, present: false, online: true, uid: "" });
  assert.equal(empty.fill, null);
  assert.equal(empty.text, "");
  const offline = readerPaint({ ...base, present: true, online: false, uid: "E0" });
  assert.equal(offline.dashed, true);
  assert.equal(offline.text, "", "오프라인이면 옛 UID 를 적지 않는다");
  assert.equal(shortUid("E0 04 01 50 AB CD"), "0150ABCD".slice(-6));
});

test("글자 도우미 · 구독 필터 · 기본 브로커 주소", () => {
  const now = Date.parse("2026-09-14T15:33:00+09:00");
  assert.equal(formatAgo("2026-09-14T15:32:50+09:00", now), "10초 전");
  assert.equal(formatAgo("2026-09-14T15:20:00+09:00", now), "13분 전");
  assert.equal(formatAgo(null, now), "-");
  assert.equal(formatAgo("garbage", now), "-");
  assert.equal(formatDwell(7069), "7.1초");
  assert.equal(formatDwell(125_000), "2.1분");
  assert.equal(formatDwell(null), "");
  assert.deepEqual(subscriptionTopics("rfid", ""), ["rfid/+/reader/+/state", "rfid/+/reader/+/event", "rfid/+/host/+/status"]);
  assert.deepEqual(subscriptionTopics(" ", "site-a"), ["rfid/site-a/reader/+/state", "rfid/site-a/reader/+/event", "rfid/site-a/host/+/status"]);
  assert.equal(defaultBrokerUrl("192.168.0.41"), "ws://192.168.0.41:9001");
  assert.equal(defaultBrokerUrl(""), "ws://localhost:9001");
});
