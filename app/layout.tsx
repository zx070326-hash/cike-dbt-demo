import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://increasing-various-seek-designs.trycloudflare.com"),
  title: "此刻｜DBT 自助练习助手",
  description:
    "从日常困扰出发，学习有书本出处的 DBT 技能，并跟着完成“核对事实”练习。",
  openGraph: {
    title: "此刻｜先说说，再一起找办法",
    description: "有书本出处的 DBT 自助练习",
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og.png", width: 1732, height: 909, alt: "此刻 DBT 自助练习助手" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "此刻｜先说说，再一起找办法",
    description: "有书本出处的 DBT 自助练习",
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
