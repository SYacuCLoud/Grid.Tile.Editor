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
  CLOCK_SKEW_WARN_MS,
  clockWarning,
  defaultBrokerUrl,
  elapsedMs,
  EMPTY_LIVE,
  FLASH_MS,
  flashAlpha,
  formatAgo,
  formatElapsed,
  formatDwell,
  formatSkew,
  GHOST_CHOICES,
  ghostMinutesOf,
  ghostTtlMs,
  ghostVisible,
  hasLiveFlash,
  matchReaders,
  MAX_EVENTS,
  parseTopic,
  pruneFlashes,
  readerPaint,
  readerSkews,
  seedGhosts,
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

test("잔상: 태그를 들어내면 마지막 UID 가 남고, 새 태그가 오면 사라지고, 유지 시간이 지나면 보이지 않는다", () => {
  const t0 = 1_000_000;
  const id = "s/RR657-005592";
  let m = applyMessage(EMPTY_LIVE, "rfid/s/reader/RR657-005592/state", STATE_PRESENT, t0);
  assert.equal(m.readers[id].lastUid, "", "태그가 있을 때는 잔상 없음");

  m = applyMessage(m, "rfid/s/reader/RR657-005592/state", STATE_EMPTY, t0 + 1000);
  const r = m.readers[id];
  assert.equal(r.present, false);
  assert.equal(r.lastUid, "E0040150ABCDEF01", "직전 UID 가 잔상으로");
  assert.equal(r.lastAt, "2026-09-14T15:32:40.000+09:00", "들어낸 시각 = 빈 상태의 time");
  assert.equal(r.lastSeenAt, t0 + 1000);
  assert.equal(ghostVisible(r, t0 + 1000 + 19 * 60_000, 20 * 60_000), true, "20분 안");
  assert.equal(ghostVisible(r, t0 + 1000 + 21 * 60_000, 20 * 60_000), false, "20분 지남");
  assert.equal(ghostVisible(r, t0 + 1000, 0), false, "0 이면 끔");
  assert.equal(ghostVisible({ ...r, online: false }, t0 + 1000, 20 * 60_000), false, "오프라인 칸에는 안 그린다");

  // 같은 빈 상태가 다시 와도(하트비트) 잔상은 그대로.
  m = applyMessage(m, "rfid/s/reader/RR657-005592/state", STATE_EMPTY.replace("15:32:40", "15:33:40"), t0 + 2000);
  assert.equal(m.readers[id].lastUid, "E0040150ABCDEF01");
  assert.equal(m.readers[id].lastSeenAt, t0 + 1000, "만료 기준 시각은 처음 들어낸 때");

  // 새 태그가 오면 잔상이 사라진다.
  m = applyMessage(m, "rfid/s/reader/RR657-005592/state", STATE_PRESENT.replace("E0040150ABCDEF01", "E004AAAA"), t0 + 3000);
  assert.equal(m.readers[id].lastUid, "");
  assert.equal(m.readers[id].uid, "E004AAAA");

  // 그리기: 잔상은 채움 없이 파란 테두리 + 회색 글자.
  const ghostPaint = readerPaint({ ...r, present: false }, undefined, "통번호 129");
  assert.equal(ghostPaint.ghost, true);
  assert.equal(ghostPaint.text, "통번호 129");
  assert.equal(ghostPaint.fill, "#94a3b8", "잔상 칸은 옅은 회색 채움");
  assert.equal(readerPaint({ ...r, present: false }).ghost, false, "잔상 글자를 안 넘기면 빈 칸 그대로");

  // 제목 아래 경과 시간 — 태그 있음은 인식된 뒤(상태 시각 기준), 잔상은 들어낸 뒤.
  const presentAt = Date.parse("2026-09-14T15:32:32.931+09:00");
  const live = applyMessage(EMPTY_LIVE, "rfid/s/reader/RR657-005592/state", STATE_PRESENT, t0).readers[id];
  assert.equal(readerPaint(live, "통번호 129", undefined, presentAt + 45_000).sub, "00:45");
  assert.equal(readerPaint(live, "통번호 129", undefined, presentAt + 192_000).sub, "03:12");
  assert.equal(readerPaint(live, "통번호 129").sub, "", "now 를 안 주면 붙이지 않는다");
  const removedAt = Date.parse("2026-09-14T15:32:40.000+09:00");
  assert.equal(readerPaint({ ...r, present: false }, undefined, "통번호 129", removedAt + 5_000).sub, "00:05");
  assert.equal(readerPaint({ ...r, present: false }, undefined, undefined, removedAt + 5_000).sub, "", "잔상이 없으면 경과도 없다");
  // 감시 PC 시계가 앞서 있어도 음수는 안 나온다. 시각을 못 읽으면 받은 시각으로.
  assert.equal(formatElapsed(-5000), "00:00");
  assert.equal(elapsedMs("이상한 시각", 1000, 61_000), 60_000);
  assert.equal(formatElapsed(3_903_000), "1:05:03", "한 시간을 넘으면 시:분:초");
  assert.equal(formatElapsed(2 * 86_400_000 + 3 * 3_600_000), "51:00:00", "하루를 넘어도 시간으로 이어 센다");
});

test("잔상: 화면을 늦게 켜도 발행 쪽 lastUid 나 제거 이벤트로 채운다", () => {
  const t0 = 1_000_000;
  const id = "s/RR657-005592";
  // 1) 발행 쪽이 선택 필드 lastUid · lastTime 을 실어 준 경우.
  const published = JSON.stringify({ present: false, online: true, uid: "", lastUid: "E004BBBB", lastTime: "2026-09-14T15:00:00+09:00", time: "2026-09-14T15:10:00+09:00" });
  const a = applyMessage(EMPTY_LIVE, "rfid/s/reader/RR657-005592/state", published, t0);
  assert.equal(a.readers[id].lastUid, "E004BBBB");
  assert.equal(a.readers[id].lastAt, "2026-09-14T15:00:00+09:00");

  // 2) retained 빈 상태가 먼저 오고(잔상 없음), 뒤에 제거 이벤트가 오면 그 UID 로 채운다.
  let b = applyMessage(EMPTY_LIVE, "rfid/s/reader/RR657-005592/state", STATE_EMPTY, t0);
  assert.equal(b.readers[id].lastUid, "");
  b = applyMessage(b, "rfid/s/reader/RR657-005592/event", EVENT_REMOVE, t0 + 10);
  assert.equal(b.readers[id].lastUid, "E0040150ABCDEF01");
  assert.equal(b.readers[id].lastSeenAt, t0 + 10);
  // 이미 잔상이 있으면 이벤트가 덮어쓰지 않는다.
  b = applyMessage(b, "rfid/s/reader/RR657-005592/event", EVENT_REMOVE.replace("ABCDEF01", "CCCC").replace("15:32:40.000", "15:32:41.000"), t0 + 20);
  assert.equal(b.readers[id].lastUid, "E0040150ABCDEF01");

  // 주소 매개변수 → 유지 시간.
  assert.equal(ghostTtlMs(null), 1440 * 60_000, "기본 24시간");
  assert.equal(ghostTtlMs(""), 1440 * 60_000);
  assert.equal(ghostTtlMs("5"), 5 * 60_000);
  assert.equal(ghostTtlMs("0"), 0);
  assert.equal(ghostTtlMs("-3"), 0);
  assert.equal(ghostTtlMs("abc"), 1440 * 60_000);
  assert.equal(ghostMinutesOf("60"), 60);
  assert.equal(ghostMinutesOf("2.6"), 3, "분은 정수로");
  assert.equal(ghostMinutesOf(undefined), 1440);
  assert.ok(GHOST_CHOICES.some((c) => c.minutes === 1440), "기본값이 선택지에 있다");
});

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

test("잔상 되살리기: 서버 로그의 마지막 제거를 비어 있고 잔상 없는 리더에만 채운다", () => {
  const t0 = 1_000_000;
  const empty = (key) => JSON.stringify({ type: "state", host: "PC-1", reader: key, serial: key, present: false, online: true, uid: "", state: "EMPTY", time: "2026-09-14T15:32:40.000+09:00" });
  let m = applyMessage(EMPTY_LIVE, "rfid/s/reader/A/state", empty("A"), t0);
  m = applyMessage(m, "rfid/s/reader/B/state", empty("B"), t0);
  m = applyMessage(m, "rfid/s/reader/C/state", STATE_PRESENT.replace("RR657-005592", "C"), t0);
  // B 는 이 화면이 직접 본 잔상이 있다.
  m = { ...m, readers: { ...m.readers, "s/B": { ...m.readers["s/B"], lastUid: "SEEN", lastAt: "2026-09-14T15:40:00.000+09:00", lastSeenAt: t0 } } };

  const seeds = {
    "s/A": { uid: "FROMLOG", at: "2026-09-14T15:30:00.000+09:00", seenAt: t0 - 5000 },
    "s/B": { uid: "OLDER", at: "2026-09-14T15:20:00.000+09:00", seenAt: t0 - 9000 },
    "s/C": { uid: "X", at: "2026-09-14T15:00:00.000+09:00", seenAt: t0 - 9000 },
    "s/Z": { uid: "NOREADER", at: "", seenAt: 0 },
  };
  const out = seedGhosts(m.readers, seeds);
  assert.equal(out["s/A"].lastUid, "FROMLOG", "빈 리더는 로그로 채움");
  assert.equal(out["s/A"].lastSeenAt, t0 - 5000, "만료 기준은 서버가 받은 시각");
  assert.equal(out["s/B"].lastUid, "SEEN", "직접 본 잔상이 우선");
  assert.equal(out["s/C"].lastUid, "", "태그가 놓인 리더는 그대로");
  assert.equal("s/Z" in out, false, "모르는 리더는 만들지 않음");
  assert.equal(ghostVisible(out["s/A"], t0, 60_000), true);

  assert.equal(seedGhosts(m.readers, {}), m.readers, "씨앗이 없으면 같은 객체");
  assert.equal(seedGhosts(out, seeds), out, "더 채울 것이 없으면 같은 객체");
});

test("시계 편차: 살아서 온 하트비트로 재고, retained · 유언은 전 값을 유지하며, 리더의 경과 시간을 보정한다", () => {
  const hbTime = "2026-09-14T15:32:33.931+09:00";
  const hbMs = Date.parse(hbTime);
  const heartbeat = (host, time = hbTime) => JSON.stringify({ type: "status", online: true, host, time, version: "0.4.1", readerCount: 1, onlineReaders: 1, presentReaders: 1, appearToday: 0, removeToday: 0 });

  // 구독 직후 되돌아온 retained 하트비트 — 시각이 묵었으니 편차로 치지 않는다.
  let m = applyMessage(EMPTY_LIVE, "rfid/s/host/PC-1/status", heartbeat("PC-1"), hbMs + 3_600_000, null, { retained: true });
  assert.equal(m.hosts["s/PC-1"].skewMs, null, "retained 는 못 잰 상태");
  assert.equal(clockWarning(m.hosts["s/PC-1"].skewMs), "", "못 잰 동안은 경고 없음");

  // 살아서 온 하트비트: PC 시계가 화면보다 3분 앞섬.
  m = applyMessage(m, "rfid/s/host/PC-1/status", heartbeat("PC-1"), hbMs - 180_000);
  assert.equal(m.hosts["s/PC-1"].skewMs, 180_000);
  assert.equal(clockWarning(m.hosts["s/PC-1"].skewMs), "시계 +3분");

  // 유언(online:false, 시각 없음)과 retained 는 전에 잰 값을 그대로 둔다.
  m = applyMessage(m, "rfid/s/host/PC-1/status", STATUS_OFF, hbMs);
  assert.equal(m.hosts["s/PC-1"].skewMs, 180_000, "유언은 편차를 지우지 않음");
  m = applyMessage(m, "rfid/s/host/PC-1/status", heartbeat("PC-1"), hbMs + 999_999, null, { retained: true });
  assert.equal(m.hosts["s/PC-1"].skewMs, 180_000, "retained 는 편차를 덮지 않음");

  // 편차 안(1초 지연)이면 경고 없음. 늦은 시계는 음수.
  m = applyMessage(m, "rfid/s/host/PC-2/status", heartbeat("PC-2"), hbMs + 1_000);
  assert.equal(m.hosts["s/PC-2"].skewMs, -1_000);
  assert.equal(clockWarning(-1_000), "");
  assert.equal(clockWarning(-CLOCK_SKEW_WARN_MS), "", "문턱과 같으면 경고 없음");
  assert.equal(clockWarning(-45_000), "시계 -45초");
  assert.equal(clockWarning(3_900_000), "시계 +1시간 5분");
  assert.equal(formatSkew(178_000), "3분", "분부터는 반올림 — 2분 58초 앞선 시계를 2분이라 하지 않는다");
  assert.equal(formatSkew(7_200_000), "2시간");
  assert.equal(formatSkew(2 * 86_400_000), "2일");
  assert.equal(formatSkew(-500), "1초", "부호는 보지 않고 반올림");

  // 리더 ↔ 감시 PC 는 사업장 + host 이름으로 잇는다. 편차 0 인 PC 의 리더는 빠진다.
  const stateOf = (host, serial) => JSON.stringify({ type: "state", host, reader: serial, serial, present: true, online: true, uid: "E0040150ABCDEF01", state: "PRESENT", time: hbTime });
  m = applyMessage(m, "rfid/s/reader/R-1/state", stateOf("PC-1", "R-1"), hbMs - 180_000);
  m = applyMessage(m, "rfid/s/reader/R-2/state", stateOf("PC-2", "R-2"), hbMs);
  m = applyMessage(m, "rfid/s/reader/R-3/state", stateOf("PC-9", "R-3"), hbMs);
  m = applyMessage(m, "rfid/x/reader/R-4/state", stateOf("PC-1", "R-4"), hbMs);
  const skews = readerSkews(m.readers, m.hosts);
  assert.deepEqual(skews, { "s/R-1": 180_000, "s/R-2": -1_000 }, "PC-9 는 하트비트가 없고, 사업장 x 의 PC-1 은 다른 PC");

  // 경과 시간 보정: PC-1 시계가 3분 앞서므로 보정 없이는 0 에 묶이고, 보정하면 화면 시계 기준으로 흐른다.
  const now = hbMs - 180_000 + 45_000;
  const r1 = m.readers["s/R-1"];
  assert.equal(elapsedMs(r1.at, r1.receivedAt, now), 0, "보정 없이는 미래 시각이라 0");
  assert.equal(elapsedMs(r1.at, r1.receivedAt, now, skews["s/R-1"]), 45_000);
  assert.equal(readerPaint(r1, undefined, undefined, now, skews["s/R-1"]).sub, "00:45");
  assert.equal(readerPaint(r1, undefined, undefined, now).sub, "00:00");
  assert.equal(formatAgo(hbTime, now, 180_000), "45초 전");
  assert.equal(formatAgo(hbTime, now), "0초 전");

  // 편차를 못 잰(null) 감시 PC 목록은 아무 것도 잇지 않는다.
  assert.deepEqual(readerSkews(m.readers, {}), {});
});
