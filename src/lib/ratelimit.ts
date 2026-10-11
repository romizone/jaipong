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

export async function upstashPipeline(commands: string[][]): Promise<PipelineReply> {
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

/**
 * Tanggal hari ini menurut WIB. Penggunanya di Indonesia: jatah harian yang
 * berganti pukul 07.00 pagi (tengah malam UTC) akan terasa janggal.
 */
function today(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
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

/** Kembalikan satu hitungan pada tiap kunci. Sekadar usaha. */
async function decr(keys: string[]): Promise<void> {
  if (!keys.length) return;
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

type Rule = { key: string; limit: number; ttlSec: number; message: string };

/**
 * Potong satu hitungan dari tiap aturan, berurutan. Begitu satu aturan
 * menolak, semua yang sudah terpotong dikembalikan: permintaan yang ditolak
 * tidak boleh memakan jatah. Tanpa ini pengguna yang tersandung batas burst
 * kehilangan satu dari lima lagunya hari itu tanpa mendapat lagu apa pun.
 */
async function take(rules: Rule[]): Promise<Quota> {
  const taken: string[] = [];
  for (const rule of rules) {
    const used = await incr(rule.key, rule.ttlSec);
    taken.push(rule.key);
    if (used > rule.limit) {
      await decr(taken);
      return { ok: false, message: rule.message };
    }
  }
  return OK;
}

/**
 * Kuota tahap penulisan lirik. Lebih longgar dari kuota audio karena biayanya
 * kecil, tapi tetap ada supaya endpoint-nya tidak bisa dipompa sendirian.
 */
export async function checkPlanQuota(ip: string): Promise<Quota> {
  return take([
    {
      key: `p:b:${ip}`,
      limit: LIMITS.burst * 2,
      ttlSec: LIMITS.burstWindowSec,
      message:
        "Terlalu banyak permintaan dalam waktu singkat. Coba lagi beberapa menit lagi.",
    },
    {
      key: `p:d:${ip}:${today()}`,
      limit: LIMITS.daily * 2,
      ttlSec: 86_400,
      message: "Kuota harian untuk koneksi ini sudah habis. Silakan lanjut besok.",
    },
  ]);
}

function userKey(userId: string): string {
  return `s:u:${userId}:${today()}`;
}

export type SongQuota =
  | { ok: true; refund: () => Promise<void> }
  | { ok: false; message: string };

/**
 * Kuota pembangkitan audio — tahap yang benar-benar berbiaya. Jatah utamanya
 * per akun Google (LIMITS.userDaily lagu sehari); batas burst dan harian per
 * IP serta batas seluruh situs tetap ada sebagai pagar terhadap satu orang
 * dengan banyak akun.
 *
 * refund() mengembalikan jatah bila hulu gagal sebelum lagunya jadi —
 * gangguan layanan jangan menghabiskan jatah pengguna. Kuncinya dibekukan di
 * sini supaya lagu yang melewati tengah malam tetap dikembalikan ke hari
 * tempat jatahnya dipotong.
 */
export async function checkSongQuota(ip: string, userId: string): Promise<SongQuota> {
  const rules: Rule[] = [
    {
      key: userKey(userId),
      limit: LIMITS.userDaily,
      ttlSec: 86_400,
      message: `Jatah ${LIMITS.userDaily} lagu hari ini sudah habis. Jatah baru tersedia besok.`,
    },
    {
      key: `s:b:${ip}`,
      limit: LIMITS.burst,
      ttlSec: LIMITS.burstWindowSec,
      message: "Terlalu banyak lagu dalam waktu singkat. Coba lagi beberapa menit lagi.",
    },
    {
      key: `s:d:${ip}:${today()}`,
      limit: LIMITS.daily,
      ttlSec: 86_400,
      message: "Kuota lagu harian untuk koneksi ini sudah habis. Silakan lanjut besok.",
    },
    {
      key: `s:g:${today()}`,
      limit: LIMITS.globalDaily,
      ttlSec: 86_400,
      message: "Kuota lagu harian situs ini sudah habis. Silakan coba lagi besok.",
    },
  ];

  const quota = await take(rules);
  if (!quota.ok) return quota;
  return { ok: true, refund: () => decr(rules.map((rule) => rule.key)) };
}

/** Jumlah lagu yang sudah dibuat akun ini hari ini. */
export async function songsUsedToday(userId: string): Promise<number> {
  const key = userKey(userId);
  if (hasSharedStore) {
    try {
      const data = await upstashPipeline([["GET", key]]);
      return Math.max(0, Number(data[0]?.result ?? 0) || 0);
    } catch {
      // Jatuh ke penghitung memori.
    }
  }
  const counter = memory.get(key);
  return counter && counter.expiresAt > Date.now() ? Math.max(0, counter.count) : 0;
}
