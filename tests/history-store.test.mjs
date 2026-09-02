import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateEquipmentInfoOnPage } from "../app/editor/doc.ts";
import { PHOTO_REF_PREFIX, PHOTOS_DIR, photoFileName } from "../server/photoStore.ts";
import { createRevisionStore, HISTORY_DIR } from "../server/revisions.ts";

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "grid-history-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 2026-08-19 03:00 UTC 부터 `day` 일 뒤 `minute` 분. 하루 단위 정리를 시험하려고 날을 넘길 수 있다. */
function at(minute, day = 0) {
  return new Date(Date.UTC(2026, 7, 19 + day, 3, minute, 0));
}

/** 정규식은 통과하되 서로 다른 작은 사진. */
const PHOTO_A = `data:image/webp;base64,${"QUJD".repeat(60)}`;
const PHOTO_B = `data:image/jpeg;base64,${"REVG".repeat(60)}`;

function withPhotos(project, key, photos, title) {
  const page = updateEquipmentInfoOnPage(project.pages[0], key, { label: "C1", photos });
  return { ...project, title: title ?? project.title, pages: [page] };
}

function snapshotFiles(dir, id) {
  return readdirSync(join(dir, HISTORY_DIR, id)).sort();
}

test("이력 사진: 스냅샷에는 참조만 남고 사진 파일은 한 번만 저장된다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("사진 이력", "가", at(0));
    const id = created.id;

    const v2 = withPhotos(created.project, "3,4", [PHOTO_A, PHOTO_B], "사진 둘");
    store.save({ id, project: v2, baseRevision: 1, author: "가", now: at(1) });
    // 사진은 그대로 두고 제목만 바꿔 한 번 더 저장한다.
    store.save({ id, project: { ...v2, title: "사진 둘 · 제목만" }, baseRevision: 2, author: "가", now: at(2) });

    // 사진 파일은 내용 해시 이름으로 두 장만 있다 — 저장 횟수와 무관하다.
    const files = readdirSync(join(dir, PHOTOS_DIR)).sort();
    assert.deepEqual(files, [photoFileName(PHOTO_A), photoFileName(PHOTO_B)].sort());

    // 스냅샷 안에는 data URL 이 없고 참조만 있다.
    for (const name of snapshotFiles(dir, id)) {
      const text = readFileSync(join(dir, HISTORY_DIR, id, name), "utf8");
      assert.ok(!text.includes("data:image/"), `${name} 에 사진이 그대로 들어 있다`);
    }
    const third = JSON.parse(readFileSync(join(dir, HISTORY_DIR, id, snapshotFiles(dir, id)[2]), "utf8"));
    assert.ok(third.project.pages[0].equipment["3,4"].photos.every((p) => p.startsWith(PHOTO_REF_PREFIX)));

    // 도면 파일 자체는 사진을 그대로 안고 있다(편집기 · MCP 가 그대로 읽는다).
    const live = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
    assert.deepEqual(live.pages[0].equipment["3,4"].photos, [PHOTO_A, PHOTO_B]);

    // 이력을 읽거나 되돌리면 사진이 다시 채워져 있다.
    assert.deepEqual(store.snapshot(id, 2).pages[0].equipment["3,4"].photos, [PHOTO_A, PHOTO_B]);
    const restored = store.restore(id, 2, "나", at(3));
    assert.equal(restored.revision, 4);
    assert.deepEqual(store.read(id).project.pages[0].equipment["3,4"].photos, [PHOTO_A, PHOTO_B]);
    assert.equal(store.read(id).externalChange, false);
  } finally {
    cleanup();
  }
});

test("같은 내용 저장: 새 판을 만들지 않고 지금 리비전을 그대로 돌려준다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("그대로", "가", at(0));
    const id = created.id;
    const v2 = withPhotos(created.project, "1,1", [PHOTO_A], "한 번 고침");
    const second = store.save({ id, project: v2, baseRevision: 1, author: "가", now: at(1) });
    assert.equal(second.revision, 2);

    const again = store.save({ id, project: v2, baseRevision: 2, author: "나", now: at(2) });
    assert.equal(again.ok, true);
    assert.equal(again.unchanged, true, "같은 내용인데 새 판을 만들었다");
    assert.equal(again.revision, 2);
    assert.equal(again.author, "가", "마지막 판의 저장자 그대로다");
    assert.equal(store.history(id).length, 2);

    // 덮어쓰기도 같은 내용이면 새 판을 만들지 않는다.
    const overwrite = store.save({ id, project: v2, baseRevision: 1, author: "나", now: at(3), mode: "overwrite" });
    assert.equal(overwrite.unchanged, true);
    assert.equal(store.history(id).length, 2);

    // 내용이 바뀌면 다시 새 판이다.
    const changed = store.save({ id, project: { ...v2, title: "다시 고침" }, baseRevision: 2, author: "나", now: at(4) });
    assert.equal(changed.unchanged, undefined);
    assert.equal(changed.revision, 3);
  } finally {
    cleanup();
  }
});

test("이력 보관: 최근 N판은 모두, 그 앞은 하루에 마지막 한 판만 남긴다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir, { keepRecent: 2 });
    const created = store.create("보관", "가", at(0, 0)); // r1 · 1일
    const id = created.id;
    const base = created.project;

    const saves = [
      ["r2", at(1, 0)], // 1일
      ["r3", at(2, 0)], // 1일
      ["r4", at(0, 1)], // 2일
      ["r5", at(1, 1)], // 2일
      ["r6", at(0, 2)], // 3일
    ];
    let revision = 1;
    for (const [title, now] of saves) {
      const result = store.save({ id, project: { ...base, title }, baseRevision: revision, author: "가", now });
      revision = result.revision;
    }
    assert.equal(revision, 6);

    // 최근 2판(r5 · r6)은 그대로. 그 앞은 1일의 마지막(r3), 2일의 마지막(r4)만 남는다.
    assert.deepEqual(
      store.history(id).map((entry) => entry.revision),
      [6, 5, 4, 3],
    );
    // 지운 뒤에도 최신 판 · 리비전 번호는 이어진다.
    const next = store.save({ id, project: { ...base, title: "r7" }, baseRevision: 6, author: "가", now: at(1, 2) });
    assert.equal(next.revision, 7);
  } finally {
    cleanup();
  }
});

test("이력 총량: 상한을 넘으면 오래된 판부터 지우되 최근 판은 남긴다", () => {
  const { dir, cleanup } = freshDir();
  try {
    // 최근 1판만 보장, 총량 상한은 1바이트 → 최근 판 말고는 다 지워진다.
    const store = createRevisionStore(dir, { keepRecent: 1, maxBytes: 1 });
    const created = store.create("총량", "가", at(0, 0));
    const id = created.id;
    const base = created.project;
    store.save({ id, project: { ...base, title: "둘째 날" }, baseRevision: 1, author: "가", now: at(0, 1) });
    store.save({ id, project: { ...base, title: "셋째 날" }, baseRevision: 2, author: "가", now: at(0, 2) });

    assert.deepEqual(
      store.history(id).map((entry) => entry.revision),
      [3],
    );
    assert.equal(store.read(id).revision, 3);
    assert.equal(store.read(id).project.title, "셋째 날");
  } finally {
    cleanup();
  }
});

test("옛 이력(사진 내장)은 다음 저장 때 참조 형식으로 옮겨지고 그대로 읽힌다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("옛 이력", "가", at(0));
    const id = created.id;

    // 예전 판 프로그램이 남긴 모양: 사진이 스냅샷 안에 통째로 들어 있고 들여쓰기도 있다.
    const old = withPhotos(created.project, "2,2", [PHOTO_A], "옛 판");
    const folder = join(dir, HISTORY_DIR, id);
    const oldFile = join(folder, "0002_2026-08-19T03-05-00-000Z.json");
    writeFileSync(
      oldFile,
      JSON.stringify({ revision: 2, savedAt: at(5).toISOString(), author: "옛사람", project: old }, null, 2),
      "utf8",
    );
    assert.ok(readFileSync(oldFile, "utf8").includes("data:image/"));

    // 다음 저장에서 옮겨진다. (도면 파일은 r1 그대로라 r2 스냅샷과 다르다 — 밖에서 바뀐 것으로
    // 잡히므로 덮어쓰기로 저장한다.)
    const saved = store.save({ id, project: { ...old, title: "새 판" }, baseRevision: 2, author: "가", now: at(6), mode: "overwrite" });
    assert.equal(saved.ok, true);
    assert.equal(saved.revision, 3);
    assert.ok(!readFileSync(oldFile, "utf8").includes("data:image/"), "옛 스냅샷이 그대로 남아 있다");
    assert.ok(existsSync(join(dir, PHOTOS_DIR, photoFileName(PHOTO_A))));

    // 내용은 그대로다.
    const snapshot = store.snapshot(id, 2);
    assert.equal(snapshot.title, "옛 판");
    assert.deepEqual(snapshot.pages[0].equipment["2,2"].photos, [PHOTO_A]);
    assert.equal(store.history(id).find((entry) => entry.revision === 2)?.author, "옛사람");
  } finally {
    cleanup();
  }
});

test("사진 정리: 지워진 판만 쓰던 사진 파일은 함께 지우고, 살아 있는 사진은 남긴다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir, { keepRecent: 1, maxBytes: 1 });
    const created = store.create("정리", "가", at(0, 0));
    const id = created.id;

    store.save({ id, project: withPhotos(created.project, "1,1", [PHOTO_A], "A 붙임"), baseRevision: 1, author: "가", now: at(0, 1) });
    assert.ok(existsSync(join(dir, PHOTOS_DIR, photoFileName(PHOTO_A))));

    // A 를 떼고 B 를 붙여 저장 → r2 가 지워지고 A 파일도 함께 사라진다. B 는 남는다.
    store.save({ id, project: withPhotos(created.project, "1,1", [PHOTO_B], "B 붙임"), baseRevision: 2, author: "가", now: at(0, 2) });
    assert.deepEqual(readdirSync(join(dir, PHOTOS_DIR)), [photoFileName(PHOTO_B)]);
    assert.deepEqual(store.read(id).project.pages[0].equipment["1,1"].photos, [PHOTO_B]);
  } finally {
    cleanup();
  }
});
