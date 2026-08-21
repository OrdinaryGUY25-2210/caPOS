import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "caPOS — Point of Sale Kafe",
  description: "Aplikasi kasir & manajemen kafe oleh Studio D13",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
