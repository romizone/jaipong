import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Plus Jakarta Sans dirancang di Jakarta — pas untuk aplikasi bikinan sini.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

const SITE = process.env.SITE_URL ?? "https://jaipong.rominur.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Jaipong — Bikin Lagu dengan AI",
    template: "%s · Jaipong",
  },
  description:
    "Tulis satu kalimat, dapatkan lagu utuh: lirik ditulis AI, audionya dibangkitkan model musik. Langsung diputar dan bisa diunduh sebagai MP3.",
  applicationName: "Jaipong",
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "Jaipong",
    title: "Jaipong — Bikin Lagu dengan AI",
    description:
      "Tulis satu kalimat, dapatkan lagu utuh — dinyanyikan sungguhan oleh model musik.",
    locale: "id_ID",
  },
  twitter: {
    card: "summary_large_image",
    title: "Jaipong — Bikin Lagu dengan AI",
    description:
      "Tulis satu kalimat, dapatkan lagu utuh — dinyanyikan sungguhan oleh model musik.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0b0810",
  width: "device-width",
  initialScale: 1,
  // Supaya env(safe-area-inset-*) terisi dan bilah pemutar tidak tertutup
  // garis home di iPhone.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={jakarta.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
