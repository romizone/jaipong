import type { SongPlan, TimedLine, VocalType } from "@/lib/types";

/**
 * Alat bantu kedua tahap penyusunan: mengurai rencana lagu yang ditulis model
 * bahasa, dan mengurai lirik berwaktu yang dikembalikan model musik.
 * Berkas ini hanya dipakai di sisi server (memakai Buffer).
 */

/**
 * Label rencana. Hiasan markdown di sekitar label dan titik dua ("**JUDUL:**",
 * "**VOKAL**: wanita") ditoleransi — model kadang menebalkannya walau diminta
 * format polos, dan tanpa toleransi ini rencananya terbaca kosong.
 */
const FIELD = /^(JUDUL|GENRE|TAG|VOKAL|GAYA|LIRIK)[*_\s]*:[*_\s]*(.*)$/i;
/** Di blok lirik hanya label huruf besar yang dianggap label — "Judul: kisah kita" bisa saja lirik. */
const FIELD_IN_LYRICS = /^(JUDUL|GENRE|TAG|VOKAL|GAYA|LIRIK)\s*:\s*(.*)$/;
/** Awalan markdown yang kadang membungkus label: "## ", "**", "- ", "> ". */
const DECOR_START = /^[#*_>\-\s]+/;
const DECOR_END = /[*_\s]+$/;
/** Pagar kode dan garis pemisah bukan lirik — jangan sampai ikut dinyanyikan. */
const NOT_LYRIC = /^(`{3,}|([-*_])\2{2,}\s*$)/;

/**
 * Pengurai rencana yang bekerja sambil teksnya mengalir. Format
 * baris-per-baris dipilih justru supaya ini mungkin: judul dikirim ke layar
 * begitu barisnya selesai, tiap baris lirik menyusul satu-satu, dan keluaran
 * yang terpotong di tengah tetap terpakai sampai baris utuh terakhir —
 * tidak ada JSON yang harus diperbaiki.
 */
export function createPlanParser(handlers: {
  onTitle?: (title: string) => void;
  onLyric?: (line: string) => void;
}): { feed: (text: string) => void; end: () => SongPlan } {
  const fields: Partial<Record<string, string>> = {};
  const lyrics: string[] = [];
  let pending = "";
  let mode: "fields" | "style" | "lyrics" = "fields";
  let titleSent = false;

  const handleLine = (raw: string): void => {
    const line = raw.replace(/\r$/, "");
    const text = line.trim();
    const m =
      mode === "lyrics"
        ? FIELD_IN_LYRICS.exec(text)
        : FIELD.exec(text.replace(DECOR_START, "").replace(DECOR_END, ""));
    if (m) {
      const key = m[1]!.toUpperCase();
      const rest = m[2]!.replace(DECOR_END, "").trim();
      if (key === "LIRIK") {
        mode = "lyrics";
        // "LIRIK: [Verse 1]" — isi di baris yang sama adalah baris lirik pertama.
        if (rest) handleLine(rest);
        return;
      }
      fields[key] = rest;
      mode = key === "GAYA" ? "style" : "fields";
      if (key === "JUDUL" && rest && !titleSent) {
        titleSent = true;
        handlers.onTitle?.(rest.slice(0, 90));
      }
      return;
    }

    if (mode === "lyrics") {
      if (NOT_LYRIC.test(text)) return;
      lyrics.push(line);
      // Label bagian ([Verse 1], [Chorus]) tidak dikirim sebagai baris lirik.
      if (text && !/^\[[^\]]*\]$/.test(text)) handlers.onLyric?.(text);
      return;
    }
    if (mode === "style" && line.trim()) {
      // Paragraf gaya boleh melipat ke beberapa baris.
      fields.GAYA = `${fields.GAYA ?? ""} ${line.trim()}`.trim();
    }
  };

  return {
    feed(text) {
      pending += text;
      let index: number;
      while ((index = pending.indexOf("\n")) !== -1) {
        handleLine(pending.slice(0, index));
        pending = pending.slice(index + 1);
      }
    },
    end() {
      if (pending.trim()) handleLine(pending);
      const vocalWord = (fields.VOKAL ?? "").toLowerCase();
      // Batas kata penting: tanpa \b, "female" ikut cocok dengan "male".
      const vocal: VocalType = /\b(pria|male|laki)\b/.test(vocalWord)
        ? "male"
        : /instrument|tanpa/.test(vocalWord)
          ? "none"
          : "female";
      return {
        title: (fields.JUDUL ?? "").trim().slice(0, 90) || "Tanpa Judul",
        genreLabel: (fields.GENRE ?? "").trim().slice(0, 60) || "Original",
        styleTags: (fields.TAG ?? "")
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 8),
        vocal,
        style: (fields.GAYA ?? "").trim().slice(0, 1_200),
        lyricsSheet: lyrics.join("\n").trim().slice(0, 7_000),
      };
    },
  };
}

/**
 * Lirik berwaktu dari model musik. Bentuk yang diamati dari Lyria:
 *
 *   [[A0]]                penanda struktur — dilewati
 *   [20.0:] Baris lirik   baris dengan detik mulai
 *   [:] Baris lirik       baris tanpa detik (menyusul baris sebelumnya)
 *
 * Penguraiannya memaafkan: baris polos pun diterima sebagai lirik tanpa
 * waktu, jadi perubahan format di hulu tidak membuat panel lirik kosong.
 */
export function parseTimedLines(content: string): TimedLine[] {
  const out: TimedLine[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || /^\[\[[^\]]*\]\]$/.test(line)) continue;

    const m = /^\[(\d+(?:\.\d+)?)?\s*:\s*\]\s*(.*)$/.exec(line);
    if (m) {
      const text = m[2]!.trim();
      if (!text) continue;
      const entry: TimedLine = { text: text.slice(0, 300) };
      if (m[1] !== undefined) entry.start = Number(m[1]);
      out.push(entry);
      continue;
    }
    // Label bagian gaya [Chorus] dilewati; baris polos dianggap lirik.
    if (!/^\[[^\]]*\]$/.test(line)) out.push({ text: line.slice(0, 300) });
  }
  return out.slice(0, 200);
}

/**
 * Genapkan base64 yang mengalir. Hulu boleh memotong string base64-nya di
 * mana saja; bagian yang sudah kelipatan empat siap dikirim, sisanya ditunda
 * ke potongan berikutnya. Tanpa ini potongan sepanjang 4n+1 membuat atob()
 * di klien melempar, dan 4n+2/4n+3 menggeser bit potongan sesudahnya.
 */
export function alignBase64(
  carry: string,
  incoming: string,
): { ready: string; rest: string } {
  const joined = carry + incoming;
  const usable = joined.length - (joined.length % 4);
  return { ready: joined.slice(0, usable), rest: joined.slice(usable) };
}

/**
 * Pecah base64 pada kelipatan empat karakter supaya tiap potongan sah
 * didekode sendiri-sendiri di klien, tanpa menunggu seluruh berkas.
 */
export function chunkBase64(b64: string, size = 200_000): string[] {
  const step = size - (size % 4);
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += step) out.push(b64.slice(i, i + step));
  return out;
}

/**
 * Tebak format berkas dari byte pertamanya. Yang diminta dan yang datang bisa
 * berbeda — Lyria mengirim MP3 walau permintaannya WAV — jadi jangan percaya
 * pada parameter, percaya pada isi berkasnya.
 */
export function sniffAudio(firstChunkB64: string): {
  format: "mp3" | "wav";
  mime: string;
} {
  try {
    const head = Buffer.from(firstChunkB64.slice(0, 24), "base64");
    if (head.subarray(0, 4).toString("latin1") === "RIFF") {
      return { format: "wav", mime: "audio/wav" };
    }
  } catch {
    // Jatuh ke bawaan di bawah.
  }
  // Header "ID3" maupun sinkronisasi frame 0xFFEx sama-sama MP3.
  return { format: "mp3", mime: "audio/mpeg" };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
