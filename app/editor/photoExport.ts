/**
 * 사진을 브라우저 밖으로 내보내는 자리 — 파일 내려받기와 인쇄 창.
 *
 * 여기만 DOM 을 만진다. 무엇을 낼지 정하는 일(모으기 · 이름 짓기 · HTML 만들기)은
 * `photoLedger.ts` 에 있고 그쪽은 브라우저 없이 시험할 수 있다.
 */

import { type LedgerMeta, ledgerHtml, type PhotoEntry, photoFileName } from "./photoLedger";
import { downloadDataUrl } from "./storage";

/** 사진 한 장을 파일로 내려받는다. */
export function downloadPhoto(entry: PhotoEntry) {
  downloadDataUrl(entry.photo, photoFileName(entry));
}

/**
 * 여러 장 사이에 두는 간격(ms).
 *
 * 한 번에 몰아서 `click()` 하면 브라우저가 뒤쪽을 "여러 파일 자동 내려받기" 로 보고
 * 조용히 버린다. 한 박자씩 띄우면 장수만큼 전부 저장된다.
 */
const DOWNLOAD_GAP_MS = 180;

/**
 * 사진을 차례로 내려받는다. 저장된 장수를 돌려준다.
 *
 * 파일 하나로 묶어(zip) 주는 편이 사용자에게 낫지만, 그러려면 압축 라이브러리가
 * 하나 더 붙는다. 사진 대장 인쇄가 "한 장으로 모아 보는" 몫을 이미 맡으므로
 * 여기서는 의존성 없이 낱장으로 낸다.
 */
export async function downloadPhotos(entries: PhotoEntry[]): Promise<number> {
  for (let index = 0; index < entries.length; index += 1) {
    downloadPhoto(entries[index]);
    if (index < entries.length - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, DOWNLOAD_GAP_MS));
    }
  }
  return entries.length;
}

/**
 * 사진 대장을 새 창에 띄우고 인쇄 창을 연다.
 *
 * 팝업이 막히면 `false` 를 돌려준다 — 부르는 쪽이 사용자에게 알려야 한다.
 * 그림이 data URL 이라도 붙는 데 한 박자 걸리므로 `load` 뒤에 인쇄한다.
 */
export function openPhotoLedger(entries: PhotoEntry[], meta: LedgerMeta): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;

  win.document.open();
  win.document.write(ledgerHtml(entries, meta));
  win.document.close();

  if (win.document.readyState === "complete") win.print();
  else win.addEventListener("load", () => win.print(), { once: true });

  return true;
}
