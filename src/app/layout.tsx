import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signalbot",
  description: "Internal research tool for insider activity and market data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
