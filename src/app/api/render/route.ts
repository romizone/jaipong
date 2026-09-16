import { LIMITS, MUSIC_MODEL, OPENROUTER_API_KEY } from "@/lib/config";
import {
  UpstreamError,
  deltaAudio,
  deltaText,
  readSse,
  streamChat,
} from "@/lib/openrouter";
import {
  alignBase64,
  chunkBase64,
  newId,
  parseTimedLines,
  sniffAudio,
} from "@/lib/plan";
import { buildMusicPrompt } from "@/lib/prompt";
import { checkComposeQuota, clientIp, refundComposeQuota } from "@/lib/ratelimit";
import type {
  ComposeEvent,
  RenderRequest,
  SongPlan,
  Track,
  VocalType,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Tahap kedua: model musik membangkitkan audionya dari rencana lagu.
 * Inilah tahap yang berbiaya (harga per lagu, bukan per token), jadi kuota
 * burst/harian/global ditegakkan di sini. Audio diteruskan ke klien
 * berpotongan-potongan base64 lewat SSE, lalu ditutup metadata trek.
 */

function sse(event: ComposeEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function bad(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function str(value: unknown, max: number, fallback = ""): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, max);
}

/** Rencana datang dari klien — jepit setiap isinya sebelum dipakai. */
function sanitizePlan(raw: unknown, instrumental: boolean): SongPlan {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const vocalRaw = p.vocal;
  const vocal: VocalType = instrumental
    ? "none"
    : vocalRaw === "male" || vocalRaw === "none"
      ? vocalRaw
      : "female";
  return {
    title: str(p.title, 90, "Tanpa Judul"),
    genreLabel: str(p.genreLabel, 60, "Original"),
    styleTags: Array.isArray(p.styleTags)
      ? p.styleTags
          .map((t) => String(t ?? "").trim().toLowerCase().slice(0, 40))
          .filter(Boolean)
          .slice(0, 8)
      : [],
    vocal,
    style: str(p.style, 1_200),
    lyricsSheet: str(p.lyricsSheet, 7_000),
  };
}

export async function POST(req: Request) {
  if (!OPENROUTER_API_KEY) {
    return bad("Layanan belum dikonfigurasi. Hubungi pengelola situs.", 503);
  }

  let body: RenderRequest;
  try {
    body = (await req.json()) as RenderRequest;
  } catch {
    return bad("Permintaan tidak valid.", 400);
  }

  const plan = sanitizePlan(body.plan, Boolean(body.instrumental));
  if (!plan.style && !plan.lyricsSheet) {
    return bad("Rencana lagunya kosong. Ulangi dari awal.", 400);
  }

  const duration = Math.round(
    Math.min(
      LIMITS.maxDuration,
      Math.max(LIMITS.minDuration, Number(body.duration) || 150),
    ),
  );

  const ip = clientIp(req);
  const quota = await checkComposeQuota(ip);
  if (!quota.ok) return bad(quota.message, 429);

  const encoder = new TextEncoder();
  // Permintaan ke hulu dibatalkan begitu klien pergi — lewat req.signal maupun
  // cancel() aliran — supaya model musik tidak terus bekerja untuk yang tak
  // akan didengar.
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ComposeEvent) => {
        try {
          controller.enqueue(encoder.encode(sse(event)));
        } catch {
          // Klien menutup koneksi lebih dulu.
        }
      };

      try {
        send({
          type: "status",
          stage: "audio",
          message: "Membangkitkan audionya… biasanya sekitar satu menit.",
        });

        const upstream = await streamChat({
          model: MUSIC_MODEL,
          messages: [{ role: "user", content: buildMusicPrompt(plan, duration) }],
          // Audio hanya dikirim kalau diminta lewat modalities + streaming.
          modalities: ["text", "audio"],
          audio: { format: "wav" },
          signal: abort.signal,
        });

        let began = false;
        let format: "mp3" | "wav" = "mp3";
        let content = "";
        let b64Length = 0;
        // Sisa base64 yang belum genap empat karakter, ditunda ke delta berikutnya.
        let carry = "";

        for await (const event of readSse(upstream)) {
          const audio = deltaAudio(event);
          if (audio) {
            if (!began) {
              // Format ditebak dari isi berkas, bukan dari parameter —
              // Lyria mengirim MP3 walau permintaannya WAV.
              const sniffed = sniffAudio(audio);
              format = sniffed.format;
              began = true;
              send({ type: "audio-begin", mime: sniffed.mime, format });
            }
            const aligned = alignBase64(carry, audio);
            carry = aligned.rest;
            for (const piece of chunkBase64(aligned.ready)) {
              send({ type: "audio", b64: piece });
            }
            b64Length += audio.length;
          }
          content += deltaText(event);
        }
        // Sisa satu karakter tak mungkin base64 yang sah; dua-tiga masih bisa didekode.
        if (carry.length >= 2) send({ type: "audio", b64: carry });

        // Di bawah ~30 KB bukan lagu — anggap gagal supaya klien tidak
        // menyimpan berkas kosong.
        if (!began || b64Length < 40_000) {
          console.error("[render] audio kosong", content.slice(0, 300));
          void refundComposeQuota(ip);
          send({
            type: "error",
            message: "Audio gagal dibangkitkan. Coba lagi sebentar lagi.",
          });
        } else {
          const track: Track = {
            kind: "track",
            id: newId(),
            title: plan.title,
            genreLabel: plan.genreLabel,
            styleTags: plan.styleTags,
            vocal: plan.vocal,
            durationSec: 0,
            createdAt: Date.now(),
            audioFormat: format,
            lines: parseTimedLines(content),
          };
          send({ type: "track", track });
        }
      } catch (error) {
        // Klien sudah pergi; pembatalannya bukan kegagalan yang perlu dicatat.
        if (abort.signal.aborted) return;
        // Hulu yang gagal bukan salah pengguna — jatahnya dikembalikan.
        void refundComposeQuota(ip);
        const message =
          error instanceof UpstreamError
            ? error.message
            : "Terjadi gangguan saat membangkitkan audio. Coba lagi sebentar lagi.";
        if (!(error instanceof UpstreamError)) console.error("[render]", error);
        send({ type: "error", message });
      } finally {
        try {
          controller.close();
        } catch {
          // Klien sudah memutus koneksi; alirannya memang sudah tertutup.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
