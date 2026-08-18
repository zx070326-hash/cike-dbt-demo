import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://cike-dbt-demo.zx070326.workers.dev"),
  title: "此刻｜NSSI · DBT 数字化干预",
  description:
    "面向成年用户的八周结构化 DBT 自助训练，包含 EMA、EMI、数字安全计划、双模式对话与远程人工协助。",
  openGraph: {
    title: "此刻｜NSSI · DBT 数字化干预",
    description: "结构化自助训练、每日状态记录、即时技能与数字安全计划",
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og.png", width: 1732, height: 909, alt: "此刻 DBT 自助练习助手" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "此刻｜NSSI · DBT 数字化干预",
    description: "结构化自助训练、每日状态记录、即时技能与数字安全计划",
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
