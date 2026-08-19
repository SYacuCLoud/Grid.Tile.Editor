"use client";

import type { PaletteItem } from "./palette";
import { borderStyleCss, patternCss } from "./pattern";

const FALLBACK_COLOR = "#94a3b8";

interface PaletteSwatchProps {
  item: PaletteItem;
  /** 한 변 길이(px). 팔레트 목록은 20, 범례는 16을 쓴다. */
  size?: number;
}

/**
 * 팔레트 항목의 색 견본.
 *
 * 도면에서 쓰이는 방식을 그대로 보여 준다 — 장비는 칸 테두리, 배선은 가로지르는
 * 경로, 나머지(배경 · 상태)는 칸 채움으로 보인다. 채움 무늬와 선 모양도 같이
 * 보여 준다. 목록과 도면이 서로 다르게 보이면 같은 색이 무엇을 뜻하는지 읽을 수 없다.
 */
export function PaletteSwatch({ item, size = 20 }: PaletteSwatchProps) {
  const color = item.color ?? FALLBACK_COLOR;

  // 배선은 칸을 채우지 않고 지나간다. 견본도 가로지르는 선으로 보인다.
  if (item.role === "wire") {
    return (
      <span
        className="flex shrink-0 items-center justify-center"
        style={{ width: size, height: size, background: "#ffffff", border: "1px solid #94a3b8" }}
      >
        <span
          style={{
            width: size,
            borderTop: `${Math.max(2, Math.round(size * 0.34))}px ${borderStyleCss(item.lineStyle)} ${color}`,
          }}
        />
      </span>
    );
  }

  const style =
    item.role === "kind"
      ? {
          width: size,
          height: size,
          background: "#ffffff",
          border: `2px ${borderStyleCss(item.lineStyle)} ${color}`,
        }
      : { width: size, height: size, ...patternCss(color, item.pattern), border: "1px solid #94a3b8" };

  return <span className="shrink-0" style={style} />;
}
