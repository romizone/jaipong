"use client";

import { Download, Loader2, Pause, Play, Trash2 } from "lucide-react";
import { formatTime } from "@/components/player-bar";
import { isTrack, type LibraryItem } from "@/lib/types";

type Props = {
  song: LibraryItem;
  active: boolean;
  playing: boolean;
  exporting: boolean;
  onPlay: () => void;
  onDownload: () => void;
  onDelete: () => void;
};

export function SongCard({
  song,
  active,
  playing,
  exporting,
  onPlay,
  onDownload,
  onDelete,
}: Props) {
  return (
    <article
      className={`group relative flex items-center gap-3 rounded-xl2 border p-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-18px_rgba(0,0,0,0.9)] ${
        active
          ? "border-gold/50 bg-gold/8"
          : "border-line bg-surface hover:border-white/18"
      }`}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={playing ? `Jeda ${song.title}` : `Putar ${song.title}`}
        className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-gold/25 to-rose/25 text-ink transition group-hover:from-gold/40 group-hover:to-rose/40"
      >
        {playing ? (
          <>
            {/* Ekualiser saat berbunyi; ikon jeda muncul saat kartu disorot. */}
            <span className="flex items-end gap-[3px] group-hover:hidden" aria-hidden>
              <span className="eq-bar h-2.5 w-[3px] rounded-full bg-ink" />
              <span className="eq-bar h-4 w-[3px] rounded-full bg-ink" />
              <span className="eq-bar h-3 w-[3px] rounded-full bg-ink" />
            </span>
            <Pause size={18} className="hidden group-hover:block" aria-hidden />
          </>
        ) : (
          <Play size={18} className="ml-0.5" aria-hidden />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <h3 className={`truncate text-sm font-semibold ${active ? "text-gold-soft" : "text-ink"}`}>
          {song.title}
        </h3>
        <p className="mt-0.5 truncate text-xs text-muted">
          {song.genreLabel}
          {song.styleTags.length > 0 && ` · ${song.styleTags.slice(0, 3).join(", ")}`}
        </p>
        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-faint">
          {formatTime(song.durationSec)}
          {!isTrack(song) && ` · ${song.bpm} BPM`} ·{" "}
          {song.vocal === "none" ? "instrumental" : song.vocal === "male" ? "vokal pria" : "vokal wanita"}
        </p>
      </div>

      <div className="flex shrink-0 items-center">
        {/*
          Unduh ada di sini, bukan hanya di bilah pemutar. Bilah itu baru muncul
          setelah ada lagu yang diputar, jadi sehabis halaman dimuat ulang tidak
          ada satu pun jalan untuk mengunduh lagu yang sudah tersimpan.
        */}
        <button
          type="button"
          onClick={onDownload}
          disabled={exporting}
          title="Unduh audio"
          aria-label={`Unduh audio ${song.title}`}
          className="rounded-lg p-2 text-faint transition hover:bg-white/5 hover:text-gold-soft disabled:opacity-50"
        >
          {exporting ? (
            <Loader2 size={15} className="animate-spin" aria-hidden />
          ) : (
            <Download size={15} aria-hidden />
          )}
        </button>

        <button
          type="button"
          onClick={onDelete}
          aria-label={`Hapus ${song.title}`}
          className="rounded-lg p-2 text-faint transition hover:bg-white/5 hover:text-rose focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </div>
    </article>
  );
}
