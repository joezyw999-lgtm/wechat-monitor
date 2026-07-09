import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '公众号推文监控系统',
  description: '监控微信公众号推文，根据关键词筛选文章',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`antialiased`}>
        {children}
      </body>
    </html>
  );
}
