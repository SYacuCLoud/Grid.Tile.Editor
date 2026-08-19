"use client";

import { PRESET_COLORS } from "./palette";
import {
  borderStyleCss,
  FILL_PATTERNS,
  type FillPattern,
  LINE_STYLES,
  type LineStyle,
  patternCss,
} from "./pattern";

const LABEL = "text-[10px] font-semibold tracking-wide text-slate-500";
const CHIP = "h-6 border px-1.5 text-[11px]";
const CHIP_ON = "border-slate-800 bg-slate-800 text-white";
const CHIP_OFF = "border-slate-300 bg-white text-slate-700 hover:border-slate-500";

interface ColorPresetsProps {
  value: string;
  onPick: (color: string) => void;
}

/** 추천 색 견본. 빠른 선택지일 뿐이고, 커스텀 색은 옆의 색 고르기로 그대로 쓴다. */
export function ColorPresets({ value, onPick }: ColorPresetsProps) {
  return (
    <div className="mt-1">
      <p className={LABEL}>추천 색</p>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            aria-label={`색 ${color}`}
            aria-pressed={value.toLowerCase() === color}
            onClick={() => onPick(color)}
            className="h-5 w-5 border"
            style={{
              background: color,
              borderColor: value.toLowerCase() === color ? "#0f172a" : "#cbd5e1",
              borderWidth: value.toLowerCase() === color ? 2 : 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}

interface PatternPickerProps {
  color: string;
  value: FillPattern;
  onPick: (pattern: FillPattern) => void;
}

/** 채움 무늬. 견본이 실제 칸과 같은 무늬로 보이므로 이름을 몰라도 고를 수 있다. */
export function PatternPicker({ color, value, onPick }: PatternPickerProps) {
  return (
    <div className="mt-1.5">
      <p className={LABEL}>채움 무늬</p>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {FILL_PATTERNS.map((pattern) => (
          <button
            key={pattern.id}
            type="button"
            title={pattern.name}
            aria-label={pattern.name}
            aria-pressed={value === pattern.id}
            onClick={() => onPick(pattern.id)}
            className={`${CHIP} flex items-center gap-1 ${value === pattern.id ? CHIP_ON : CHIP_OFF}`}
          >
            <span
              className="inline-block h-3.5 w-3.5 border border-slate-400"
              style={patternCss(color, pattern.id)}
            />
            {pattern.name}
          </button>
        ))}
      </div>
    </div>
  );
}

interface LineStylePickerProps {
  color: string;
  value: LineStyle;
  onPick: (style: LineStyle) => void;
  /** 무엇에 쓰이는 선인지 — 장비는 칸 테두리, 배선은 경로. */
  hint: string;
}

export function LineStylePicker({ color, value, onPick, hint }: LineStylePickerProps) {
  return (
    <div className="mt-1.5">
      <p className={LABEL}>
        선 모양 <span className="font-normal text-slate-400">({hint})</span>
      </p>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {LINE_STYLES.map((style) => (
          <button
            key={style.id}
            type="button"
            title={style.name}
            aria-label={style.name}
            aria-pressed={value === style.id}
            onClick={() => onPick(style.id)}
            className={`${CHIP} flex items-center gap-1 ${value === style.id ? CHIP_ON : CHIP_OFF}`}
          >
            <span
              className="inline-block h-0 w-5"
              style={{ borderTop: `2px ${borderStyleCss(style.id)} ${color}` }}
            />
            {style.name}
          </button>
        ))}
      </div>
    </div>
  );
}
