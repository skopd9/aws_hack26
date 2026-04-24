import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IP-Pulse — real-time agentic patent intelligence',
  description:
    'Proactive, agentic IP defense for software engineers. Turns the daily flood of patent filings into real-time, voice-activated strategic alerts.'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-pulse-bg text-pulse-ink antialiased">
        {children}
      </body>
    </html>
  );
}
