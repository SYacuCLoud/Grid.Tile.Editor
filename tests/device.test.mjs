import assert from "node:assert/strict";
import test from "node:test";
import { activePage, createProject, updateActivePage, updateEquipmentInfoOnPage } from "../app/editor/doc.ts";
import {
  deviceById,
  deviceLabel,
  linkDeviceToCell,
  MAX_DEVICE_FIELD,
  MAX_DEVICES,
  nextDeviceId,
  normalizeDeviceField,
  registerDeviceForCell,
  removeDeviceFromProject,
  sanitizeDevices,
  unplaceDeviceInProject,
  upsertDeviceInProject,
} from "../app/editor/device.ts";
import { devicesToCsv, devicesToMarkdown, sortDevices } from "../app/editor/deviceExport.ts";
import { parseProjectJson, projectToJson, sanitizeProject } from "../app/editor/storage.ts";

test("필드 다듬기: 공백을 떼고 길이를 자른다", () => {
  assert.equal(normalizeDeviceField("  RR657-002219  "), "RR657-002219");
  assert.equal(normalizeDeviceField(123), "");
  assert.equal(normalizeDeviceField("x".repeat(MAX_DEVICE_FIELD + 10)).length, MAX_DEVICE_FIELD);
});

test("sanitizeDevices: id 없는 항목과 중복 id 를 버리고 빈 필드를 남기지 않는다", () => {
  const devices = sanitizeDevices([
    { id: "dev-1", type: " RFID 리더기 ", serial: "RR657-002219", ip: "" },
    { id: "dev-1", type: "중복" },
    { type: "id 없음" },
    "문자열",
    null,
    { id: "dev-2", station: "1101", role: "입하" },
  ]);
  assert.equal(devices.length, 2);
  assert.deepEqual(devices[0], { id: "dev-1", type: "RFID 리더기", serial: "RR657-002219" });
  assert.deepEqual(devices[1], { id: "dev-2", station: "1101", role: "입하" });
});

test("sanitizeDevices: 배열이 아니거나 비면 undefined", () => {
  assert.equal(sanitizeDevices(undefined), undefined);
  assert.equal(sanitizeDevices({}), undefined);
  assert.equal(sanitizeDevices([]), undefined);
  assert.equal(sanitizeDevices([null, "x"]), undefined);
});

test("sanitizeDevices: 상한을 넘는 항목은 버린다", () => {
  const raw = Array.from({ length: MAX_DEVICES + 5 }, (_, i) => ({ id: `dev-${i + 1}` }));
  assert.equal(sanitizeDevices(raw).length, MAX_DEVICES);
});

test("nextDeviceId: 지운 뒤 추가해도 겹치지 않는다", () => {
  assert.equal(nextDeviceId([]), "dev-1");
  assert.equal(nextDeviceId([{ id: "dev-1" }, { id: "dev-2" }]), "dev-3");
  assert.equal(nextDeviceId([{ id: "dev-2" }]), "dev-3");
});

test("deviceLabel: 채워진 것부터 이어 부르고, 아무것도 없으면 id", () => {
  assert.equal(deviceLabel({ id: "dev-1", station: "1101", role: "입하", serial: "RR657-002219" }), "1101 · 입하 · RR657-002219");
  assert.equal(deviceLabel({ id: "dev-9" }), "dev-9");
});

test("upsert: 추가와 갈아 끼우기, 필드는 다듬어서 담는다", () => {
  let project = createProject();
  project = upsertDeviceInProject(project, { id: "dev-1", type: " 저울 ", comPort: true, port: "COM3" });
  assert.deepEqual(project.devices, [{ id: "dev-1", type: "저울", comPort: true, port: "COM3" }]);

  project = upsertDeviceInProject(project, { id: "dev-1", type: "저울", port: "COM4" });
  assert.equal(project.devices.length, 1);
  assert.equal(project.devices[0].port, "COM4");
  // 체크를 빼고 저장하면 체크도 사라진다.
  assert.equal(project.devices[0].comPort, undefined);
});

test("sanitizeDevices: 이전 판의 문자열 COM 포트는 체크 + PORT 로 옮긴다", () => {
  const devices = sanitizeDevices([
    { id: "dev-1", comPort: "COM3" },
    { id: "dev-2", comPort: true },
    { id: "dev-3", comPort: "" },
  ]);
  assert.deepEqual(devices[0], { id: "dev-1", comPort: true, port: "COM3" });
  assert.deepEqual(devices[1], { id: "dev-2", comPort: true });
  assert.deepEqual(devices[2], { id: "dev-3" });
});

test("칸 등록: 장비 ID 가 S/N 으로 옮겨 심어지고 칸이 장치를 가리킨다", () => {
  let project = createProject();
  project = updateActivePage(project, (page) => updateEquipmentInfoOnPage(page, "3,4", { label: "RR657-005570" }));
  project = registerDeviceForCell(project, "3,4");

  const cell = activePage(project).equipment["3,4"];
  const device = deviceById(project.devices, cell.deviceId);
  assert.equal(device.serial, "RR657-005570");
  assert.equal(cell.label, "RR657-005570");
});

test("빈 칸 등록: S/N 없는 장치가 만들어지고 연결된다", () => {
  const project = registerDeviceForCell(createProject(), "0,0");
  const cell = activePage(project).equipment["0,0"];
  assert.equal(project.devices.length, 1);
  assert.equal(cell.deviceId, project.devices[0].id);
  assert.equal(project.devices[0].serial, undefined);
});

test("삭제: 대장에서 지우면 모든 페이지의 연결도 풀린다", () => {
  let project = registerDeviceForCell(createProject(), "1,1");
  const id = project.devices[0].id;
  // 같은 장치를 다른 칸에서도 가리키게 한다.
  project = updateActivePage(project, (page) => updateEquipmentInfoOnPage(page, "2,2", { label: "표식", deviceId: id }));

  project = removeDeviceFromProject(project, id);
  assert.equal(project.devices, undefined);
  // 연결만 있던 칸은 비워지고, 다른 내용이 있던 칸은 연결만 풀린다.
  assert.equal(activePage(project).equipment["1,1"], undefined);
  assert.deepEqual(activePage(project).equipment["2,2"], { label: "표식" });
});

test("연결 해제: deviceId 만 있던 칸은 빈 칸으로 돌아간다", () => {
  let project = registerDeviceForCell(createProject(), "5,5");
  project = updateActivePage(project, (page) => updateEquipmentInfoOnPage(page, "5,5", { deviceId: "" }));
  assert.equal(activePage(project).equipment["5,5"], undefined);
  // 장치는 대장에 남는다.
  assert.equal(project.devices.length, 1);
});

test("S/N 동기화: 장치의 S/N 을 고치면 연결된 칸의 글자가 따라 바뀐다", () => {
  let project = registerDeviceForCell(createProject(), "1,1");
  const id = project.devices[0].id;

  project = upsertDeviceInProject(project, { ...project.devices[0], serial: "RR657-005599" });
  assert.equal(activePage(project).equipment["1,1"].label, "RR657-005599");

  // S/N 을 비우면 칸 글자도 비워진다. 연결은 남는다.
  project = upsertDeviceInProject(project, { id, serial: "" });
  assert.equal(activePage(project).equipment["1,1"].label, undefined);
  assert.equal(activePage(project).equipment["1,1"].deviceId, id);
});

test("연결: 칸 글자가 장치의 S/N 으로 맞춰지고, 풀 때는 글자도 함께 지워진다", () => {
  let project = upsertDeviceInProject(createProject(), { id: "dev-1", serial: "RR657-002219" });
  project = updateActivePage(project, (page) =>
    updateEquipmentInfoOnPage(page, "3,3", { label: "옛글자", memo: "자리 메모" }),
  );

  project = linkDeviceToCell(project, "3,3", "dev-1");
  assert.equal(activePage(project).equipment["3,3"].label, "RR657-002219");

  project = linkDeviceToCell(project, "3,3", null);
  // 낡은 S/N 이 도면에 글자로 남지 않는다. 메모 같은 자리 기록은 남는다.
  assert.equal(activePage(project).equipment["3,3"].deviceId, undefined);
  assert.equal(activePage(project).equipment["3,3"].label, undefined);
  assert.equal(activePage(project).equipment["3,3"].memo, "자리 메모");
});

test("배치 해제: 모든 칸의 연결·글자가 지워지고 장치는 대장에 남는다", () => {
  let project = upsertDeviceInProject(createProject(), { id: "dev-1", serial: "RR657-005570" });
  project = linkDeviceToCell(project, "1,1", "dev-1");
  project = linkDeviceToCell(project, "2,2", "dev-1");

  project = unplaceDeviceInProject(project, "dev-1");
  // 연결과 글자만 있던 칸은 빈 칸으로 돌아간다.
  assert.equal(activePage(project).equipment["1,1"], undefined);
  assert.equal(activePage(project).equipment["2,2"], undefined);
  assert.equal(project.devices.length, 1);
});

test("저장 왕복: 대장과 칸의 연결이 그대로 살아 돌아온다", () => {
  let project = createProject();
  project = upsertDeviceInProject(project, { id: "dev-1", type: "PLC", station: "1211", ip: "192.168.0.10", mac: "00-0b-29-7c-f0-b7" });
  project = updateActivePage(project, (page) => updateEquipmentInfoOnPage(page, "7,8", { deviceId: "dev-1" }));

  const restored = parseProjectJson(projectToJson(project));
  assert.deepEqual(restored.devices, project.devices);
  assert.equal(activePage(restored).equipment["7,8"].deviceId, "dev-1");
});

test("sanitizeProject: 문자열이 아닌 deviceId 는 버린다", () => {
  const project = sanitizeProject({
    pages: [
      {
        id: "page-1",
        name: "p",
        cols: 10,
        rows: 10,
        background: {},
        equipment: { "0,0": { label: "a", deviceId: 42 }, "1,1": { label: "b", deviceId: "dev-1" } },
        wiring: {},
      },
    ],
  });
  assert.equal(project.pages[0].equipment["0,0"].deviceId, undefined);
  assert.equal(project.pages[0].equipment["1,1"].deviceId, "dev-1");
});

test("내보내기: 작업장 → 구분 순으로 늘어놓는다", () => {
  const sorted = sortDevices([
    { id: "a", station: "1120", role: "출고" },
    { id: "b", station: "1101", role: "입하" },
    { id: "c", station: "1120", role: "입고" },
  ]);
  assert.deepEqual(sorted.map((d) => d.id), ["b", "c", "a"]);
});

test("CSV: BOM 으로 시작하고, 쉼표·따옴표가 든 값은 감싼다", () => {
  const csv = devicesToCsv(
    [{ id: "dev-1", station: "1101", role: '입하, "특수"', serial: "RR657-002219", comPort: true, port: "COM3" }],
    new Map([["dev-1", "1번방 (4, 14)"]]),
  );
  assert.ok(csv.startsWith("\uFEFF"));
  const lines = csv.slice(1).trimEnd().split("\r\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("작업장 번호,구분,장치 종류"));
  // 위치 글에도 쉼표가 있으므로 감싸진다.
  assert.equal(lines[1], '1101,"입하, ""특수""",,,RR657-002219,,,Y,COM3,,"1번방 (4, 14)"');
});

test("마크다운: 표 한 벌, 파이프는 이스케이프, 미배치는 그렇게 적는다", () => {
  const md = devicesToMarkdown(
    [{ id: "dev-1", station: "1211", role: "조합 저울 1|A", type: "PLC", ip: "192.168.0.10" }],
    new Map(),
  );
  const lines = md.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith("| 작업장 번호 | 구분 |"));
  assert.ok(lines[1].includes("---"));
  assert.ok(lines[2].includes("조합 저울 1\\|A"));
  assert.ok(lines[2].includes("| 미배치 |"));
});
