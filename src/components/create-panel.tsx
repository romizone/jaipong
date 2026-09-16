"use client";

import { useState } from "react";
import { Loader2, Music4, Sparkles, Wand2 } from "lucide-react";
import type { ComposeRequest, VocalType } from "@/lib/types";

const PRESETS: Array<{ label: string; tags: string }> = [
  { label: "Pop Indonesia", tags: "pop indonesia, manis, gitar akustik" },
  { label: "Dangdut Koplo", tags: "dangdut koplo, kendang, suling, gembira" },
  { label: "Jaipong Sunda", tags: "jaipong, kendang sunda, suling, laras pelog" },
  { label: "Keroncong", tags: "keroncong, ukulele, cello, syahdu" },
  { label: "Gamelan Ambient", tags: "gamelan, slendro, tenang, meditatif" },
  { label: "Balada Galau", tags: "balada, piano, sendu, patah hati" },
  { label: "Rock Anthem", tags: "rock, gitar distorsi, drum keras, semangat" },
  { label: "Lo-fi Santai", tags: "lo-fi, chill, piano elektrik, hujan" },
  { label: "EDM Festival", tags: "edm, sintesizer, drop, energik" },
  { label: "Reggae Pantai", tags: "reggae, santai, offbeat, pantai" },
  { label: "Jazz Kafe", tags: "jazz, akor tujuh, piano elektrik, hangat" },
  { label: "Sinematik", tags: "sinematik, orkestra, megah, string" },
];

/** Contoh sekali klik untuk pengguna yang belum tahu harus menulis apa. */
const EXAMPLES = [
  "Jaipong riang tentang hujan pertama di Bandung",
  "Balada piano sendu tentang rindu rumah",
  "Dangdut koplo penyemangat kerja pagi",
];

/**
 * Semua lagu dibuat 2,5 menit. Pemilih durasi dihapus: model musik dibayar
 * per lagu, bukan per detik, jadi durasi pendek tidak lebih murah — dan
 * 2,5 menit cukup untuk dua verse, chorus berulang, dan bridge.
 */
const DURATION_SEC = 150;

type Props = {
  busy: boolean;
  onSubmit: (request: ComposeRequest) => void;
  onCancel: () => void;
};

export function CreatePanel({ busy, onSubmit, onCancel }: Props) {
  const [prompt, setPrompt] = useState("");
  const [custom, setCustom] = useState(false);
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [styleTags, setStyleTags] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [vocal, setVocal] = useState<VocalType>("female");

  const canSubmit =
    !busy && (prompt.trim().length > 0 || lyrics.trim().length > 0 || styleTags.trim().length > 0);

  /** Pecah isian gaya menjadi kata kunci satuan. */
  function parseTags(raw: string): string[] {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  // Cocokkan per kata kunci utuh — kalau memakai pencocokan potongan teks,
  // "kendang sunda" akan ikut menyalakan preset yang hanya minta "kendang".
  const selected = parseTags(styleTags);

  function togglePreset(tags: string) {
    setStyleTags((current) => {
      const parts = parseTags(current);
      const incoming = parseTags(tags);
      const has = incoming.every((t) => parts.includes(t));
      const next = has
        ? parts.filter((t) => !incoming.includes(t))
        : [...parts, ...incoming.filter((t) => !parts.includes(t))];
      return next.join(", ");
    });
  }

  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      prompt: prompt.trim(),
      title: custom ? title.trim() : undefined,
      lyrics: custom ? lyrics.trim() : undefined,
      styleTags: styleTags.trim(),
      instrumental,
      vocal: instrumental ? "none" : vocal,
      duration: DURATION_SEC,
    });
  }

  return (
    <form onSubmit={submit} className="panel rounded-xl2 p-5 sm:p-6">
      <div className="flex items-center gap-2 text-sm font-semibold text-gold">
        <Sparkles size={16} aria-hidden />
        Bikin Lagu
      </div>

      <label htmlFor="prompt" className="mt-4 block text-sm font-medium text-ink">
        Lagu seperti apa yang kamu bayangkan?
      </label>
      <textarea
        id="prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          // Pintasan baku aplikasi tulis: Ctrl/Cmd+Enter langsung membuat.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={4}
        maxLength={2000}
        placeholder="Lagu dangdut riang tentang pulang kampung naik kereta malam, ada suling dan kendang."
        className="mt-2 w-full resize-y rounded-xl border border-line bg-night-2/70 px-3.5 py-3 text-[15px] leading-relaxed text-ink transition placeholder:text-faint focus:border-gold/50 focus:outline-none focus:ring-2 focus:ring-gold/20"
      />

      {!prompt.trim() && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-faint">Contoh:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setPrompt(example)}
              className="rounded-full border border-dashed border-line px-2.5 py-1 text-[11px] text-faint transition hover:border-gold/40 hover:text-muted"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-ink">Gaya musik</legend>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => {
            const active = parseTags(preset.tags).every((t) => selected.includes(t));
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => togglePreset(preset.tags)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "border-gold/70 bg-gold/15 text-gold-soft"
                    : "border-line bg-surface text-muted hover:border-white/20 hover:text-ink"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5">
        <span className="block text-sm font-medium text-ink">Vokal</span>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl border border-line bg-night-2/70 p-1">
          {(
            [
              ["female", "Wanita"],
              ["male", "Pria"],
              ["none", "Instrumen"],
            ] as const
          ).map(([value, label]) => {
            const active = value === "none" ? instrumental : !instrumental && vocal === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => {
                  if (value === "none") {
                    setInstrumental(true);
                  } else {
                    setInstrumental(false);
                    setVocal(value);
                  }
                }}
                aria-pressed={active}
                className={`rounded-lg px-2 py-2 text-xs font-medium transition ${
                  active ? "bg-gold text-night" : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setCustom((v) => !v)}
        aria-expanded={custom}
        className="mt-5 flex w-full items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-muted transition hover:text-ink"
      >
        <span className="flex items-center gap-2">
          <Wand2 size={15} aria-hidden />
          Mode kustom — tulis judul, gaya, dan lirik sendiri
        </span>
        <span className="text-xs text-faint">{custom ? "Tutup" : "Buka"}</span>
      </button>

      {custom && (
        <div className="animate-rise mt-3 space-y-3">
          <div>
            <label htmlFor="title" className="block text-xs font-medium text-muted">
              Judul
            </label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={90}
              placeholder="Senja di Ciwidey"
              className="mt-1.5 w-full rounded-xl border border-line bg-night-2/70 px-3.5 py-2.5 text-sm text-ink transition placeholder:text-faint focus:border-gold/50 focus:outline-none focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <div>
            <label htmlFor="tags" className="block text-xs font-medium text-muted">
              Gaya musik (pisahkan dengan koma)
            </label>
            <input
              id="tags"
              value={styleTags}
              onChange={(e) => setStyleTags(e.target.value)}
              maxLength={300}
              placeholder="jaipong, kendang, suling, riang"
              className="mt-1.5 w-full rounded-xl border border-line bg-night-2/70 px-3.5 py-2.5 text-sm text-ink transition placeholder:text-faint focus:border-gold/50 focus:outline-none focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <div>
            <label htmlFor="lyrics" className="block text-xs font-medium text-muted">
              Lirik — kosongkan kalau mau ditulis AI
            </label>
            <textarea
              id="lyrics"
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              rows={7}
              maxLength={6000}
              placeholder={"[Verse]\nSenja turun di Ciwidey\nKabut tipis di jendela\n\n[Reff]\nPulanglah, pulanglah"}
              className="mt-1.5 w-full resize-y rounded-xl border border-line bg-night-2/70 px-3.5 py-2.5 font-mono text-[13px] leading-relaxed text-ink transition placeholder:text-faint focus:border-gold/50 focus:outline-none focus:ring-2 focus:ring-gold/20"
            />
          </div>
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-gold to-rose px-4 py-3 text-sm font-semibold text-night shadow-[0_8px_24px_-10px_rgba(233,166,60,0.55)] transition hover:brightness-110 hover:shadow-[0_10px_28px_-10px_rgba(233,166,60,0.7)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {busy ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden />
              Menyusun…
            </>
          ) : (
            <>
              <Music4 size={16} aria-hidden />
              Bikin Lagu
            </>
          )}
        </button>
        {busy && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-line px-4 py-3 text-sm font-medium text-muted transition hover:text-ink"
          >
            Batal
          </button>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        Lirik ditulis AI, lalu audionya dibangkitkan model musik. Tulis lagu
        orisinal — jangan menempelkan lirik milik orang lain.{" "}
        <span className="whitespace-nowrap text-faint/80">
          Pintasan: Ctrl/⌘ + Enter.
        </span>
      </p>
    </form>
  );
}
