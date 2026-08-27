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

/**
 * Ketukan per birama. Hampir semua groove di sini 4/4; waltz satu-satunya
 * yang 3/4. Nilainya diturunkan dari groove, bukan disimpan di lagu, jadi
 * lagu lama di localStorage tetap terbaca tanpa migrasi.
 */
export function beatsPerBar(groove: Groove): number {
  return groove === "waltz" ? 3 : 4;
}

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

/* ------------------------------------------------- lagu dari model musik --- */

/** Satu baris lirik dari model musik, dengan detik mulai kalau diberi. */
export type TimedLine = {
  text: string;
  start?: number;
};

/**
 * Rencana lagu hasil tahap pertama: model bahasa menulis judul, gaya, dan
 * lirik. Rencana inilah yang dikirim balik ke /api/render untuk dijadikan
 * audio oleh model musik.
 */
export type SongPlan = {
  title: string;
  genreLabel: string;
  styleTags: string[];
  vocal: VocalType;
  /** Deskripsi musik untuk model audio: genre, tempo, instrumen, suasana. */
  style: string;
  /** Lembar lirik lengkap dengan label [Bagian]. */
  lyricsSheet: string;
};

/**
 * Lagu hasil model musik. Audionya berkas jadi (MP3/WAV) yang disimpan di
 * IndexedDB browser — metadata di sini sengaja kecil supaya tetap muat di
 * localStorage bersama lagu-lagu partitur lama.
 */
export type Track = {
  kind: "track";
  id: string;
  title: string;
  genreLabel: string;
  styleTags: string[];
  vocal: VocalType;
  /** Diisi klien setelah audionya terdekode. */
  durationSec: number;
  createdAt: number;
  audioFormat: "mp3" | "wav";
  /** Lirik berwaktu dari model musik, untuk panel lirik yang ikut berjalan. */
  lines: TimedLine[];
};

/** Isi pustaka: trek audio baru, atau lagu partitur dari versi sebelumnya. */
export type LibraryItem = Song | Track;

export function isTrack(item: LibraryItem): item is Track {
  return (item as Track).kind === "track";
}

/** Permintaan dari formulir di browser. */
export type ComposeRequest = {
  prompt: string;
  /** Mode mandiri: judul dan lirik diisi sendiri oleh pengguna. */
  title?: string;
  lyrics?: string;
  styleTags?: string;
  instrumental?: boolean;
  vocal?: VocalType;
  /** Target durasi dalam detik. */
  duration?: number;
};

/** Permintaan pembangkitan audio: rencana lagu plus pilihan pengguna. */
export type RenderRequest = {
  plan: SongPlan;
  duration?: number;
  instrumental?: boolean;
};

/**
 * Peristiwa yang dialirkan kedua endpoint. /api/compose mengirim status,
 * judul, baris lirik, lalu "plan"; /api/render mengirim status, audio
 * berpotongan-potongan (base64), lalu "track".
 */
export type ComposeEvent =
  | { type: "status"; stage: string; message: string }
  | { type: "title"; title: string }
  | { type: "lyric"; line: string }
  | { type: "plan"; plan: SongPlan }
  | { type: "audio-begin"; mime: string; format: "mp3" | "wav" }
  | { type: "audio"; b64: string }
  | { type: "track"; track: Track }
  | { type: "error"; message: string };
