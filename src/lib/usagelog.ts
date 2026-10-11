import { hasSharedStore } from "@/lib/config";
import { upstashPipeline } from "@/lib/ratelimit";

/**
 * Catatan pemakaian: satu entri tiap kali model musik dipanggil — siapa,
 * kapan, lagu apa, dan bagaimana akhirnya.
 *
 * Entri selalu ditulis ke log server (terbaca di dasbor Vercel). Kalau
 * Upstash diisi, entri juga disimpan di sana sebagai daftar yang bisa dibaca
 * lewat /api/log. Tanpa Upstash daftarnya hanya di memori proses dan hilang
 * tiap instance berganti — cukup untuk pengembangan, bukan untuk produksi.
 */

export type UsageEntry = {
  /** Waktu ISO (UTC). */
  waktu: string;
  /** ok = lagu jadi; gagal = hulu gagal, jatah dikembalikan; batal = klien pergi. */
  status: "ok" | "gagal" | "batal";
  sub: string;
  email: string;
  nama: string;
  judul: string;
  genre: string;
  vokal: string;
  durasi: number;
  ip: string;
};

const KEY = "log:lagu";
const MAX_ENTRIES = 5_000;
const memoryLog: string[] = [];

export async function logUsage(entry: UsageEntry): Promise<void> {
  const line = JSON.stringify(entry);
  console.log("[pakai]", line);

  if (hasSharedStore) {
    try {
      await upstashPipeline([
        ["LPUSH", KEY, line],
        ["LTRIM", KEY, "0", String(MAX_ENTRIES - 1)],
      ]);
      return;
    } catch (error) {
      console.error("[pakai] upstash gagal, memakai memori", error);
    }
  }
  memoryLog.unshift(line);
  if (memoryLog.length > 500) memoryLog.length = 500;
}

/** Entri terbaru lebih dulu. */
export async function readUsage(limit = 200): Promise<UsageEntry[]> {
  let lines = memoryLog.slice(0, limit);
  if (hasSharedStore) {
    try {
      const data = await upstashPipeline([["LRANGE", KEY, "0", String(limit - 1)]]);
      const result = data[0]?.result;
      if (Array.isArray(result)) lines = result.map(String);
    } catch (error) {
      console.error("[pakai] upstash gagal dibaca", error);
    }
  }

  const out: UsageEntry[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as UsageEntry);
    } catch {
      // Entri rusak dilewati.
    }
  }
  return out;
}
