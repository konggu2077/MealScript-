import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MealScript · 麦门编译器',
  description:
    'Code Your Meal. Compile Your Hunger. 一门面向真实麦当劳点餐场景的轻量 DSL 编译器，用官方 MCP 校验真实价格。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-ink-950 text-[#e7e7ea] antialiased">{children}</body>
    </html>
  );
}
