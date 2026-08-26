import { OPENROUTER_API_KEY } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pemeriksaan ringan: apakah situs sudah dikonfigurasi. Tidak membocorkan kunci. */
export async function GET() {
  return Response.json({
    ok: true,
    configured: Boolean(OPENROUTER_API_KEY),
    time: new Date().toISOString(),
  });
}
