import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Koora Break — Live Scores',
  description: 'Live scores — pick a match to watch it in real time',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (Grammarly, ColorZilla…)
          inject attributes into <body> before React hydrates */}
      <body suppressHydrationWarning className="min-h-screen bg-bg font-sans text-fg antialiased">
        <header className="flex items-center justify-between gap-4 border-b border-edge px-7 py-5">
          <div>
            <h1 className="text-[1.4rem] font-bold tracking-[0.3px]">
              Koora Break <span className="text-accent">Live</span>
            </h1>
            <p className="mt-1 text-[0.85rem] text-muted">
              Live scores — pick a match to watch it in real time
            </p>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
