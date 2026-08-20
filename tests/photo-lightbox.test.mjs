/**
 * 사진 확대 보기 — 순번 셈과 실제 그려진 마크업.
 *
 * 순번 셈(`stepPhotoIndex` · `photoCounter`)은 순수 함수라 그대로 시험한다.
 * 컴포넌트는 `react-dom/server` 로 한 번 그려서 넘긴 값이 화면에 제대로
 * 실리는지 본다 — 클릭·키보드까지 흉내 내려면 브라우저가 필요하므로, 거기까지는
 * `TESTING.md` 의 수동 절차로 확인한다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { formatBytes, photoBytes, photoCounter, stepPhotoIndex } from "../app/editor/photo.ts";
import { PhotoLightbox } from "../app/editor/PhotoLightbox.tsx";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

function photo(seed) {
  return `${TINY_PNG.slice(0, -4)}${seed}A/w==`;
}

function markup(props) {
  return renderToStaticMarkup(
    createElement(PhotoLightbox, {
      photos: [photo("aa"), photo("bb"), photo("cc")],
      index: 1,
      caption: "C1101 · 1층 메인 공장 · 가로 3 · 세로 5",
      onIndex: () => {},
      onDownload: () => {},
      onClose: () => {},
      ...props,
    }),
  );
}

// ── 순번 셈 ─────────────────────────────────────────────────────────

test("순번 넘기기: 한 칸씩 옮기고 끝에서 끝으로 돈다", () => {
  assert.equal(stepPhotoIndex(0, 5, 1), 1);
  assert.equal(stepPhotoIndex(4, 5, 1), 0, "마지막에서 다음은 첫 장");
  assert.equal(stepPhotoIndex(0, 5, -1), 4, "첫 장에서 이전은 마지막");
  assert.equal(stepPhotoIndex(2, 5, 0), 2);
});

test("순번 넘기기: 한 장뿐이거나 없으면 제자리다", () => {
  assert.equal(stepPhotoIndex(0, 1, 1), 0);
  assert.equal(stepPhotoIndex(0, 1, -1), 0);
  assert.equal(stepPhotoIndex(3, 0, 1), 0, "장수가 없으면 0");
  assert.equal(stepPhotoIndex(0, -2, 1), 0);
});

test("순번 표시: 1부터 세고 장수를 넘지 않는다", () => {
  assert.equal(photoCounter(0, 5), "1 / 5");
  assert.equal(photoCounter(4, 5), "5 / 5");
  assert.equal(photoCounter(9, 5), "5 / 5", "목록이 줄어도 장수를 넘겨 적지 않는다");
  assert.equal(photoCounter(-3, 5), "1 / 5");
});

// ── 그려진 마크업 ───────────────────────────────────────────────────

test("확대 보기: 지금 보는 사진 · 순번 · 크기를 함께 싣는다", () => {
  const html = markup({});

  assert.match(html, /2 \/ 3/, "순번을 적는다");
  assert.ok(html.includes(photo("bb")), "가리킨 사진을 크게 싣는다");
  assert.ok(!html.includes(photo("aa")), "다른 장은 싣지 않는다 — 무게가 배로 늘어난다");
  assert.ok(html.includes(formatBytes(photoBytes(photo("bb")))), "파일 크기를 적는다");
  assert.match(html, /C1101 · 1층 메인 공장 · 가로 3 · 세로 5/);
});

test("확대 보기: 원본 비율을 지키고 화면 안에 들어맞춘다", () => {
  const html = markup({});
  assert.match(html, /object-contain/, "잘라내지 않고 비율을 지킨다");
  assert.match(html, /max-h-\[78vh\]/);
  assert.match(html, /max-w-\[82vw\]/);
});

test("확대 보기: 닫기 · 저장 · 이전 · 다음 단추가 모두 있다", () => {
  const html = markup({});
  for (const label of ["이 사진 파일로 저장", "닫기", "이전 사진", "다음 사진", "배경을 눌러 닫기"]) {
    assert.ok(html.includes(label), `"${label}" 단추가 없다`);
  }
  assert.match(html, /← → 넘기기 · Esc 닫기/);
});

test("확대 보기: 한 장뿐이면 넘기기 단추를 감춘다", () => {
  const html = markup({ photos: [photo("aa")], index: 0 });

  assert.match(html, /1 \/ 1/);
  // 단추 자체는 남기고 감춘다 — 자리만 비면 사진 폭이 장수에 따라 들썩인다.
  assert.match(html, /hidden=""[^>]*aria-label="이전 사진"|aria-label="이전 사진"[^>]*hidden=""/);
  assert.match(html, /Esc 닫기/);
  assert.doesNotMatch(html, /← → 넘기기/);
});

test("확대 보기: 없는 순번을 가리키면 아무것도 그리지 않는다", () => {
  // 사진을 지운 직후처럼 목록과 순번이 어긋난 순간에도 깨지지 않아야 한다.
  assert.equal(markup({ photos: [photo("aa")], index: 5 }), "");
  assert.equal(markup({ photos: [], index: 0 }), "");
});

test("확대 보기: 화면 전체를 덮는 모달이다", () => {
  const html = markup({});
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /fixed inset-0/, "편집 상자 폭(240px)에 갇히지 않는다");
});
