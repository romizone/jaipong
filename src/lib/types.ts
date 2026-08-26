/**
 * Bentuk data lagu yang dipakai bersama oleh server (penyusun) dan
 * mesin audio di browser (perender). Ini satu-satunya kontrak di antara
 * keduanya: model bahasa mengarang lagu dalam bentuk JSON ini, lalu
 * Web Audio API yang membunyikannya.
 */

/** Tangga nada. Nilainya tetap supaya model tidak bisa mengarang nama baru. */
export const MODES = [
  "major",
  "minor",
  "harmonic_minor",
  "dorian",
  "mixolydian",
  "lydian",
  "phrygian",
  "pentatonic_major",
  "pentatonic_minor",
  "blues",
  "pelog",
  "slendro",
] as const;
export type Mode = (typeof MODES)[number];

/** Pola ketukan drum/perkusi. */
export const GROOVES = [
  "none",
  "ballad",
  "pop",
  "rock",
  "funk",
  "disco",
  "four_on_floor",
  "edm",
  "hiphop",
  "trap",
  "shuffle",
  "reggae",
  "bossa",
  "latin",
  "waltz",
  "halftime",
  "dangdut",
  "jaipong",
  "keroncong",
  "gamelan",
] as const;
export type Groove = (typeof GROOVES)[number];

/** Suara melodi utama. */
export const LEAD_VOICES = [
  "none",
  "vocal",
  "lead_synth",
  "guitar_clean",
  "guitar_dist",
  "piano",
  "epiano",
  "flute",
  "suling",
  "violin",
  "sax",
  "bell",
  "gamelan",
] as const;
export type LeadVoice = (typeof LEAD_VOICES)[number];

/** Suara pengiring akor. */
export const CHORD_VOICES = [
  "none",
  "pad",
  "strings",
  "piano",
  "epiano",
  "organ",
  "guitar_clean",
  "guitar_nylon",
  "brass",
  "choir",
  "gamelan",
] as const;
export type ChordVoice = (typeof CHORD_VOICES)[number];

/** Suara bas. */
export const BASS_VOICES = [
  "none",
  "bass_round",
  "bass_pick",
  "bass_sub",
  "bass_synth",
  "upright",
] as const;
export type BassVoice = (typeof BASS_VOICES)[number];

/** Lapisan arpeggio/hiasan. */
export const ARP_VOICES = [
  "none",
  "pluck",
  "bell",
  "gamelan",
  "harp",
  "guitar_nylon",
  "marimba",
] as const;
export type ArpVoice = (typeof ARP_VOICES)[number];

export const SECTION_TYPES = [
  "intro",
  "verse",
  "prechorus",
  "chorus",
  "bridge",
  "solo",
  "outro",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export type VocalType = "male" | "female" | "none";

/** Satu nada melodi. */
export type Note = {
  /** Derajat tangga nada; 1 = nada dasar, 8 = satu oktaf di atasnya, boleh negatif. */
  d: number;
  /** Awal nada dalam ketukan, dihitung dari awal bagian. */
  t: number;
  /** Panjang nada dalam ketukan. */
  l: number;
  /** Suku kata yang dinyanyikan pada nada ini (kosong untuk bagian instrumental). */
  s?: string;
};

/** Satu baris lirik beserta melodinya. */
export type Line = {
  text: string;
  notes: Note[];
};

export type Section = {
  id: string;
  type: SectionType;
  label: string;
  bars: number;
  /** 0–1. Menentukan kepadatan aransemen, cutoff filter, dan tenaga drum. */
  energy: number;
  /** Satu simbol akor per birama, mis. "Am", "F", "G7", "Cmaj7". */
  chords: string[];
  lines: Line[];
};

export type Song = {
  id: string;
  title: string;
  genreLabel: string;
  styleTags: string[];
  bpm: number;
  /** Nama nada dasar, mis. "A", "C#", "Eb". */
  key: string;
  mode: Mode;
  groove: Groove;
  vocal: VocalType;
  instruments: {
    lead: LeadVoice;
    chords: ChordVoice;
    bass: BassVoice;
    arp: ArpVoice;
  };
  sections: Section[];
  /** Diisi server setelah normalisasi. */
  durationSec: number;
  createdAt: number;
};

/** Permintaan dari formulir di browser. */
export type ComposeRequest = {
  prompt: string;
  /** Mode mandiri: pengguna menulis sendiri lirik dan gaya. */
  custom?: boolean;
  title?: string;
  lyrics?: string;
  styleTags?: string;
  instrumental?: boolean;
  vocal?: VocalType;
  /** Target durasi dalam detik. */
  duration?: number;
};

/** Peristiwa yang dialirkan server selama lagu disusun. */
export type ComposeEvent =
  | { type: "status"; stage: string; message: string }
  | { type: "title"; title: string }
  | { type: "lyric"; line: string }
  | { type: "song"; song: Song }
  | { type: "error"; message: string };
