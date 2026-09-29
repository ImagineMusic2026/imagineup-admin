import type { Metadata, Viewport } from "next";
import { Manrope, Sora } from "next/font/google";

import "./globals.css";

// Fontes baixadas no build e servidas pelo próprio painel (next/font):
// nenhuma visita fala com o Google.
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Painel ImagineUP", template: "%s · Painel ImagineUP" },
  description: "Painel administrativo do app ImagineUP, da Imagine Music. Acesso restrito à equipe.",
  applicationName: "Painel ImagineUP",
  // Painel interno: nada aqui entra em busca.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  referrer: "same-origin",
  formatDetection: { email: false, telephone: false, address: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0b10",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${sora.variable} ${manrope.variable}`}>
      <body className="min-h-dvh bg-ink font-sans text-fg antialiased">{children}</body>
    </html>
  );
}
