import { readSession } from "@/lib/auth";
import { ADMIN_EMAILS, hasSharedStore } from "@/lib/config";
import { readUsage } from "@/lib/usagelog";
import { summarize } from "@/lib/usagestats";
import { listUsers } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rentang bawaan, dipakai footer studio. */
const HARI_BAWAAN = 20;
const HARI_MAKS = 90;

/**
 * Entri yang dibaca sebelum dipotong menurut waktu. Catatan pemakaian
 * dipangkas di 5.000 entri, jadi angka ini hanya membatasi besar jawaban
 * Upstash — bukan rentangnya. Kalau situs pernah seramai ini dalam 20 hari,
 * yang terpotong adalah entri paling tua.
 */
const PINDAI = 2_000;

/** Ringkasan pemakaian, hanya untuk email yang terdaftar di ADMIN_EMAILS. */
export async function GET(req: Request) {
  const user = readSession(req);
  if (!user) return Response.json({ error: "Masuk dulu." }, { status: 401 });
  if (!ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return Response.json({ error: "Bukan pengelola." }, { status: 403 });
  }

  // Dibulatkan dan dibatasi: rentang pecahan atau raksasa tidak berguna,
  // dan readUsage tetap hanya menyimpan 5.000 entri.
  const diminta = Math.floor(Number(new URL(req.url).searchParams.get("hari")));
  const hari =
    Number.isFinite(diminta) && diminta > 0 ? Math.min(HARI_MAKS, diminta) : HARI_BAWAAN;

  const [entries, users] = await Promise.all([readUsage(PINDAI), listUsers()]);
  return Response.json(summarize(entries, users, hari, hasSharedStore));
}
