import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://cike-dbt-demo.zx070326.workers.dev"),
  title: "此刻｜DBT 自助练习助手",
  description:
    "默认从陪伴对话开始，也可切换到知识伴读；DBT 方法附有可核对的书本出处。",
  openGraph: {
    title: "此刻｜先说说，再一起找办法",
    description: "伴读引导与知识深读双模式，现已升级为陪伴对话与知识伴读，书中方法可追溯",
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og.png", width: 1732, height: 909, alt: "此刻 DBT 自助练习助手" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "此刻｜先说说，再一起找办法",
    description: "陪伴对话与知识伴读双模式，书中方法可追溯",
    images: ["/og.png"],
  },
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
