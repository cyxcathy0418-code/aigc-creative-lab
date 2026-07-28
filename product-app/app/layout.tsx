import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Brand Anchor Studio",
    template: "%s · Brand Anchor Studio",
  },
  description:
    "锁定商品身份，再为不同市场生成广告素材。Brand Anchor Studio 邀请制 Beta。",
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
