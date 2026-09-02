import assert from "node:assert/strict";
import test from "node:test";

/** 빌드된 Worker 로 `/m` 을 서버 렌더한다. `rendered-html.test.mjs` 와 같은 길이다. */
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

test("모바일 도면 보기(/m)가 서버에서 렌더된다", async () => {
  const response = await render("/m");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>도면 보기<\/title>/);
  // 휴대폰 화면에 맞추고 브라우저 확대는 끈다 — 두 손가락은 도면을 키우는 데 쓴다.
  assert.match(html, /<meta name="viewport" content="[^"]*width=device-width[^"]*user-scalable=no/);

  // 읽기 전용 화면이다 — 편집기의 팔레트 · 저장 단추가 없다.
  assert.ok(html.includes("읽기 전용"), "읽기 전용 안내가 없다");
  for (const label of ["상태 추가", "장비 추가", "서버 저장", "전체 초기화"]) {
    assert.ok(!html.includes(label), `보기 화면에 편집 단추 "${label}" 가 있다`);
  }
});
