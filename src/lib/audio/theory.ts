/**
 * Teori musik secukupnya: nama nada, tangga nada, dan simbol akor.
 *
 * Berkas ini dipakai di dua sisi — server memakainya untuk memeriksa apakah
 * akor karangan model masuk akal, browser memakainya untuk mengubah derajat
 * tangga nada menjadi frekuensi. Karena itu tidak boleh ada kode khusus Node
 * maupun DOM di sini.
 */

import type { Mode } from "@/lib/types";

const SEMITONE: Record<string, number> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

/** Ubah nama nada ("A", "C#", "Eb") menjadi jarak semiton dari C. */
export function noteToSemitone(name: string): number | null {
  const m = /^([a-gA-G])([#b♯♭]*)$/.exec(name.trim());
  if (!m) return null;
  let value = SEMITONE[m[1]!.toLowerCase()]!;
  for (const ch of m[2] ?? "") {
    if (ch === "#" || ch === "♯") value += 1;
    else value -= 1;
  }
  return ((value % 12) + 12) % 12;
}

/** Nomor MIDI dari nama nada dan oktaf ("A", 4) -> 69. */
export function noteToMidi(name: string, octave: number): number {
  const semitone = noteToSemitone(name) ?? 0;
  return (octave + 1) * 12 + semitone;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export function midiToName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${SHARP_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

/** Jarak semiton tiap derajat, dihitung dari nada dasar. */
export const SCALE_STEPS: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  // Pendekatan 12-TET untuk laras Sunda/Jawa. Gamelan sebenarnya tidak
  // memakai temperamen ini, tapi inilah yang paling dekat di Web Audio.
  pelog: [0, 1, 3, 7, 8],
  slendro: [0, 2, 5, 7, 9],
};

/**
 * Derajat tangga nada -> jarak semiton dari nada dasar.
 * Derajat 1 adalah nada dasar; di luar satu oktaf akan melipat naik/turun,
 * jadi tangga nada lima nada pun tetap benar oktafnya.
 */
export function degreeToSemitone(degree: number, mode: Mode): number {
  const steps = SCALE_STEPS[mode] ?? SCALE_STEPS.major;
  const size = steps.length;
  const index = Math.round(degree) - 1;
  const octave = Math.floor(index / size);
  const within = ((index % size) + size) % size;
  return steps[within]! + octave * 12;
}

/** Nomor MIDI sebuah derajat pada nada dasar tertentu. */
export function degreeToMidi(
  degree: number,
  mode: Mode,
  rootMidi: number,
): number {
  return rootMidi + degreeToSemitone(degree, mode);
}

/* ---------------------------------------------------------------- akor --- */

const QUALITIES: Array<[string, number[]]> = [
  // Yang paling panjang diuji lebih dulu supaya "maj7" tidak terbaca "maj".
  ["m7b5", [0, 3, 6, 10]],
  ["mmaj7", [0, 3, 7, 11]],
  ["madd9", [0, 3, 7, 14]],
  ["7sus4", [0, 5, 7, 10]],
  ["7sus2", [0, 2, 7, 10]],
  ["maj13", [0, 4, 7, 11, 14, 21]],
  ["maj11", [0, 4, 7, 11, 14, 17]],
  ["dim7", [0, 3, 6, 9]],
  ["maj9", [0, 4, 7, 11, 14]],
  ["maj7", [0, 4, 7, 11]],
  ["add9", [0, 4, 7, 14]],
  ["sus2", [0, 2, 7]],
  ["sus4", [0, 5, 7]],
  ["m11", [0, 3, 7, 10, 14, 17]],
  ["m13", [0, 3, 7, 10, 14, 21]],
  ["dim", [0, 3, 6]],
  ["aug", [0, 4, 8]],
  ["m9", [0, 3, 7, 10, 14]],
  ["m7", [0, 3, 7, 10]],
  ["m6", [0, 3, 7, 9]],
  ["11", [0, 7, 10, 14, 17]],
  ["13", [0, 4, 7, 10, 14, 21]],
  ["m", [0, 3, 7]],
  ["9", [0, 4, 7, 10, 14]],
  ["7", [0, 4, 7, 10]],
  ["6", [0, 4, 7, 9]],
  ["5", [0, 7]],
  ["", [0, 4, 7]],
];

export type Chord = {
  symbol: string;
  /** Semiton nada dasar akor, 0-11. */
  root: number;
  /** Jarak semiton tiap nada akor dari nada dasarnya. */
  intervals: number[];
  /** Semiton nada bas kalau akornya bertanda garis miring, mis. "Am/G". */
  bass: number;
};

/** Samakan penulisan simbol akor sebelum diurai. */
function normalizeSuffix(raw: string): string {
  return raw
    .replace(/[Δ∆]/g, "maj7")
    .replace(/[øØ]/g, "m7b5")
    .replace(/[°o]/g, "dim")
    .replace(/\+/g, "aug")
    .replace(/[−–—]/g, "m")
    .replace(/\s+/g, "")
    .replace(/^-/, "m")
    .replace(/^maj$/i, "")
    .replace(/^M7$/, "maj7")
    .replace(/^M9$/, "maj9")
    .replace(/^min/i, "m")
    .replace(/^MIN/, "m")
    .replace(/^Maj/, "maj")
    .replace(/^MAJ/, "maj");
}

/** Urai simbol akor. Mengembalikan null kalau tidak dikenali. */
export function parseChord(symbol: string): Chord | null {
  const trimmed = String(symbol ?? "").trim();
  if (!trimmed) return null;

  const [main, bassPart] = trimmed.split("/");
  const m = /^([a-gA-G][#b♯♭]*)(.*)$/.exec(main!.trim());
  if (!m) return null;

  const root = noteToSemitone(m[1]!);
  if (root === null) return null;

  const suffix = normalizeSuffix(m[2] ?? "");
  const match = QUALITIES.find(([name]) =>
    name === "" ? suffix === "" : suffix.toLowerCase() === name.toLowerCase(),
  );
  // Simbol yang tidak persis cocok (mis. "C7b9") diturunkan ke akor terdekat
  // yang awalannya sama, jadi lagu tetap bisa dimainkan.
  const intervals =
    match?.[1] ??
    QUALITIES.find(
      ([name]) => name !== "" && suffix.toLowerCase().startsWith(name.toLowerCase()),
    )?.[1] ??
    [0, 4, 7];

  let bass = root;
  if (bassPart) {
    const parsed = noteToSemitone(bassPart.trim());
    if (parsed !== null) bass = parsed;
  }

  return { symbol: trimmed, root, intervals, bass };
}

/** Apakah simbol ini bisa dimainkan? Dipakai server untuk menyaring akor. */
export function isPlayableChord(symbol: string): boolean {
  return parseChord(symbol) !== null;
}

/**
 * Susun nada akor di sekitar satu titik pusat, dengan pembalikan yang
 * mendekati akor sebelumnya. Tanpa ini, tiap pergantian akor melompat
 * satu oktaf dan terdengar patah-patah.
 */
export function voiceChord(
  chord: Chord,
  centerMidi: number,
  previousTop?: number,
): number[] {
  const base = chord.intervals.map((interval) => {
    const pitchClass = (chord.root + interval) % 12;
    // Taruh tiap nada di oktaf terdekat dengan titik pusat.
    let midi = Math.round(centerMidi / 12) * 12 + pitchClass;
    while (midi - centerMidi > 6) midi -= 12;
    while (centerMidi - midi > 6) midi += 12;
    return midi;
  });

  // Nada tumpuk yang sama dihilangkan, lalu diurutkan naik.
  const unique = Array.from(new Set(base)).sort((a, b) => a - b);

  if (previousTop !== undefined && unique.length) {
    const top = unique[unique.length - 1]!;
    if (Math.abs(top - previousTop) > 7) {
      const shift = top > previousTop ? -12 : 12;
      return unique.map((n) => n + shift).sort((a, b) => a - b);
    }
  }
  return unique;
}

/** Nada bas untuk sebuah akor, di oktaf bas. */
export function bassMidi(chord: Chord, octave = 2): number {
  return (octave + 1) * 12 + chord.bass;
}
