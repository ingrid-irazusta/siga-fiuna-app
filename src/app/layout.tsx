import "./globals.css";
import AppShell from "@/components/AppShell";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "S.I.G.A. FIUNA",
  description: "Gestión académica personalizada para estudiantes de FIUNA",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}