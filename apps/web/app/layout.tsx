import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Discord's UI font ("gg sans") is proprietary; Inter is the closest open
// equivalent and matches Discord's look. Loaded as the global app font.
const discordFont = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-discord",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DiscWorld — Seu servidor Discord em 2D",
  description: "Explore seu servidor Discord como um mundo 2D com spatial audio.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={discordFont.variable}>
      <body>{children}</body>
    </html>
  );
}
