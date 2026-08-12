import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "此刻｜DBT 心理自助技能助手",
  description:
    "基于两册专业资料、回答可追溯的 DBT 心理自助 RAG Demo，并提供“核对事实”结构化练习。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
