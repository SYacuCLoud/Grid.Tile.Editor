import assert from "node:assert/strict";
import test from "node:test";

/** 빌드된 Worker 로 `/live` 를 서버 렌더한다. `rendered-mobile.test.mjs` 와 같은 길이다. */
async function render(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("실시간 현황판(/live)이 서버에서 렌더된다", async () => {
  const response = await render("/live");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>실시간 현황판<\/title>/);
  assert.ok(html.includes("읽기 전용"), "읽기 전용 안내가 없다");
  // mqtt.js 는 브라우저에서 늦게 읽는다 — 서버 렌더 HTML 에 번들로 박혀 있으면 안 된다.
  assert.ok(!html.includes("MqttClient"), "mqtt.js 가 서버 렌더에 섞여 들어갔다");
  for (const label of ["상태 추가", "장비 추가", "서버 저장", "전체 초기화"]) {
    assert.ok(!html.includes(label), `현황판에 편집 단추 "${label}" 가 있다`);
  }
});
