"use client";

interface CellNoteBubbleProps {
  text: string;
  /** 칸에 붙은 사진들(data URL). 있으면 글 위에 보여 준다. */
  photos?: string[];
  /** 칸의 격자 좌표. */
  x: number;
  y: number;
  cell: number;
  /**
   * **캔버스** 전체 칸 수 — 오른쪽·아래 끝에서 말풍선이 잘리지 않게 방향을 바꾼다.
   *
   * 도면 칸 수가 아니라 캔버스 칸 수다. 인쇄 경계선을 켜면 캔버스가 용지 범위까지
   * 넓어지는데, `right`/`bottom` 은 캔버스 끝에서 재기 때문이다. 도면 폭을 넘기면
   * 그 차이만큼 말풍선이 엉뚱한 곳으로 밀린다.
   */
  cols: number;
  rows: number;
}

const MAX_WIDTH = 220;
/** 말풍선에 그리는 썸네일 수. 이보다 많으면 남은 장수만 숫자로 알린다. */
const MAX_THUMBS = 6;

/** 메모나 사진이 있는 칸에 마우스를 올리면 뜨는 읽기 전용 말풍선. */
export function CellNoteBubble(props: CellNoteBubbleProps) {
  const { x, y, cell, cols, rows } = props;
  const photos = props.photos ?? [];
  // 첫 장은 크게 — 대개 그 칸을 알아보려고 올린 것이다.
  // 나머지는 아래 줄에 작게 늘어놓고, 말풍선이 길어지지 않게 여섯 장에서 끊는다.
  const [first, ...rest] = photos;
  const thumbs = rest.slice(0, MAX_THUMBS);
  const hidden = rest.length - thumbs.length;

  // 오른쪽 끝에서는 왼쪽으로, 아래 끝에서는 위로 펼친다.
  const flipX = (x + 1) * cell + MAX_WIDTH > cols * cell;
  const flipY = y > rows - 4;

  const style: React.CSSProperties = {
    maxWidth: MAX_WIDTH,
    top: flipY ? undefined : (y + 1) * cell + 6,
    bottom: flipY ? (rows - y) * cell + 6 : undefined,
    left: flipX ? undefined : x * cell,
    right: flipX ? (cols - x - 1) * cell : undefined,
  };

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] leading-snug whitespace-pre-wrap break-words text-white shadow-md"
      style={style}
    >
      {first ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL 썸네일이라 최적화 대상이 아니다 */}
          <img
            src={first}
            alt="칸 사진 1"
            className="block max-h-40 w-full border border-slate-600 object-contain"
          />
          {thumbs.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {thumbs.map((photo, index) => (
                // eslint-disable-next-line @next/next/no-img-element -- data URL 썸네일이라 최적화 대상이 아니다
                <img
                  key={photo.slice(-24)}
                  src={photo}
                  alt={`칸 사진 ${index + 2}`}
                  className="h-9 w-9 border border-slate-600 object-cover"
                />
              ))}
              {hidden > 0 ? (
                <span className="flex h-9 w-9 items-center justify-center border border-slate-600 text-[11px] text-slate-300">
                  +{hidden}
                </span>
              ) : null}
            </div>
          ) : null}
          <p className="mt-0.5 mb-1 text-[10px] text-slate-300">사진 {photos.length}장</p>
        </>
      ) : null}
      {props.text}
    </div>
  );
}
