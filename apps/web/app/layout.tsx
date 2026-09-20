import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HookRelay — webhook gateway",
  description: "Receive, verify, queue, deliver and replay webhooks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
