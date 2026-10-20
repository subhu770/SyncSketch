import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'SyncSketch | Real-Time Collaborative Whiteboard',
  description:
    'A high-performance collaborative whiteboard application powered by HTML5 Canvas and Yjs CRDT engine. Features optimistic zero-latency rendering and jitter-free awareness cursors.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full overflow-hidden" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-full w-full overflow-hidden bg-[#121316] text-white select-none`}
      >
        {children}
      </body>
    </html>
  );
}
