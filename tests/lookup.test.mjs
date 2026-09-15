/**
 * 기준정보 매핑(UID → 실물) — 설정 검사 · 키 정규화 · 템플릿 · 스냅샷 · 저장소 · API.
 * DB 없이 가짜 질의기로 본다.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildRows,
  coerceValue,
  emptySnapshot,
  mergeDraft,
  normalizeKey,
  parseLookupConfig,
  pickSnapshot,
  publicConfig,
  renderTemplate,
  resolveTag,
  subjectValue,
  tagLabel,
  tagLine,
  templateColumns,
} from "../app/live/lookup.ts";
import { fitLabel, MIN_LABEL_FONT, wrapLabel } from "../app/live/liveState.ts";
import { createLookupApi, parseLookupPath } from "../server/lookupApi.ts";
import { buildSelect, createLookupStore, filterSql, parseConnections, parseEnvText, resolveTarget } from "../server/lookupStore.ts";

const CONFIG = {
  v: 1,
  site: "default",
  source: { kind: "mssql", env: "db.env", table: "mes_db.dbo.tb_rfid_card" },
  key: { column: "카드번호", format: "hex" },
  display: { title: "{정의구분} {정의번호}", subtitle: "{정의명}" },
  columns: ["정의구분", "정의번호", { column: "정의명" }, { column: "등록일자", label: "등록" }, { column: "비고", show: false }],
  refreshSeconds: 120,
};

const ROWS = [
  { 카드번호: "C6117A17530104E0", 정의구분: "통번호", 정의번호: "129", 정의명: "칼작업분배", 등록일자: "2026-09-08", 비고: null },
  { 카드번호: "62077b17530104e0", 정의구분: "사원", 정의번호: "20044", 정의명: "노이남", 등록일자: null, 비고: "" },
  { 카드번호: "", 정의구분: "빈키", 정의번호: "0", 정의명: null, 등록일자: null, 비고: null },
  { 카드번호: "C6117A17530104E0", 정의구분: "중복", 정의번호: "999", 정의명: null, 등록일자: null, 비고: null },
];

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "grid-lookup-"));
  mkdirSync(join(dir, ".lookup"));
  writeFileSync(join(dir, "db.env"), "SERVER=192.0.2.10,1433\nDATABASE=mes_db\nUSERNAME=mes\nPASSWORD=\"p w\"\n", "utf8");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function writeConfig(dir, site, config) {
  writeFileSync(join(dir, ".lookup", `${site}.json`), JSON.stringify({ ...config, source: { ...config.source, env: join(dir, "db.env") } }), "utf8");
}

// ------------------------------------------------------------ 설정

test("설정: 문자열 열과 객체 열을 모두 받고, 제목이 쓰는 열은 숨김으로 채워 넣는다", () => {
  const config = parseLookupConfig({ ...CONFIG, columns: ["정의번호"] }, "default");
  assert.equal(config.site, "default");
  assert.equal(config.key.format, "hex");
  assert.equal(config.refreshSeconds, 120);
  assert.deepEqual(
    config.columns.map((c) => [c.column, c.show ?? true]),
    [["정의번호", true], ["정의구분", false], ["정의명", false]],
  );
});

test("설정: 파일 이름의 사업장이 안의 site 보다 우선한다", () => {
  const config = parseLookupConfig({ ...CONFIG, site: "안쪽" }, "파일이름");
  assert.equal(config.site, "파일이름");
});

test("설정: 틀린 곳을 한국어로 알린다", () => {
  assert.throws(() => parseLookupConfig(null), /JSON 객체/);
  assert.throws(() => parseLookupConfig({ ...CONFIG, v: 2 }), /v=1/);
  assert.throws(() => parseLookupConfig({ ...CONFIG, source: { ...CONFIG.source, kind: "csv" } }), /mssql/);
  assert.throws(() => parseLookupConfig({ ...CONFIG, source: { ...CONFIG.source, table: "dbo.[bad] table" } }), /쓸 수 없는 이름/);
  assert.throws(() => parseLookupConfig({ ...CONFIG, key: { column: "a; DROP" } }), /쓸 수 없는 이름/);
  assert.throws(() => parseLookupConfig({ ...CONFIG, key: { column: "카드번호", format: "base64" } }), /hex.*text/);
  assert.throws(() => parseLookupConfig({ ...CONFIG, display: {} }), /display\.title/);
  assert.throws(() => parseLookupConfig({ ...CONFIG, columns: "정의번호" }), /배열/);
  assert.throws(() => parseLookupConfig({ ...CONFIG, refreshSeconds: "빨리" }), /숫자/);
  assert.throws(() => parseLookupConfig(CONFIG, "공장 A"), /공백/);
});

test("설정: 갱신 간격은 너무 짧으면 최소치로 올린다", () => {
  assert.equal(parseLookupConfig({ ...CONFIG, refreshSeconds: 1 }).refreshSeconds, 15);
  const noRefresh = { ...CONFIG };
  delete noRefresh.refreshSeconds;
  assert.equal(parseLookupConfig(noRefresh).refreshSeconds, 300);
});

// ------------------------------------------------------------ 키 · 템플릿

test("키 정규화: 리더의 띄어쓴 UID 와 DB 의 소문자 값이 같아진다", () => {
  const hex = { format: "hex" };
  assert.equal(normalizeKey("C6 11 7A 17 53 01 04 E0", hex), "C6117A17530104E0");
  assert.equal(normalizeKey("c6:11:7a:17:53:01:04:e0", hex), "C6117A17530104E0");
  assert.equal(normalizeKey(" c6117a17530104e0 ", hex), "C6117A17530104E0");
  assert.equal(normalizeKey(null, hex), "");
  // 바이트 역순 — ISO 15693 을 E0 앞으로 저장한 DB.
  assert.equal(normalizeKey("C6 11 7A 17 53 01 04 E0", { format: "hex", reverseBytes: true }), "E0040153177A11C6");
  // 홀수 자릿수는 뒤집지 않는다(바이트 경계가 없다).
  assert.equal(normalizeKey("ABC", { format: "hex", reverseBytes: true }), "ABC");
  // text 는 공백만 떼고 대소문자를 그대로 둔다.
  assert.equal(normalizeKey("  Card-01 ", { format: "text" }), "Card-01");
});

test("템플릿: {열} 을 값으로 바꾸고 빈 값은 공백 하나로 정리한다", () => {
  assert.deepEqual(templateColumns("{정의구분} {정의번호} ({정의명})"), ["정의구분", "정의번호", "정의명"]);
  const row = { 정의구분: "통번호", 정의번호: 129, 정의명: null };
  assert.equal(renderTemplate("{정의구분} {정의번호}", row), "통번호 129");
  assert.equal(renderTemplate("{정의명} / {없는열} / {정의번호}", row), "/ / 129");
  assert.equal(renderTemplate("{사용여부}", { 사용여부: true }), "예");
});

test("값 변환: 날짜는 ISO, 바이트는 16진수, bigint 는 문자열", () => {
  assert.equal(coerceValue(new Date("2026-09-15T03:00:00Z")), "2026-09-15T03:00:00.000Z");
  assert.equal(coerceValue(Buffer.from([0xe0, 0x04])), "E004");
  assert.equal(coerceValue(10n), "10");
  assert.equal(coerceValue(Number.NaN), null);
  assert.equal(coerceValue(undefined), null);
});

// ------------------------------------------------------------ 행 → 스냅샷 → 찾기

test("행 만들기: 키를 정규화하고, 빈 키는 버리고, 중복은 앞 것을 남기고, 적은 열만 싣는다", () => {
  const config = parseLookupConfig(CONFIG);
  const { rows, dropped, duplicates } = buildRows(config, ROWS.map((r) => ({ ...r, 비밀열: "secret" })));
  assert.equal(Object.keys(rows).length, 2);
  assert.equal(dropped, 1);
  assert.equal(duplicates, 1);
  assert.equal(rows.C6117A17530104E0.정의번호, "129");
  assert.equal(rows["62077B17530104E0"].정의구분, "사원");
  assert.equal("비밀열" in rows.C6117A17530104E0, false);
});

test("찾기: 제목 · 부제목 · 상세를 만들고, 숨긴 열과 빈 값은 상세에서 빠진다", () => {
  const config = parseLookupConfig(CONFIG);
  const snapshot = { ...emptySnapshot(config), ok: true, ...buildRows(config, ROWS), rowCount: 2 };
  const tag = resolveTag(snapshot, "C6 11 7A 17 53 01 04 E0");
  assert.equal(tag.title, "통번호 129");
  assert.equal(tag.subtitle, "칼작업분배");
  assert.deepEqual(tag.fields, [
    { label: "정의구분", value: "통번호" },
    { label: "정의번호", value: "129" },
    { label: "정의명", value: "칼작업분배" },
    { label: "등록", value: "2026-09-08" },
  ]);
  assert.equal(resolveTag(snapshot, "00 00 00 00"), null);
  assert.equal(resolveTag(null, "C6117A17530104E0"), null);
  assert.equal(resolveTag(snapshot, ""), null);

  assert.equal(tagLabel(snapshot, "C6117A17530104E0"), "통번호 129");
  assert.equal(tagLabel(snapshot, "DE AD BE EF 00 11"), "EF0011", "모르는 UID 는 짧은 UID");
  assert.equal(tagLine(snapshot, "62 07 7B 17 53 01 04 E0"), "사원 20044 · 노이남");
  assert.equal(tagLine(snapshot, "DEADBEEF"), "UID DEADBEEF");
});

test("키 필드: 기본은 uid, serial 로 바꾸면 리더 상태 객체에서 S/N 을 꺼내 찾는다", () => {
  assert.equal(parseLookupConfig(CONFIG).key.field, "uid");
  // S/N 은 16진수가 아니므로 문자 그대로 비교한다.
  const bySerial = parseLookupConfig({ ...CONFIG, key: { field: "serial", column: "리더SN", format: "text" } });
  assert.equal(bySerial.key.field, "serial");
  assert.throws(() => parseLookupConfig({ ...CONFIG, key: { field: "uid.x", column: "카드번호" } }), /필드 이름/);
  assert.equal(parseLookupConfig({ ...CONFIG, key: { field: "", column: "카드번호" } }).key.field, "uid", "비어 있으면 기본 uid");

  const snapshot = {
    ...emptySnapshot(bySerial),
    ok: true,
    rows: { "RR657-005586": { 리더SN: "RR657-005586", 이름: "07-02 칼작업" } },
    display: { title: "{이름}" },
    columns: [],
  };
  const reader = { serial: " RR657-005586 ", uid: "C6117A17530104E0", present: false, online: true };
  assert.equal(subjectValue(snapshot, reader), " RR657-005586 ");
  assert.equal(resolveTag(snapshot, reader).title, "07-02 칼작업", "text 형식은 앞뒤 공백만 떼고 그대로 비교한다");
  assert.equal(resolveTag(snapshot, { serial: "" }), null);
  assert.equal(tagLine(snapshot, { serial: "NOPE" }), "serial NOPE");

  // 기본 uid 필드는 객체에서 uid 를 꺼낸다.
  const uidConfig = parseLookupConfig(CONFIG);
  const uidSnap = { ...emptySnapshot(uidConfig), ok: true, ...buildRows(uidConfig, ROWS), rowCount: 2 };
  assert.equal(resolveTag(uidSnap, { uid: "C6 11 7A 17 53 01 04 E0", serial: "x" }).title, "통번호 129");
  assert.equal(subjectValue(null, { uid: "A" }), "A", "스냅샷이 없으면 uid");
});

test("사업장 고르기: 같은 이름 → 하나뿐이면 그것 → default", () => {
  const a = { site: "a" };
  const b = { site: "b" };
  const d = { site: "default" };
  assert.equal(pickSnapshot({ sites: { a, b } }, "a"), a);
  assert.equal(pickSnapshot({ sites: { a } }, "없음"), a);
  assert.equal(pickSnapshot({ sites: { a, b, default: d } }, "없음"), d);
  assert.equal(pickSnapshot({ sites: { a, b } }, "없음"), null);
  assert.equal(pickSnapshot(null, "a"), null);
});

// ------------------------------------------------------------ 칸 글자 맞추기

/** 가짜 캔버스: 한글 · 전각은 글자 크기만큼, 나머지는 0.6 배 폭으로 잰다. */
function fakeMeasure() {
  const ctx = {
    font: "",
    measureText(text) {
      const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)[1]);
      let width = 0;
      for (const ch of text) width += /[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/.test(ch) ? size : size * 0.6;
      return { width };
    },
  };
  return ctx;
}

test("칸 글자: 넓으면 한 줄, 좁으면 글자를 줄이고, 더 좁으면 띄어쓰기에서 줄을 나눈다", () => {
  const ctx = fakeMeasure();
  // 칸 4개 폭(140px) — 12px 로 한 줄에 들어간다.
  const wide = fitLabel(ctx, "통번호 129", "0104E0", 140, 32, 36);
  assert.deepEqual(wide.lines, ["통번호 129"]);
  assert.ok(Math.abs(wide.fontSize - 36 * 0.34) < 1e-9, "기본 글자 크기(칸의 34%) 그대로");
  assert.match(wide.font, /system-ui/);

  // 칸 하나(32px) — 한 줄은 7px 로도 안 들어가(3*7 + 0.6*7*4 = 37.8) 두 줄로 나눈다.
  const narrow = fitLabel(ctx, "통번호 129", "0104E0", 32, 32, 36);
  assert.deepEqual(narrow.lines, ["통번호", "129"]);
  assert.ok(narrow.fontSize >= MIN_LABEL_FONT && narrow.fontSize < 36 * 0.34, `두 줄은 한 줄보다 작은 글자 (${narrow.fontSize})`);
  assert.ok(narrow.lines.length * narrow.lineHeight <= 32, "두 줄이 칸 높이 안에 든다");

  // 높이가 한 줄밖에 안 되면(가로로 긴 장치가 아니라 낮은 칸) UID 로 물러난다.
  const low = fitLabel(ctx, "통번호 129", "0104E0", 32, 12, 36);
  assert.deepEqual(low.lines, ["0104E0"]);
  assert.match(low.font, /monospace/);

  // 이름이 없으면 바로 UID.
  assert.deepEqual(fitLabel(ctx, "", "0104E0", 140, 32, 36).lines, ["0104E0"]);
  // 폭이 아주 좁아 UID 도 안 들어가면 최소 글자로라도 UID 를 적는다(잘리더라도 빈 칸은 아니다).
  const tiny = fitLabel(ctx, "통번호 129", "0104E0", 10, 10, 14);
  assert.deepEqual(tiny.lines, ["0104E0"]);
  assert.equal(tiny.fontSize, MIN_LABEL_FONT);
});

test("줄 나누기: 낱말 단위 → 긴 낱말은 글자 단위, 줄 수를 넘으면 null", () => {
  const fits = (max) => (text) => text.length <= max;
  assert.deepEqual(wrapLabel("통번호 129", 2, fits(4)), ["통번호", "129"]);
  assert.deepEqual(wrapLabel("사원 20044 노이남", 3, fits(6)), ["사원", "20044", "노이남"]);
  assert.deepEqual(wrapLabel("사원 20044 노이남", 2, fits(6)), null, "세 줄이 필요한데 두 줄만 된다");
  assert.deepEqual(wrapLabel("칼작업분배", 2, fits(3)), ["칼작업", "분배"], "한 낱말은 글자로 자른다");
  assert.equal(wrapLabel("가", 2, fits(0)), null, "글자 하나도 안 들어가면 포기");
});

// ------------------------------------------------------------ 서버: env · SQL

test("env 파일: 주석 · 따옴표 · BOM 을 처리하고 host,port 를 나눈다", () => {
  const env = parseEnvText("﻿# 설명\nSERVER=192.0.2.10,1433\nDATABASE=mes_db\nUSERNAME=mes\nPASSWORD=\"p w\"\n\n");
  assert.deepEqual(env, { SERVER: "192.0.2.10,1433", DATABASE: "mes_db", USERNAME: "mes", PASSWORD: "p w" });

  const { dir, cleanup } = freshDir();
  try {
    const target = resolveTarget({ kind: "mssql", env: join(dir, "db.env"), table: "t" }, dir);
    assert.deepEqual(target, { server: "192.0.2.10", port: 1433, database: "mes_db", user: "mes", password: "p w" });

    // env 에 SERVER/DATABASE 가 없으면 설정의 값으로 채운다. 그것도 없으면 무엇이 빠졌는지 말한다.
    writeFileSync(join(dir, "only-cred.env"), "USERNAME=sa\nPASSWORD=x\n", "utf8");
    const filled = resolveTarget({ kind: "mssql", env: "only-cred.env", table: "t", server: "db.local", database: "mes" }, dir);
    assert.deepEqual(filled, { server: "db.local", port: null, database: "mes", user: "sa", password: "x" });
    assert.throws(() => resolveTarget({ kind: "mssql", env: "only-cred.env", table: "t" }, dir), /SERVER/);
    assert.throws(() => resolveTarget({ kind: "mssql", env: "없는.env", table: "t" }, dir), /env 파일이 없습니다/);
  } finally {
    cleanup();
  }
});

test("SELECT 문: 식별자는 대괄호로 감싸고 키 열을 앞에, 화면 조건과 파일 WHERE 를 AND 로", () => {
  const config = parseLookupConfig({ ...CONFIG, source: { ...CONFIG.source, where: "사용여부 = 1" } });
  assert.equal(
    buildSelect(config),
    "SELECT [카드번호], [정의구분], [정의번호], [정의명], [등록일자], [비고] FROM [mes_db].[dbo].[tb_rfid_card] WHERE (사용여부 = 1)",
  );
  const filtered = parseLookupConfig({
    ...CONFIG,
    source: { ...CONFIG.source, where: "사용여부 = 1", filters: [{ column: "정의구분", op: "eq", value: "통번호" }, { column: "정의명", op: "notEmpty" }] },
  });
  assert.match(buildSelect(filtered), / WHERE \[정의구분\] = N'통번호' AND \(\[정의명\] IS NOT NULL AND .*\) AND \(사용여부 = 1\)$/);
  assert.equal(buildSelect(filtered, 5).startsWith("SELECT TOP 5 [카드번호]"), true);
});

test("조건 → SQL: 값은 리터럴로만 들어가고 홑따옴표 · LIKE 특수문자를 막는다", () => {
  assert.equal(filterSql({ column: "정의구분", op: "eq", value: "통'번호" }), "[정의구분] = N'통''번호'");
  assert.equal(filterSql({ column: "정의구분", op: "ne", value: "x" }), "([정의구분] <> N'x' OR [정의구분] IS NULL)");
  assert.equal(filterSql({ column: "비고", op: "contains", value: "50%_[a]" }), "[비고] LIKE N'%50[%][_][[]a]%'");
  assert.match(filterSql({ column: "비고", op: "empty" }), /^\(\[비고\] IS NULL OR /);
  // 파서: 값이 필요한 연산자에 값이 없으면 거부, 모르는 연산자 거부, 열 이름 검사.
  assert.throws(() => parseLookupConfig({ ...CONFIG, source: { ...CONFIG.source, filters: [{ column: "정의구분", op: "eq" }] } }), /값이 없습니다/);
  assert.throws(() => parseLookupConfig({ ...CONFIG, source: { ...CONFIG.source, filters: [{ column: "정의구분", op: "like", value: "x" }] } }), /op 를 모릅니다/);
  assert.throws(() => parseLookupConfig({ ...CONFIG, source: { ...CONFIG.source, filters: [{ column: "a]; DROP", op: "eq", value: "x" }] } }), /쓸 수 없는 이름/);
  // 값이 필요 없는 연산자의 값은 버린다.
  const parsed = parseLookupConfig({ ...CONFIG, source: { ...CONFIG.source, filters: [{ column: "정의명", op: "notEmpty", value: "무시" }] } });
  assert.deepEqual(parsed.source.filters, [{ column: "정의명", op: "notEmpty" }]);
});

test("접속 파일: 이름 → env 만 남기고, 설정은 접속 이름 또는 env 중 하나가 있어야 한다", () => {
  const defs = parseConnections({ v: 1, connections: { MES: { env: "C:/secrets/DB-mes.env" }, 창고: { env: "wh.env", server: "db.local", database: "wh" } } });
  assert.deepEqual(Object.keys(defs), ["MES", "창고"]);
  assert.deepEqual(defs.창고, { env: "wh.env", server: "db.local", database: "wh" });
  assert.throws(() => parseConnections({ connections: { "잘못 된": { env: "x" } } }), /공백/);
  assert.throws(() => parseConnections({ connections: { MES: {} } }), /env 가 없습니다/);

  const byName = parseLookupConfig({ ...CONFIG, source: { kind: "mssql", connection: "MES", table: "dbo.t" } });
  assert.equal(byName.source.connection, "MES");
  assert.equal("env" in byName.source, false);
  assert.throws(() => parseLookupConfig({ ...CONFIG, source: { kind: "mssql", table: "dbo.t" } }), /connection.*env/);
  assert.throws(() => parseLookupConfig(CONFIG, "_meta"), /쓸 수 없습니다/);
});

test("화면용 설정: env 는 파일 이름만, 자유 WHERE 는 있다는 사실만 나간다", () => {
  const config = parseLookupConfig({ ...CONFIG, source: { ...CONFIG.source, env: "C:\\_DX\\_env\\DB-mes.env", where: "사용여부 = 1" } });
  const shown = publicConfig(config);
  assert.equal(shown.envFile, "DB-mes.env");
  assert.equal(shown.hasWhere, true);
  assert.equal("env" in shown.source, false);
  assert.equal("where" in shown.source, false);
});

test("초안 합치기: 화면이 못 만지는 env · WHERE 는 지키고, 접속 이름을 고르면 env 는 버린다", () => {
  const existing = parseLookupConfig({ ...CONFIG, source: { ...CONFIG.source, env: "old.env", server: "db.old", database: "olddb", where: "사용여부 = 1" } });
  const draft = { source: { kind: "mssql", table: "dbo.new", env: "해킹.env", where: "1=1; DROP TABLE x", filters: [{ column: "a", op: "eq", value: "b" }] }, key: { column: "k" }, display: { title: "{n}" }, columns: ["n"], refreshSeconds: 60 };

  const kept = mergeDraft(existing, draft, "default");
  assert.equal(kept.source.env, "old.env", "화면이 보낸 env 는 무시하고 기존 것을 지킨다");
  assert.equal(kept.source.where, "사용여부 = 1", "자유 WHERE 도 기존 것");
  assert.equal(kept.source.server, "db.old");
  assert.equal(kept.source.table, "dbo.new");
  assert.deepEqual(kept.source.filters, [{ column: "a", op: "eq", value: "b" }]);
  assert.equal(kept.refreshSeconds, 60);

  const switched = mergeDraft(existing, { ...draft, source: { ...draft.source, connection: "MES" } }, "default");
  assert.equal(switched.source.connection, "MES");
  assert.equal("env" in switched.source, false);
  assert.equal(switched.source.where, "사용여부 = 1", "WHERE 는 접속을 바꿔도 남는다");

  assert.throws(() => mergeDraft(null, draft, "default"), /connection.*env/, "기존 설정이 없으면 접속 이름이 꼭 있어야 한다");
});

// ------------------------------------------------------------ 서버: 저장소

test("저장소: 설정 파일을 읽어 질의하고, 실패해도 마지막 행을 지키며 오류만 알린다", async () => {
  const { dir, cleanup } = freshDir();
  try {
    writeConfig(dir, "default", CONFIG);
    let fail = false;
    const calls = [];
    const store = createLookupStore(dir, {
      autoRefresh: false,
      log: () => {},
      now: () => new Date("2026-09-15T03:00:00Z"),
      query: async (target, sql) => {
        calls.push({ target, sql });
        if (fail) throw new Error("Login failed for user 'mes'.");
        return ROWS;
      },
    });
    assert.deepEqual(store.sites(), ["default"]);
    assert.equal(store.get("default").ok, false, "아직 읽지 않았다");
    assert.equal(store.get("default").rowCount, 0);

    const first = await store.refresh("default");
    assert.equal(first.ok, true);
    assert.equal(first.rowCount, 2);
    assert.equal(first.fetchedAt, "2026-09-15T03:00:00.000Z");
    assert.equal(calls[0].target.user, "mes");
    assert.match(calls[0].sql, /^SELECT \[카드번호\]/);
    assert.equal(first.rows.C6117A17530104E0.정의명, "칼작업분배");

    fail = true;
    const second = await store.refresh("default");
    assert.equal(second.ok, false);
    assert.match(second.error, /Login failed/);
    assert.equal(second.rowCount, 2, "마지막으로 성공한 행은 남는다");
    assert.equal(second.fetchedAt, first.fetchedAt);

    await assert.rejects(store.refresh("없는사업장"), /조회 설정이 없습니다/);
    store.stop();
  } finally {
    cleanup();
  }
});

test("저장소: 깨진 설정 파일은 오류만 실은 스냅샷이 되고 다른 사업장은 그대로 돈다", async () => {
  const { dir, cleanup } = freshDir();
  try {
    writeConfig(dir, "default", CONFIG);
    writeFileSync(join(dir, ".lookup", "b공장.json"), "{ 이건: JSON 아님", "utf8");
    const store = createLookupStore(dir, { autoRefresh: false, log: () => {}, query: async () => ROWS });
    assert.deepEqual(store.sites(), ["b공장", "default"]);
    assert.equal(store.get("b공장").ok, false);
    assert.match(store.get("b공장").error, /JSON/);
    assert.equal((await store.refresh("default")).ok, true);
    store.stop();
  } finally {
    cleanup();
  }
});

test("저장소: 설정 파일을 고치면 다음 refresh 가 새 설정으로 읽는다", async () => {
  const { dir, cleanup } = freshDir();
  try {
    writeConfig(dir, "default", CONFIG);
    const sqls = [];
    const store = createLookupStore(dir, {
      autoRefresh: false,
      log: () => {},
      query: async (_t, sql) => {
        sqls.push(sql);
        return ROWS;
      },
    });
    await store.refresh("default");
    // mtime 이 같으면 파일을 다시 읽지 않으므로 확실히 다르게 만든다.
    await new Promise((r) => setTimeout(r, 20));
    writeConfig(dir, "default", { ...CONFIG, display: { title: "{정의명}" }, columns: ["정의명"] });
    // 새 설정으로 읽기 전까지는 예전 행을 그대로 보여 준다 — 설정을 고쳤다고 화면의 이름이 잠깐 사라지면 안 된다.
    store.reload();
    assert.equal(store.get("default").display.title, "{정의명}");
    assert.equal(store.get("default").rowCount, 2, "설정이 바뀌어도 마지막 행은 남는다");
    const after = await store.refresh("default");
    assert.equal(after.display.title, "{정의명}");
    assert.match(sqls.at(-1), /^SELECT \[카드번호\], \[정의명\] FROM/);
    store.stop();
  } finally {
    cleanup();
  }
});

// ------------------------------------------------------------ 서버: API

function fakeRequest(method, url) {
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {},
  };
}

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
  let passed = false;
  await api(fakeRequest(method, url), res, () => {
    passed = true;
  });
  return { res, passed };
}

test("API: 목록 · 사업장 · 새로고침, 다른 주소는 넘긴다", async () => {
  const { dir, cleanup } = freshDir();
  try {
    writeConfig(dir, "default", CONFIG);
    const { middleware, store } = createLookupApi(dir, { autoRefresh: false, log: () => {}, query: async () => ROWS });

    const other = await call(middleware, "GET", "/live");
    assert.equal(other.passed, true);

    const list = await call(middleware, "GET", "/api/lookup");
    assert.equal(list.res.statusCode, 200);
    assert.deepEqual(Object.keys(list.res.json.sites), ["default"]);
    assert.equal(list.res.json.sites.default.rowCount, 0);

    const refreshed = await call(middleware, "POST", "/api/lookup/default/refresh");
    assert.equal(refreshed.res.statusCode, 200);
    assert.equal(refreshed.res.json.ok, true);
    assert.equal(refreshed.res.json.rowCount, 2);

    const one = await call(middleware, "GET", "/api/lookup/default");
    assert.equal(one.res.json.rows.C6117A17530104E0.정의구분, "통번호");
    assert.equal(one.res.headers["Cache-Control"], "no-store");

    const missing = await call(middleware, "GET", "/api/lookup/없음");
    assert.equal(missing.res.statusCode, 404);
    const badRefresh = await call(middleware, "POST", "/api/lookup/없음/refresh");
    assert.equal(badRefresh.res.statusCode, 404);
    assert.match(badRefresh.res.json.error, /조회 설정이 없습니다/);
    const badMethod = await call(middleware, "DELETE", "/api/lookup/default");
    assert.equal(badMethod.res.statusCode, 404);
    store.stop();
  } finally {
    cleanup();
  }
});

/** 가짜 DB: INFORMATION_SCHEMA 질의와 표 질의를 SQL 문자열로 갈라 답한다. */
function fakeDb(log = []) {
  return async (target, sql) => {
    log.push({ target, sql });
    if (sql.includes("INFORMATION_SCHEMA.TABLES")) {
      return [
        { schema: "dbo", name: "tb_rfid_card", type: "BASE TABLE" },
        { schema: "dbo", name: "vw_카드", type: "VIEW" },
      ];
    }
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
      return [{ name: "카드번호", type: "varchar" }, { name: "정의구분", type: "varchar" }, { name: "정의번호", type: "bigint" }, { name: "정의명", type: "varchar" }, { name: "등록일자", type: "varchar" }, { name: "비고", type: "varchar" }];
    }
    if (/^SELECT TOP 5 /.test(sql)) return ROWS.slice(0, 2);
    return ROWS;
  };
}

function writeConnections(dir) {
  writeFileSync(join(dir, ".lookup", "connections.json"), JSON.stringify({ v: 1, connections: { MES: { env: join(dir, "db.env") } } }), "utf8");
}

async function callJson(api, method, url, body) {
  const res = fakeResponse();
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
  await api(
    {
      method,
      url,
      async *[Symbol.asyncIterator]() {
        if (payload) yield payload;
      },
    },
    res,
    () => {},
  );
  return res;
}

test("API(설정 화면): 접속 · 표 · 열 목록, 미리보기, 저장 → 바로 읽기, 화면용 설정", async () => {
  const { dir, cleanup } = freshDir();
  try {
    writeConnections(dir);
    const log = [];
    const { middleware, store } = createLookupApi(dir, { autoRefresh: false, log: () => {}, query: fakeDb(log) });

    const connections = await callJson(middleware, "GET", "/api/lookup/_meta/connections");
    assert.equal(connections.statusCode, 200);
    assert.deepEqual(connections.json.connections, [{ name: "MES", database: "mes_db", server: "192.0.2.10" }]);

    const tables = await callJson(middleware, "GET", "/api/lookup/_meta/tables?connection=MES");
    assert.deepEqual(tables.json.tables.map((t) => `${t.schema}.${t.name}:${t.kind}`), ["dbo.tb_rfid_card:table", "dbo.vw_카드:view"]);
    assert.equal(log.at(-1).target.user, "mes", "접속 이름으로 env 를 찾아 붙는다");

    const columns = await callJson(middleware, "GET", `/api/lookup/_meta/columns?connection=MES&table=${encodeURIComponent("dbo.tb_rfid_card")}`);
    assert.equal(columns.json.columns.length, 6);
    assert.match(log.at(-1).sql, /TABLE_NAME = N'tb_rfid_card' AND TABLE_SCHEMA = N'dbo'/);

    const badTable = await callJson(middleware, "GET", `/api/lookup/_meta/columns?connection=MES&table=${encodeURIComponent("dbo.[x]; DROP")}`);
    assert.equal(badTable.statusCode, 400);
    const noConn = await callJson(middleware, "GET", "/api/lookup/_meta/tables?connection=없음");
    assert.equal(noConn.statusCode, 404);
    assert.match(noConn.json.error, /접속 "없음" 이 없습니다/);

    // 아직 설정이 없는 사업장에 초안으로 미리보기 → 파일은 생기지 않는다.
    const draft = {
      source: { kind: "mssql", connection: "MES", table: "dbo.tb_rfid_card", filters: [{ column: "정의구분", op: "eq", value: "통번호" }] },
      key: { column: "카드번호", format: "hex" },
      display: { title: "{정의구분} {정의번호}", subtitle: "{정의명}" },
      columns: ["정의구분", "정의번호", { column: "정의명", label: "이름" }],
      refreshSeconds: 120,
    };
    const preview = await callJson(middleware, "POST", "/api/lookup/새사업장/preview", { config: draft });
    assert.equal(preview.statusCode, 200);
    assert.match(preview.json.sql, /^SELECT TOP 5 .* WHERE \[정의구분\] = N'통번호'$/);
    assert.deepEqual(preview.json.titles, ["통번호 129", "사원 20044"]);
    assert.equal(existsSync(join(dir, ".lookup", "새사업장.json")), false);

    // 저장 → 파일 · 스냅샷 · 저장자.
    const saved = await callJson(middleware, "PUT", "/api/lookup/새사업장/config", { config: draft, author: "홍길동" });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json.ok, true);
    assert.equal(saved.json.snapshot.ok, true);
    assert.equal(saved.json.snapshot.rowCount, 2);
    assert.equal(saved.json.snapshot.refreshSeconds, 120);
    assert.equal(saved.json.config.updatedBy, "홍길동");
    const onDisk = JSON.parse(readFileSync(join(dir, ".lookup", "새사업장.json"), "utf8"));
    assert.equal(onDisk.site, "새사업장");
    assert.equal(onDisk.source.connection, "MES");
    assert.deepEqual(store.sites(), ["default", "새사업장"].filter((s) => s !== "default" || existsSync(join(dir, ".lookup", "default.json"))));

    const shown = await callJson(middleware, "GET", "/api/lookup/새사업장/config");
    assert.equal(shown.json.config.hasWhere, false);
    assert.equal(shown.json.config.source.connection, "MES");

    // 없는 접속 이름으로는 저장되지 않는다.
    const badSave = await callJson(middleware, "PUT", "/api/lookup/새사업장/config", { config: { ...draft, source: { ...draft.source, connection: "없음" } }, author: "홍길동" });
    assert.equal(badSave.statusCode, 404);
    assert.equal(JSON.parse(readFileSync(join(dir, ".lookup", "새사업장.json"), "utf8")).source.connection, "MES", "파일은 그대로");

    // 예약된 이름(_meta)에는 저장하지 못한다 — 잘못된 요청(400).
    const reserved = await callJson(middleware, "PUT", "/api/lookup/_meta/config", { config: draft, author: "가" });
    assert.equal(reserved.statusCode, 400);
    store.stop();
  } finally {
    cleanup();
  }
});

test("경로 해석: /api/lookup 만 잡는다", () => {
  assert.deepEqual(parseLookupPath("/api/lookup"), []);
  assert.deepEqual(parseLookupPath("/api/lookup/default"), ["default"]);
  assert.deepEqual(parseLookupPath(`/api/lookup/${encodeURIComponent("1공장")}/refresh`), ["1공장", "refresh"]);
  assert.equal(parseLookupPath("/api/lookups"), null);
  assert.equal(parseLookupPath("/api/projects"), null);
});
