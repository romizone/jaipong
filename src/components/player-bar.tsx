"use client";

import {
  Download,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Volume2,
} from "lucide-react";
import { Visualizer } from "@/components/visualizer";
import type { PlayerState } from "@/lib/audio/engine";
import type { Song } from "@/lib/types";

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

type Props = {
  song: Song | null;
  state: PlayerState;
  position: number;
  duration: number;
  volume: number;
  singing: boolean;
  exporting: boolean;
  getAnalyser: () => AnalyserNode | null;
  onToggle: () => void;
  onRestart: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (value: number) => void;
  onToggleSinging: () => void;
  onDownload: () => void;
};

export function PlayerBar({
  song,
  state,
  position,
  duration,
  volume,
  singing,
  exporting,
  getAnalyser,
  onToggle,
  onRestart,
  onSeek,
  onVolume,
  onToggleSinging,
  onDownload,
}: Props) {
  if (!song) return null;

  const playing = state === "playing";
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-night/85 backdrop-blur-xl">
      <div className="relative mx-auto max-w-6xl px-3 pb-3 pt-2 sm:px-5">
        <Visualizer
          getAnalyser={getAnalyser}
          active={playing}
          className="pointer-events-none absolute inset-x-3 bottom-0 h-14 w-[calc(100%-1.5rem)] opacity-25 sm:inset-x-5 sm:w-[calc(100%-2.5rem)]"
        />

        <div className="relative flex items-center gap-3">
          <button
            type="button"
            onClick={onToggle}
            aria-label={playing ? "Jeda" : "Putar"}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold to-rose text-night transition hover:brightness-110"
          >
            {playing ? <Pause size={19} aria-hidden /> : <Play size={19} className="ml-0.5" aria-hidden />}
          </button>

          <button
            type="button"
            onClick={onRestart}
            aria-label="Ulang dari awal"
            className="hidden size-9 shrink-0 items-center justify-center rounded-full border border-line text-muted transition hover:text-ink sm:flex"
          >
            <RotateCcw size={15} aria-hidden />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <p className="truncate text-sm font-semibold text-ink">{song.title}</p>
              <p className="hidden truncate text-xs text-faint sm:block">
                {song.genreLabel} · {song.bpm} BPM · {song.key} {modeLabel(song.mode)}
              </p>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <span className="w-9 shrink-0 text-right font-mono text-[11px] text-faint">
                {formatTime(position)}
              </span>

              <div className="relative h-1.5 flex-1">
                <div className="absolute inset-0 rounded-full bg-white/10" />
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold to-rose"
                  style={{ width: `${progress * 100}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, duration)}
                  step={0.1}
                  value={Math.min(position, duration)}
                  onChange={(e) => onSeek(Number(e.target.value))}
                  aria-label="Posisi lagu"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </div>

              <span className="w-9 shrink-0 font-mono text-[11px] text-faint">
                {formatTime(duration)}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {song.vocal !== "none" && (
              <button
                type="button"
                onClick={onToggleSinging}
                aria-pressed={singing}
                title={singing ? "Matikan suara penyanyi" : "Nyalakan suara penyanyi"}
                className={`flex size-9 items-center justify-center rounded-full border transition ${
                  singing
                    ? "border-gold/60 bg-gold/15 text-gold-soft"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {singing ? <Mic size={15} aria-hidden /> : <MicOff size={15} aria-hidden />}
              </button>
            )}

            <div className="hidden items-center gap-1.5 md:flex">
              <Volume2 size={15} className="text-faint" aria-hidden />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => onVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1 w-20 cursor-pointer accent-gold"
              />
            </div>

            <button
              type="button"
              onClick={onDownload}
              disabled={exporting}
              title="Unduh sebagai WAV"
              aria-label="Unduh sebagai WAV"
              className="flex size-9 items-center justify-center rounded-full border border-line text-muted transition hover:text-ink disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 size={15} className="animate-spin" aria-hidden />
              ) : (
                <Download size={15} aria-hidden />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function modeLabel(mode: string): string {
  const names: Record<string, string> = {
    major: "mayor",
    minor: "minor",
    harmonic_minor: "minor harmonis",
    dorian: "dorian",
    mixolydian: "mixolydian",
    lydian: "lydian",
    phrygian: "phrygian",
    pentatonic_major: "pentatonis mayor",
    pentatonic_minor: "pentatonis minor",
    blues: "blues",
    pelog: "pélog",
    slendro: "sléndro",
  };
  return names[mode] ?? mode;
}
