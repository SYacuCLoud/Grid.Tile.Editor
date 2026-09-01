/**
 * 장치 대장을 파일 글로 바꾼다.
 *
 * CSV 는 엑셀에서 바로 열리는 자산 대장용이고, 마크다운은 문서·메신저에
 * 붙여 넣는 표용이다. 두 쪽 다 목록 상자가 보여 주는 순서(작업장 → 구분)
 * 그대로 적어, 화면과 파일이 같은 말을 하게 한다.
 */

import type { Device } from "./device";

/** 장치가 놓인 자리를 사람이 읽는 한 줄로. 없으면 "미배치". */
export interface DevicePlacementText {
  deviceId: string;
  text: string;
}

const HEADERS = ["작업장 번호", "구분", "장치 종류", "프로그램", "H/W S/N", "IP", "MAC", "COM 포트", "PORT", "비고", "위치"] as const;

function rowOf(device: Device, placementText: string): string[] {
  return [
    device.station ?? "",
    device.role ?? "",
    device.type ?? "",
    device.program ?? "",
    device.serial ?? "",
    device.ip ?? "",
    device.mac ?? "",
    device.comPort ? "Y" : "",
    device.port ?? "",
    device.memo ?? "",
    placementText || "미배치",
  ];
}

/** 목록 상자와 같은 순서. 화면에서 본 것과 파일이 다르면 어느 쪽도 못 믿는다. */
export function sortDevices(devices: Device[]): Device[] {
  return [...devices].sort(
    (a, b) => (a.station ?? "").localeCompare(b.station ?? "") || (a.role ?? "").localeCompare(b.role ?? ""),
  );
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 엑셀이 한글을 바로 읽도록 BOM 을 앞에 붙인다. */
export function devicesToCsv(devices: Device[], placements: Map<string, string>): string {
  const lines = [HEADERS.map(csvCell).join(",")];
  for (const device of sortDevices(devices)) {
    lines.push(rowOf(device, placements.get(device.id) ?? "").map(csvCell).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function devicesToMarkdown(devices: Device[], placements: Map<string, string>): string {
  const lines = [
    `| ${HEADERS.join(" | ")} |`,
    `| ${HEADERS.map(() => "---").join(" | ")} |`,
  ];
  for (const device of sortDevices(devices)) {
    lines.push(`| ${rowOf(device, placements.get(device.id) ?? "").map(mdCell).join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}
