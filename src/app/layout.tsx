import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wolfdesk",
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
