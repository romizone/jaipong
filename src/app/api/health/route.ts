import { OPENROUTER_API_KEY, hasAuth, hasSharedStore } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pemeriksaan ringan: apakah situs sudah dikonfigurasi. Tidak membocorkan kunci. */
export async function GET() {
  return Response.json({
    ok: true,
    configured: Boolean(OPENROUTER_API_KEY),
    // Tanpa kredensial Google tidak ada yang bisa masuk, jadi tidak ada lagu.
    auth: hasAuth,
    // Kuota dihitung di store bersama (Upstash) atau hanya di memori proses —
    // tanpa ini token Upstash yang salah tidak pernah ketahuan dari luar.
    sharedStore: hasSharedStore,
    time: new Date().toISOString(),
  });
}
