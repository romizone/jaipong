"use client";

import { useEffect, useMemo, useRef } from "react";
import type { LineMark, SectionMark } from "@/lib/audio/timeline";
import { formatTime } from "@/components/player-bar";

type Props = {
  sections: SectionMark[];
  position: number;
  playing: boolean;
  onSeek: (seconds: number) => void;
};

/** Lirik yang ikut berjalan bersama lagu; baris yang sedang dinyanyikan disorot. */
export function LyricsPanel({ sections, position, playing, onSeek }: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Daftar rata beserta petanya dihitung sekali per lagu. Sebelumnya tiap
  // baris mencari posisinya sendiri dengan findIndex di dalam map — O(n²)
  // yang diulang tiap 120 milidetik, seiring posisi lagu berjalan.
  const { flat, indexOf } = useMemo(() => {
    const rows: Array<{ section: SectionMark; line: LineMark }> = [];
    const map = new Map<LineMark, number>();
    for (const section of sections) {
      for (const line of section.lines) {
        map.set(line, rows.length);
        rows.push({ section, line });
      }
    }
    return { flat: rows, indexOf: map };
  }, [sections]);

  // Baris yang sedang berbunyi = baris terakhir yang sudah dimulai. Dicari
  // lewat awal terbesar, bukan lewat baris sesudahnya, supaya tetap benar
  // kalau urutan barisnya tidak persis menaik.
  const activeIndex = useMemo(() => {
    let best = -1;
    let bestStart = -Infinity;
    for (let i = 0; i < flat.length; i += 1) {
      const start = flat[i]!.line.start;
      if (start <= position + 0.25 && start >= bestStart) {
        bestStart = start;
        best = i;
      }
    }
    return best;
  }, [flat, position]);

  useEffect(() => {
    if (!playing) return;
    const node = activeRef.current;
    const container = scrollRef.current;
    if (!node || !container) return;

    // Jaga baris aktif tetap di tengah panel, tanpa menggeser seluruh halaman.
    const target =
      node.offsetTop - container.clientHeight / 2 + node.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeIndex, playing]);

  if (!sections.length) return null;

  const hasLyrics = flat.some(({ line }) => line.text.trim());

  return (
    <div
      ref={scrollRef}
      className="fade-y max-h-[52vh] overflow-y-auto rounded-xl2 border border-line bg-surface p-5 pb-8 sm:p-6 sm:pb-9"
    >
      {!hasLyrics && (
        <p className="text-sm text-muted">
          Lagu instrumental — tidak ada lirik untuk ditampilkan.
        </p>
      )}

      {sections.map((section) => (
        <section key={`${section.id}-${section.start}`} className="mb-6 last:mb-0">
          <button
            type="button"
            onClick={() => onSeek(section.start)}
            className="mb-2 flex items-baseline gap-2 text-left"
          >
            <span className="rounded-md bg-gold/12 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gold-soft">
              {section.label}
            </span>
            <span className="font-mono text-[11px] text-faint">
              {formatTime(section.start)}
            </span>
          </button>

          <div className="space-y-1">
            {section.lines
              .filter((line) => line.text.trim())
              .map((line, index) => {
                const lineIndex = indexOf.get(line) ?? -1;
                const active = lineIndex === activeIndex;
                // Gaya karaoke tiga tingkat: baris yang sudah lewat meredup,
                // baris aktif menyala dan sedikit membesar, baris berikutnya
                // menunggu di tingkat tengah.
                const sung = activeIndex >= 0 && lineIndex < activeIndex;
                return (
                  <button
                    key={`${section.id}-${index}`}
                    ref={active ? activeRef : undefined}
                    type="button"
                    onClick={() => onSeek(line.start)}
                    className={`block w-full text-left leading-relaxed transition-all duration-300 ${
                      active
                        ? "text-[17px] font-semibold text-gold-soft"
                        : sung
                          ? "text-[15px] text-faint hover:text-muted"
                          : "text-[15px] text-muted hover:text-ink"
                    }`}
                  >
                    {line.text}
                  </button>
                );
              })}
            {/* Penanda per bagian hanya untuk lagu campuran; lagu yang
                sepenuhnya instrumental sudah dijelaskan di atas. */}
            {hasLyrics && !section.lines.some((line) => line.text.trim()) && (
              <p className="text-sm italic text-faint">instrumental</p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
