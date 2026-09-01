import assert from "node:assert/strict";
import test from "node:test";
import {
  addConnectionToProject,
  connectionsAtCell,
  connectionsOfDevice,
  findConnection,
  MAX_CONNECTION_LABEL,
  nextConnectionId,
  removeConnectionFromProject,
  sanitizeConnections,
} from "../app/editor/connection.ts";
import { linkDeviceToCell, removeDeviceFromProject, upsertDeviceInProject } from "../app/editor/device.ts";
import { activeLayoutDoc, createProject, paintCellsOnPage, updateActivePage } from "../app/editor/doc.ts";
import { CONNECTION_COLOR, connectionSegmentsOnPage } from "../app/editor/connection.ts";
import { connectionEndColors } from "../app/editor/render.ts";
import { inkOnPaper } from "../app/editor/palette.ts";
import { parseProjectJson, projectToJson, sanitizeProject } from "../app/editor/storage.ts";

/** 장치 세 대가 등록된 한 페이지짜리 프로젝트. 연결 테스트의 공통 출발점이다. */
function projectWithDevices() {
  let project = createProject("연결 테스트");
  project = upsertDeviceInProject(project, { id: "dev-1", type: "RFID 리더기", serial: "RR657-002219" });
  project = upsertDeviceInProject(project, { id: "dev-2", type: "PLC", ip: "192.168.0.10" });
  project = upsertDeviceInProject(project, { id: "dev-3", type: "저울" });
  return project;
}

const PAGES = [{ id: "page-1" }];

test("sanitizeConnections: 성치 않은 끝점·같은 양끝·중복 쌍을 버린다", () => {
  const devices = [{ id: "dev-1" }, { id: "dev-2" }];
  const connections = sanitizeConnections(
    [
      { id: "conn-1", from: { device: "dev-1" }, to: { device: "dev-2" }, label: "  RS-232  " },
      { id: "conn-2", from: { device: "dev-2" }, to: { device: "dev-1" } }, // 같은 쌍 (방향만 반대)
      { id: "conn-1", from: { device: "dev-1" }, to: { page: "page-1", cell: "3,4" } }, // 중복 id
      { id: "conn-3", from: { device: "dev-1" }, to: { device: "dev-1" } }, // 양끝이 같음
      { id: "conn-4", from: { device: "dev-1" }, to: { device: "ghost" } }, // 대장에 없는 장치
      { id: "conn-5", from: { page: "ghost", cell: "1,1" }, to: { device: "dev-1" } }, // 없는 페이지
      { id: "conn-6", from: { page: "page-1", cell: "x,y" }, to: { device: "dev-1" } }, // 칸 키 모양 아님
      { id: "conn-7", from: { page: "page-1", cell: "3,4" }, to: { page: "page-1", cell: "5,6" } },
      null,
      "문자열",
    ],
    devices,
    PAGES,
  );
  assert.equal(connections.length, 2);
  assert.deepEqual(connections[0], {
    id: "conn-1",
    from: { device: "dev-1" },
    to: { device: "dev-2" },
    label: "RS-232",
  });
  assert.deepEqual(connections[1], {
    id: "conn-7",
    from: { page: "page-1", cell: "3,4" },
    to: { page: "page-1", cell: "5,6" },
  });
});

test("sanitizeConnections: 대장이 비어도 칸 끝점끼리의 연결은 산다", () => {
  const connections = sanitizeConnections(
    [{ id: "conn-1", from: { page: "page-1", cell: "1,1" }, to: { page: "page-1", cell: "9,9" } }],
    undefined,
    PAGES,
  );
  assert.equal(connections.length, 1);
});

test("sanitizeConnections: 장치 id 를 문자열로 적던 첫 판 형식도 읽는다", () => {
  const connections = sanitizeConnections(
    [{ id: "conn-1", from: "dev-1", to: "dev-2" }],
    [{ id: "dev-1" }, { id: "dev-2" }],
    PAGES,
  );
  assert.deepEqual(connections[0].from, { device: "dev-1" });
  assert.deepEqual(connections[0].to, { device: "dev-2" });
});

test("nextConnectionId: 쓰이지 않은 id 를 결정적으로 낸다", () => {
  assert.equal(nextConnectionId([]), "conn-1");
  const taken = [
    { id: "conn-1", from: { device: "a" }, to: { device: "b" } },
    { id: "conn-3", from: { device: "b" }, to: { device: "c" } },
  ];
  assert.equal(nextConnectionId(taken), "conn-4");
  assert.equal(nextConnectionId(taken), nextConnectionId(taken));
});

test("addConnectionToProject: 장치·칸을 가리지 않고 잇고, 방향이 반대인 같은 쌍은 막는다", () => {
  let project = projectWithDevices();
  project = addConnectionToProject(project, { device: "dev-1" }, { device: "dev-2" }, { label: " 계량 신호 " });
  project = addConnectionToProject(project, { device: "dev-1" }, { page: "page-1", cell: "3,4" });
  assert.equal(project.connections.length, 2);
  assert.deepEqual(project.connections[0], {
    id: "conn-1",
    from: { device: "dev-1" },
    to: { device: "dev-2" },
    label: "계량 신호",
  });

  const again = addConnectionToProject(project, { device: "dev-2" }, { device: "dev-1" });
  assert.equal(again, project);

  const self = addConnectionToProject(project, { device: "dev-1" }, { device: "dev-1" });
  assert.equal(self, project);

  const ghost = addConnectionToProject(project, { device: "dev-1" }, { device: "ghost" });
  assert.equal(ghost, project);

  const badPage = addConnectionToProject(project, { device: "dev-1" }, { page: "ghost", cell: "1,1" });
  assert.equal(badPage, project);
});

test("addConnectionToProject: 라벨을 다듬고 색은 #rrggbb 만 받는다", () => {
  let project = projectWithDevices();
  project = addConnectionToProject(project, { device: "dev-1" }, { device: "dev-2" }, {
    label: "x".repeat(MAX_CONNECTION_LABEL + 10),
    color: "#FF8800",
  });
  project = addConnectionToProject(project, { device: "dev-1" }, { device: "dev-3" }, { color: "빨강" });
  assert.equal(project.connections[0].label.length, MAX_CONNECTION_LABEL);
  assert.equal(project.connections[0].color, "#ff8800");
  assert.equal(project.connections[1].color, undefined);
});

test("findConnection / connectionsOfDevice: 방향을 가리지 않는다", () => {
  let project = projectWithDevices();
  project = addConnectionToProject(project, { device: "dev-1" }, { device: "dev-2" });
  project = addConnectionToProject(project, { device: "dev-3" }, { device: "dev-2" });

  assert.ok(findConnection(project.connections, { device: "dev-2" }, { device: "dev-1" }));
  assert.equal(findConnection(project.connections, { device: "dev-1" }, { device: "dev-3" }), undefined);
  assert.equal(connectionsOfDevice(project.connections, "dev-2").length, 2);
  assert.equal(connectionsOfDevice(project.connections, "dev-1").length, 1);
  assert.equal(connectionsOfDevice(undefined, "dev-1").length, 0);
});

test("connectionsAtCell: 칸 끝점과 그 칸에 놓인 장치를 한 번에 찾는다", () => {
  let project = projectWithDevices();
  project = addConnectionToProject(project, { device: "dev-1" }, { page: "page-1", cell: "3,4" });
  project = addConnectionToProject(project, { page: "page-1", cell: "3,4" }, { page: "page-1", cell: "7,8" });

  // (3,4) 칸: 칸 끝점으로 두 연결에 낀다.
  assert.equal(connectionsAtCell(project.connections, "page-1", "3,4").length, 2);
  // dev-1 이 놓인 칸: 장치 끝점으로 한 연결에 낀다.
  assert.equal(connectionsAtCell(project.connections, "page-1", "0,0", "dev-1").length, 1);
  // 아무 연결에도 안 낀 칸.
  assert.equal(connectionsAtCell(project.connections, "page-1", "20,20").length, 0);
});

test("removeConnectionFromProject: 마지막 연결이 나가면 필드를 비운다", () => {
  let project = projectWithDevices();
  project = addConnectionToProject(project, { device: "dev-1" }, { device: "dev-2" });
  project = removeConnectionFromProject(project, "conn-1");
  assert.equal(project.connections, undefined);
});

test("removeDeviceFromProject: 장치가 나가면 그 장치가 낀 연결만 나간다", () => {
  let project = projectWithDevices();
  project = addConnectionToProject(project, { device: "dev-1" }, { device: "dev-2" });
  project = addConnectionToProject(project, { device: "dev-2" }, { device: "dev-3" });
  project = addConnectionToProject(project, { page: "page-1", cell: "1,1" }, { page: "page-1", cell: "2,2" });

  project = removeDeviceFromProject(project, "dev-2");
  assert.equal(project.connections.length, 1);
  assert.deepEqual(project.connections.map((c) => c.id), ["conn-3"]);
  assert.ok(!project.devices.some((d) => d.id === "dev-2"));
});

test("connectionSegmentsOnPage: 장치는 놓인 칸으로, 칸은 좌표 그대로 풀린다", () => {
  let project = projectWithDevices();
  project = linkDeviceToCell(project, "5,6", "dev-1"); // dev-1 을 (5,6) 에 배치
  project = addConnectionToProject(project, { device: "dev-1" }, { page: "page-1", cell: "10,3" });
  project = addConnectionToProject(project, { device: "dev-1" }, { device: "dev-2" }); // dev-2 미배치
  project = addConnectionToProject(project, { device: "dev-1" }, { page: "page-1", cell: "999,3" }); // 격자 밖

  const segments = connectionSegmentsOnPage(project, "page-1");
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].from, { x: 5, y: 6 });
  assert.deepEqual(segments[0].to, { x: 10, y: 3 });

  // 활성 페이지 뷰에도 같은 것이 실린다 — 렌더러(화면·PNG·인쇄)가 이걸 그린다.
  const doc = activeLayoutDoc(project);
  assert.equal(doc.connectionSegments.length, 1);

  assert.equal(connectionSegmentsOnPage(project, "ghost").length, 0);
});

test("connectionEndColors: 끝점 칸의 색을 물려받고, 빈 칸은 기본색, 지정색은 단색", () => {
  let project = projectWithDevices();
  // (5,6) 에 상태색(설치 정상 #57a639)을 칠하고 dev-1 을 놓는다. (10,3) 은 빈 칸.
  const installed = project.palette.find((item) => item.id === "installed");
  project = updateActivePage(project, (page) => paintCellsOnPage(page, installed, [{ x: 5, y: 6 }]));
  project = linkDeviceToCell(project, "5,6", "dev-1");
  project = addConnectionToProject(project, { device: "dev-1" }, { page: "page-1", cell: "10,3" });
  project = addConnectionToProject(project, { page: "page-1", cell: "1,1" }, { page: "page-1", cell: "2,2" }, {
    color: "#7c3aed",
  });

  const doc = activeLayoutDoc(project);
  const colors = connectionEndColors(doc, doc.connectionSegments);
  assert.deepEqual(colors[0], { from: installed.color, to: CONNECTION_COLOR });
  assert.deepEqual(colors[1], { from: "#7c3aed", to: "#7c3aed" });
});

test("inkOnPaper: 너무 밝은 색은 어둡게 눌리고 진한 색은 그대로", () => {
  assert.equal(inkOnPaper("#57a639", "#2563eb"), "#57a639");
  assert.equal(inkOnPaper(null, "#2563eb"), "#2563eb");
  assert.notEqual(inkOnPaper("#eef1f4", "#2563eb"), "#eef1f4"); // 통로색 — 흰 바탕에 묻힌다
  assert.match(inkOnPaper("#eef1f4", "#2563eb"), /^#[0-9a-f]{6}$/);
});

test("저장 왕복: 연결이 sanitizeProject 통로를 그대로 지난다", () => {
  let project = projectWithDevices();
  project = addConnectionToProject(project, { device: "dev-1" }, { device: "dev-2" }, {
    label: "RS-232",
    color: "#16a34a",
  });
  project = addConnectionToProject(project, { page: "page-1", cell: "3,4" }, { device: "dev-3" });
  const restored = parseProjectJson(projectToJson(project));
  assert.deepEqual(restored.connections, project.connections);
});

test("sanitizeProject: 대장에서 사라진 장치를 가리키는 연결은 열 때 걸러진다", () => {
  let project = projectWithDevices();
  project = addConnectionToProject(project, { device: "dev-1" }, { device: "dev-2" });
  const raw = JSON.parse(projectToJson(project));
  raw.devices = raw.devices.filter((d) => d.id !== "dev-2");
  const restored = sanitizeProject(raw);
  assert.equal(restored.connections, undefined);
});
