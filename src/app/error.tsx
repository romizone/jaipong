"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * Jaring pengaman terakhir. Tanpa ini, satu kesalahan saat membangun timeline —
 * misalnya dari lagu tersimpan yang bentuknya rusak — membuat seluruh halaman
 * jadi putih tanpa penjelasan apa pun.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[jaipong]", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl2 border border-rose/40 bg-rose/10">
        <AlertTriangle size={20} className="text-rose" aria-hidden />
      </span>

      <h1 className="mt-4 text-lg font-bold tracking-tight text-ink">
        Ada yang tersendat
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Halaman studio gagal ditampilkan. Coba muat ulang — pustaka lagumu tetap
        tersimpan di browser ini.
      </p>

      <button
        type="button"
        onClick={reset}
        className="mt-5 flex items-center gap-2 rounded-xl bg-gradient-to-r from-gold to-rose px-4 py-2.5 text-sm font-semibold text-night transition hover:brightness-110"
      >
        <RotateCcw size={15} aria-hidden />
        Coba lagi
      </button>
    </main>
  );
}
