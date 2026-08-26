"use client";

import { useEffect, useRef, useState } from "react";

import {
  addZone,
  MAX_ZONE_NAME,
  MAX_ZONES,
  removeZone,
  updateZone,
  type Zone,
  ZONE_COLORS,
  zoneArea,
  zoneRangeText,
} from "./zone";

const PANEL_WIDTH = 220;

const BUTTON = "h-7 flex-1 border border-slate-300 bg-white text-[12px] text-slate-700 hover:bg-slate-100";
const OK_BUTTON = "h-7 flex-1 border border-slate-800 bg-slate-800 text-[12px] text-white hover:bg-slate-700";
const DANGER_BUTTON = "h-7 flex-1 border border-red-300 bg-white text-[12px] text-red-700 hover:bg-red-50";

/** 구역 색 고르기. 고른 색에 테두리를 둘러 표시한다. */
function ColorRow({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {ZONE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`구역 색 ${color}`}
          onClick={() => onPick(color)}
          className={`h-5 w-5 border ${value === color ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-300"}`}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

interface ZonePopoverProps {
  /** 상자를 띄울 자리(격자 좌표). 우클릭한 칸이다. */
  x: number;
  y: number;
  cell: number;
  cols: number;
  rows: number;
  /** 이 페이지의 구역 전부. 더하고 고치는 일이 모두 이 목록 위에서 일어난다. */
  zones: Zone[];
  /**
   * 하려는 일.
   * - `create`: 잡아 둔 범위에 이름을 붙인다.
   * - `edit`: 이미 있는 구역을 고친다.
   */
  mode: { kind: "create"; rect: { x: number; y: number; w: number; h: number } } | { kind: "edit"; zone: Zone };
  onChange: (zones: Zone[]) => void;
  /** 구역이 아니라 칸 메모를 열고 싶을 때. 구역이 도면을 덮어도 메모로 갈 길을 남긴다. */
  onNote: () => void;
  onClose: () => void;
}

/**
 * 우클릭하면 그 자리에 뜨는 구역 상자.
 *
 * `ZonePanel`(오른쪽 패널)과 같은 일을 하지만 손이 캔버스에 있을 때 쓴다. 범위를
 * 끌어 놓은 직후, 또는 구역 위를 눌렀을 때 — 둘 다 패널까지 가는 왕복이 아깝다.
 */
export function ZonePopover(props: ZonePopoverProps) {
  const { x, y, cell, cols, rows, zones, mode } = props;
  const creating = mode.kind === "create";

  const [name, setName] = useState(creating ? "" : mode.zone.name);
  const [color, setColor] = useState(
    creating ? ZONE_COLORS[zones.length % ZONE_COLORS.length] : (mode.zone.color ?? ZONE_COLORS[0]),
  );
  // 새 구역은 범례에 오르는 것이 기본이다 — 이름을 붙였다는 것은 남에게 보이려는 뜻이다.
  const [onLegend, setOnLegend] = useState(creating ? true : mode.zone.hideLegend !== true);
  const nameRef = useRef<HTMLInputElement | null>(null);

  // 열린 순간 이름 칸에 손이 가 있게 한다. 새로 만들 때는 곧 이름을 치고,
  // 고칠 때는 이름을 바꾸러 온 경우가 대부분이다.
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const onClose = props.onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const full = zones.length >= MAX_ZONES;

  const save = () => {
    if (creating) {
      if (full) return;
      const next = addZone(zones, mode.rect, name, color);
      // `addZone` 이 만든 구역은 목록 맨 뒤에 붙는다. 범례에서 빼기로 했으면 그 한 칸만 고친다.
      props.onChange(
        onLegend ? next : next.map((zone, i) => (i === next.length - 1 ? { ...zone, hideLegend: true as const } : zone)),
      );
      onClose();
      return;
    }
    // 이름을 비우면 `updateZone` 이 예전 이름을 지킨다 — 이름 없는 구역은 없다.
    props.onChange(updateZone(zones, mode.zone.id, { name, color, hideLegend: !onLegend }));
    onClose();
  };

  const remove = () => {
    if (creating) return;
    props.onChange(removeZone(zones, mode.zone.id));
    onClose();
  };

  const rect = creating ? mode.rect : mode.zone;
  const rangeText = creating
    ? `가로 ${rect.x + 1}~${rect.x + rect.w} · 세로 ${rect.y + 1}~${rect.y + rect.h}`
    : zoneRangeText(mode.zone);
  const area = rect.w * rect.h;

  const flipX = (x + 1) * cell + PANEL_WIDTH > cols * cell;
  // 상자 높이가 대략 여섯 칸이다. 아래가 모자라면 위로 뒤집는다.
  const flipY = y > rows - 6;

  const style: React.CSSProperties = {
    width: PANEL_WIDTH,
    top: flipY ? undefined : (y + 1) * cell + 6,
    bottom: flipY ? (rows - y) * cell + 6 : undefined,
    left: flipX ? undefined : x * cell,
    right: flipX ? (cols - x - 1) * cell : undefined,
  };

  return (
    <div
      className="absolute z-30 border border-slate-400 bg-white p-2 shadow-lg"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="mb-1 text-[11px] font-semibold text-slate-700">
        {creating ? "이 범위를 구역으로" : "구역 고치기"}
      </p>
      <p className="mb-1.5 text-[11px] text-slate-500">
        {rangeText} · {creating ? area : zoneArea(mode.zone)}칸
      </p>

      <label className="text-[10px] font-semibold tracking-wide text-slate-500">
        구역 이름
        <input
          ref={nameRef}
          value={name}
          maxLength={MAX_ZONE_NAME}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
          className="mt-0.5 h-7 w-full border border-slate-300 bg-white px-2 text-[13px] text-slate-900 outline-none focus:border-slate-600"
          aria-label="구역 이름"
        />
      </label>

      <div className="mt-1.5">
        <p className="mb-0.5 text-[10px] font-semibold tracking-wide text-slate-500">색</p>
        <ColorRow value={color} onPick={setColor} />
      </div>

      {/* 범례에 올릴지. 도면의 테두리·이름표는 이 값과 무관하게 그려진다 —
          작은 구역까지 범례에 오르면 범례가 도면보다 길어진다. */}
      <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-700">
        <input
          type="checkbox"
          checked={onLegend}
          onChange={(event) => setOnLegend(event.target.checked)}
          className="h-3 w-3"
        />
        범례에 올린다
      </label>

      {creating && full ? (
        <p className="mt-1.5 text-[11px] text-red-700">구역은 {MAX_ZONES}개까지 둘 수 있습니다.</p>
      ) : null}

      <div className="mt-2 flex gap-1">
        <button type="button" className={OK_BUTTON} onClick={save} disabled={creating && full}>
          {creating ? "만들기" : "저장"}
        </button>
        {creating ? null : (
          <button type="button" className={DANGER_BUTTON} onClick={remove} title="이 구역을 지운다">
            삭제
          </button>
        )}
        <button type="button" className={BUTTON} onClick={props.onClose}>
          닫기
        </button>
      </div>

      {/* 구역이 도면을 덮고 있어도 그 아래 칸의 메모로 갈 수 있어야 한다. */}
      <button
        type="button"
        className="mt-1 h-6 w-full border border-slate-200 bg-white text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        onClick={props.onNote}
      >
        이 칸의 메모 열기
      </button>

      <p className="mt-1 text-[10px] text-slate-400">Enter 저장 · Esc 닫기</p>
    </div>
  );
}
