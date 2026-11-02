import type { Metadata, Viewport } from "next";
import "@fontsource-variable/nunito-sans/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "SAQUE LEAGUE 2026/27 · Saque Pádel Social Club",
  description: "La liga interna de la Escuela de Pádel Saque: nivelación, Race to Masters y Saque Masters.",
  icons: { icon: "/brand/icon.png", apple: "/brand/apple-icon.png" },
};

export const viewport: Viewport = { themeColor: "#071e47", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
