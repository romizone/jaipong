"use client";

import { deleteAudio } from "@/lib/client/audiodb";
import { isTrack, type LibraryItem, type Song, type Track } from "@/lib/types";

/**
 * Pustaka lagu disimpan di browser masing-masing. Tidak ada basis data dan
 * tidak ada akun — lagu yang dibuat hanya milik peramban yang membuatnya.
 * Metadata di localStorage; audio trek di IndexedDB (lihat audiodb.ts).
 *
 * Isinya dibaca lewat useSyncExternalStore, jadi halaman yang dirender di
 * server memulai dari daftar kosong dan React sendiri yang menukarnya dengan
 * isi localStorage setelah hidrasi. Cuplikan di-cache supaya acuannya tetap
 * sama selama isinya belum berubah.
 */

const KEY = "jaipong:library:v1";
const MAX_SONGS = 60;
const EMPTY: LibraryItem[] = [];

let cache: LibraryItem[] | null = null;
const listeners = new Set<() => void>();

/**
 * Isi localStorage tidak dipercaya begitu saja: bisa dari versi lama atau
 * disunting sendiri. Lagu partitur yang rusak berujung waktu NaN di mesin
 * audio, jadi bentuknya diperiksa di sini.
 */
function isPlayableSong(value: unknown): value is Song {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<Song>;
  return (
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    typeof s.bpm === "number" &&
    Number.isFinite(s.bpm) &&
    s.bpm > 0 &&
    typeof s.key === "string" &&
    typeof s.groove === "string" &&
    Boolean(s.instruments) &&
    typeof s.instruments === "object" &&
    Array.isArray(s.styleTags) &&
    Array.isArray(s.sections) &&
    s.sections.length > 0 &&
    s.sections.every(
      (section) =>
        Boolean(section) &&
        typeof section === "object" &&
        // Jumlah birama dibatasi: nilai raksasa membuat penata aransemen
        // berputar sampai tab membeku.
        Number.isFinite(section.bars) &&
        section.bars > 0 &&
        section.bars <= 128 &&
        Array.isArray(section.chords) &&
        Array.isArray(section.lines) &&
        section.lines.every(
          (line) =>
            Boolean(line) &&
            typeof line.text === "string" &&
            Array.isArray(line.notes) &&
            line.notes.every(
              (note) =>
                Boolean(note) &&
                typeof note === "object" &&
                Number.isFinite(note.d) &&
                Number.isFinite(note.t) &&
                note.t >= 0 &&
                Number.isFinite(note.l) &&
                (note.s === undefined || typeof note.s === "string"),
            ),
        ),
    )
  );
}

function isValidTrack(value: unknown): value is Track {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<Track>;
  return (
    t.kind === "track" &&
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    typeof t.durationSec === "number" &&
    Number.isFinite(t.durationSec) &&
    (t.audioFormat === "mp3" || t.audioFormat === "wav") &&
    Array.isArray(t.styleTags) &&
    Array.isArray(t.lines) &&
    t.lines.every((l) => Boolean(l) && typeof l.text === "string")
  );
}

function isValidItem(value: unknown): value is LibraryItem {
  return isValidTrack(value) || isPlayableSong(value);
}

function read(): LibraryItem[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter(isValidItem);
  } catch {
    return EMPTY;
  }
}

function tryStore(items: LibraryItem[]): LibraryItem[] {
  const trimmed = items.slice(0, MAX_SONGS);
  if (typeof window === "undefined") return trimmed;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch {
    // Kuota penuh: buang separuh yang terlama lalu coba sekali lagi.
    const half = trimmed.slice(0, Math.max(1, Math.floor(trimmed.length / 2)));
    try {
      window.localStorage.setItem(KEY, JSON.stringify(half));
      return half;
    } catch {
      return trimmed;
    }
  }
}

function persist(items: LibraryItem[]): LibraryItem[] {
  const kept = tryStore(items);
  // Audio milik lagu yang tergusur ikut dibuang, supaya IndexedDB tidak
  // menimbun berkas yatim yang tidak bisa dijangkau dari mana pun.
  const keptIds = new Set(kept.map((item) => item.id));
  for (const item of items) {
    if (!keptIds.has(item.id) && isTrack(item)) deleteAudio(item.id);
  }
  return kept;
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Tab lain mengubah pustaka — buang cache supaya dibaca ulang. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== KEY) return;
  cache = null;
  emit();
}

export function subscribeLibrary(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function getLibrary(): LibraryItem[] {
  if (cache === null) cache = read();
  return cache;
}

/** Server tidak punya localStorage, jadi selalu daftar kosong yang sama. */
export function getServerLibrary(): LibraryItem[] {
  return EMPTY;
}

export function saveSong(item: LibraryItem): void {
  cache = persist([item, ...getLibrary().filter((s) => s.id !== item.id)]);
  emit();
}

/**
 * Perbarui metadata lagu yang sudah ada di tempatnya: urutan pustaka tidak
 * berubah, dan lagu yang keburu dihapus tidak dihidupkan kembali.
 */
export function updateSong(item: LibraryItem): void {
  const items = getLibrary();
  const index = items.findIndex((s) => s.id === item.id);
  if (index === -1) return;
  const next = items.slice();
  next[index] = item;
  cache = persist(next);
  emit();
}

export function deleteSong(id: string): void {
  deleteAudio(id);
  cache = persist(getLibrary().filter((s) => s.id !== id));
  emit();
}
