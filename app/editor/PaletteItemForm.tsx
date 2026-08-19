"use client";

import { useState } from "react";
import { DESCRIPTION_MAX, NAME_MAX, type PaletteRole } from "./palette";
import type { PaletteInput } from "./paletteOps";
import { ColorPresets, LineStylePicker, PatternPicker } from "./PaletteStyleOptions";
import { DEFAULT_LINE_STYLE, DEFAULT_PATTERN, type FillPattern, type LineStyle } from "./pattern";

const FIELD =
  "h-7 w-full border border-slate-300 bg-white px-2 text-[12px] text-slate-900 outline-none focus:border-slate-600";
const OK_BUTTON = "h-7 flex-1 border border-slate-800 bg-slate-800 text-[12px] text-white hover:bg-slate-700";
const CANCEL_BUTTON = "h-7 flex-1 border border-slate-300 bg-white text-[12px] text-slate-700 hover:bg-slate-100";
const LABEL = "text-[10px] font-semibold tracking-wide text-slate-500";

interface PaletteItemFormProps {
  /** "상태 추가" 처럼 무엇을 하는 칸인지 알려 준다. */
  title: string;
  /** 분류에 따라 고를 수 있는 스타일이 다르다 — 장비는 테두리, 나머지는 채움. */
  role: PaletteRole;
  initialName: string;
  initialColor: string;
  initialDescription: string;
  initialPattern?: FillPattern;
  initialLineStyle?: LineStyle;
  submitLabel: string;
  /** 문제가 있으면 사용자에게 보일 한 줄을 돌려준다. 성공하면 null. */
  onSubmit: (input: PaletteInput) => string | null;
  onCancel: () => void;
}

/** 팔레트 항목의 디스플레이 이름 · 색 · 설명을 입력하는 칸. 추가와 편집이 같은 모양을 쓴다. */
export function PaletteItemForm(props: PaletteItemFormProps) {
  const [name, setName] = useState(props.initialName);
  const [color, setColor] = useState(props.initialColor);
  const [description, setDescription] = useState(props.initialDescription);
  const [pattern, setPattern] = useState<FillPattern>(props.initialPattern ?? DEFAULT_PATTERN);
  const [lineStyle, setLineStyle] = useState<LineStyle>(props.initialLineStyle ?? DEFAULT_LINE_STYLE);
  const [error, setError] = useState<string | null>(null);

  // 장비는 칸을 채우지 않고 테두리로 보인다. 채움 무늬를 골라도 쓸 곳이 없다.
  const showPattern = props.role !== "kind";
  const showLineStyle = props.role === "kind" || props.role === "wire";

  const submit = () => {
    const message = props.onSubmit({
      name,
      color,
      description,
      ...(showPattern ? { pattern } : {}),
      ...(showLineStyle ? { lineStyle } : {}),
    });
    if (message) setError(message);
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") submit();
    if (event.key === "Escape") props.onCancel();
  };

  return (
    <div className="border border-slate-400 bg-white p-2">
      <p className="mb-1 text-[11px] font-semibold text-slate-700">{props.title}</p>

      <label className={LABEL}>
        디스플레이 이름
        <div className="mt-0.5 flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(event) => {
              setColor(event.target.value);
              setError(null);
            }}
            className="h-7 w-9 shrink-0 cursor-pointer border border-slate-300 bg-white p-0.5"
            aria-label="색"
            title="색 고르기"
          />
          <input
            value={name}
            maxLength={NAME_MAX}
            placeholder="예: 교체 예정"
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            onKeyDown={onKey}
            className={FIELD}
            aria-label="디스플레이 이름"
          />
        </div>
      </label>

      <label className={`${LABEL} mt-1.5 block`}>
        설명 <span className="font-normal text-slate-400">(PNG 범례에 함께 나온다)</span>
        <input
          value={description}
          maxLength={DESCRIPTION_MAX}
          placeholder="예: 3월 교체 예정 설비"
          onChange={(event) => {
            setDescription(event.target.value);
            setError(null);
          }}
          onKeyDown={onKey}
          className={`${FIELD} mt-0.5`}
          aria-label="설명"
        />
      </label>

      <ColorPresets
        value={color}
        onPick={(next) => {
          setColor(next);
          setError(null);
        }}
      />

      {showPattern ? <PatternPicker color={color} value={pattern} onPick={setPattern} /> : null}
      {showLineStyle ? (
        <LineStylePicker
          color={color}
          value={lineStyle}
          onPick={setLineStyle}
          hint={props.role === "kind" ? "칸 테두리" : "배선 경로"}
        />
      ) : null}

      {error ? <p className="mt-1 text-[11px] text-red-700">{error}</p> : null}

      <div className="mt-2 flex gap-1">
        <button type="button" className={OK_BUTTON} onClick={submit}>
          {props.submitLabel}
        </button>
        <button type="button" className={CANCEL_BUTTON} onClick={props.onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
