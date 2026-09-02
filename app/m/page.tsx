import type { Metadata, Viewport } from "next";
import { MobileViewer } from "./MobileViewer";

export const metadata: Metadata = {
  title: "도면 보기",
  description: "서버에 저장된 배치 도면을 휴대폰에서 읽기 전용으로 본다.",
};

/**
 * 휴대폰 화면에 맞추고 브라우저 확대는 끈다 — 두 손가락은 도면을 키우는 데 쓴다.
 * `viewportFit: cover` 는 노치 옆까지 배경을 채운다.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function MobilePage() {
  return <MobileViewer />;
}
