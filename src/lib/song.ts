import { LIMITS } from "@/lib/config";
import { degreeToSemitone, isPlayableChord, parseChord } from "@/lib/audio/theory";
import {
  ARP_VOICES,
  BASS_VOICES,
  CHORD_VOICES,
  GROOVES,
  LEAD_VOICES,
  MODES,
  SECTION_TYPES,
  type ArpVoice,
  type BassVoice,
  type ChordVoice,
  type Groove,
  type LeadVoice,
  type Line,
  type Mode,
  type Note,
  type Section,
  type SectionType,
  type Song,
  type VocalType,
} from "@/lib/types";

export const BEATS_PER_BAR = 4;

/* ------------------------------------------------------- ambil JSON-nya --- */

/**
 * Model kadang membungkus JSON dengan pagar kode atau kalimat pengantar,
 * dan kalau kehabisan token bisa berhenti di tengah. Fungsi ini mengambil
 * objek terluar dan, kalau perlu, menutup kurung yang masih menggantung.
 */
export function extractJson(raw: string): unknown {
  let text = raw.trim();

  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1]!.trim();

  const start = text.indexOf("{");
  if (start === -1) return null;
  text = text.slice(start);

  try {
    return JSON.parse(text);
  } catch {
    // Lanjut ke perbaikan di bawah.
  }

  const repaired = repairTruncated(text);
  if (repaired) {
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
  return null;
}

/** Tutup string, larik, dan objek yang belum sempat ditutup model. */
function repairTruncated(text: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastComplete = -1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (!stack.length) return text.slice(0, i + 1);
    }
    // Titik tempat elemen terakhir selesai — potongan setelah ini biasanya
    // separuh jadi, jadi lebih aman dibuang.
    if (!stack.length) continue;
    if (ch === "}" || ch === "]") lastComplete = i;
  }

  if (!stack.length) return null;

  let body = lastComplete > 0 ? text.slice(0, lastComplete + 1) : text;
  if (inString) body += '"';
  body = body.replace(/,\s*$/, "");

  // Hitung ulang tumpukan pada potongan yang dipakai, lalu tutup terbalik.
  const closing: string[] = [];
  let s = false;
  let e = false;
  for (const ch of body) {
    if (s) {
      if (e) e = false;
      else if (ch === "\\") e = true;
      else if (ch === '"') s = false;
      continue;
    }
    if (ch === '"') s = true;
    else if (ch === "{") closing.push("}");
    else if (ch === "[") closing.push("]");
    else if (ch === "}" || ch === "]") closing.pop();
  }
  if (s) body += '"';
  body = body.replace(/,\s*$/, "");

  return body + closing.reverse().join("");
}

/* ------------------------------------------------------------- bantuan --- */

function str(value: unknown, fallback: string, max = 200): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
}

/** Bulatkan ke kelipatan 1/16 ketukan supaya ritme tetap rapi. */
function quantize(beats: number): number {
  return Math.round(beats * 4) / 4;
}

/**
 * Pemenggal suku kata sederhana untuk bahasa Indonesia — hanya dipakai
 * sebagai cadangan kalau model tidak memecah lirik sendiri.
 */
export function syllables(word: string): string[] {
  const clean = word.replace(/[^A-Za-zÀ-ÿ']/g, "");
  if (!clean) return [];

  const vowels = "aeiouAEIOU";
  const out: string[] = [];
  let current = "";
  let seenVowel = false;

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]!;
    const isVowel = vowels.includes(ch);

    if (isVowel) {
      if (seenVowel) {
        // Vokal baru: potong sebelum konsonan terakhir kalau ada (pola VC-V).
        const tail = /[^aeiouAEIOU]+$/.exec(current);
        if (tail && tail[0].length >= 1) {
          const digraph = /(ng|ny|kh|sy)$/i.test(tail[0]);
          const keep = digraph && tail[0].length === 2 ? 2 : 1;
          const cut = current.length - Math.min(keep, tail[0].length);
          out.push(current.slice(0, cut));
          current = current.slice(cut);
        } else {
          out.push(current);
          current = "";
        }
      }
      seenVowel = true;
    }
    current += ch;
  }

  if (current) {
    if (!seenVowel && out.length) out[out.length - 1] += current;
    else out.push(current);
  }
  return out.filter(Boolean);
}

function lineSyllables(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      const parts = syllables(word);
      return parts.length ? parts : [word];
    });
}

/* -------------------------------------------------------- normalisasi ---- */

function normalizeNotes(raw: unknown, sectionBeats: number): Note[] {
  if (!Array.isArray(raw)) return [];

  const notes: Note[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const n = item as Record<string, unknown>;

    // Terima bentuk panjang maupun singkat.
    const degree = numberOr(n.d ?? n.degree, NaN);
    const start = numberOr(n.t ?? n.start ?? n.beat, NaN);
    const length = numberOr(n.l ?? n.len ?? n.duration, 1);
    if (!Number.isFinite(degree) || !Number.isFinite(start)) continue;

    const t = quantize(clamp(start, 0, Math.max(0, sectionBeats - 0.25)));
    const l = quantize(clamp(length, 0.25, 8));
    if (t + l > sectionBeats + 0.001) {
      const trimmed = quantize(sectionBeats - t);
      if (trimmed < 0.25) continue;
      notes.push({
        d: clamp(Math.round(degree), -12, 21),
        t,
        l: trimmed,
        s: typeof n.s === "string" ? n.s.trim() : undefined,
      });
      continue;
    }

    notes.push({
      d: clamp(Math.round(degree), -12, 21),
      t,
      l,
      s: typeof n.s === "string" ? n.s.trim() : undefined,
    });
  }

  notes.sort((a, b) => a.t - b.t);

  // Nada yang tumpang tindih dipotong supaya vokal tidak terdengar bertumpuk.
  for (let i = 0; i < notes.length - 1; i += 1) {
    const next = notes[i + 1]!;
    const current = notes[i]!;
    if (current.t + current.l > next.t) {
      current.l = Math.max(0.25, quantize(next.t - current.t));
    }
  }
  return notes.filter((n) => n.l >= 0.25);
}

/**
 * Buat melodi cadangan untuk baris lirik yang tidak diberi nada oleh model.
 * Nada mengikuti nada akor yang sedang berbunyi, jadi selalu masuk kunci.
 */
function fallbackMelody(
  text: string,
  startBeat: number,
  availableBeats: number,
  chords: string[],
  mode: Mode,
  seed: number,
): Note[] {
  const parts = lineSyllables(text);
  if (!parts.length || availableBeats < 1) return [];

  // Sisakan sekitar seperempat waktu di akhir baris untuk bernapas.
  const singBeats = Math.max(1, availableBeats * 0.78);
  const step = quantize(Math.max(0.25, singBeats / parts.length));

  // Cari derajat tangga nada yang paling dekat dengan tiap nada akor.
  const degreeFor = (semitone: number): number => {
    let best = 1;
    let bestDistance = 99;
    for (let d = 1; d <= 12; d += 1) {
      const distance = Math.abs(
        ((degreeToSemitone(d, mode) - semitone) % 12 + 12) % 12,
      );
      const folded = Math.min(distance, 12 - distance);
      if (folded < bestDistance) {
        bestDistance = folded;
        best = d;
      }
    }
    return best;
  };

  const contour = [0, 1, 2, 1, 3, 2, 1, 0];
  const notes: Note[] = [];

  parts.forEach((syllable, index) => {
    const t = quantize(startBeat + index * step);
    const bar = Math.floor(t / BEATS_PER_BAR) % Math.max(1, chords.length);
    const chord = parseChord(chords[bar] ?? chords[0] ?? "C");
    const tone = chord ? chord.intervals[index % chord.intervals.length]! : 0;
    const base = chord ? degreeFor((chord.root + tone) % 12) : 1;
    const lift = contour[(index + seed) % contour.length]!;
    notes.push({
      d: clamp(base + lift, 1, 12),
      t,
      l: step,
      s: syllable,
    });
  });

  return notes;
}

function normalizeLines(
  raw: unknown,
  sectionBeats: number,
  chords: string[],
  mode: Mode,
  index: number,
): Line[] {
  const source = Array.isArray(raw) ? raw : [];
  const lines: Line[] = [];

  for (const item of source) {
    if (!item) continue;

    // Baris boleh ditulis sebagai string biasa; melodinya dibuatkan nanti.
    if (typeof item === "string") {
      lines.push({ text: item.trim().slice(0, 300), notes: [] });
      continue;
    }
    if (typeof item !== "object") continue;

    const l = item as Record<string, unknown>;
    const notes = normalizeNotes(l.notes ?? l.melody, sectionBeats);
    let text = typeof l.text === "string" ? l.text.trim() : "";

    // Kalau liriknya hilang tapi suku katanya ada, rangkai ulang dari nada.
    if (!text && notes.some((n) => n.s)) {
      text = notes
        .map((n) => n.s ?? "")
        .join("")
        .trim();
    }
    lines.push({ text: text.slice(0, 300), notes });
  }

  // Baris berlirik yang belum punya nada diberi melodi cadangan pada
  // sisa waktu yang belum terpakai.
  const needsMelody = lines.filter((l) => l.text && !l.notes.length);
  if (needsMelody.length) {
    const used = lines.flatMap((l) => l.notes);
    const busyUntil = used.length
      ? Math.max(...used.map((n) => n.t + n.l))
      : 0;
    const free = Math.max(0, sectionBeats - busyUntil);
    const slot = free / needsMelody.length;

    if (slot >= 1) {
      needsMelody.forEach((line, i) => {
        line.notes = fallbackMelody(
          line.text,
          busyUntil + i * slot,
          slot,
          chords,
          mode,
          index + i,
        );
      });
    } else {
      // Tidak ada ruang tersisa — biarkan liriknya tampil tanpa dinyanyikan.
      needsMelody.forEach((line) => {
        line.notes = [];
      });
    }
  }

  return lines.filter((l) => l.text || l.notes.length);
}

function normalizeChords(raw: unknown, bars: number, key: string): string[] {
  const source = Array.isArray(raw) ? raw : [];
  const valid = source
    .map((c) => String(c ?? "").trim())
    .filter((c) => c && isPlayableChord(c));

  if (!valid.length) {
    // Tanpa akor yang bisa dibaca, tahan di nada dasar saja.
    return Array.from({ length: bars }, () => key);
  }
  // Ulang atau potong supaya persis satu akor per birama.
  return Array.from({ length: bars }, (_, i) => valid[i % valid.length]!);
}

function normalizeSection(
  raw: unknown,
  index: number,
  key: string,
  mode: Mode,
): Section | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;

  const bars = Math.round(
    clamp(numberOr(s.bars, 8), 1, LIMITS.maxBarsPerSection),
  );
  const type = pick<SectionType>(s.type, SECTION_TYPES, "verse");
  const chords = normalizeChords(s.chords, bars, key);
  const lines = normalizeLines(
    s.lines,
    bars * BEATS_PER_BAR,
    chords,
    mode,
    index,
  );

  return {
    id: str(s.id, `sec${index + 1}`, 40),
    type,
    label: str(s.label, defaultLabel(type, index), 40),
    bars,
    energy: clamp(numberOr(s.energy, 0.6), 0.15, 1),
    chords,
    lines,
  };
}

function defaultLabel(type: SectionType, index: number): string {
  const names: Record<SectionType, string> = {
    intro: "Intro",
    verse: "Verse",
    prechorus: "Pre-Chorus",
    chorus: "Reff",
    bridge: "Bridge",
    solo: "Solo",
    outro: "Outro",
  };
  return `${names[type]} ${index + 1}`;
}

/* ------------------------------------------------------------ durasi ----- */

export function sectionSeconds(bars: number, bpm: number): number {
  return (bars * BEATS_PER_BAR * 60) / bpm;
}

export function songSeconds(song: Pick<Song, "sections" | "bpm">): number {
  return song.sections.reduce(
    (total, s) => total + sectionSeconds(s.bars, song.bpm),
    0,
  );
}

/**
 * Dekatkan durasi ke target. Model biasanya sudah mendekati, jadi ini hanya
 * bertindak kalau melesetnya besar: reff diulang kalau kependekan, bagian
 * tengah dibuang kalau kepanjangan.
 */
function fitDuration(sections: Section[], bpm: number, target: number): Section[] {
  const result = [...sections];
  const total = () =>
    result.reduce((n, s) => n + sectionSeconds(s.bars, bpm), 0);

  let guard = 0;
  while (
    total() < target - 12 &&
    result.length < LIMITS.maxSections &&
    guard < 8
  ) {
    guard += 1;
    const chorus = [...result].reverse().find((s) => s.type === "chorus");
    const source = chorus ?? result[Math.max(0, result.length - 2)];
    if (!source) break;

    const copy: Section = {
      ...source,
      id: `${source.id}-r${guard}`,
      label: source.label,
      lines: source.lines.map((l) => ({ ...l, notes: l.notes.map((n) => ({ ...n })) })),
      chords: [...source.chords],
    };
    const outroAt = result.findIndex((s) => s.type === "outro");
    if (outroAt > 0) result.splice(outroAt, 0, copy);
    else result.push(copy);
  }

  guard = 0;
  while (total() > target + 20 && result.length > 3 && guard < 8) {
    guard += 1;
    // Buang bagian tengah yang paling tidak penting, jangan intro/outro.
    const removable = result
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => i > 0 && i < result.length - 1 && s.type !== "chorus");
    const victim = removable[removable.length - 1] ?? { i: result.length - 2 };
    result.splice(victim.i, 1);
  }

  return result;
}

/* ------------------------------------------------------------- gerbang --- */

export type NormalizeOptions = {
  targetDuration: number;
  instrumental: boolean;
  vocalHint: VocalType;
};

/**
 * Ubah JSON mentah dari model menjadi lagu yang pasti bisa dimainkan.
 * Semua nilai dijepit ke rentang aman, dan setiap kekurangan diberi
 * nilai cadangan — jadi fungsi ini tidak pernah melempar kesalahan.
 */
export function normalizeSong(raw: unknown, options: NormalizeOptions): Song | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const rawSections = Array.isArray(r.sections) ? r.sections : [];
  if (!rawSections.length) return null;

  const key = normalizeKey(r.key);
  const mode = pick<Mode>(r.mode, MODES, "minor");
  const bpm = Math.round(clamp(numberOr(r.bpm, 100), 50, 200));

  let sections = rawSections
    .slice(0, LIMITS.maxSections)
    .map((s, i) => normalizeSection(s, i, key, mode))
    .filter((s): s is Section => s !== null);

  if (!sections.length) return null;

  sections = fitDuration(sections, bpm, options.targetDuration);

  // Pagar terakhir: batasi jumlah nada seluruh lagu.
  let budget = LIMITS.maxNotesPerSong;
  for (const section of sections) {
    for (const line of section.lines) {
      if (budget <= 0) {
        line.notes = [];
        continue;
      }
      if (line.notes.length > budget) line.notes = line.notes.slice(0, budget);
      budget -= line.notes.length;
    }
  }

  const instruments = r.instruments as Record<string, unknown> | undefined;
  const vocal: VocalType = options.instrumental
    ? "none"
    : pick<VocalType>(r.vocal, ["male", "female", "none"], options.vocalHint);

  // Lagu instrumental tidak boleh menyisakan suku kata.
  if (vocal === "none" && options.instrumental) {
    for (const section of sections) {
      for (const line of section.lines) {
        line.notes = line.notes.map((n) => ({ d: n.d, t: n.t, l: n.l }));
      }
    }
  }

  const song: Song = {
    id: newId(),
    title: str(r.title, "Tanpa Judul", 90),
    genreLabel: str(r.genreLabel ?? r.genre, "Original", 60),
    styleTags: Array.isArray(r.styleTags)
      ? r.styleTags
          .map((t) => String(t ?? "").trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 8)
      : [],
    bpm,
    key,
    mode,
    groove: pick<Groove>(r.groove, GROOVES, "pop"),
    vocal,
    instruments: {
      lead: pick<LeadVoice>(
        instruments?.lead,
        LEAD_VOICES,
        vocal === "none" ? "lead_synth" : "vocal",
      ),
      chords: pick<ChordVoice>(instruments?.chords, CHORD_VOICES, "pad"),
      bass: pick<BassVoice>(instruments?.bass, BASS_VOICES, "bass_round"),
      arp: pick<ArpVoice>(instruments?.arp, ARP_VOICES, "pluck"),
    },
    sections,
    durationSec: 0,
    createdAt: Date.now(),
  };

  song.durationSec = songSeconds(song);
  return song;
}

function normalizeKey(raw: unknown): string {
  const text = String(raw ?? "").trim();
  // Terima "A minor" atau "Bb" — nama modenya diambil dari field lain.
  const m = /^([a-gA-G][#b♯♭]?)/.exec(text);
  if (!m) return "A";
  return m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).replace("♯", "#").replace("♭", "b");
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
