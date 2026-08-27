"use client";

import type { Song } from "@/lib/types";

/**
 * Pustaka lagu disimpan di browser masing-masing. Tidak ada basis data dan
 * tidak ada akun — lagu yang dibuat hanya milik peramban yang membuatnya.
 *
 * Isinya dibaca lewat useSyncExternalStore, jadi halaman yang dirender di
 * server memulai dari daftar kosong dan React sendiri yang menukarnya dengan
 * isi localStorage setelah hidrasi. Cuplikan di-cache supaya acuannya tetap
 * sama selama isinya belum berubah.
 */

const KEY = "jaipong:library:v1";
const MAX_SONGS = 60;
const EMPTY: Song[] = [];

let cache: Song[] | null = null;
const listeners = new Set<() => void>();

function read(): Song[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter(isPlayableSong);
  } catch {
    return EMPTY;
  }
}

/**
 * Isi localStorage tidak dipercaya begitu saja: bisa berasal dari versi lama,
 * atau disunting sendiri. Lagu yang bentuknya tidak masuk akal dibuang di sini,
 * karena bpm atau bagian yang rusak berujung pada waktu NaN di mesin audio.
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
    Array.isArray(s.styleTags) &&
    Array.isArray(s.sections) &&
    s.sections.length > 0 &&
    s.sections.every(
      (section) =>
        Boolean(section) &&
        typeof section === "object" &&
        Number.isFinite(section.bars) &&
        Array.isArray(section.chords) &&
        Array.isArray(section.lines),
    )
  );
}

function persist(songs: Song[]): Song[] {
  const trimmed = songs.slice(0, MAX_SONGS);
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

export function getLibrary(): Song[] {
  if (cache === null) cache = read();
  return cache;
}

/** Server tidak punya localStorage, jadi selalu daftar kosong yang sama. */
export function getServerLibrary(): Song[] {
  return EMPTY;
}

export function saveSong(song: Song): void {
  cache = persist([song, ...getLibrary().filter((s) => s.id !== song.id)]);
  emit();
}

export function deleteSong(id: string): void {
  cache = persist(getLibrary().filter((s) => s.id !== id));
  emit();
}
