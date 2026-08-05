import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "investing — portfolio analytics",
  description:
    "Local investment analytics from brokerage statement PDFs: net worth, cash flows, TWRR, MWRR, and benchmark comparison.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body
        className={`${GeistSans.className} bg-background text-foreground flex min-h-full flex-col`}
      >
        {children}
      </body>
    </html>
  );
}
