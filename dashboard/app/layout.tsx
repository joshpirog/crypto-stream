import type { Metadata } from "next";
import { IBM_Plex_Mono, Chakra_Petch } from "next/font/google";
import "./globals.css";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

const display = Chakra_Petch({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Crypto Stream - live market terminal",
  description: "Real-time crypto VWAP, anomalies, and pipeline health",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${mono.variable} ${display.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
