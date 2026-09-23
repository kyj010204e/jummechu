import type { Metadata } from "next";

import {
  Geist,
  Geist_Mono,
} from "next/font/google";

import "./globals.css";

import SessionKeepAlive from "@/components/SessionKeepAlive";

/* =========================================================
   FONT
========================================================= */

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* =========================================================
   METADATA
========================================================= */

export const metadata: Metadata = {
  title: "점메추",
  description:
    "내 취향과 위치를 기반으로 점심 메뉴와 맛집을 추천해주는 서비스",
};

/* =========================================================
   ROOT LAYOUT
========================================================= */

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">

        {/* 로그인 세션 자동 연장 */}
        <SessionKeepAlive />

        {/* 각 페이지 */}
        {children}

      </body>
    </html>
  );
}