"use client";

import { Pause, Play, Trash2 } from "lucide-react";
import { formatTime } from "@/components/player-bar";
import type { Song } from "@/lib/types";

type Props = {
  song: Song;
  active: boolean;
  playing: boolean;
  onPlay: () => void;
  onDelete: () => void;
};

export function SongCard({ song, active, playing, onPlay, onDelete }: Props) {
  return (
    <article
      className={`group relative flex items-center gap-3 rounded-xl2 border p-3 transition ${
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
          <Pause size={18} aria-hidden />
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
        <p className="mt-0.5 font-mono text-[11px] text-faint">
          {formatTime(song.durationSec)} · {song.bpm} BPM ·{" "}
          {song.vocal === "none" ? "instrumental" : song.vocal === "male" ? "vokal pria" : "vokal wanita"}
        </p>
      </div>

      <button
        type="button"
        onClick={onDelete}
        aria-label={`Hapus ${song.title}`}
        className="shrink-0 rounded-lg p-2 text-faint opacity-0 transition hover:bg-white/5 hover:text-rose focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 size={15} aria-hidden />
      </button>
    </article>
  );
}
