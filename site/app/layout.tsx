import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Sora } from "next/font/google";
import { SITE_URL } from "@/lib/links";
import "./globals.css";

const sora = Sora({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-sora", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-mono", display: "swap" });

const title = "ZeroBox · Gmail cleanup for the terminal";
const description =
  "Get to inbox zero from the terminal. ZeroBox ranks every Gmail sender by how much you engage, then trashes, unsubscribes and filters the noise in bulk. Runs locally. MIT.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title,
  description,
  applicationName: "ZeroBox",
  openGraph: {
    type: "website",
    siteName: "ZeroBox",
    title,
    description,
    url: "/",
    images: [{ url: "/social-preview.png", width: 1280, height: 640, alt: "ZeroBox: Gmail cleanup for the terminal" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/social-preview.png"],
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#08090B",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sora.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
