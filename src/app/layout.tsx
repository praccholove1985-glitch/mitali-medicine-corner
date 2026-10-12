import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Bengali } from "next/font/google";
import { ThemeScript } from "@/components/shell/theme-script";
import { getLocale } from "@/lib/locale";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Fallback for Bangla customer and medicine names.
const notoBengali = Noto_Sans_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Mitali Medicine Corner",
    template: "%s · Mitali Medicine Corner",
  },
  description:
    "Pharmacy management, inventory, point of sale and accounting for Mitali Medicine Corner.",
};

export const viewport: Viewport = {
  themeColor: "#f5f7fb",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    // data-theme is set to light before first paint.
    <html
      lang={locale === "bn" ? "bn" : "en"}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoBengali.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
