/**
 * 칸 영상 — 검사 규칙 · 문서 저장 · 비교 · 렌더 표시 · 이력 분리.
 *
 * 브라우저에서 다시 굽는 일(`shrinkVideo`)은 여기서 시험하지 않는다 — `<video>` ·
 * `MediaRecorder` 가 없다. 그 앞뒤의 순수한 계산과, 영상이 문서를 지나 서버
 * 이력까지 가는 길만 본다.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cellVideos, createProject, updateEquipmentInfoOnPage } from "../app/editor/doc.ts";
import { diffProjects } from "../app/editor/diff.ts";
import { renderDoc } from "../app/editor/render.ts";
import { sanitizeProject } from "../app/editor/storage.ts";
import {
  checkVideoRoom,
  dataUrlChars,
  fitsAsIs,
  formatSeconds,
  MAX_CELL_VIDEO_CHARS,
  MAX_CELL_VIDEOS,
  MAX_VIDEO_CHARS,
  sanitizeVideo,
  sanitizeVideos,
  videoExtension,
  videoFileName,
  videosBytes,
} from "../app/editor/video.ts";
import { cellSummary, isEmptyCell } from "../app/m/mobileView.ts";
import { PHOTO_REF_PREFIX, PHOTOS_DIR, photoFileName } from "../server/photoStore.ts";
import { createRevisionStore } from "../server/revisions.ts";
import { recordingContext, VISIBLE } from "./recording-context.mjs";

/** 정규식은 통과하되 서로 다른 작은 영상. 검사·비교는 내용이 아니라 문자열이 갈리는지만 본다. */
function video(seed, type = "webm") {
  // 서버 이력이 base64 를 풀어 파일로 쓰고 다시 읽으므로 진짜 base64 여야 한다.
  return `data:video/${type};base64,${"QUJD".repeat(20)}${Buffer.from(`clip-${seed}`).toString("base64")}`;
}

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

function layout(project) {
  const page = project.pages[0];
  return {
    version: project.version,
    title: project.title,
    cols: page.cols,
    rows: page.rows,
    background: page.background,
    equipment: page.equipment,
    wiring: page.wiring,
    palette: project.palette,
  };
}

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "grid-video-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("영상 검사: 우리가 담는 형식만 받고 큰 것은 버린다", () => {
  assert.equal(sanitizeVideo(video("a")), video("a"));
  assert.equal(sanitizeVideo(video("a", "mp4")), video("a", "mp4"));
  assert.equal(sanitizeVideo(video("a", "quicktime")), video("a", "quicktime"));
  assert.equal(sanitizeVideo(TINY_PNG), null, "사진은 영상 자리에 못 들어온다");
  assert.equal(sanitizeVideo("data:video/x-matroska;base64,QUJD"), null, "모르는 형식");
  assert.equal(sanitizeVideo(`data:video/webm;base64,${"A".repeat(MAX_VIDEO_CHARS + 1)}`), null, "한 편 한도");
  assert.equal(sanitizeVideo(42), null);
});

test("영상 목록 다듬기: 편수 · 중복 · 총량을 자른다", () => {
  const many = Array.from({ length: MAX_CELL_VIDEOS + 2 }, (_, i) => video(`v${i}`));
  assert.equal(sanitizeVideos(many).length, MAX_CELL_VIDEOS);
  assert.deepEqual(sanitizeVideos([video("a"), video("a"), "쓰레기", video("b")]), [video("a"), video("b")]);
  assert.deepEqual(sanitizeVideos(undefined), []);
});

test("영상 자리 검사: 편수 · 같은 영상 · 총량", () => {
  assert.equal(checkVideoRoom([], video("a")), null);
  assert.match(checkVideoRoom([video("a")], video("a")), /같은 영상/);
  const full = Array.from({ length: MAX_CELL_VIDEOS }, (_, i) => video(`v${i}`));
  assert.match(checkVideoRoom(full, video("z")), new RegExp(`${MAX_CELL_VIDEOS}편`));

  // 한 편이 한도에 꽉 찬 영상 셋이면 칸 총량을 넘는다.
  const heavy = (seed) => `data:video/webm;base64,${"A".repeat(MAX_VIDEO_CHARS - 40)}${seed}==`;
  assert.ok(heavy("a").length * 3 > MAX_CELL_VIDEO_CHARS, "시험 전제: 세 편이면 총량을 넘는다");
  assert.match(checkVideoRoom([heavy("a"), heavy("b")], heavy("c")), /용량/);
  assert.ok(videosBytes([video("a"), video("b")]) > 0);
});

test("영상 크기 셈: 그대로 담을 수 있는가", () => {
  assert.equal(dataUrlChars(3), 4 + 32);
  assert.ok(fitsAsIs(1_000_000), "1MB 는 그대로");
  assert.ok(!fitsAsIs(20_000_000), "20MB 는 다시 굽는다");
  assert.equal(formatSeconds(65), "1:05");
  assert.equal(formatSeconds(0), "0:00");
});

test("영상 파일 이름: 사진과 같은 짜임 · 확장자는 형식을 따른다", () => {
  assert.equal(videoExtension(video("a", "quicktime")), "mov");
  assert.equal(videoExtension(video("a", "ogg")), "ogv");
  assert.equal(videoExtension(video("a", "mp4")), "mp4");
  assert.equal(
    videoFileName({ pageName: "1층 메인 공장", x: 2, y: 4, label: "C1101", index: 2, video: video("a") }),
    "1층-메인-공장_5_3_C1101_video_2.webm",
  );
  assert.equal(
    videoFileName({ pageName: "P", x: 0, y: 0, label: "", index: 1, video: video("a", "mp4") }),
    "P_1_1_-_video_1.mp4",
  );
});

test("칸 갱신: 영상만 있는 칸도 남고, patch 에 자리가 없으면 그대로 둔다", () => {
  const project = createProject("영상");
  let page = project.pages[0];

  page = updateEquipmentInfoOnPage(page, "1,1", { memo: "", videos: [video("a")] });
  assert.deepEqual(cellVideos(page.equipment["1,1"]), [video("a")], "영상만으로도 칸이 산다");

  // 메모만 고치는 patch(영상 자리 없음)는 영상을 지우지 않는다.
  page = updateEquipmentInfoOnPage(page, "1,1", { memo: "점검" });
  assert.deepEqual(cellVideos(page.equipment["1,1"]), [video("a")]);
  assert.equal(page.equipment["1,1"].memo, "점검");

  // 사진과 영상은 서로 건드리지 않는다.
  page = updateEquipmentInfoOnPage(page, "1,1", { photos: [TINY_PNG] });
  assert.deepEqual(cellVideos(page.equipment["1,1"]), [video("a")]);
  assert.deepEqual(page.equipment["1,1"].photos, [TINY_PNG]);

  page = updateEquipmentInfoOnPage(page, "1,1", { memo: "", photos: [], videos: [] });
  assert.equal(page.equipment["1,1"], undefined, "남은 값이 없으면 칸 자체가 비워진다");
});

test("문서 열기: 영상은 검사를 거치고 빈 목록은 필드가 사라진다", () => {
  const project = createProject("영상 저장");
  project.pages[0].equipment["2,2"] = { status: "installed", videos: [video("a"), "쓰레기", TINY_PNG] };
  project.pages[0].equipment["3,3"] = { status: "installed", videos: [] };

  const opened = sanitizeProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(opened.pages[0].equipment["2,2"].videos, [video("a")]);
  assert.equal("videos" in opened.pages[0].equipment["3,3"], false);
});

test("리비전 비교: 영상은 편수와 지문만 적는다", () => {
  const before = createProject("비교");
  const after = JSON.parse(JSON.stringify(before));
  after.pages[0].equipment["1,1"] = { status: "installed", videos: [video("a"), video("b")] };

  const diff = diffProjects(before, after);
  const change = diff.pages[0].changes.find((c) => c.key === "1,1");
  assert.ok(change, "영상이 붙은 칸이 변경으로 잡혀야 한다");
  assert.match(change.after, /영상=2편\(/);
  assert.ok(!change.after.includes("base64"), "data URL 을 통째로 적지 않는다");

  // 편수는 같고 한 편만 갈아 끼우면 변경이다.
  const swapped = JSON.parse(JSON.stringify(after));
  swapped.pages[0].equipment["1,1"].videos = [video("a"), video("c")];
  assert.equal(diffProjects(after, swapped).pages[0].changes.length, 1);
});

test("도면 렌더: 영상이 붙은 칸에 재생 표시(▶)를 남긴다", () => {
  const project = createProject("영상 표시");
  const page = project.pages[0];
  page.equipment["1,1"] = { status: "installed", videos: [video("a")] };
  page.equipment["3,1"] = { status: "installed", photo: TINY_PNG, videos: [video("a"), video("b")] };
  page.equipment["5,1"] = { status: "installed" };

  const ctx = recordingContext();
  renderDoc(ctx, layout(project), { cell: 24, visible: VISIBLE, showGrid: false });

  // 삼각형은 세 점 경로를 채우는 fill 로 남는다(가짜 캔버스의 fillPath). 색으로 가려낸다.
  const marks = ctx.ops.filter((op) => op.op === "fillPath" && op.color === "#1d4ed8");
  assert.equal(marks.length, 2, "영상이 있는 칸 두 곳에만 표시가 있어야 한다");
  assert.ok(marks.every((op) => op.points.length === 3), "재생 표시는 삼각형이다");
  // 사진이 함께 있는 칸(3,1)에서는 사진 네모 오른쪽으로 밀린다.
  const [alone, beside] = marks;
  assert.ok(alone.points[0].x < 24 + 8, "영상만 있는 칸은 왼쪽 끝");
  assert.ok(beside.points[0].x >= 72 + 8, "사진 옆 자리");
  // 두 편이면 편수 글자가 붙는다.
  const counts = ctx.ops.filter((op) => op.op === "fillText" && op.text === "2");
  assert.ok(counts.length >= 1, "편수 2 가 적혀야 한다");
});

test("모바일 요약: 영상이 있으면 빈 칸이 아니다", () => {
  const project = createProject("모바일");
  const page = project.pages[0];
  page.equipment["1,1"] = { videos: [video("a")] };
  const summary = cellSummary(project, page, 1, 1);
  assert.deepEqual(summary.videos, [video("a")]);
  assert.equal(isEmptyCell(summary), false);
  assert.equal(isEmptyCell(cellSummary(project, page, 2, 2)), true);
});

test("이력 영상: 스냅샷에는 참조만 남고 영상 파일은 한 번만 저장된다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const at = (n) => new Date(Date.UTC(2026, 8, 14, 0, n));
    const created = store.create("영상 이력", "가", at(0));
    const id = created.id;

    const withVideo = JSON.parse(JSON.stringify(created.project));
    withVideo.pages[0].equipment["3,4"] = { label: "C1", videos: [video("a", "mp4"), video("b")] };
    store.save({ id, project: withVideo, baseRevision: 1, author: "가", now: at(1) });
    store.save({ id, project: { ...withVideo, title: "제목만" }, baseRevision: 2, author: "가", now: at(2) });

    const files = readdirSync(join(dir, PHOTOS_DIR)).sort();
    assert.deepEqual(files, [photoFileName(video("a", "mp4")), photoFileName(video("b"))].sort());
    assert.ok(files.some((name) => name.endsWith(".mp4")), "mp4 는 .mp4 로 저장된다");
    assert.ok(files.some((name) => name.endsWith(".webm")));

    for (const name of readdirSync(join(dir, ".history", id))) {
      const text = readFileSync(join(dir, ".history", id, name), "utf8");
      assert.ok(!text.includes("data:video/"), `${name} 에 영상이 그대로 들어 있다`);
    }

    // 도면 파일과 이력 읽기는 영상을 그대로 안고 있다.
    const live = store.read(id).project;
    assert.deepEqual(live.pages[0].equipment["3,4"].videos, [video("a", "mp4"), video("b")]);
    const snap = store.snapshot(id, 2);
    assert.deepEqual(snap.pages[0].equipment["3,4"].videos, [video("a", "mp4"), video("b")]);
    assert.ok(!JSON.stringify(snap).includes(PHOTO_REF_PREFIX));
  } finally {
    cleanup();
  }
});
