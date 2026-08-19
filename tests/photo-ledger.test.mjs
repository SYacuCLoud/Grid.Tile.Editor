/**
 * 사진 대장 — 모으기 · 파일 이름 · 인쇄용 HTML.
 *
 * 창을 열고 파일을 내려받는 일(`photoExport.ts`)은 DOM 이 있어야 하므로 여기서
 * 다루지 않는다. 무엇을 낼지 정하는 쪽은 전부 순수 함수라 그대로 시험한다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { addPageToProject, createProject, updateEquipmentInfoOnPage } from "../app/editor/doc.ts";
import {
  collectPhotoEntries,
  entriesFromCell,
  ledgerHtml,
  ledgerSubtitle,
  photoExtension,
  photoFileName,
  positionText,
} from "../app/editor/photoLedger.ts";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

/** 서로 다른 사진. 대장은 내용이 아니라 장수·순서만 보므로 문자열만 갈라 준다. */
function photo(seed) {
  return `${TINY_PNG.slice(0, -4)}${seed}A/w==`;
}

function jpeg(seed) {
  return `data:image/jpeg;base64,${seed}AAAA`;
}

/** 사진이 붙은 칸을 만들어 첫 페이지에 얹는다. */
function withCell(project, key, patch) {
  project.pages[0] = updateEquipmentInfoOnPage(project.pages[0], key, patch);
  return project;
}

// ── 모으기 ──────────────────────────────────────────────────────────

test("사진 모으기: 읽는 순서(위→아래, 왼→오른쪽)로 늘어놓는다", () => {
  let project = createProject("순서");
  project = withCell(project, "5,1", { photos: [photo("b")] });
  project = withCell(project, "1,1", { photos: [photo("a")] });
  project = withCell(project, "3,0", { photos: [photo("c")] });

  const entries = collectPhotoEntries(project);
  assert.deepEqual(
    entries.map((entry) => [entry.x, entry.y]),
    [
      [3, 0],
      [1, 1],
      [5, 1],
    ],
  );
});

test("사진 모으기: 한 칸의 여러 장은 붙은 순서대로 번호가 붙는다", () => {
  const project = withCell(createProject("번호"), "2,2", {
    label: "C1101",
    memo: "3월 점검",
    photos: [photo("a"), photo("b"), photo("c")],
  });

  const entries = collectPhotoEntries(project);
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((entry) => entry.index),
    [1, 2, 3],
  );
  assert.ok(
    entries.every((entry) => entry.total === 3 && entry.label === "C1101" && entry.memo === "3월 점검"),
    "칸 정보는 장마다 함께 실린다",
  );
  assert.equal(entries[0].key, "2,2");
});

test("사진 모으기: 사진 없는 칸은 들어오지 않는다", () => {
  let project = withCell(createProject("빈 칸"), "1,1", { label: "C1" });
  project.pages[0].equipment["2,2"] = { status: "installed" };
  project = withCell(project, "3,3", { photos: [photo("a")] });

  const entries = collectPhotoEntries(project);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].x, 3);
});

test("사진 모으기: 이전 판 단일 photo 도 함께 잡힌다", () => {
  const project = createProject("옛 문서");
  project.pages[0].equipment["1,1"] = { label: "C9", photo: TINY_PNG };

  const entries = collectPhotoEntries(project);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].photo, TINY_PNG);
  assert.equal(entries[0].total, 1);
});

test("사진 모으기: 페이지 순서를 지키고 페이지 이름을 함께 담는다", () => {
  let project = withCell(createProject("여러 페이지"), "1,1", { photos: [photo("a")] });
  project = addPageToProject(project, "2층");
  project.pages[1] = updateEquipmentInfoOnPage(project.pages[1], "2,2", { photos: [photo("b")] });

  const entries = collectPhotoEntries(project);
  assert.deepEqual(
    entries.map((entry) => entry.pageName),
    ["1층 메인 공장", "2층"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.pageId),
    ["page-1", "page-2"],
  );
});

test("칸 목록: 저장하지 않은 값으로도 목록을 짓는다", () => {
  const entries = entriesFromCell({
    pageId: "page-1",
    pageName: "1층",
    x: 4,
    y: 6,
    label: "C1",
    memo: "메모",
    photos: [photo("a"), photo("b")],
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].key, "4,6");
  assert.deepEqual(
    entries.map((entry) => `${entry.index}/${entry.total}`),
    ["1/2", "2/2"],
  );
  assert.deepEqual(entriesFromCell({ pageId: "p", pageName: "n", x: 0, y: 0, label: "", memo: "", photos: [] }), []);
});

// ── 파일 이름 ───────────────────────────────────────────────────────

test("사진 파일 이름: 페이지 · 세로 · 가로 · 장비 ID · 순번을 담는다", () => {
  const [entry] = entriesFromCell({
    pageId: "page-1",
    pageName: "1층 메인 공장",
    x: 2,
    y: 4,
    label: "C1101",
    memo: "",
    photos: [jpeg("x")],
  });

  // 좌표는 화면에 보이는 값(1부터). 세로 5 · 가로 3 인 칸이다.
  assert.equal(photoFileName(entry), "1층-메인-공장_5_3_C1101_photo_1.jpg");
});

test("사진 파일 이름: 쓸 수 없는 글자를 걷어 내고 빈 자리는 - 로 채운다", () => {
  const [entry] = entriesFromCell({
    pageId: "page-1",
    pageName: 'A/B:C*?"<>|층',
    x: 0,
    y: 0,
    label: "",
    memo: "",
    photos: [TINY_PNG],
  });

  assert.equal(photoFileName(entry), "ABC층_1_1_-_photo_1.png");
  assert.doesNotMatch(photoFileName(entry), /[\\/:*?"<>|]/);
});

test("확장자: data URL 이 말하는 형식을 따른다", () => {
  assert.equal(photoExtension(jpeg("a")), "jpg");
  assert.equal(photoExtension(TINY_PNG), "png");
  assert.equal(photoExtension("data:image/webp;base64,AAAA"), "webp");
  assert.equal(photoExtension("엉뚱한 값"), "png", "알 수 없으면 png 로 둔다");
});

test("칸 자리 표시: 화면과 같은 1부터의 좌표로 적는다", () => {
  const [entry] = entriesFromCell({
    pageId: "p",
    pageName: "n",
    x: 2,
    y: 4,
    label: "",
    memo: "",
    photos: [TINY_PNG],
  });
  assert.equal(positionText(entry), "가로 3 · 세로 5");
});

// ── 인쇄용 HTML ─────────────────────────────────────────────────────

test("사진 대장 HTML: A4 인쇄 설정과 사진·좌표·메모가 모두 들어간다", () => {
  const project = withCell(createProject("대장"), "2,4", {
    label: "C1101",
    memo: "배선 재작업 필요",
    photos: [photo("a"), photo("b")],
  });

  const html = ledgerHtml(collectPhotoEntries(project), { title: "대장 사진 대장", subtitle: "사진 2장" });

  assert.match(html, /^<!doctype html>/);
  assert.match(html, /@page \{ size: A4 portrait/);
  assert.match(html, /break-inside: avoid/, "사진과 설명이 장 경계에서 갈리지 않아야 한다");
  assert.equal(html.match(/<figure>/g).length, 2, "사진마다 한 칸");
  assert.match(html, /가로 3 · 세로 5/);
  assert.match(html, /C1101/);
  assert.match(html, /배선 재작업 필요/);
  assert.match(html, /\(1\/2\)/, "여러 장이면 몇 번째인지 적는다");
  assert.match(html, /<title>대장 사진 대장<\/title>/);
  assert.match(html, /사진 2장/);
});

test("사진 대장 HTML: 한 장뿐인 칸에는 순번을 적지 않는다", () => {
  const project = withCell(createProject("한 장"), "1,1", { photos: [photo("a")] });
  const html = ledgerHtml(collectPhotoEntries(project), { title: "한 장" });

  assert.equal(html.match(/<figure>/g).length, 1);
  assert.doesNotMatch(html, /\(1\/1\)/);
});

test("사진 대장 HTML: 페이지가 여럿이면 이름으로 갈라 적는다", () => {
  let project = withCell(createProject("갈라 적기"), "1,1", { photos: [photo("a")] });
  project = addPageToProject(project, "2층");
  project.pages[1] = updateEquipmentInfoOnPage(project.pages[1], "2,2", { photos: [photo("b")] });

  const html = ledgerHtml(collectPhotoEntries(project), { title: "갈라 적기" });
  assert.equal(html.match(/<section>/g).length, 2);
  assert.match(html, /<h2>1층 메인 공장 \(1장\)<\/h2>/);
  assert.match(html, /<h2>2층 \(1장\)<\/h2>/);
});

test("사진 대장 HTML: 한 페이지뿐이면 페이지 머리를 생략한다", () => {
  const project = withCell(createProject("한 페이지"), "1,1", { photos: [photo("a")] });
  const html = ledgerHtml(collectPhotoEntries(project), { title: "한 페이지" });

  assert.equal(html.match(/<section>/g).length, 1);
  assert.doesNotMatch(html, /<h2>/);
});

test("사진 대장 HTML: 태그로 읽힐 글자는 그대로 내보내지 않는다", () => {
  const [entry] = entriesFromCell({
    pageId: "p",
    pageName: "n",
    x: 0,
    y: 0,
    label: "<script>alert(1)</script>",
    memo: 'a & b "c"',
    photos: [TINY_PNG],
  });

  const html = ledgerHtml([entry], { title: "<b>제목</b>" });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b &quot;c&quot;/);
  assert.match(html, /&lt;b&gt;제목&lt;\/b&gt;/);
});

test("사진 대장 HTML: 사진이 없으면 빈 대장이라고 알린다", () => {
  const html = ledgerHtml([], { title: "빈 대장" });
  assert.match(html, /붙어 있는 사진이 없습니다/);
  assert.doesNotMatch(html, /<figure>/);
});

test("사진 대장 머리줄: 없는 값은 자리를 비우지 않고 빼 버린다", () => {
  assert.equal(
    ledgerSubtitle({ count: 7, revision: 3, author: "홍길동", printedAt: new Date(2026, 7, 19, 9, 5) }),
    "사진 7장 · r3 · 홍길동 · 2026-08-19 09:05",
  );
  assert.equal(ledgerSubtitle({ count: 1 }), "사진 1장");
  assert.equal(ledgerSubtitle({ count: 2, revision: null, author: "" }), "사진 2장");
});
