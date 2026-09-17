/**
 * 재발행 요청 — 토픽 · 페이로드 · done 해석 · datetime-local 왕복.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { fromLocalInput, isReplayDoneTopic, newRequestId, parseReplayDone, replayDoneTopic, replayPayload, replayTopic, shortStamp, toLocalInput } from "../app/live/replay.ts";
import { parseTopic, subscriptionTopics } from "../app/live/liveState.ts";

const T0 = Date.parse("2026-09-17T16:31:00+09:00");

test("요청 토픽: 사업장 전체 또는 한 PC, 빈 prefix · site 는 기본값", () => {
  assert.equal(replayTopic("rfid", "default"), "rfid/default/replay");
  assert.equal(replayTopic(" ", "", null), "rfid/default/replay");
  assert.equal(replayTopic("plc", "line-a", " C1101 "), "plc/line-a/host/C1101/replay");
  assert.equal(replayDoneTopic("rfid", ""), "rfid/+/host/+/replay-done");
  assert.equal(replayDoneTopic("rfid", "default"), "rfid/default/host/+/replay-done");
});

test("요청 페이로드: v1 · type replay · ISO 시각 · 선택 host", () => {
  const body = JSON.parse(replayPayload({ fromMs: T0, toMs: T0 + 3_600_000, requestId: "abc" }));
  assert.equal(body.v, 1);
  assert.equal(body.type, "replay");
  assert.equal(Date.parse(body.from), T0);
  assert.equal(Date.parse(body.to), T0 + 3_600_000);
  assert.equal(body.requestId, "abc");
  assert.equal("host" in body, false);
  assert.equal(JSON.parse(replayPayload({ fromMs: T0, toMs: T0 + 1, requestId: "x", host: "C1101" })).host, "C1101");
  assert.match(newRequestId(), /^[a-z0-9]{8,}$/);
  assert.notEqual(newRequestId(), newRequestId());
});

test("done 해석: replay-done 토픽만, 빈 host 는 토픽에서, 깨진 것은 null", () => {
  assert.equal(isReplayDoneTopic("rfid/default/host/C1101/replay-done"), true);
  assert.equal(isReplayDoneTopic("rfid/default/host/C1101/status"), false);
  assert.equal(isReplayDoneTopic("rfid/default/reader/RR1/replay"), false);
  assert.equal(isReplayDoneTopic("rfid/default/replay"), false);

  const d = parseReplayDone("rfid/default/host/C1101/replay-done", JSON.stringify({ v: 1, type: "replay-done", host: "C1101", requestId: "abc", from: "2026-09-17T16:31:00.000+09:00", to: "2026-09-18T07:05:00.000+09:00", count: 412, truncated: false, files: 2 }), T0);
  assert.deepEqual(d, { host: "C1101", requestId: "abc", from: "2026-09-17T16:31:00.000+09:00", to: "2026-09-18T07:05:00.000+09:00", count: 412, truncated: false, files: 2, error: null, at: T0 });
  const e = parseReplayDone("rfid/default/host/C1102/replay-done", JSON.stringify({ v: 1, type: "replay-done", requestId: "abc", from: "", to: "", count: 0, truncated: false, files: 0, error: "CSV 폴더 없음" }), T0);
  assert.equal(e.host, "C1102");
  assert.equal(e.error, "CSV 폴더 없음");
  assert.equal(parseReplayDone("rfid/default/host/C1101/replay-done", "깨진", T0), null);
  assert.equal(parseReplayDone("rfid/default/host/C1101/status", "{}", T0), null);
  assert.equal(parseReplayDone("rfid/default/host/C1101/replay-done", JSON.stringify({ type: "status" }), T0), null);
});

test("현황판 모델은 replay 토픽을 상태로 읽지 않는다 — 재발행 이벤트는 기록기만, done 은 화면이 따로", () => {
  assert.deepEqual(parseTopic("rfid/default/reader/RR1/replay"), { kind: "event", site: "default", key: "RR1", replay: true });
  assert.equal(parseTopic("rfid/default/host/C1101/replay-done"), null);
  assert.equal(parseTopic("rfid/default/replay"), null);
  // 현황판의 기본 구독에는 reader replay 가 없다(지금 상태를 흔들지 않게). done 만 받는다.
  const topics = subscriptionTopics("rfid", "default");
  assert.equal(topics.includes("rfid/default/reader/+/replay"), false);
  assert.equal(topics.includes("rfid/default/host/+/replay-done"), true);
});

test("datetime-local 왕복은 분 단위로 같고, 짧은 시각 표시", () => {
  const v = toLocalInput(T0);
  assert.match(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(fromLocalInput(v), T0);
  assert.equal(fromLocalInput(""), null);
  assert.equal(fromLocalInput("nope"), null);
  assert.match(shortStamp("2026-09-17T16:31:00.000+09:00"), /^\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(shortStamp("깨진"), "깨진");
});
