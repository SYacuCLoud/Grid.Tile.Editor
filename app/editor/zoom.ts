/** 휠을 굴린 순간의 위치 정보. 확대 후 같은 지점이 커서 밑에 오도록 스크롤을 맞추는 데 쓴다. */
export interface WheelAnchor {
  /** 도면 좌표(칸 단위, 소수 포함). */
  docX: number;
  docY: number;
  /** 화면 좌표. */
  clientX: number;
  clientY: number;
  /** 굴리기 직전 캔버스의 화면 위치. */
  canvasLeft: number;
  canvasTop: number;
}

/** 굴리기 직전의 스크롤량까지 포함한 기준점. */
export interface ScrollAnchor extends WheelAnchor {
  scrollLeft: number;
  scrollTop: number;
}

/**
 * 확대 배율이 바뀐 뒤 스크롤을 얼마로 두어야 하는지 구한다.
 *
 * 굴리기 직전 커서 아래 있던 도면 지점이 확대 후에도 그대로 커서 밑에 오게 한다.
 * 이 보정이 없으면 확대할 때마다 보던 자리가 왼쪽 위로 달아나 쓸 수가 없다.
 */
export function anchoredScroll(anchor: ScrollAnchor, nextCell: number): { scrollLeft: number; scrollTop: number } {
  // 캔버스 왼쪽 끝의 콘텐츠 좌표 = 화면 위치 + 그때의 스크롤량
  const contentLeft = anchor.canvasLeft + anchor.scrollLeft;
  const contentTop = anchor.canvasTop + anchor.scrollTop;

  return {
    scrollLeft: Math.max(0, contentLeft + anchor.docX * nextCell - anchor.clientX),
    scrollTop: Math.max(0, contentTop + anchor.docY * nextCell - anchor.clientY),
  };
}

/**
 * 보정 후 그 도면 지점이 화면 어디에 오는지. 검증용.
 * 스크롤이 0 에서 잘리지 않았다면 굴린 위치(clientX/Y)와 같아야 한다.
 */
export function anchoredScreenPos(
  anchor: ScrollAnchor,
  nextCell: number,
  scroll: { scrollLeft: number; scrollTop: number },
): { x: number; y: number } {
  const contentLeft = anchor.canvasLeft + anchor.scrollLeft;
  const contentTop = anchor.canvasTop + anchor.scrollTop;

  return {
    x: contentLeft - scroll.scrollLeft + anchor.docX * nextCell,
    y: contentTop - scroll.scrollTop + anchor.docY * nextCell,
  };
}

/** 가운데 버튼으로 화면을 끌 때의 스크롤 위치. 끈 방향과 반대로 내용이 움직인다. */
export function panScroll(
  start: { scrollLeft: number; scrollTop: number; clientX: number; clientY: number },
  clientX: number,
  clientY: number,
): { scrollLeft: number; scrollTop: number } {
  return {
    scrollLeft: Math.max(0, start.scrollLeft - (clientX - start.clientX)),
    scrollTop: Math.max(0, start.scrollTop - (clientY - start.clientY)),
  };
}

/** W/A/S/D 한 번에 옮길 화면량(칸 수). 배율을 곱해 쓴다. */
export const KEY_PAN_CELLS = 4;

/**
 * W/A/S/D 로 화면을 옮긴 뒤의 스크롤 위치.
 *
 * 걸음은 픽셀이 아니라 칸 단위다 — 확대해도 "네 칸 옮긴다"가 유지된다.
 * Shift 를 누르면 한 화면씩 뛴다.
 */
export function keyPanScroll(
  box: { scrollLeft: number; scrollTop: number; clientWidth: number; clientHeight: number },
  dir: { x: number; y: number },
  cell: number,
  page = false,
): { scrollLeft: number; scrollTop: number } {
  const stepX = page ? box.clientWidth : KEY_PAN_CELLS * cell;
  const stepY = page ? box.clientHeight : KEY_PAN_CELLS * cell;
  return {
    scrollLeft: Math.max(0, box.scrollLeft + dir.x * stepX),
    scrollTop: Math.max(0, box.scrollTop + dir.y * stepY),
  };
}
