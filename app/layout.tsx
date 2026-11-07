import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Shared by every app on tinkeryard.dev; each app sets its own title and description.
// The manifest (app/manifest.ts) and icons (app/icon.tsx, app/apple-icon.tsx) make it installable;
// appleWebApp is what iPhone's "Add to Home Screen" reads, since Safari ignores parts of the manifest.
export const metadata: Metadata = {
  title: "Tinkeryard",
  description: "A yard for half-finished AI things.",
  applicationName: "Tinkeryard",
  appleWebApp: { capable: true, title: "Tinkeryard", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

// viewportFit "cover" lets pages use the whole screen on phones with a notch or home indicator;
// the tab bar and sheets pad themselves with env(safe-area-inset-*) so nothing hides underneath.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f6f4ef" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
