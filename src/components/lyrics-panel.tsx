"use client";

import { useEffect, useRef } from "react";
import type { SectionMark } from "@/lib/audio/timeline";
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

  const flat = sections.flatMap((section) =>
    section.lines.map((line) => ({ section, line })),
  );
  const activeIndex = flat.findIndex(
    ({ line }, index) =>
      position >= line.start - 0.25 &&
      (index === flat.length - 1 || position < flat[index + 1]!.line.start - 0.25),
  );

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
      className="max-h-[52vh] overflow-y-auto rounded-xl2 border border-line bg-surface p-5 sm:p-6"
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
                const flatIndex = flat.findIndex(
                  (item) => item.line === line && item.section === section,
                );
                const active = flatIndex === activeIndex;
                return (
                  <button
                    key={`${section.id}-${index}`}
                    ref={active ? activeRef : undefined}
                    type="button"
                    onClick={() => onSeek(line.start)}
                    className={`block w-full text-left text-[15px] leading-relaxed transition ${
                      active
                        ? "font-semibold text-gold-soft"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {line.text}
                  </button>
                );
              })}
            {!section.lines.some((line) => line.text.trim()) && (
              <p className="text-sm italic text-faint">instrumental</p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
