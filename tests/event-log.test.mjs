/**
 * 이벤트 로그 — 하루 파일 JSONL 기록 · 조회 · 겹침 제거 · 보관 정리, 브로커 기록기(가짜 클라이언트), /api/live/events.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { bulkRows, csvCell, historyCsv, historyFileName, pairEvents } from "../app/live/historyCsv.ts";
import { DEFAULT_HISTORY_RANGE, HISTORY_RANGES, historyRange, rangeQuery, startOfDay } from "../app/live/historyRange.ts";
import { createEventLog, dayOf, lastRemovals } from "../server/eventLog.ts";
import { createEventLogger, readLoggerConfig } from "../server/eventLogger.ts";
import { createFormatStore } from "../server/formatStore.ts";
import { createLiveApi } from "../server/liveApi.ts";

const T0 = Date.parse("2026-09-16T09:00:00+09:00");

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "grid-events-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function ev(overrides = {}) {
  const base = {
    time: "2026-09-16T09:00:00.000+09:00",
    receivedAt: T0,
    site: "default",
    key: "RR657-005592",
    kind: "APPEAR",
    uid: "C6117A17530104E0",
    serial: "RR657-005592",
    reader: "05-01",
    host: "C1141",
    dwellMs: null,
  };
  const e = { ...base, ...overrides };
  return { id: `${e.time}|${e.site}/${e.key}|${e.kind}`, ...e };
}

// ------------------------------------------------------------ 로그 파일

test("기록: 하루 · 프로세스별 파일에 한 줄씩, 같은 id 는 한 번만", () => {
  const { dir, cleanup } = freshDir();
  try {
    const log = createEventLog(dir, { instance: "t", now: () => T0 });
    assert.equal(log.append(ev()), true);
    assert.equal(log.append(ev()), false, "재전송은 파일에 두 번 쓰지 않는다");
    assert.equal(log.append(ev({ kind: "REMOVE", time: "2026-09-16T09:00:07.000+09:00", receivedAt: T0 + 7000, dwellMs: 7000 })), true);
    const files = readdirSync(dir);
    assert.deepEqual(files, [`${dayOf(T0)}.t.jsonl`]);
    const lines = readFileSync(join(dir, files[0]), "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]).dwellMs, 7000);
    assert.equal(log.status().appended, 2);
    assert.ok(log.status().todayBytes > 0);
  } finally {
    cleanup();
  }
});

test("조회: 범위 · 사업장 · 리더로 걸러 최신부터, 두 프로세스가 겹쳐 쓴 것은 하나로", () => {
  const { dir, cleanup } = freshDir();
  try {
    const main = createEventLog(dir, { instance: "main", now: () => T0 });
    const dev = createEventLog(dir, { instance: "dev", now: () => T0 });
    const a = ev();
    const b = ev({ kind: "REMOVE", time: "2026-09-16T09:00:07.000+09:00", receivedAt: T0 + 7000, dwellMs: 7000 });
    const other = ev({ key: "RR657-005593", reader: "05-02", receivedAt: T0 + 100 });
    const yesterday = ev({ time: "2026-09-15T09:00:00.000+09:00", receivedAt: T0 - 86_400_000 });
    main.append(a);
    main.append(b);
    main.append(other);
    main.append(yesterday);
    dev.append(a); // 개발 서버도 같은 이벤트를 받아 적었다
    dev.append(b);
    assert.equal(readdirSync(dir).length, 3, "오늘 main · 오늘 dev · 어제 main");

    const all = main.query({ fromMs: T0 - 1000, toMs: T0 + 10_000 });
    assert.deepEqual(all.events.map((e) => e.id), [b.id, other.id, a.id], "최신이 앞, 겹친 것은 하나");
    assert.equal(all.files, 2);
    assert.equal(all.truncated, false);

    const one = main.query({ fromMs: T0 - 1000, toMs: T0 + 10_000, key: "RR657-005592" });
    assert.deepEqual(one.events.map((e) => e.kind), ["REMOVE", "APPEAR"]);

    const limited = main.query({ fromMs: T0 - 1000, toMs: T0 + 10_000, limit: 1 });
    assert.equal(limited.events.length, 1);
    assert.equal(limited.truncated, true);

    const wide = main.query({ fromMs: T0 - 2 * 86_400_000, toMs: T0 + 10_000, site: "default" });
    assert.equal(wide.events.length, 4);
    assert.equal(wide.events.at(-1).id, yesterday.id, "어제 파일도 읽는다");

    assert.equal(main.query({ fromMs: T0 - 1000, toMs: T0 + 10_000, site: "없음" }).events.length, 0);
  } finally {
    cleanup();
  }
});

test("조회: 쓰다 끊긴 줄은 건너뛰고, 보관 일수를 넘은 파일은 정리한다", () => {
  const { dir, cleanup } = freshDir();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${dayOf(T0)}.x.jsonl`), JSON.stringify(ev()) + "\n{\"id\":\"깨진", "utf8");
    writeFileSync(join(dir, `2026-08-01.x.jsonl`), JSON.stringify(ev({ receivedAt: Date.parse("2026-08-01T09:00:00+09:00") })) + "\n", "utf8");
    writeFileSync(join(dir, `notes.txt`), "무관한 파일", "utf8");
    const log = createEventLog(dir, { instance: "t", retentionDays: 30, now: () => T0 });
    assert.equal(log.query({ fromMs: T0 - 1000, toMs: T0 + 1000 }).events.length, 1);
    assert.equal(log.prune(), 1);
    assert.equal(existsSync(join(dir, "2026-08-01.x.jsonl")), false);
    assert.equal(existsSync(join(dir, "notes.txt")), true, "모르는 파일은 건드리지 않는다");
    assert.equal(log.status().files, 1);
  } finally {
    cleanup();
  }
});

// ------------------------------------------------------------ 기록기

/** 가짜 MQTT 클라이언트 — 핸들러를 잡아 두고 시험이 메시지를 밀어 넣는다. */
function fakeMqtt() {
  const handlers = {};
  const subscribed = [];
  const client = {
    on(event, handler) {
      handlers[event] = handler;
    },
    subscribe(topic, options) {
      subscribed.push({ topic, options });
    },
    end() {
      client.ended = true;
    },
    ended: false,
  };
  return { client, handlers, subscribed, connect: async () => client };
}

test("기록기: 브로커의 이벤트를 형식 프로필로 읽어 로그에 쌓고, 상태 메시지는 무시한다", async () => {
  const { dir, cleanup } = freshDir();
  try {
    const formats = createFormatStore(dir, { log: () => {} });
    const log = createEventLog(join(dir, ".live", "events"), { instance: "t", now: () => T0 });
    const fake = fakeMqtt();
    const said = [];
    const handle = createEventLogger({ log, formats, configDir: join(dir, ".live"), connect: fake.connect, now: () => T0, logger: (m) => said.push(m) });
    await new Promise((r) => setTimeout(r, 10));
    fake.handlers.connect();
    assert.deepEqual(fake.subscribed, [{ topic: "rfid/+/reader/+/event", options: { qos: 1 } }]);
    assert.equal(handle.status().connected, true);

    const payload = JSON.stringify({ v: 1, type: "event", time: "2026-09-16T09:00:00.000+09:00", kind: "APPEAR", reader: "05-01", serial: "RR657-005592", uid: "C6117A17530104E0", host: "C1141" });
    fake.handlers.message("rfid/default/reader/RR657-005592/event", Buffer.from(payload));
    fake.handlers.message("rfid/default/reader/RR657-005592/event", Buffer.from(payload)); // 재전송
    fake.handlers.message("rfid/default/reader/RR657-005592/state", Buffer.from('{"present":true}')); // 상태는 이벤트가 아니다
    fake.handlers.message("rfid/default/reader/RR657-005592/event", Buffer.from("깨진 json"));

    const status = handle.status();
    assert.equal(status.received, 4);
    assert.equal(status.logged, 1);
    const q = log.query({ fromMs: T0 - 1000, toMs: T0 + 1000 });
    assert.equal(q.events.length, 1);
    assert.equal(q.events[0].reader, "05-01");
    assert.equal(q.events[0].receivedAt, T0);

    // 사업장 프로필이 있으면 그 경로로 읽는다.
    formats.save("gw", { event: { kind: "ev", uid: "tag.epc", reader: "device.label", time: "ts" }, values: { removeValues: ["OUT"] } }, "t");
    fake.handlers.message("plc/gw/reader/GW-1/event", Buffer.from(JSON.stringify({ ev: "OUT", tag: { epc: "E004" }, device: { label: "게이트" }, ts: 1789443090 })));
    const gw = log.query({ fromMs: T0 - 1000, toMs: T0 + 1000, site: "gw" });
    assert.equal(gw.events.length, 1);
    assert.equal(gw.events[0].kind, "REMOVE");
    assert.equal(gw.events[0].reader, "게이트");

    await handle.stop();
    assert.equal(fake.client.ended, true);
  } finally {
    cleanup();
  }
});

test("기록기 설정: 파일이 없으면 같은 PC 브로커, 있으면 그 값, enabled:false 면 구독하지 않는다", async () => {
  const { dir, cleanup } = freshDir();
  try {
    assert.deepEqual(readLoggerConfig(dir), { enabled: true, broker: "mqtt://127.0.0.1:1883", prefix: "rfid", site: "+", retentionDays: 30 });
    writeFileSync(join(dir, "logger.json"), JSON.stringify({ broker: "mqtt://10.0.0.9:1883", prefix: "plc", retentionDays: 7 }), "utf8");
    assert.deepEqual(readLoggerConfig(dir), { enabled: true, broker: "mqtt://10.0.0.9:1883", prefix: "plc", site: "+", retentionDays: 7 });

    writeFileSync(join(dir, "logger.json"), JSON.stringify({ enabled: false }), "utf8");
    const formats = createFormatStore(dir, { log: () => {} });
    const log = createEventLog(join(dir, "events"), { instance: "t" });
    let connected = 0;
    const handle = createEventLogger({ log, formats, configDir: dir, connect: async () => { connected += 1; return fakeMqtt().client; }, logger: () => {} });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(connected, 0);
    assert.equal(handle.status().enabled, false);
    await handle.stop();
  } finally {
    cleanup();
  }
});

// ------------------------------------------------------------ API

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(text) {
      this.body = text ?? "";
    },
    get json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}

async function call(api, method, url) {
  const res = fakeResponse();
  await api({ method, url, async *[Symbol.asyncIterator]() {} }, res, () => {});
  return res;
}

test("API: /api/live/events 는 리더별 최신 이벤트를 시간 범위로, status 는 로그 · 기록기 상태를 준다", async () => {
  const { dir, cleanup } = freshDir();
  try {
    const { middleware, store } = createLiveApi(dir, { log: () => {}, logger: false, eventLog: { instance: "t", now: () => T0 } });
    store.events.append(ev());
    store.events.append(ev({ kind: "REMOVE", time: "2026-09-16T09:00:07.000+09:00", receivedAt: T0 + 7000, dwellMs: 7000 }));
    store.events.append(ev({ time: "2026-09-14T09:00:00.000+09:00", receivedAt: T0 - 2 * 86_400_000 }));

    const page = await call(middleware, "GET", `/api/live/events?site=default&key=RR657-005592&hours=24&before=${T0 + 10_000}`);
    assert.equal(page.statusCode, 200);
    assert.equal(page.json.events.length, 2, "48시간 전 것은 24시간 범위 밖");
    assert.equal(page.json.events[0].kind, "REMOVE");
    assert.equal(page.json.hours, 24);
    assert.equal(page.json.fromMs, T0 + 10_000 - 24 * 3_600_000);

    const older = await call(middleware, "GET", `/api/live/events?key=RR657-005592&hours=24&before=${page.json.fromMs}`);
    assert.equal(older.json.events.length, 0);
    const wide = await call(middleware, "GET", `/api/live/events?key=RR657-005592&hours=72&before=${T0 + 10_000}`);
    assert.equal(wide.json.events.length, 3);

    // `since` — 화면의 "오늘": 그 시각부터. hours 가 함께 와도 since 가 이긴다. 최대 폭(31일)은 넘지 못한다.
    const today = await call(middleware, "GET", `/api/live/events?key=RR657-005592&since=${T0 - 3_600_000}&hours=720&before=${T0 + 10_000}`);
    assert.equal(today.json.fromMs, T0 - 3_600_000);
    assert.equal(today.json.events.length, 2, "48시간 전 것은 since 앞");
    assert.ok(Math.abs(today.json.hours - (3_610_000 / 3_600_000)) < 1e-9, "hours 는 실제 폭");
    const tooWide = await call(middleware, "GET", `/api/live/events?key=RR657-005592&since=${T0 - 400 * 86_400_000}&before=${T0}`);
    assert.equal(tooWide.json.fromMs, T0 - 31 * 86_400_000, "31일로 잘림");

    // 잔상 씨앗: 리더마다 마지막 이벤트가 제거인 것. 다른 리더는 등장이 마지막이라 빠진다.
    store.events.append(ev({ key: "R-2", serial: "R-2", time: "2026-09-16T09:00:20.000+09:00", receivedAt: T0 + 20_000 }));
    const ghosts = await call(middleware, "GET", "/api/live/events/ghosts?site=default&hours=24");
    assert.equal(ghosts.statusCode, 200);
    assert.deepEqual(ghosts.json.ghosts.map((g) => [g.key, g.kind, g.uid]), [["RR657-005592", "REMOVE", "C6117A17530104E0"]]);
    assert.equal(ghosts.json.truncated, false);

    const status = await call(middleware, "GET", "/api/live/events/status");
    assert.equal(status.json.log.appended, 4, "위에서 넣은 3건 + 잔상 씨앗 시험용 1건");
    assert.equal(status.json.logger, null, "시험에서는 기록기를 끈다");

    assert.equal((await call(middleware, "GET", "/api/live/events/nope")).statusCode, 404);
  } finally {
    cleanup();
  }
});

// ------------------------------------------------------------ 화면: CSV 내려받기

test("CSV: BOM · 머리글 · 따옴표 처리 · 체류 초 · 태그 이름, 파일 이름은 안전하게", () => {
  const appear = ev({ time: "2026-09-16T09:00:00.000+09:00", receivedAt: T0, reader: '05-01, "칼" 라인' });
  const remove = ev({ kind: "REMOVE", time: "2026-09-16T09:00:07.500+09:00", receivedAt: T0 + 7500, dwellMs: 7500, reader: '05-01, "칼" 라인' });
  const snapshot = {
    key: { field: "uid", column: "카드번호", format: "hex", reverseBytes: false },
    display: { title: "{정의구분} {정의번호}", subtitle: "{정의명}" },
    columns: [],
    rows: { C6117A17530104E0: { 정의구분: "통번호", 정의번호: "129", 정의명: "칼작업분배" } },
  };
  const csv = historyCsv([{ appear, remove }, { appear: null, remove: ev({ kind: "REMOVE", uid: "DEAD", receivedAt: T0 - 5000 }) }], snapshot);
  assert.equal(csv.charCodeAt(0), 0xfeff, "엑셀용 BOM");
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], "등장,제거,체류(초),태그,태그 상세,UID,리더,S/N,감시 PC,사업장");
  assert.match(lines[1], /^2026-09-16 09:00:00,2026-09-16 09:00:07,7\.5,통번호 129,칼작업분배,C6117A17530104E0,"05-01, ""칼"" 라인",RR657-005592,C1141,default$/);
  assert.match(lines[2], /^,2026-09-16 09:00:00,,,,DEAD,/, "짝 없는 제거는 등장 칸이 비고 이름 없는 UID 는 그대로");
  assert.equal(lines[3], "", "CRLF 로 끝난다");
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell(null), "");
  assert.equal(historyFileName("05-01 / 칼:작업", new Date("2026-09-16T12:00:00")), "식별이력_05-01_칼_작업_2026-09-16.csv");
  assert.equal(historyFileName("   ", new Date("2026-09-16T12:00:00")), "식별이력_reader_2026-09-16.csv");
});

test("lastRemovals: 리더별 첫(최신) 이벤트만 보고, 그것이 UID 있는 제거일 때만 남긴다", () => {
  const events = [
    ev({ key: "A", kind: "REMOVE", time: "2026-09-16T09:00:30.000+09:00", receivedAt: T0 + 30_000, uid: "AAA" }),
    ev({ key: "B", kind: "APPEAR", time: "2026-09-16T09:00:25.000+09:00", receivedAt: T0 + 25_000, uid: "BBB" }),
    ev({ key: "B", kind: "REMOVE", time: "2026-09-16T09:00:20.000+09:00", receivedAt: T0 + 20_000, uid: "B0" }),
    ev({ key: "A", kind: "APPEAR", time: "2026-09-16T09:00:10.000+09:00", receivedAt: T0 + 10_000, uid: "AAA" }),
    ev({ key: "C", kind: "REMOVE", time: "2026-09-16T09:00:05.000+09:00", receivedAt: T0 + 5_000, uid: "" }),
  ];
  assert.deepEqual(lastRemovals(events).map((e) => e.key), ["A"], "B 는 등장이 마지막, C 는 UID 없음");
  assert.deepEqual(lastRemovals([]), []);
});

test("기간 선택: 오늘은 이 시간대의 0시부터, 이어 받기는 달력 하루씩, 나머지는 n시간 폭", () => {
  assert.equal(DEFAULT_HISTORY_RANGE, "today");
  assert.deepEqual(HISTORY_RANGES.map((r) => r.label), ["오늘", "24시간", "3일", "7일", "30일"]);
  assert.equal(historyRange("없는 값").id, "today", "모르는 값은 첫 항목");

  const now = new Date(2026, 8, 17, 14, 30, 5).getTime(); // 2026-09-17 14:30:05 (이 환경 시간대)
  const midnight = new Date(2026, 8, 17).getTime();
  assert.equal(startOfDay(now), midnight);
  assert.equal(startOfDay(midnight), midnight, "0시는 그대로");

  assert.deepEqual(rangeQuery("today", now), { since: midnight });
  // 이어 받기: 오늘 0시 앞은 어제 0시 ~ 오늘 0시.
  assert.deepEqual(rangeQuery("today", now, midnight), { since: new Date(2026, 8, 16).getTime(), before: midnight });
  assert.deepEqual(rangeQuery("24h", now), { hours: 24 });
  assert.deepEqual(rangeQuery("7d", now, midnight), { hours: 168, before: midnight });
  assert.equal(historyRange("today").step, "하루");
  assert.equal(historyRange("3d").step, "3일");
});

// ------------------------------------------------------------ 화면: 등장 · 제거 짝짓기

test("이력 짝짓기: 최신순 이벤트를 등장 → 제거 한 줄로, 짝 없는 것은 홀로", () => {
  const a1 = ev({ time: "t1", receivedAt: 1 });
  const r1 = ev({ kind: "REMOVE", time: "t2", receivedAt: 2, dwellMs: 1000 });
  const a2 = ev({ time: "t3", receivedAt: 3, uid: "BBBB" });
  const rows = pairEvents([a2, r1, a1]); // 최신이 앞
  assert.deepEqual(
    rows.map((r) => [r.appear?.time ?? null, r.remove?.time ?? null]),
    [["t3", null], ["t1", "t2"]],
    "놓여 있는 것(a2) 한 줄, a1→r1 한 줄",
  );
  // 서버가 켜지기 전에 등장한 태그의 제거만 남은 경우.
  const rOnly = pairEvents([r1]);
  assert.deepEqual(rOnly.map((r) => [r.appear, r.remove?.time]), [[null, "t2"]]);
  // UID 가 다르면 짝이 아니다.
  const mismatch = pairEvents([ev({ kind: "REMOVE", time: "t2", receivedAt: 2, uid: "X" }), a1]);
  assert.equal(mismatch.length, 2);
});

test("일괄 이력: 여러 리더의 이벤트를 리더별로 짝짓고 리더 이름 순으로, 페이지의 리더만 고를 수 있다", () => {
  const a = [
    ev({ key: "R2", reader: "나", time: "t1", receivedAt: 1 }),
    ev({ key: "R2", reader: "나", kind: "REMOVE", time: "t2", receivedAt: 2, dwellMs: 1000 }),
    ev({ key: "R1", reader: "가", time: "t3", receivedAt: 3 }),
    ev({ key: "R3", reader: "다", site: "other", time: "t4", receivedAt: 4 }),
  ];
  const rows = bulkRows(a);
  assert.deepEqual(
    rows.map((r) => [(r.appear ?? r.remove).reader, r.appear?.time ?? null, r.remove?.time ?? null]),
    [["가", "t3", null], ["나", "t1", "t2"], ["다", "t4", null]],
  );
  const onlyPage = bulkRows(a, new Set(["default/R1", "default/R2"]));
  assert.deepEqual(onlyPage.map((r) => (r.appear ?? r.remove).key), ["R1", "R2"], "다른 사업장 · 다른 리더는 빠진다");
  assert.equal(bulkRows([], new Set()).length, 0);
});
