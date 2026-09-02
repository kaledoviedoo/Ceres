import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import "./globals.css";

/*
 * IBM Plex: herencia industrial real, y no es la eleccion por defecto que
 * arrastra cualquier proyecto de Next. La mono hace el trabajo pesado —datos,
 * etiquetas, versalitas— y es lo que da a la pantalla textura de panel de
 * instrumentos en lugar de textura de plantilla.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CERES — Digital Twin agrícola",
  description:
    "Inspección espacial de una finca dividida en celdas de 1 m². DEMO / SYNTHETIC DATA: finca ficticia y modelo experimental.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d0c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="h-dvh overflow-hidden bg-canvas text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
