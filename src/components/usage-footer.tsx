"use client";

import { useEffect, useState } from "react";
import type { UsageStats } from "@/lib/usagestats";

/**
 * Ringkasan pemakaian di kaki studio: siapa yang masuk dalam rentang
 * terakhir dan berapa lagu yang dibuatnya.
 *
 * Hanya tampil untuk pengelola. Gerbangnya ada di dua tempat: komponen ini
 * tidak memanggil apa pun kalau `aktif` false, dan /api/stats sendiri menolak
 * email di luar ADMIN_EMAILS. Yang kedua itulah pengamannya — yang pertama
 * sekadar menghindari permintaan yang pasti ditolak.
 */

/** Waktu ISO (UTC) ditampilkan ringkas dalam WIB. */
function wib(iso: string): string {
  if (!iso) return "—";
  const waktu = new Date(iso);
  if (Number.isNaN(waktu.getTime())) return "—";
  return waktu.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UsageFooter({ aktif }: { aktif: boolean }) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [pesan, setPesan] = useState("");

  useEffect(() => {
    if (!aktif) {
      setStats(null);
      setPesan("");
      return;
    }
    // Jawaban yang datang setelah komponen berganti keadaan jangan dipakai.
    let batal = false;
    fetch("/api/stats?hari=20", { cache: "no-store" })
      .then(async (res) => {
        if (batal) return;
        if (res.ok) setStats((await res.json()) as UsageStats);
        else setPesan("Ringkasan pemakaian tidak bisa dimuat.");
      })
      .catch(() => {
        if (!batal) setPesan("Ringkasan pemakaian tidak bisa dimuat.");
      });
    return () => {
      batal = true;
    };
  }, [aktif]);

  if (!aktif) return null;
  if (pesan) return <p className="pb-4 text-[11px] text-faint">{pesan}</p>;
  if (!stats) return <p className="pb-4 text-[11px] text-faint">Memuat ringkasan pemakaian…</p>;

  const sel = "px-2.5 py-1.5 text-left align-top";

  return (
    <section className="pb-4" aria-labelledby="ringkasan-pemakaian">
      <h2
        id="ringkasan-pemakaian"
        className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted"
      >
        Pemakaian {stats.hari} hari terakhir
      </h2>

      {!stats.persistent && (
        <p role="alert" className="mb-2 text-[11px] text-rose">
          Penyimpanan tetap belum diisi — angka di bawah hanya dari memori
          server yang sedang menjawab.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl2 border border-line bg-surface">
        <table className="w-full min-w-[32rem] text-[11px] text-ink">
          <thead className="text-faint">
            <tr className="border-b border-line">
              <th scope="col" className={sel}>Pengguna</th>
              <th scope="col" className={`${sel} text-right`}>Lagu</th>
              <th scope="col" className={`${sel} text-right`}>Gagal</th>
              <th scope="col" className={sel}>Masuk terakhir</th>
              <th scope="col" className={sel}>Lagu terakhir</th>
            </tr>
          </thead>
          <tbody>
            {stats.baris.map((row) => (
              <tr key={row.sub} className="border-b border-line last:border-0">
                <td className={sel}>
                  <span className="font-medium text-ink">{row.nama || "—"}</span>
                  <span className="block text-faint">{row.email}</span>
                </td>
                <td className={`${sel} text-right tabular-nums font-semibold`}>{row.lagu}</td>
                <td className={`${sel} text-right tabular-nums text-faint`}>
                  {row.gagal || "—"}
                </td>
                <td className={`${sel} whitespace-nowrap text-muted`}>{wib(row.terakhirMasuk)}</td>
                <td className={`${sel} whitespace-nowrap text-muted`}>{wib(row.terakhirLagu)}</td>
              </tr>
            ))}
            {stats.baris.length === 0 && (
              <tr>
                <td className={`${sel} text-faint`} colSpan={5}>
                  Belum ada yang masuk atau membuat lagu dalam {stats.hari} hari terakhir.
                </td>
              </tr>
            )}
          </tbody>
          {stats.baris.length > 0 && (
            <tfoot className="border-t border-line text-faint">
              <tr>
                <td className={sel}>{stats.baris.length} pengguna</td>
                <td className={`${sel} text-right tabular-nums font-semibold text-ink`}>
                  {stats.totalLagu}
                </td>
                <td className={`${sel} text-right tabular-nums`}>{stats.totalGagal || "—"}</td>
                <td className={sel} colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-1.5 text-[11px] text-faint">
        Hanya terlihat oleh pengelola. Kolom lagu dihitung dari catatan
        pemakaian dalam rentang; &ldquo;masuk terakhir&rdquo; dan &ldquo;lagu
        terakhir&rdquo; adalah waktu sebenarnya dan bisa lebih tua dari rentang,
        karena sesi bertahan 30 hari.{" "}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- muat ulang penuh disengaja */}
        <a href="/admin" className="underline hover:text-muted">
          Rincian lengkap
        </a>
      </p>
    </section>
  );
}
