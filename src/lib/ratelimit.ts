import { LIMITS, UPSTASH_TOKEN, UPSTASH_URL, hasSharedStore } from "@/lib/config";

/**
 * Penghitung kuota sederhana: satu kunci = satu jendela waktu.
 *
 * Tanpa Upstash, penghitung disimpan di memori proses. Di Vercel setiap
 * instance punya memorinya sendiri, jadi batas efektifnya bisa lebih longgar
 * dari angka yang tertulis. Isi UPSTASH_REDIS_REST_URL/TOKEN kalau butuh
 * kuota yang persis.
 */

type Counter = { count: number; expiresAt: number };
const memory = new Map<string, Counter>();

function memoryIncr(key: string, ttlSec: number): number {
  const now = Date.now();
  const existing = memory.get(key);
  if (!existing || existing.expiresAt <= now) {
    memory.set(key, { count: 1, expiresAt: now + ttlSec * 1000 });
    if (memory.size > 10_000) {
      for (const [k, v] of memory) if (v.expiresAt <= now) memory.delete(k);
    }
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

async function upstashIncr(key: string, ttlSec: number): Promise<number> {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, String(ttlSec), "NX"],
    ]),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const data = (await res.json()) as Array<{ result: number }>;
  return Number(data?.[0]?.result ?? 0);
}

async function incr(key: string, ttlSec: number): Promise<number> {
  if (hasSharedStore) {
    try {
      return await upstashIncr(key, ttlSec);
    } catch {
      // Kalau store bersama sedang bermasalah, jangan matikan situs —
      // turun ke penghitung memori supaya batas tetap ada.
    }
  }
  return memoryIncr(key, ttlSec);
}

export type Quota = { ok: true } | { ok: false; message: string };

const OK: Quota = { ok: true };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Ambil IP klien dari header proxy.
 *
 * Urutannya penting. Isi paling kiri x-forwarded-for berasal dari klien, jadi
 * siapa pun bisa mengarangnya dan mendapat kuota baru tiap permintaan.
 * x-real-ip dan cf-connecting-ip diisi platform di depan aplikasi dan menimpa
 * apa pun yang dikirim klien, jadi keduanya didahulukan; x-forwarded-for hanya
 * dipakai kalau tidak ada pilihan lain.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;

  const cloudflare = req.headers.get("cf-connecting-ip")?.trim();
  if (cloudflare) return cloudflare;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();

  return "anon";
}

async function check(
  key: string,
  limit: number,
  ttlSec: number,
  message: string,
): Promise<Quota> {
  const used = await incr(key, ttlSec);
  return used > limit ? { ok: false, message } : OK;
}

/** Kuota untuk satu permintaan penyusunan lagu. */
export async function checkComposeQuota(ip: string): Promise<Quota> {
  const burst = await check(
    `s:b:${ip}`,
    LIMITS.burst,
    LIMITS.burstWindowSec,
    "Terlalu banyak lagu dalam waktu singkat. Coba lagi beberapa menit lagi.",
  );
  if (!burst.ok) return burst;

  const daily = await check(
    `s:d:${ip}:${today()}`,
    LIMITS.daily,
    86_400,
    "Kuota lagu harian untuk koneksi ini sudah habis. Silakan lanjut besok.",
  );
  if (!daily.ok) return daily;

  return check(
    `s:g:${today()}`,
    LIMITS.globalDaily,
    86_400,
    "Kuota lagu harian situs ini sudah habis. Silakan coba lagi besok.",
  );
}
