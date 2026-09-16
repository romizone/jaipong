import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Ada lockfile lain di direktori induk; kunci akar proyek ke folder ini.
  turbopack: { root: import.meta.dirname },
  async headers() {
    return [
      {
        // Pengaman dasar untuk situs terbuka: tidak boleh dibingkai situs
        // lain, jenis berkas tidak ditebak-tebak browser, dan URL halaman
        // tidak bocor penuh ke situs tujuan tautan.
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
