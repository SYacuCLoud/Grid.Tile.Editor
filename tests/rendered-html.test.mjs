import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("배치 편집기 화면이 서버에서 렌더된다", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>격자형 배치 편집기<\/title>/i);
  assert.match(html, /<html lang="ko"/i);

  // 다중 페이지 탭 및 도구, 팔레트, 클립보드, 파일 기능이 한 화면에 있다.
  for (const label of ["페이지 추가", "브러시", "지우개", "채우기", "복사", "잘라내기", "붙여넣기", "미설치", "미연결", "신호선", "PNG 저장", "전체 초기화", "범례"]) {
    assert.ok(html.includes(label), `화면에 "${label}" 이 없다`);
  }

  // 사용자 팔레트 관리 UI — 분류마다 추가 버튼이 있다.
  for (const label of ["상태 추가", "장비 추가", "배선 추가"]) {
    assert.ok(html.includes(label), `화면에 "${label}" 버튼이 없다`);
  }

  // 항목마다 편집 · 삭제 단추가 붙는다.
  assert.ok(html.includes("편집"), "화면에 편집 단추가 없다");
  assert.ok(html.includes("삭제"), "화면에 삭제 단추가 없다");

  // 시작 배치도가 비어 있지 않다.
  assert.match(html, /격자 크기/);
  assert.doesNotMatch(html, /codex-preview|_sites-preview/);
});
