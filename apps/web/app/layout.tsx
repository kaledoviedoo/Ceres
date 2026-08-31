import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "CERES — Digital Twin agrícola",
  description:
    "Prototipo de gemelo digital agrícola. DEMO / SYNTHETIC DATA: finca ficticia y modelo experimental.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-ceres-bg text-ceres-text antialiased">{children}</body>
    </html>
  );
}
