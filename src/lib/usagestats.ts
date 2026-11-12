import type { UsageEntry } from "@/lib/usagelog";
import type { UserRecord } from "@/lib/users";

/**
 * Ringkasan pemakaian untuk rentang hari terakhir: siapa yang masuk, dan
 * berapa lagu yang dibuatnya dalam rentang itu.
 *
 * Dua sumbernya berbeda sifat. Catatan pemakaian (log:lagu) punya cap waktu
 * per lagu, jadi jumlah lagu bisa dipotong persis sesuai rentang. Catatan
 * pengguna (user:<sub>) hanya menyimpan waktu masuk terakhir, bukan riwayat
 * tiap kali masuk — jadi "masuk dalam rentang" berarti masuk terakhirnya
 * jatuh di dalam rentang, bukan hitungan berapa kali.
 */

export type UsageStatRow = {
  sub: string;
  nama: string;
  email: string;
  /** Lagu yang benar-benar jadi dalam rentang. */
  lagu: number;
  /** Percobaan yang gagal di hulu dalam rentang — jatahnya sudah dikembalikan. */
  gagal: number;
  /** Waktu ISO (UTC), "" kalau tidak diketahui. Bisa lebih tua dari rentang. */
  terakhirMasuk: string;
  terakhirLagu: string;
};

export type UsageStats = {
  hari: number;
  /** Awal rentang, waktu ISO (UTC). */
  sejak: string;
  /** false berarti angkanya hanya dari memori instance yang menjawab. */
  persistent: boolean;
  baris: UsageStatRow[];
  totalLagu: number;
  totalGagal: number;
};

/**
 * Seseorang masuk daftar kalau salah satu dari dua hal: masuk terakhirnya
 * ada di dalam rentang, atau ia membuat lagu di dalam rentang. Keduanya
 * perlu — sesi bertahan 30 hari, jadi orang bisa membuat lagu hari ini
 * dengan sesi yang dibuatnya sebulan lalu dan tidak akan terjaring kalau
 * hanya waktu masuk yang dilihat.
 */
export function summarize(
  entries: UsageEntry[],
  users: UserRecord[],
  hari: number,
  persistent: boolean,
  now: number = Date.now(),
): UsageStats {
  const sejakMs = now - hari * 86_400_000;
  const dalamRentang = (iso: string): boolean => {
    if (!iso) return false;
    const waktu = Date.parse(iso);
    return Number.isFinite(waktu) && waktu >= sejakMs;
  };

  const baris = new Map<string, UsageStatRow>();
  const ambil = (sub: string, nama: string, email: string): UsageStatRow => {
    let row = baris.get(sub);
    if (!row) {
      row = { sub, nama, email, lagu: 0, gagal: 0, terakhirMasuk: "", terakhirLagu: "" };
      baris.set(sub, row);
    }
    return row;
  };

  for (const entry of entries) {
    if (!entry?.sub || !dalamRentang(entry.waktu)) continue;
    const row = ambil(entry.sub, entry.nama || entry.email || "", entry.email || "");
    if (entry.status === "ok") {
      row.lagu += 1;
      if (entry.waktu > row.terakhirLagu) row.terakhirLagu = entry.waktu;
    } else if (entry.status === "gagal") {
      row.gagal += 1;
    }
  }

  for (const user of users) {
    if (!baris.has(user.sub) && !dalamRentang(user.terakhirMasuk)) continue;
    const row = ambil(user.sub, user.nama || user.email, user.email);
    // Catatan pengguna selalu lebih mutakhir daripada entri log lama:
    // email dan nama di sana ditimpa tiap kali orangnya masuk.
    if (user.nama) row.nama = user.nama;
    if (user.email) row.email = user.email;
    row.terakhirMasuk = user.terakhirMasuk;
    if (user.terakhirLagu > row.terakhirLagu) row.terakhirLagu = user.terakhirLagu;
  }

  const hasil = [...baris.values()].sort(
    (a, b) =>
      b.lagu - a.lagu ||
      b.terakhirMasuk.localeCompare(a.terakhirMasuk) ||
      a.email.localeCompare(b.email),
  );

  return {
    hari,
    sejak: new Date(sejakMs).toISOString(),
    persistent,
    baris: hasil,
    totalLagu: hasil.reduce((sum, row) => sum + row.lagu, 0),
    totalGagal: hasil.reduce((sum, row) => sum + row.gagal, 0),
  };
}
