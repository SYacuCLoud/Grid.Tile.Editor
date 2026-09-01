"use client";

import { arcControlPoint, CONNECTION_COLOR, type ConnectionSegment } from "./connection";

/**
 * 호버한 칸이 낀 연결을 캔버스 위에 SVG 로 얹어 애니메이션으로 보여 준다.
 *
 * 정지 그림(체크로 항상 표시·PNG·인쇄)은 캔버스(`render.ts`)의 몫이고, 여기는
 * 화면 전용이다 — 캔버스는 CSS 애니메이션을 못 하므로 흐르는 점선(마칭 앤츠)과
 * 신호 점은 이 오버레이가 맡는다. 포물선 기하와 양끝 색(`connectionEndColors`)은
 * 캔버스와 같은 식을 쓴다.
 */
interface ConnectionOverlayProps {
  segments: ConnectionSegment[];
  /** `segments` 와 같은 순서의 양끝 색. 양끝이 다르면 그라데이션으로 긋는다. */
  colors: Array<{ from: string; to: string }>;
  cell: number;
  cols: number;
  rows: number;
}

export function ConnectionOverlay({ segments, colors, cell, cols, rows }: ConnectionOverlayProps) {
  if (segments.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={cols * cell}
      height={rows * cell}
      aria-hidden="true"
    >
      <style>{`
        @keyframes conn-ants { to { stroke-dashoffset: -12; } }
        @keyframes conn-dot {
          0%   { offset-distance: 0%; opacity: 0; }
          8%   { opacity: 1; }
          92%  { opacity: 1; }
          100% { offset-distance: 100%; opacity: 0; }
        }
        .conn-wire { animation: conn-ants 0.9s linear infinite; }
        .conn-dot  { offset-rotate: 0deg; animation: conn-dot 2.2s linear infinite; }
      `}</style>
      {segments.map((segment, i) => {
        const a = { x: (segment.from.x + 0.5) * cell, y: (segment.from.y + 0.5) * cell };
        const b = { x: (segment.to.x + 0.5) * cell, y: (segment.to.y + 0.5) * cell };
        const control = arcControlPoint(a, b);
        const d = `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`;
        const { from: colorA, to: colorB } = colors[i] ?? { from: CONNECTION_COLOR, to: CONNECTION_COLOR };
        const gradientId = `conn-grad-${segment.connection.id}`;
        const dotStyle = { offsetPath: `path('${d}')` } as React.CSSProperties;
        return (
          <g key={segment.connection.id}>
            {colorA !== colorB ? (
              // 그라데이션 축은 출발점 → 도착점. 곡선이 휘어도 색은 이 직선을 따라 섞인다.
              <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
                <stop offset="0" stopColor={colorA} />
                <stop offset="1" stopColor={colorB} />
              </linearGradient>
            ) : null}
            <path
              className="conn-wire"
              d={d}
              fill="none"
              stroke={colorA !== colorB ? `url(#${gradientId})` : colorA}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="7 5"
            />
            {/* 신호 점은 도착 쪽 색 — 신호가 도착지의 것이 되어 간다. */}
            <circle className="conn-dot" r={3.5} fill={colorB} style={dotStyle} />
            <circle
              className="conn-dot"
              r={3.5}
              fill={colorB}
              style={{ ...dotStyle, animationDelay: "-1.1s" }}
            />
          </g>
        );
      })}
    </svg>
  );
}
