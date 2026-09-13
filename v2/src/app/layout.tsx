import type { Metadata } from "next";

import "./globals.css";
import "./workspace-theme.css";

export const metadata: Metadata = {
  title: "Knowledge Context V2",
  description: "个人上下文引擎的事件、记忆和上下文组装工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
