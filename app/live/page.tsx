import type { Metadata, Viewport } from "next";
import { LiveBoard } from "./LiveBoard";

export const metadata: Metadata = {
  title: "실시간 현황판",
  description: "서버에 저장된 배치 도면 위에 RFID 리더의 지금 상태를 MQTT 로 받아 얹어 보인다. 읽기 전용.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#020617",
};

export default function LivePage() {
  return <LiveBoard />;
}
