import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "격자형 배치 편집기",
  description:
    "격자 위에 설비·장비·센서와 배선 경로, 설치 상태를 칸 단위로 찍어 배치도를 만드는 도구.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
