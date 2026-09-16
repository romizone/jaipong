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

function memoryDecr(key: string): void {
  const existing = memory.get(key);
  if (existing && existing.count > 0) existing.count -= 1;
}

type PipelineReply = Array<{ result?: unknown; error?: string }>;

async function upstashPipeline(commands: string[][]): Promise<PipelineReply> {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
    // Store yang menggantung jangan ikut menggantungkan permintaan; lewat
    // batas ini penghitung memori yang mengambil alih.
    signal: AbortSignal.timeout(1_500),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const data = (await res.json()) as PipelineReply;
  // Upstash menjawab 200 walau perintahnya gagal — kesalahannya ada di badan.
  // Tanpa pemeriksaan ini INCR yang gagal terbaca 0 dan semua batas lolos.
  const failed = Array.isArray(data) ? data.find((entry) => entry?.error) : undefined;
  if (!Array.isArray(data) || failed) throw new Error(`upstash: ${failed?.error ?? "jawaban tidak dikenal"}`);
  return data;
}

async function upstashIncr(key: string, ttlSec: number): Promise<number> {
  const data = await upstashPipeline([
    ["INCR", key],
    ["EXPIRE", key, String(ttlSec), "NX"],
  ]);
  const count = Number(data[0]?.result);
  if (!Number.isFinite(count) || count < 1) throw new Error("upstash: hitungan tidak sah");
  return count;
}

async function incr(key: string, ttlSec: number): Promise<number> {
  if (hasSharedStore) {
    try {
      return await upstashIncr(key, ttlSec);
    } catch (error) {
      // Kalau store bersama sedang bermasalah, jangan matikan situs —
      // turun ke penghitung memori supaya batas tetap ada.
      console.error("[ratelimit] upstash gagal, memakai memori", error);
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

/**
 * Kuota tahap penulisan lirik. Lebih longgar dari kuota audio karena biayanya
 * kecil, tapi tetap ada supaya endpoint-nya tidak bisa dipompa sendirian.
 */
export async function checkPlanQuota(ip: string): Promise<Quota> {
  const burst = await check(
    `p:b:${ip}`,
    LIMITS.burst * 2,
    LIMITS.burstWindowSec,
    "Terlalu banyak permintaan dalam waktu singkat. Coba lagi beberapa menit lagi.",
  );
  if (!burst.ok) return burst;

  return check(
    `p:d:${ip}:${today()}`,
    LIMITS.daily * 2,
    86_400,
    "Kuota harian untuk koneksi ini sudah habis. Silakan lanjut besok.",
  );
}

/**
 * Kuota pembangkitan audio — tahap yang benar-benar berbiaya, jadi di sinilah
 * batas burst, harian, dan batas seluruh situs ditegakkan.
 */
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

/**
 * Kembalikan jatah yang dipotong checkComposeQuota bila hulu gagal sebelum
 * lagunya jadi — gangguan layanan jangan menghabiskan kuota pengguna sampai
 * ia terkunci "terlalu banyak lagu". Sekadar usaha: kalau store-nya sedang
 * bermasalah, jatahnya hangus saja.
 */
export async function refundComposeQuota(ip: string): Promise<void> {
  const keys = [`s:b:${ip}`, `s:d:${ip}:${today()}`, `s:g:${today()}`];
  if (hasSharedStore) {
    try {
      await upstashPipeline(keys.map((key) => ["DECR", key]));
      return;
    } catch {
      // Jatuh ke penghitung memori, tempat jatahnya mungkin dipotong tadi.
    }
  }
  for (const key of keys) memoryDecr(key);
}
