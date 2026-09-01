"use client";

import { useState } from "react";
import type { Device } from "./device";

const FIELD = "h-8 w-full border border-slate-300 bg-white px-2 text-[13px] text-slate-900 outline-none focus:border-slate-600";

/** 장치 한 대의 명세 편집. 값이 바뀌면 key 로 새로 마운트된다(되돌리기 반영). */
export function DeviceForm({
  device,
  onUpsert,
}: {
  device: Device;
  onUpsert: (device: Device) => void;
}) {
  const [draft, setDraft] = useState<Device>(device);

  const field = (name: keyof Device, label: string) => (
    <label className="text-[11px] text-slate-600">
      {label}
      <input
        className={FIELD}
        value={(draft[name] as string | undefined) ?? ""}
        onChange={(event) => setDraft((current) => ({ ...current, [name]: event.target.value }))}
        onBlur={() => onUpsert(draft)}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-2 border border-slate-200 bg-white p-2">
      <div className="grid grid-cols-2 gap-2">
        {field("type", "장치 종류")}
        {field("role", "구분")}
        {field("program", "프로그램")}
        {field("station", "작업장 번호")}
      </div>
      {field("serial", "H/W S/N")}
      <div className="grid grid-cols-2 gap-2">
        {field("ip", "IP")}
        {field("port", "PORT")}
      </div>
      {field("mac", "MAC")}
      <label className="flex items-center gap-1.5 text-[12px] text-slate-700">
        <input
          type="checkbox"
          checked={draft.comPort === true}
          onChange={(event) => {
            // 체크는 입력을 마칠 블러가 없다 — 누르는 순간 그대로 커밋한다.
            const next: Device = { ...draft };
            if (event.target.checked) next.comPort = true;
            else delete next.comPort;
            setDraft(next);
            onUpsert(next);
          }}
        />
        COM 포트 연결
      </label>
      {field("memo", "비고")}
    </div>
  );
}

/** 값이 하나라도 바뀌면 폼을 새로 마운트하는 열쇠. 되돌리기가 폼에도 보인다. */
export function deviceFormKey(device: Device): string {
  return [
    device.id,
    device.type,
    device.program,
    device.station,
    device.role,
    device.serial,
    device.ip,
    device.mac,
    device.comPort ? "com" : "",
    device.port,
    device.memo,
  ].map((value) => value ?? "").join("|");
}
