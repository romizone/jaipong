import type { SessionUser } from "@/lib/auth";
import { hasSharedStore } from "@/lib/config";
import { upstashPipeline } from "@/lib/ratelimit";

/**
 * Daftar pengguna: siapa saja yang pernah masuk, kapan, dan berapa lagu
 * yang sudah dibuatnya. Satu catatan per akun Google.
 *
 * Disimpan di Upstash sebagai satu hash per pengguna ("user:<sub>") plus
 * satu set berisi semua id ("users"). Tanpa Upstash daftarnya hanya di
 * memori proses dan hilang tiap instance berganti — cukup untuk
 * pengembangan, bukan untuk produksi.
 */

export type UserRecord = {
  sub: string;
  email: string;
  nama: string;
  /** Waktu ISO (UTC). */
  pertamaMasuk: string;
  terakhirMasuk: string;
  jumlahMasuk: number;
  /** Lagu yang benar-benar jadi, sepanjang masa. */
  jumlahLagu: number;
  terakhirLagu: string;
};

const INDEX = "users";
const memoryUsers = new Map<string, UserRecord>();

function memoryRecord(user: SessionUser, now: string): UserRecord {
  let record = memoryUsers.get(user.sub);
  if (!record) {
    record = {
      sub: user.sub,
      email: user.email,
      nama: user.name,
      pertamaMasuk: now,
      terakhirMasuk: now,
      jumlahMasuk: 0,
      jumlahLagu: 0,
      terakhirLagu: "",
    };
    memoryUsers.set(user.sub, record);
  }
  record.email = user.email;
  record.nama = user.name;
  return record;
}

/** Bagian yang sama untuk kedua pencatatan: identitas terbaru + indeks. */
function identity(user: SessionUser, now: string): string[][] {
  const key = `user:${user.sub}`;
  return [
    ["SADD", INDEX, user.sub],
    ["HSET", key, "sub", user.sub, "email", user.email, "nama", user.name],
    ["HSETNX", key, "pertamaMasuk", now],
  ];
}

async function write(commands: string[][], fallback: () => void): Promise<void> {
  if (hasSharedStore) {
    try {
      await upstashPipeline(commands);
      return;
    } catch (error) {
      console.error("[pengguna] upstash gagal, memakai memori", error);
    }
  }
  fallback();
}

/** Dipanggil tiap kali seseorang berhasil masuk dengan Google. */
export async function recordLogin(user: SessionUser): Promise<void> {
  const now = new Date().toISOString();
  const key = `user:${user.sub}`;
  console.log("[masuk]", JSON.stringify({ waktu: now, sub: user.sub, email: user.email }));
  await write(
    [
      ...identity(user, now),
      ["HSET", key, "terakhirMasuk", now],
      ["HINCRBY", key, "jumlahMasuk", "1"],
    ],
    () => {
      const record = memoryRecord(user, now);
      record.terakhirMasuk = now;
      record.jumlahMasuk += 1;
    },
  );
}

/** Dipanggil tiap kali satu lagu benar-benar jadi. */
export async function recordSong(user: SessionUser): Promise<void> {
  const now = new Date().toISOString();
  const key = `user:${user.sub}`;
  await write(
    [
      ...identity(user, now),
      ["HSET", key, "terakhirLagu", now],
      ["HINCRBY", key, "jumlahLagu", "1"],
    ],
    () => {
      const record = memoryRecord(user, now);
      record.terakhirLagu = now;
      record.jumlahLagu += 1;
    },
  );
}

/** HGETALL lewat REST menjawab larik selang-seling [nama, nilai, …]. */
function fromHash(raw: unknown): UserRecord | null {
  if (!Array.isArray(raw)) return null;
  const f: Record<string, string> = {};
  for (let i = 0; i + 1 < raw.length; i += 2) f[String(raw[i])] = String(raw[i + 1]);
  if (!f.sub) return null;
  return {
    sub: f.sub,
    email: f.email ?? "",
    nama: f.nama ?? "",
    pertamaMasuk: f.pertamaMasuk ?? "",
    terakhirMasuk: f.terakhirMasuk ?? "",
    jumlahMasuk: Number(f.jumlahMasuk) || 0,
    jumlahLagu: Number(f.jumlahLagu) || 0,
    terakhirLagu: f.terakhirLagu ?? "",
  };
}

/** Semua pengguna, yang terakhir aktif lebih dulu. */
export async function listUsers(): Promise<UserRecord[]> {
  let users = [...memoryUsers.values()];
  if (hasSharedStore) {
    try {
      const index = await upstashPipeline([["SMEMBERS", INDEX]]);
      const ids = Array.isArray(index[0]?.result) ? index[0].result.map(String) : [];
      const rows = ids.length
        ? await upstashPipeline(ids.map((id) => ["HGETALL", `user:${id}`]))
        : [];
      users = rows
        .map((row) => fromHash(row.result))
        .filter((u): u is UserRecord => u !== null);
    } catch (error) {
      console.error("[pengguna] upstash gagal dibaca", error);
    }
  }
  const last = (u: UserRecord) => (u.terakhirLagu > u.terakhirMasuk ? u.terakhirLagu : u.terakhirMasuk);
  return users.sort((a, b) => last(b).localeCompare(last(a)));
}
