import type { Metadata } from "next";
import localFont from "next/font/local";
import { Fraunces } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
});

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "D'accord: verified milestone payments",
  description:
    "Freelance milestone payments held with PayPal and released when the delivered work meets criteria agreed up front, checked by AI against the real PR, CI and live URL.",
  metadataBase: new URL("https://daccord.hero-apps.com"),
  openGraph: {
    title: "D'accord: verified milestone payments",
    description:
      "Agreed. Verified. D'accord. Funds held with PayPal, released the minute the work passes the criteria both sides signed.",
    url: "https://daccord.hero-apps.com",
    siteName: "D'accord",
    images: [{ url: "/og-image.png", width: 1920, height: 1080 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "D'accord: verified milestone payments",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
