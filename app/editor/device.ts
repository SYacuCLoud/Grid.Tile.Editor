/**
 * 장치 대장(Device Registry).
 *
 * 리더기 · 저울 · PLC 같은 실물 장치의 명세(S/N · IP · COM 포트)를 도면 칸과
 * 분리해 프로젝트 한 곳에 담는다. 칸은 `deviceId` 로 참조만 한다 — 그래야
 * 도면에 아직 안 놓은 장치(예비품, 인식 불가)도 대장에 남고, 칸을 옮겨도
 * 장치 정보가 따라간다.
 */

import {
  activePage,
  type ProjectDoc,
  updateActivePage,
  updateEquipmentInfoOnPage,
} from "./doc";

export interface Device {
  id: string;
  /** 장치 종류. 예: RFID 리더기 · 저울 · PLC */
  type?: string;
  /** 프로그램/화면 단위. 예: C1101 */
  program?: string;
  /** 작업장 번호. 예: 1101 */
  station?: string;
  /** 구분. 예: 입하 · 시메 출고 · 08 입고 */
  role?: string;
  /** H/W S/N. 예: RR657-002219 */
  serial?: string;
  ip?: string;
  mac?: string;
  /** COM 포트로 붙는 장치인가(저울 등). 포트 번호·이름은 `port` 에 적는다. */
  comPort?: true;
  /** 포트 번호·이름. 예: COM3 · 8899 */
  port?: string;
  memo?: string;
}

export const MAX_DEVICES = 500;
export const MAX_DEVICE_FIELD = 60;

/** 대장에 담기는 순서대로. UI 와 내보내기가 같은 순서를 쓴다. */
export const DEVICE_TEXT_FIELDS = [
  "type",
  "program",
  "station",
  "role",
  "serial",
  "ip",
  "mac",
  "port",
  "memo",
] as const;

export type DeviceTextField = (typeof DEVICE_TEXT_FIELDS)[number];

/** 값을 다듬는다. 공백을 떼고 길이를 자른다 — 빈 값은 필드를 두지 않는다. */
export function normalizeDeviceField(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_DEVICE_FIELD);
}

/**
 * 저장 파일에서 온 장치 목록을 다듬는다.
 *
 * id 없는 항목과 상한을 넘는 항목은 버린다. 문서를 여는 길은 모두
 * `sanitizeProject` 를 지나므로, 위쪽 코드는 여기서 나온 모양만 믿으면 된다.
 */
export function sanitizeDevices(raw: unknown): Device[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Device[] = [];
  const used = new Set<string>();

  for (const entry of raw) {
    if (out.length >= MAX_DEVICES) break;
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<Device>;
    if (typeof candidate.id !== "string" || !candidate.id || used.has(candidate.id)) continue;

    const device: Device = { id: candidate.id };
    for (const field of DEVICE_TEXT_FIELDS) {
      const value = normalizeDeviceField(candidate[field]);
      if (value) device[field] = value;
    }
    // COM 포트는 체크(불리언)다. 문자열로 적어 두던 이전 판 값은
    // 체크로 바꾸고 그 글자를 포트 자리로 옮긴다.
    if (candidate.comPort === true) device.comPort = true;
    else if (typeof candidate.comPort === "string") {
      const legacy = normalizeDeviceField(candidate.comPort);
      if (legacy) {
        device.comPort = true;
        if (!device.port) device.port = legacy;
      }
    }
    used.add(device.id);
    out.push(device);
  }

  return out.length > 0 ? out : undefined;
}

/** 쓰이지 않은 장치 ID. 시각·난수를 쓰지 않아 같은 조작이 항상 같은 결과를 낸다. */
export function nextDeviceId(devices: Device[]): string {
  const used = new Set(devices.map((device) => device.id));
  for (let n = devices.length + 1; ; n += 1) {
    const candidate = `dev-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function deviceById(devices: Device[] | undefined, id: string | undefined): Device | undefined {
  if (!devices || !id) return undefined;
  return devices.find((device) => device.id === id);
}

/** 목록·연결 상자에서 장치를 부르는 한 줄. 채워진 것부터 골라 잇는다. */
export function deviceLabel(device: Device): string {
  const parts = [device.station, device.role, device.type, device.serial].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : device.id;
}

/**
 * 연결된 칸의 표시 글자(label)를 장치의 S/N 에 맞춘다.
 *
 * 칸 글자와 대장 S/N 이 두 곳에서 따로 고쳐지면 도면과 대장이 다른 말을 한다.
 * 그래서 연결된 칸의 label 은 손으로 고치는 자리를 두지 않고, 장치를 고칠 때
 * 여기서 한 번에 따라 바뀐다.
 */
function syncLinkedCellLabels(project: ProjectDoc, device: Device): ProjectDoc {
  const label = device.serial ?? "";
  const pages = project.pages.map((page) => {
    const keys = Object.entries(page.equipment)
      .filter(([, cell]) => cell.deviceId === device.id && (cell.label ?? "") !== label)
      .map(([key]) => key);
    if (keys.length === 0) return page;

    let next = page;
    for (const key of keys) next = updateEquipmentInfoOnPage(next, key, { label });
    return next;
  });
  return { ...project, pages };
}

/** 장치를 추가하거나 같은 id 를 갈아 끼운다. 필드는 다듬어서 담는다. */
export function upsertDeviceInProject(project: ProjectDoc, device: Device): ProjectDoc {
  const cleaned: Device = { id: device.id };
  for (const field of DEVICE_TEXT_FIELDS) {
    const value = normalizeDeviceField(device[field]);
    if (value) cleaned[field] = value;
  }
  if (device.comPort === true) cleaned.comPort = true;

  const devices = project.devices ?? [];
  const exists = devices.some((entry) => entry.id === cleaned.id);
  if (!exists && devices.length >= MAX_DEVICES) return project;

  const next = {
    ...project,
    devices: exists
      ? devices.map((entry) => (entry.id === cleaned.id ? cleaned : entry))
      : [...devices, cleaned],
  };
  return syncLinkedCellLabels(next, cleaned);
}

/**
 * 활성 페이지의 칸이 가리키는 장치를 바꾼다. null 이면 연결을 푼다.
 *
 * 연결하는 순간 칸 글자도 장치의 S/N 으로 맞추고, 풀 때는 글자도 함께 지운다 —
 * 대장에서 나간 장치의 S/N 이 도면에 글자로 남으면 대장과 도면이 다른 말을 한다.
 * 칠해 둔 상태·장비 모양은 그대로 남는다.
 */
export function linkDeviceToCell(project: ProjectDoc, key: string, deviceId: string | null): ProjectDoc {
  const device = deviceId ? deviceById(project.devices, deviceId) : undefined;
  return updateActivePage(project, (page) =>
    updateEquipmentInfoOnPage(page, key, {
      deviceId: deviceId ?? "",
      label: device ? device.serial ?? "" : "",
    }),
  );
}

/**
 * 장치를 도면에서 뺀다 — 모든 페이지에서 이 장치를 가리키는 칸의 연결과
 * S/N 글자를 지운다. 장치는 대장에 미배치로 남는다(`removeDeviceFromProject`
 * 와 달리 대장 항목은 그대로다).
 */
export function unplaceDeviceInProject(project: ProjectDoc, id: string): ProjectDoc {
  const pages = project.pages.map((page) => {
    const keys = Object.entries(page.equipment)
      .filter(([, cell]) => cell.deviceId === id)
      .map(([key]) => key);
    if (keys.length === 0) return page;

    let next = page;
    for (const key of keys) next = updateEquipmentInfoOnPage(next, key, { deviceId: "", label: "" });
    return next;
  });
  return { ...project, pages };
}

/**
 * 장치를 대장에서 지운다. 모든 페이지에서 그 장치를 가리키던 칸의 연결도
 * 함께 푼다 — 끊어진 참조를 남기면 칸이 없는 장치를 계속 부른다.
 */
export function removeDeviceFromProject(project: ProjectDoc, id: string): ProjectDoc {
  const devices = (project.devices ?? []).filter((device) => device.id !== id);

  const pages = project.pages.map((page) => {
    const keys = Object.entries(page.equipment)
      .filter(([, cell]) => cell.deviceId === id)
      .map(([key]) => key);
    if (keys.length === 0) return page;

    let next = page;
    for (const key of keys) next = updateEquipmentInfoOnPage(next, key, { deviceId: "" });
    return next;
  });

  const next = { ...project, pages };
  if (devices.length > 0) next.devices = devices;
  else delete next.devices;
  return next;
}

/**
 * 활성 페이지의 칸 하나를 새 장치로 등록하고 바로 연결한다.
 *
 * 칸에 적힌 장비 ID(label)는 대개 S/N 이므로 그 자리로 옮겨 심는다 —
 * 지금까지 label 에 S/N 을 적어 온 도면이 클릭 한 번으로 대장에 오른다.
 */
export function registerDeviceForCell(project: ProjectDoc, key: string): ProjectDoc {
  const devices = project.devices ?? [];
  if (devices.length >= MAX_DEVICES) return project;

  const cell = activePage(project).equipment[key];
  const device: Device = { id: nextDeviceId(devices) };
  const serial = normalizeDeviceField(cell?.label);
  if (serial) device.serial = serial;

  const withDevice = upsertDeviceInProject(project, device);
  return updateActivePage(withDevice, (page) =>
    updateEquipmentInfoOnPage(page, key, { deviceId: device.id }),
  );
}
