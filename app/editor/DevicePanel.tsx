"use client";

import { useMemo, useState } from "react";
import { connectionEndKey, connectionsOfDevice } from "./connection";
import { connectionTextFor } from "./connectionText";
import { type Device, nextDeviceId } from "./device";
import { devicesToCsv, devicesToMarkdown } from "./deviceExport";
import { DeviceForm, deviceFormKey } from "./DeviceForm";
import { parseCellKey, type ProjectDoc } from "./doc";
import { downloadText, fileStamp, safeFileName } from "./storage";

const BUTTON =
  "h-6 shrink-0 border border-slate-300 bg-white px-2 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40";
const FIELD =
  "h-8 w-full border border-slate-300 bg-white px-2 text-[13px] text-slate-900 outline-none focus:border-slate-600";

/** 장치가 놓인 자리 하나. 한 장치가 여러 칸에 놓였으면 여럿이 나온다. */
interface Placement {
  pageId: string;
  pageName: string;
  key: string;
  x: number;
  y: number;
}

/** 장치 id → 놓인 자리들. 모든 페이지를 한 번만 훑는다. */
function collectPlacements(project: ProjectDoc): Map<string, Placement[]> {
  const map = new Map<string, Placement[]>();
  for (const page of project.pages) {
    for (const [key, cell] of Object.entries(page.equipment)) {
      if (!cell.deviceId) continue;
      const { x, y } = parseCellKey(key);
      const list = map.get(cell.deviceId) ?? [];
      list.push({ pageId: page.id, pageName: page.name, key, x, y });
      map.set(cell.deviceId, list);
    }
  }
  return map;
}

function placementText(placement: Placement): string {
  return `${placement.pageName} (${placement.x + 1}, ${placement.y + 1})`;
}

/** 검색어가 장치의 아무 필드에나 걸리는가. 빈 검색어는 모두 통과. */
function matches(device: Device, query: string): boolean {
  if (!query) return true;
  const haystack = [
    device.type,
    device.program,
    device.station,
    device.role,
    device.serial,
    device.ip,
    device.mac,
    device.port,
    device.memo,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

interface DevicePanelProps {
  open: boolean;
  /** 열릴 때 이 장치의 명세를 바로 펼친다(칸 우클릭 → 수정으로 들어온 경우). */
  focusId?: string;
  project: ProjectDoc;
  onClose: () => void;
  /** 장치가 놓인 칸으로 간다 — 페이지를 바꾸고 그 칸을 선택한다. */
  onJump: (pageId: string, key: string) => void;
  /** 미배치 장치를 든다 — 상자가 닫히고, 다음에 누르는 칸에 배치된다. */
  onPlace: (deviceId: string) => void;
  /** 배치를 뺀다 — 이 장치가 놓인 모든 칸의 연결과 S/N 글자를 지운다. */
  onUnplace: (deviceId: string) => void;
  onUpsert: (device: Device) => void;
  onDelete: (id: string) => void;
  /** 이 장치가 낀 연결 하나를 지운다. */
  onRemoveConnection: (id: string) => void;
}

/** 장치 대장 전체 목록. 행을 누르면 그 자리에서 명세를 고친다. */
export function DevicePanel({ open, focusId, project, onClose, onJump, onPlace, onUnplace, onUpsert, onDelete, onRemoveConnection }: DevicePanelProps) {
  // 우클릭 → 수정으로 들어오면 그 장치가 펼쳐진 채 시작한다. focusId 가 바뀌면
  // 밖에서 key 로 새로 마운트한다 — 상자 안에서 상태를 갈아 끼우지 않는다.
  const [detailId, setDetailId] = useState<string | null>(focusId ?? null);
  const [query, setQuery] = useState("");

  const devices = useMemo(() => {
    const list = [...(project.devices ?? [])];
    // 작업장 → 구분 순으로 늘어놓는다. 현장에서 부르는 순서가 이 순서다.
    list.sort((a, b) => (a.station ?? "").localeCompare(b.station ?? "") || (a.role ?? "").localeCompare(b.role ?? ""));
    return list;
  }, [project.devices]);

  const placements = useMemo(() => collectPlacements(project), [project]);

  if (!open) return null;

  const shown = devices.filter((device) => matches(device, query.trim()));
  const unplaced = devices.filter((device) => !placements.has(device.id)).length;

  const addDevice = () => {
    const id = nextDeviceId(project.devices ?? []);
    onUpsert({ id });
    setDetailId(id);
    setQuery("");
  };

  // 파일에도 화면과 같은 위치 글이 실린다. 여러 곳이면 첫 자리 + "외 N곳".
  const placementTextOf = new Map(
    [...placements.entries()].map(([deviceId, list]) => [
      deviceId,
      `${placementText(list[0])}${list.length > 1 ? ` 외 ${list.length - 1}곳` : ""}`,
    ]),
  );

  const exportFile = (format: "csv" | "md") => {
    const base = `${safeFileName(project.title)}-장치대장-${fileStamp()}`;
    if (format === "csv") downloadText(devicesToCsv(devices, placementTextOf), `${base}.csv`, "text/csv");
    else downloadText(devicesToMarkdown(devices, placementTextOf), `${base}.md`, "text/markdown");
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[80vh] w-[760px] max-w-full flex-col border border-slate-400 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
          <p className="text-[12px] font-semibold text-slate-800">
            장치 대장 — {devices.length}대{unplaced > 0 ? ` (미배치 ${unplaced}대)` : ""}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={BUTTON}
              onClick={() => exportFile("csv")}
              disabled={devices.length === 0}
              title="엑셀에서 열리는 CSV 파일로 저장합니다"
            >
              CSV 저장
            </button>
            <button
              type="button"
              className={BUTTON}
              onClick={() => exportFile("md")}
              disabled={devices.length === 0}
              title="문서에 붙여 넣는 마크다운 표로 저장합니다"
            >
              마크다운 저장
            </button>
            <button type="button" className={BUTTON} onClick={addDevice}>
              새 장치
            </button>
            <button type="button" className={BUTTON} onClick={onClose}>
              닫기
            </button>
          </div>
        </div>

        <div className="border-b border-slate-200 px-3 py-2">
          <input
            className={FIELD}
            placeholder="검색 — S/N · 작업장 · 구분 · IP …"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {devices.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-slate-500">
            아직 등록된 장치가 없습니다. 도면에서 칸을 선택해 «새 장치로 등록» 을 누르거나, 위의 «새 장치» 로 추가하세요.
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-1.5 font-medium">작업장</th>
                  <th className="border-b border-slate-200 px-2 py-1.5 font-medium">구분</th>
                  <th className="border-b border-slate-200 px-2 py-1.5 font-medium">장치 종류</th>
                  <th className="border-b border-slate-200 px-2 py-1.5 font-medium">H/W S/N</th>
                  <th className="border-b border-slate-200 px-2 py-1.5 font-medium">위치</th>
                  <th className="border-b border-slate-200 px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {shown.map((device) => {
                  const placed = placements.get(device.id) ?? [];
                  const detail = detailId === device.id;
                  // 이 장치가 낀 연결. 나가는 것은 "→ 상대", 들어오는 것은 "← 상대".
                  const myKeys = new Set([connectionEndKey({ device: device.id })]);
                  const connections = connectionsOfDevice(project.connections, device.id).map(
                    (connection) => ({
                      id: connection.id,
                      text: connectionTextFor(project, connection, myKeys),
                    }),
                  );
                  return (
                    <FragmentRow
                      key={device.id}
                      device={device}
                      placed={placed}
                      connections={connections}
                      detail={detail}
                      onToggle={() => setDetailId(detail ? null : device.id)}
                      onJump={onJump}
                      onPlace={onPlace}
                      onUnplace={onUnplace}
                      onUpsert={onUpsert}
                      onDelete={onDelete}
                      onRemoveConnection={onRemoveConnection}
                    />
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-slate-500">검색에 걸리는 장치가 없습니다.</p>
            ) : null}
          </div>
        )}

        <p className="border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-500">
          행을 누르면 명세를 고칠 수 있습니다. 삭제·수정은 Ctrl+Z 로 되돌릴 수 있습니다.
        </p>
      </div>
    </div>
  );
}

/** 목록 한 줄 + (펼쳤을 때) 명세 편집 줄. */
function FragmentRow({
  device,
  placed,
  connections,
  detail,
  onToggle,
  onJump,
  onPlace,
  onUnplace,
  onUpsert,
  onDelete,
  onRemoveConnection,
}: {
  device: Device;
  placed: Placement[];
  /** 이 장치가 낀 연결 — 방향과 상대편을 적은 한 줄씩. */
  connections: Array<{ id: string; text: string }>;
  detail: boolean;
  onToggle: () => void;
  onJump: DevicePanelProps["onJump"];
  onPlace: DevicePanelProps["onPlace"];
  onUnplace: DevicePanelProps["onUnplace"];
  onUpsert: DevicePanelProps["onUpsert"];
  onDelete: DevicePanelProps["onDelete"];
  onRemoveConnection: DevicePanelProps["onRemoveConnection"];
}) {
  const first = placed[0];
  return (
    <>
      <tr
        className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${detail ? "bg-slate-50" : ""}`}
        onClick={onToggle}
      >
        <td className="px-3 py-1.5 font-semibold text-slate-800">{device.station ?? "—"}</td>
        <td className="px-2 py-1.5 text-slate-700">{device.role ?? "—"}</td>
        <td className="px-2 py-1.5 text-slate-700">{device.type ?? "—"}</td>
        <td className="px-2 py-1.5 text-slate-700">{device.serial ?? "—"}</td>
        <td className="px-2 py-1.5 text-slate-600">
          {first ? `${placementText(first)}${placed.length > 1 ? ` 외 ${placed.length - 1}곳` : ""}` : (
            <span className="text-amber-700">미배치</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-right">
          {first ? (
            <span className="inline-flex gap-1">
              <button
                type="button"
                className={BUTTON}
                onClick={(event) => {
                  event.stopPropagation();
                  onJump(first.pageId, first.key);
                }}
              >
                위치로
              </button>
              <button
                type="button"
                className={BUTTON}
                onClick={(event) => {
                  event.stopPropagation();
                  onUnplace(device.id);
                }}
                title={`도면에서 뺍니다 — 놓인 칸 ${placed.length}곳의 연결과 S/N 글자가 지워지고, 장치는 미배치로 남습니다. Ctrl+Z 로 되돌릴 수 있습니다.`}
              >
                해제
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={BUTTON}
              onClick={(event) => {
                event.stopPropagation();
                onPlace(device.id);
              }}
              title="상자가 닫히고, 도면에서 누르는 칸에 이 장치가 배치됩니다. Esc 로 취소."
            >
              배치
            </button>
          )}
        </td>
      </tr>
      {detail ? (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={6} className="px-3 py-2">
            <div className="flex flex-col gap-2">
              <DeviceForm key={deviceFormKey(device)} device={device} onUpsert={onUpsert} />
              {connections.length > 0 ? (
                <div>
                  <p className="mb-0.5 text-[10px] font-semibold tracking-wide text-slate-500">
                    연결 ({connections.length})
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {connections.map((connection) => (
                      <li
                        key={connection.id}
                        className="flex items-center gap-1 border border-slate-200 bg-white px-1.5 py-0.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700" title={connection.text}>
                          {connection.text}
                        </span>
                        <button
                          type="button"
                          className="h-4 w-4 shrink-0 border border-slate-400 bg-white text-[10px] leading-none text-slate-700 hover:bg-red-50 hover:text-red-700"
                          onClick={() => onRemoveConnection(connection.id)}
                          title="이 연결을 지운다 (Ctrl+Z 로 되돌릴 수 있습니다)"
                          aria-label={`연결 지우기: ${connection.text}`}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {placed.length > 1 ? (
                <div className="flex flex-wrap gap-1">
                  {placed.map((placement) => (
                    <button
                      key={`${placement.pageId}:${placement.key}`}
                      type="button"
                      className={BUTTON}
                      onClick={() => onJump(placement.pageId, placement.key)}
                    >
                      {placementText(placement)}
                    </button>
                  ))}
                </div>
              ) : null}
              <div>
                <button
                  type="button"
                  className="h-6 border border-red-300 bg-white px-2 text-[11px] text-red-700 hover:bg-red-50"
                  onClick={() => {
                    if (window.confirm("이 장치를 대장에서 지웁니다. 놓인 칸의 연결도 함께 풀립니다.")) {
                      onDelete(device.id);
                    }
                  }}
                >
                  대장에서 삭제
                </button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
