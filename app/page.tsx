import type { Metadata } from "next";
import { GridEditor } from "./editor/GridEditor";

export const metadata: Metadata = {
  title: "격자형 배치 편집기",
  description:
    "격자 위에 설비·장비·센서와 배선 경로, 설치 상태를 칸 단위로 찍어 배치도를 만드는 도구.",
};

export default function Home() {
  return <GridEditor />;
}
