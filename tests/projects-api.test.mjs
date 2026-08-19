import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createProject } from "../app/editor/doc.ts";
import { createStore } from "../mcp/store.ts";
import { createProjectsApi } from "../server/projectsApi.ts";
import { API_BASE, parsePath } from "../server/projectsRouter.ts";
import { createRevisionStore, HISTORY_DIR } from "../server/revisions.ts";

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "grid-share-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 저장 시각을 고정해 파일 이름과 정렬을 예측할 수 있게 한다. */
function at(minute) {
  return new Date(Date.UTC(2026, 7, 19, 3, minute, 0));
}

function seeded(title = "공유 도면") {
  const project = createProject(title);
  project.pages[0].background["1,1"] = "wall";
  return project;
}

test("새 도면: 파일과 첫 이력이 함께 만들어진다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("1공장 배치도", "홍길동", at(0));

    assert.equal(created.ok, true);
    assert.equal(created.revision, 1);
    assert.equal(created.author, "홍길동");
    assert.ok(existsSync(join(dir, `${created.id}.json`)));
    assert.equal(store.history(created.id).length, 1);

    // 도면 파일은 편집기 JSON 그대로다. MCP 와 같은 파일을 본다.
    const saved = JSON.parse(readFileSync(join(dir, `${created.id}.json`), "utf8"));
    assert.equal(saved.version, 3);
    assert.equal(saved.title, "1공장 배치도");
  } finally {
    cleanup();
  }
});

test("저장: 리비전이 하나씩 오르고 스냅샷이 쌓인다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("이력", "가", at(0));
    const project = store.read(created.id).project;

    project.title = "이력 2";
    const second = store.save({ id: created.id, project, baseRevision: 1, author: "나", now: at(1) });
    assert.equal(second.ok, true);
    assert.equal(second.revision, 2);

    const history = store.history(created.id);
    assert.deepEqual(
      history.map((entry) => entry.revision),
      [2, 1],
      "최근 것이 위로 온다",
    );
    assert.equal(history[0].author, "나");
    assert.equal(history[0].title, "이력 2");

    // 스냅샷은 .history/<id>/ 아래에 쌓인다.
    const files = readdirSync(join(dir, HISTORY_DIR, created.id));
    assert.equal(files.length, 2);
    assert.ok(files.every((name) => /^\d{4}_.+\.json$/.test(name)));
  } finally {
    cleanup();
  }
});

test("동시 편집: 먼저 저장한 사람이 있으면 충돌을 알린다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("동시 편집", "가", at(0));

    // 두 사람이 같은 리비전(r1)을 열었다.
    const mine = store.read(created.id).project;
    const yours = store.read(created.id).project;

    yours.title = "네가 먼저";
    const first = store.save({ id: created.id, project: yours, baseRevision: 1, author: "너", now: at(1) });
    assert.equal(first.ok, true);

    mine.title = "내가 나중";
    const clash = store.save({ id: created.id, project: mine, baseRevision: 1, author: "나", now: at(2) });
    assert.equal(clash.ok, false);
    assert.equal(clash.reason, "conflict");
    assert.equal(clash.revision, 2);
    assert.match(clash.message, /너/);

    // 서버 내용은 그대로 남아 있어야 한다.
    assert.equal(store.read(created.id).project.title, "네가 먼저");
  } finally {
    cleanup();
  }
});

test("충돌 해결: 덮어쓰기는 그대로 올리고 사본은 새 도면을 만든다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("해결", "가", at(0));
    const mine = store.read(created.id).project;
    store.save({ id: created.id, project: seeded("남이 먼저"), baseRevision: 1, author: "너", now: at(1) });

    mine.title = "덮어쓴 내용";
    const forced = store.save({ id: created.id, project: mine, mode: "overwrite", author: "나", now: at(2) });
    assert.equal(forced.ok, true);
    assert.equal(forced.revision, 3);
    assert.equal(store.read(created.id).project.title, "덮어쓴 내용");

    const copy = store.save({ id: created.id, project: mine, mode: "copy", author: "나", now: at(3) });
    assert.equal(copy.ok, true);
    assert.equal(copy.copied, true);
    assert.notEqual(copy.id, created.id);
    assert.equal(copy.revision, 1);
    assert.equal(store.read(copy.id).project.title, "덮어쓴 내용");
    // 원본은 건드리지 않는다.
    assert.equal(store.read(created.id).revision, 3);
  } finally {
    cleanup();
  }
});

test("MCP 가 밖에서 고친 파일도 충돌로 잡는다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("바깥 수정", "가", at(0));

    // MCP 서버(또는 손편집)가 같은 폴더의 파일을 바꿨다 — 이력은 그대로다.
    const outside = createStore(dir);
    const project = outside.read(created.id);
    project.title = "MCP 가 고침";
    outside.write(created.id, project);

    const loaded = store.read(created.id);
    assert.equal(loaded.externalChange, true);

    const clash = store.save({ id: created.id, project: seeded("내 것"), baseRevision: 1, author: "나", now: at(1) });
    assert.equal(clash.ok, false);
    assert.equal(clash.externalChange, true);
    assert.match(clash.message, /편집기 밖/);
  } finally {
    cleanup();
  }
});

test("이력이 없는 파일(MCP 가 만든 도면)도 그대로 열고 저장할 수 있다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const outside = createStore(dir);
    outside.write("mcp-도면", seeded("MCP 도면"));

    const store = createRevisionStore(dir);
    const loaded = store.read("mcp-도면");
    assert.equal(loaded.revision, 0);
    assert.equal(loaded.externalChange, false);

    const saved = store.save({ id: "mcp-도면", project: loaded.project, baseRevision: 0, author: "나", now: at(1) });
    assert.equal(saved.ok, true);
    assert.equal(saved.revision, 1);
  } finally {
    cleanup();
  }
});

test("되돌리기: 이력을 지우지 않고 새 리비전으로 다시 올린다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("되돌리기", "가", at(0));

    const project = store.read(created.id).project;
    project.title = "두 번째";
    store.save({ id: created.id, project, baseRevision: 1, author: "가", now: at(1) });

    const restored = store.restore(created.id, 1, "나", at(2));
    assert.equal(restored.revision, 3);
    assert.equal(store.read(created.id).project.title, "되돌리기");
    assert.equal(store.history(created.id).length, 3, "이력은 남아 있다");
    assert.match(store.history(created.id)[0].author, /r1 복원/);
  } finally {
    cleanup();
  }
});

test("되돌리기: 없는 리비전은 거부한다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("없는 리비전", "가", at(0));
    assert.throws(() => store.restore(created.id, 99, "나"), /리비전을 찾을 수 없습니다/);
  } finally {
    cleanup();
  }
});

test("목록: 도면마다 리비전과 마지막 저장 정보를 준다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    store.create("가나다", "홍길동", at(0));
    store.create("라마바", "김철수", at(1));

    const list = store.list();
    assert.equal(list.length, 2);
    for (const entry of list) {
      assert.equal(entry.revision, 1);
      assert.ok(entry.savedAt);
      assert.ok(entry.author);
    }
    // 이력 폴더는 도면으로 세지 않는다.
    assert.equal(list.some((entry) => entry.id === HISTORY_DIR), false);
  } finally {
    cleanup();
  }
});

test("잘못된 입력: 배치도 형식이 아니면 저장하지 않는다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    assert.throws(() => store.save({ id: "아무거나", project: { 이건: "도면 아님" } }), /배치도 형식이 아닙니다/);
    assert.throws(() => store.read("../탈출"), /쓸 수 없는 projectId/);
  } finally {
    cleanup();
  }
});

test("손으로 넣어 둔 백업 파일(봉투 없는 JSON)도 이력으로 읽는다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("백업", "가", at(0));

    const folder = join(dir, HISTORY_DIR, created.id);
    writeFileSync(join(folder, "0005_수동백업.json"), JSON.stringify(seeded("손으로 넣은 백업")), "utf8");

    const history = store.history(created.id);
    assert.equal(history[0].revision, 5);
    assert.equal(history[0].title, "손으로 넣은 백업");

    const restored = store.restore(created.id, 5, "나", at(1));
    assert.equal(restored.revision, 6);
    assert.equal(store.read(created.id).project.title, "손으로 넣은 백업");
  } finally {
    cleanup();
  }
});

/** 미들웨어를 실제 HTTP 없이 부르기 위한 최소한의 요청·응답. */
function fakeRequest(method, url, body) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (payload) yield payload;
    },
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

async function call(api, method, url, body) {
  const res = fakeResponse();
  let passed = false;
  await api(fakeRequest(method, url, body), res, () => {
    passed = true;
  });
  return { res, passed };
}

test("API: 목록 · 생성 · 조회 · 저장 · 이력 · 복원이 한 줄로 이어진다", async () => {
  const { dir, cleanup } = freshDir();
  try {
    const api = createProjectsApi(dir);

    const empty = await call(api, "GET", "/api/projects");
    assert.equal(empty.res.statusCode, 200);
    assert.deepEqual(empty.res.json.projects, []);

    const created = await call(api, "POST", "/api/projects", { title: "API 도면", author: "홍길동" });
    assert.equal(created.res.statusCode, 201);
    const id = created.res.json.id;

    const loaded = await call(api, "GET", `/api/projects/${encodeURIComponent(id)}`);
    assert.equal(loaded.res.statusCode, 200);
    assert.equal(loaded.res.json.revision, 1);

    const project = loaded.res.json.project;
    project.title = "API 도면 2";
    const saved = await call(api, "POST", `/api/projects/${encodeURIComponent(id)}`, {
      project,
      baseRevision: 1,
      author: "김철수",
    });
    assert.equal(saved.res.statusCode, 200);
    assert.equal(saved.res.json.revision, 2);

    const history = await call(api, "GET", `/api/projects/${encodeURIComponent(id)}/history`);
    assert.equal(history.res.statusCode, 200);
    assert.equal(history.res.json.revisions.length, 2);

    const restored = await call(api, "POST", `/api/projects/${encodeURIComponent(id)}/restore/1`, { author: "김철수" });
    assert.equal(restored.res.statusCode, 200);
    assert.equal(restored.res.json.revision, 3);

    const after = await call(api, "GET", `/api/projects/${encodeURIComponent(id)}`);
    assert.equal(after.res.json.project.title, "API 도면");
  } finally {
    cleanup();
  }
});

test("API: 충돌은 409 로 알리고 내용을 함께 준다", async () => {
  const { dir, cleanup } = freshDir();
  try {
    const api = createProjectsApi(dir);
    const created = await call(api, "POST", "/api/projects", { title: "충돌", author: "가" });
    const id = created.res.json.id;
    const loaded = await call(api, "GET", `/api/projects/${encodeURIComponent(id)}`);

    await call(api, "POST", `/api/projects/${encodeURIComponent(id)}`, {
      project: loaded.res.json.project,
      baseRevision: 1,
      author: "너",
    });

    const clash = await call(api, "POST", `/api/projects/${encodeURIComponent(id)}`, {
      project: loaded.res.json.project,
      baseRevision: 1,
      author: "나",
    });
    assert.equal(clash.res.statusCode, 409);
    assert.equal(clash.res.json.ok, false);
    assert.equal(clash.res.json.revision, 2);
  } finally {
    cleanup();
  }
});

test("API: 다른 주소는 손대지 않고 넘긴다", async () => {
  const { dir, cleanup } = freshDir();
  try {
    const api = createProjectsApi(dir);
    const other = await call(api, "GET", "/editor");
    assert.equal(other.passed, true, "앱 라우트는 그대로 지나가야 한다");
    assert.equal(other.res.body, "");

    const missing = await call(api, "DELETE", "/api/projects/무엇");
    assert.equal(missing.res.statusCode, 404);

    const badJson = await call(api, "GET", "/api/projects/없는-도면");
    assert.equal(badJson.res.statusCode, 404);
    assert.match(badJson.res.json.error, /찾을 수 없습니다/);
  } finally {
    cleanup();
  }
});

test("용지 설정은 서버 저장 · 이력 · 복원을 거쳐도 그대로 남는다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("용지 보존", "가", at(0));

    const paper = { id: "a3", orientation: "portrait", cellMm: 7, marginMm: 8 };
    const project = store.read(created.id).project;
    project.pages[0].paper = { ...paper };
    store.save({ id: created.id, project, baseRevision: 1, author: "가", now: at(1) });

    // 프로젝트 파일에도, 이력 스냅샷에도 적힌다.
    const saved = JSON.parse(readFileSync(join(dir, `${created.id}.json`), "utf8"));
    assert.deepEqual(saved.pages[0].paper, paper);

    const snapshot = JSON.parse(readFileSync(store.history(created.id)[0].file, "utf8"));
    assert.deepEqual(snapshot.project.pages[0].paper, paper);

    // 용지를 지운 채 한 번 더 저장한 뒤 되돌리면 다시 살아난다.
    const dropped = store.read(created.id).project;
    delete dropped.pages[0].paper;
    store.save({ id: created.id, project: dropped, baseRevision: 2, author: "가", now: at(2) });
    assert.equal(store.read(created.id).project.pages[0].paper, undefined);

    store.restore(created.id, 2, "가", at(3));
    assert.deepEqual(store.read(created.id).project.pages[0].paper, paper);
  } finally {
    cleanup();
  }
});

test("용지 설정이 망가져 있으면 버리고 나머지는 살린다", () => {
  const { dir, cleanup } = freshDir();
  try {
    const store = createRevisionStore(dir);
    const created = store.create("망가진 용지", "가", at(0));

    const project = store.read(created.id).project;
    project.pages[0].paper = { id: "없는용지", orientation: "대각선", cellMm: "다섯" };
    store.save({ id: created.id, project, baseRevision: 1, author: "가", now: at(1) });

    const loaded = store.read(created.id);
    assert.equal(loaded.project.pages[0].paper, undefined, "형식이 아니면 인쇄 설정만 버린다");
    assert.equal(loaded.project.pages.length, 1, "도면은 그대로 남는다");
  } finally {
    cleanup();
  }
});

test("경로 해석: /api/projects 만 잡고 조각을 풀어 준다", () => {
  assert.deepEqual(parsePath(API_BASE), []);
  assert.deepEqual(parsePath(`${API_BASE}/도면`), ["도면"]);
  assert.deepEqual(parsePath(`${API_BASE}/${encodeURIComponent("가공장-배치도")}/history`), [
    "가공장-배치도",
    "history",
  ]);
  assert.deepEqual(parsePath(`${API_BASE}/x/restore/3`), ["x", "restore", "3"]);

  // 다른 주소는 손대지 않는다.
  assert.equal(parsePath("/editor"), null);
  assert.equal(parsePath("/api/projectsomething"), null);
  assert.equal(parsePath("/"), null);
});
