import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Font di-load sekali di root layout dan diekspos sebagai CSS variable
// (--font-inter) — dipakai oleh tailwind.config.ts fontFamily.sans,
// jadi SELURUH app otomatis pakai Inter tanpa perlu import ulang.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "caPOS — Point of Sale Kafe/Restoran",
    template: "%s · caPOS",
  },
  description:
    "caPOS — aplikasi Point of Sale untuk kafe/restoran: kasir offline-first, dapur real-time, multi-cabang, dan laporan otomatis. by Studio D13.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#10B981",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className={inter.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
