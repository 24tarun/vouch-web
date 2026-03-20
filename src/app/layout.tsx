import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "TAS - Task Accountability System",
  description:
    "Set commitments, assign vouchers, face consequences. When you fail, your money goes to charity.",
  keywords: ["accountability", "productivity", "commitment", "charity"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

import { PlatformProvider } from "@/components/PlatformProvider";
import { PWARegistration } from "@/components/PWARegistration";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body
        className="antialiased"
      >
        <PlatformProvider>
          {children}
        </PlatformProvider>
        <PWARegistration />
        <Toaster />
      </body>
    </html>
  );
}
