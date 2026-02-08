import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthGuard from "@/components/AuthGuard";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SIGA FIUNA",
  description: "Aplicación académica FIUNA",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Si quieres que algunas rutas sean públicas, puedes chequear la ruta aquí
  // Por simplicidad, protegemos todo menos /auth
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children && <AuthGuard>{children}</AuthGuard>}
      </body>
    </html>
  );
}
