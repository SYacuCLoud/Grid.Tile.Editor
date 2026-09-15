/**
 * 메시지 형식 프로필 — 검사 · JSON 경로 · 값 해석 · 프로필로 메시지 읽기 · 파일 저장소 · /api/live 라우팅.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMessage, EMPTY_LIVE } from "../app/live/liveState.ts";
import {
  checkPath,
  defaultFormat,
  formatFor,
  getPath,
  isDefaultFormat,
  parseMessageFormat,
  previewFields,
  readBool,
  readKind,
  readTime,
} from "../app/live/messageFormat.ts";
import { createFormatStore } from "../server/formatStore.ts";
import { createLiveApi } from "../server/liveApi.ts";
import { parseLivePath } from "../server/liveRouter.ts";

/** PLC 게이트웨이가 낸다고 치는 다른 모양의 페이로드. */
const GATEWAY_STATE = JSON.stringify({
  device: { sn: "GW-01-R3", label: "3번 게이트", pc: "PLC-A" },
  tag: { epc: "e0 04 01 53 2a 86 b1 70", tech: "ISO15693" },
  detected: "ON",
  alive: 1,
  ts: 1789443082,
});
const GATEWAY_EVENT = JSON.stringify({ ev: "OUT", device: { sn: "GW-01-R3", label: "3번 게이트" }, tag: { epc: "E00401532A86B170" }, ts: 1789443090123, held: "7069" });
const GATEWAY_STATUS = JSON.stringify({ up: true, name: "PLC-A", ts: 1789443082, readers: { total: 4, ok: 3 } });

const GATEWAY_FORMAT = {
  state: { uid: "tag.epc", present: "detected", online: "alive", serial: "device.sn", reader: "device.label", alias: "", readerName: "", host: "device.pc", tech: "tag.tech", state: "detected", time: "ts" },
  event: { kind: "ev", uid: "tag.epc", serial: "device.sn", reader: "device.label", time: "ts", dwellMs: "held" },
  status: { online: "up", host: "name", time: "ts", readerCount: "readers.total", onlineReaders: "readers.ok" },
  values: { trueValues: ["ON", "1", "true"], removeValues: ["OUT"], timeFormat: "auto" },
};

// ------------------------------------------------------------ 검사 · 경로

test("기본 프로필은 v1 — 경로가 곧 필드 이름이고, 기본과 같은지 알아본다", () => {
  const base = defaultFormat("default");
  assert.equal(base.state.uid, "uid");
  assert.equal(base.event.dwellMs, "dwellMs");
  assert.equal(isDefaultFormat(base), true);
  assert.equal(isDefaultFormat(parseMessageFormat({ state: { uid: "tag.epc" } })), false);
  // 목록의 대소문자 · 빈 값은 기본과 같은 것으로 본다.
  assert.equal(isDefaultFormat(parseMessageFormat({ values: { trueValues: "TRUE, 1, Yes, y, ON, present" } })), true);
});

test("검사: 경로 문법 · 시각 형식 · 판 번호를 한국어로 알린다", () => {
  assert.equal(checkPath(" tag.epc ", "x"), "tag.epc");
  assert.equal(checkPath("readers[0].id", "x"), "readers[0].id");
  assert.equal(checkPath("", "x"), "", "빈 경로 = 읽지 않음");
  assert.throws(() => checkPath("a..b", "state.uid"), /JSON 경로가 이상합니다/);
  assert.throws(() => checkPath("a[x]", "state.uid"), /JSON 경로/);
  assert.throws(() => parseMessageFormat({ v: 2 }), /판/);
  assert.throws(() => parseMessageFormat({ values: { timeFormat: "unix" } }), /timeFormat/);
  assert.throws(() => parseMessageFormat({ state: { uid: 3 } }), /문자열/);
  assert.throws(() => parseMessageFormat({}, "_meta"), /쓸 수 없습니다/);
  const parsed = parseMessageFormat({ state: { uid: "tag.epc", alias: null }, values: { removeValues: "OUT,GONE" } }, "gw");
  assert.equal(parsed.site, "gw");
  assert.equal(parsed.state.uid, "tag.epc");
  assert.equal(parsed.state.alias, "", "null 은 읽지 않음");
  assert.equal(parsed.state.present, "present", "안 적은 필드는 기본 경로");
  assert.deepEqual(parsed.values.removeValues, ["OUT", "GONE"]);
});

test("JSON 경로: 점 · 배열 · 없는 곳", () => {
  const json = { a: { b: [{ c: 1 }, { c: 2 }] }, "한글 키": "값", n: null };
  assert.equal(getPath(json, "a.b[1].c"), 2);
  assert.equal(getPath(json, "a.b[0]").c, 1);
  assert.equal(getPath(json, "한글 키"), "값", "읽기 자체는 되지만 설정 검사(checkPath)가 공백 있는 경로를 거른다");
  assert.throws(() => checkPath("한글 키", "x"), /JSON 경로/);
  assert.equal(getPath(json, "a.x.y"), undefined);
  assert.equal(getPath(json, "n"), null);
  assert.equal(getPath(json, ""), undefined);
  assert.equal(getPath("문자열", "a"), undefined);
});

test("값 해석: 참/거짓 글자 목록, epoch 초 · 밀리초, 제거값 목록", () => {
  const rules = parseMessageFormat(GATEWAY_FORMAT).values;
  assert.equal(readBool("on", rules), true);
  assert.equal(readBool("off", rules), false);
  assert.equal(readBool(1, rules), true);
  assert.equal(readBool(false, rules), false);
  assert.equal(readTime(1789443082, rules), new Date(1789443082 * 1000).toISOString(), "auto: 초");
  assert.equal(readTime(1789443090123, rules), new Date(1789443090123).toISOString(), "auto: 밀리초");
  assert.equal(readTime("2026-09-15T12:00:00+09:00", rules), "2026-09-15T12:00:00+09:00", "글자는 그대로");
  assert.equal(readTime("1789443082", { ...rules, timeFormat: "epochS" }), new Date(1789443082 * 1000).toISOString());
  assert.equal(readTime("", rules), "");
  assert.equal(readKind("out", rules), "REMOVE");
  assert.equal(readKind("IN", rules), "APPEAR");
  assert.equal(readKind(undefined, rules), "APPEAR");
});

// ------------------------------------------------------------ 프로필로 읽기

test("다른 모양의 페이로드도 프로필만 맞추면 v1 과 같은 모델이 된다", () => {
  const book = { sites: { gw: parseMessageFormat(GATEWAY_FORMAT, "gw") } };
  let m = applyMessage(EMPTY_LIVE, "plc/gw/reader/GW-01-R3/state", GATEWAY_STATE, 1000, book);
  const r = m.readers["gw/GW-01-R3"];
  assert.equal(r.uid, "e0 04 01 53 2a 86 b1 70");
  assert.equal(r.present, true, "detected:ON → 참");
  assert.equal(r.online, true, "alive:1 → 참");
  assert.equal(r.serial, "GW-01-R3");
  assert.equal(r.reader, "3번 게이트");
  assert.equal(r.host, "PLC-A");
  assert.equal(r.tech, "ISO15693");
  assert.equal(r.at, new Date(1789443082 * 1000).toISOString());
  assert.equal(m.samples.gw.state, GATEWAY_STATE, "원문 표본이 남는다");

  m = applyMessage(m, "plc/gw/reader/GW-01-R3/event", GATEWAY_EVENT, 2000, book);
  assert.equal(m.events[0].kind, "REMOVE", "ev:OUT → 제거");
  assert.equal(m.events[0].dwellMs, 7069, "글자 숫자도 ms 로");
  assert.equal(m.events[0].uid, "E00401532A86B170");
  assert.equal(m.flashes["gw/GW-01-R3"].kind, "REMOVE");

  m = applyMessage(m, "plc/gw/host/PLC-A/status", GATEWAY_STATUS, 3000, book);
  const h = m.hosts["gw/PLC-A"];
  assert.equal(h.online, true);
  assert.equal(h.readerCount, 4);
  assert.equal(h.onlineReaders, 3);
  assert.equal(h.appearToday, 0, "경로가 없는 필드는 0");

  // 다른 사업장은 프로필이 없으니 v1 로 읽는다 — 같은 페이로드가 다르게 해석된다.
  const v1 = applyMessage(EMPTY_LIVE, "plc/other/reader/X/state", GATEWAY_STATE, 1000, book);
  assert.equal(v1.readers["other/X"].uid, "", "v1 은 uid 필드를 찾는다");
  assert.equal(formatFor(book, "other").site, "other");
  assert.equal(formatFor(null, "x").state.uid, "uid");
});

test("미리보기: 표본에서 각 필드가 어떻게 읽히는지", () => {
  const format = parseMessageFormat(GATEWAY_FORMAT, "gw");
  const rows = previewFields(format, "state", GATEWAY_STATE);
  const by = Object.fromEntries(rows.map((r) => [r.field, r]));
  assert.equal(by.present.shown, "참");
  assert.equal(by.uid.shown, "e0 04 01 53 2a 86 b1 70");
  assert.equal(by.alias.raw, undefined, "빈 경로는 읽지 않음");
  assert.equal(by.time.shown, new Date(1789443082 * 1000).toISOString());
  assert.equal(previewFields(format, "event", GATEWAY_EVENT).find((r) => r.field === "kind").shown, "제거");
  assert.equal(previewFields(format, "state", "깨진 json").find((r) => r.field === "uid").raw, undefined);
});

// ------------------------------------------------------------ 저장소 · API

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "grid-format-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("저장소: 저장 → 파일, 기본과 같으면 파일을 지운다, 깨진 파일은 오류로 알린다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createFormatStore(dir, { log: () => {}, now: () => new Date("2026-09-15T06:00:00Z") });
    assert.deepEqual(store.book().sites, {});
    assert.equal(store.get("gw"), null);

    const saved = store.save("gw", GATEWAY_FORMAT, "홍길동");
    assert.equal(saved.state.uid, "tag.epc");
    assert.equal(saved.updatedBy, "홍길동");
    assert.equal(saved.updatedAt, "2026-09-15T06:00:00.000Z");
    const file = join(dir, ".live", "gw.json");
    assert.ok(existsSync(file));
    assert.equal(JSON.parse(readFileSync(file, "utf8")).site, "gw");
    assert.equal(store.book().sites.gw.event.kind, "ev");

    // 기본으로 되돌리면 파일이 사라진다.
    const back = store.save("gw", defaultFormat("gw"), "홍길동");
    assert.equal(isDefaultFormat(back), true);
    assert.equal(existsSync(file), false);

    mkdirSync(join(dir, ".live"), { recursive: true });
    writeFileSync(join(dir, ".live", "bad.json"), "{ 깨짐", "utf8");
    assert.match(store.book().errors.bad, /JSON/);
    assert.throws(() => store.save("gw", { state: { uid: "a..b" } }, "x"), /JSON 경로/);
  } finally {
    cleanup();
  }
});

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

async function call(api, method, url, body) {
  const res = fakeResponse();
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
  let passed = false;
  await api(
    {
      method,
      url,
      async *[Symbol.asyncIterator]() {
        if (payload) yield payload;
      },
    },
    res,
    () => {
      passed = true;
    },
  );
  return { res, passed };
}

test("API: 목록 · 사업장(없으면 기본) · 저장 · 되돌리기, 다른 주소는 넘긴다", async () => {
  const { dir, cleanup } = freshDir();
  try {
    const { middleware } = createLiveApi(dir, { log: () => {} });
    assert.equal((await call(middleware, "GET", "/live")).passed, true);

    const empty = await call(middleware, "GET", "/api/live/format");
    assert.equal(empty.res.statusCode, 200);
    assert.deepEqual(empty.res.json.sites, {});

    const def = await call(middleware, "GET", "/api/live/format/gw");
    assert.equal(def.res.json.isDefault, true);
    assert.equal(def.res.json.format.state.uid, "uid");

    const saved = await call(middleware, "PUT", "/api/live/format/gw", { format: GATEWAY_FORMAT, author: "가" });
    assert.equal(saved.res.statusCode, 200, saved.res.body);
    assert.equal(saved.res.json.isDefault, false);
    assert.equal(saved.res.json.format.state.uid, "tag.epc");
    assert.equal((await call(middleware, "GET", "/api/live/format")).res.json.sites.gw.updatedBy, "가");

    const bad = await call(middleware, "PUT", "/api/live/format/gw", { format: { values: { timeFormat: "x" } }, author: "가" });
    assert.equal(bad.res.statusCode, 400);

    const reset = await call(middleware, "DELETE", "/api/live/format/gw");
    assert.equal(reset.res.json.isDefault, true);
    assert.deepEqual((await call(middleware, "GET", "/api/live/format")).res.json.sites, {});

    assert.equal((await call(middleware, "GET", "/api/live/nope")).res.statusCode, 404);
    assert.equal((await call(middleware, "POST", "/api/live/format")).res.statusCode, 404);
  } finally {
    cleanup();
  }
});

test("경로 해석: /api/live 만 잡는다", () => {
  assert.deepEqual(parseLivePath("/api/live"), []);
  assert.deepEqual(parseLivePath("/api/live/format/gw"), ["format", "gw"]);
  assert.equal(parseLivePath("/api/lives"), null);
  assert.equal(parseLivePath("/live"), null);
});
