/**
 * Konfigurasi server. Kunci dan nama model hanya hidup di sini —
 * tidak ada yang di-prefix NEXT_PUBLIC_, jadi tidak pernah sampai ke browser.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
export const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

/**
 * Model penyusun lagu. Namanya sengaja tidak pernah dikirim ke klien
 * dan tidak pernah muncul di pesan kesalahan.
 */
export const COMPOSER_MODEL =
  process.env.COMPOSER_MODEL ?? "google/gemini-3.7-flash";

/** Atribusi aplikasi di dasbor OpenRouter. */
export const SITE_URL = process.env.SITE_URL ?? "https://jaipong.rominur.com";
export const SITE_NAME = process.env.SITE_NAME ?? "Jaipong";

export const LIMITS = {
  /** Panjang maksimum deskripsi lagu dari pengguna. */
  maxPromptChars: num("MAX_PROMPT_CHARS", 2_000),
  /** Panjang maksimum lirik yang ditempel sendiri oleh pengguna. */
  maxLyricsChars: num("MAX_LYRICS_CHARS", 6_000),
  /** Batas token keluaran untuk satu lagu. */
  maxOutputTokens: num("MAX_OUTPUT_TOKENS", 20_000),

  /** Durasi lagu yang boleh diminta (detik). */
  minDuration: num("MIN_DURATION_SEC", 30),
  maxDuration: num("MAX_DURATION_SEC", 240),

  /** Pagar aransemen supaya satu lagu tidak meledak ukurannya. */
  maxSections: num("MAX_SECTIONS", 16),
  maxBarsPerSection: num("MAX_BARS_PER_SECTION", 32),
  maxNotesPerSong: num("MAX_NOTES_PER_SONG", 1_600),

  /** Situs terbuka tanpa login, jadi ada kuota per IP. */
  burst: num("COMPOSE_BURST_LIMIT", 6),
  burstWindowSec: num("COMPOSE_BURST_WINDOW_SEC", 300),
  daily: num("COMPOSE_DAILY_LIMIT", 40),
  /** Kuota harian seluruh situs, bukan per IP. */
  globalDaily: num("COMPOSE_GLOBAL_DAILY_LIMIT", 600),
};

/** Opsional: Upstash Redis REST supaya kuota tetap akurat lintas instance serverless. */
export const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL ?? "";
export const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
export const hasSharedStore = Boolean(UPSTASH_URL && UPSTASH_TOKEN);
