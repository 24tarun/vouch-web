import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TAS - Task Accountability System",
  description:
    "Set commitments, assign vouchers, face consequences. When you fail, your money goes to charity.",
  keywords: ["accountability", "productivity", "commitment", "charity"],
};

import { PlatformProvider } from "@/components/PlatformProvider";
import { PWARegistration } from "@/components/PWARegistration";
import { PomodoroProvider } from "@/components/PomodoroProvider";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#0a0a0a" />
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PlatformProvider>
          <PomodoroProvider>
            {children}
          </PomodoroProvider>
        </PlatformProvider>
        <PWARegistration />
        <Toaster />
      </body>
    </html>
  );
}
