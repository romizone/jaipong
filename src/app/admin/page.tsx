"use client";

import { useEffect, useState } from "react";
import type { UsageEntry } from "@/lib/usagelog";
import type { UserRecord } from "@/lib/users";

/**
 * Halaman pengelola: daftar pengguna dan catatan pemakaian. Datanya dari
 * /api/log, yang hanya menjawab email di ADMIN_EMAILS — halaman ini sendiri
 * tidak memuat data apa pun.
 */

type Data = { persistent: boolean; users: UserRecord[]; entries: UsageEntry[] };

/** Waktu ISO (UTC) ditampilkan dalam WIB. */
function wib(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const STATUS: Record<UsageEntry["status"], string> = {
  ok: "jadi",
  gagal: "gagal",
  batal: "batal",
};

export default function AdminPage() {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("Memuat…");

  useEffect(() => {
    fetch("/api/log?n=500", { cache: "no-store" })
      .then(async (res) => {
        if (res.ok) setData((await res.json()) as Data);
        else if (res.status === 401) setMessage("Masuk dulu dengan akun pengelola.");
        else setMessage("Halaman ini hanya untuk pengelola situs.");
      })
      .catch(() => setMessage("Data gagal dimuat. Periksa jaringan lalu muat ulang."));
  }, []);

  const cell = "border-b border-line px-3 py-2 text-left align-top";

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Pemakaian Jaipong</h1>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- muat ulang penuh disengaja */}
        <a href="/" className="text-sm text-muted hover:text-ink">
          ← Kembali ke studio
        </a>
      </div>

      {!data ? (
        <p className="mt-6 text-sm text-muted">
          {message}{" "}
          {message.startsWith("Masuk") && (
            <a href="/api/auth/login" className="font-semibold text-gold-soft underline">
              Masuk dengan Google
            </a>
          )}
        </p>
      ) : (
        <>
          {!data.persistent && (
            <p role="alert" className="mt-4 rounded-xl border border-rose/40 bg-rose/10 p-3 text-sm text-ink">
              Penyimpanan tetap (Upstash) belum diisi. Data di bawah hanya dari
              memori server yang sedang menjawab dan akan hilang.
            </p>
          )}

          <h2 className="mt-8 text-sm font-semibold text-muted">
            Pengguna ({data.users.length})
          </h2>
          <div className="mt-2 overflow-x-auto rounded-xl2 border border-line bg-surface">
            <table className="w-full min-w-[44rem] text-sm text-ink">
              <thead className="text-xs text-muted">
                <tr>
                  <th className={cell}>Nama</th>
                  <th className={cell}>Email</th>
                  <th className={cell}>Lagu</th>
                  <th className={cell}>Masuk</th>
                  <th className={cell}>Pertama masuk</th>
                  <th className={cell}>Terakhir masuk</th>
                  <th className={cell}>Lagu terakhir</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.sub}>
                    <td className={cell}>{user.nama}</td>
                    <td className={cell}>{user.email}</td>
                    <td className={`${cell} tabular-nums`}>{user.jumlahLagu}</td>
                    <td className={`${cell} tabular-nums`}>{user.jumlahMasuk}×</td>
                    <td className={cell}>{wib(user.pertamaMasuk)}</td>
                    <td className={cell}>{wib(user.terakhirMasuk)}</td>
                    <td className={cell}>{wib(user.terakhirLagu)}</td>
                  </tr>
                ))}
                {data.users.length === 0 && (
                  <tr>
                    <td className={`${cell} text-muted`} colSpan={7}>
                      Belum ada pengguna.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 className="mt-8 text-sm font-semibold text-muted">
            Catatan pemakaian ({data.entries.length} terbaru)
          </h2>
          <div className="mt-2 overflow-x-auto rounded-xl2 border border-line bg-surface">
            <table className="w-full min-w-[44rem] text-sm text-ink">
              <thead className="text-xs text-muted">
                <tr>
                  <th className={cell}>Waktu (WIB)</th>
                  <th className={cell}>Pengguna</th>
                  <th className={cell}>Judul</th>
                  <th className={cell}>Genre</th>
                  <th className={cell}>Hasil</th>
                  <th className={cell}>IP</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry, index) => (
                  <tr key={`${entry.waktu}-${index}`}>
                    <td className={`${cell} whitespace-nowrap`}>{wib(entry.waktu)}</td>
                    <td className={cell}>{entry.email}</td>
                    <td className={cell}>{entry.judul}</td>
                    <td className={cell}>{entry.genre}</td>
                    <td className={cell}>{STATUS[entry.status] ?? entry.status}</td>
                    <td className={`${cell} font-mono text-xs text-muted`}>{entry.ip}</td>
                  </tr>
                ))}
                {data.entries.length === 0 && (
                  <tr>
                    <td className={`${cell} text-muted`} colSpan={6}>
                      Belum ada lagu yang dibuat.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
