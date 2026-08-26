import { COMPOSER_MODEL, LIMITS, OPENROUTER_API_KEY } from "@/lib/config";
import { UpstreamError, deltaText, readSse, streamChat } from "@/lib/openrouter";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompt";
import { checkComposeQuota, clientIp } from "@/lib/ratelimit";
import { extractJson, normalizeSong } from "@/lib/song";
import type { ComposeEvent, ComposeRequest, VocalType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function sse(event: ComposeEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function bad(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(req: Request) {
  if (!OPENROUTER_API_KEY) {
    return bad("Layanan belum dikonfigurasi. Hubungi pengelola situs.", 503);
  }

  let body: ComposeRequest;
  try {
    body = (await req.json()) as ComposeRequest;
  } catch {
    return bad("Permintaan tidak valid.", 400);
  }

  const prompt = String(body.prompt ?? "")
    .trim()
    .slice(0, LIMITS.maxPromptChars);
  const lyrics = String(body.lyrics ?? "")
    .trim()
    .slice(0, LIMITS.maxLyricsChars);
  const styleTags = String(body.styleTags ?? "").trim().slice(0, 300);

  if (!prompt && !lyrics && !styleTags) {
    return bad("Tulis dulu lagu seperti apa yang kamu bayangkan.", 400);
  }

  const duration = Math.round(
    Math.min(
      LIMITS.maxDuration,
      Math.max(LIMITS.minDuration, Number(body.duration) || 120),
    ),
  );
  const instrumental = Boolean(body.instrumental);
  const vocal: VocalType = instrumental
    ? "none"
    : body.vocal === "male" || body.vocal === "female"
      ? body.vocal
      : "female";

  const quota = await checkComposeQuota(clientIp(req));
  if (!quota.ok) return bad(quota.message, 429);

  const userPrompt = buildUserPrompt({
    prompt,
    duration,
    vocal,
    instrumental,
    title: body.title,
    lyrics,
    styleTags,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ComposeEvent) => {
        try {
          controller.enqueue(encoder.encode(sse(event)));
        } catch {
          // Klien menutup koneksi lebih dulu.
        }
      };

      const abort = new AbortController();
      req.signal.addEventListener("abort", () => abort.abort());

      try {
        send({
          type: "status",
          stage: "start",
          message: "Menyiapkan ide lagu…",
        });

        const upstream = await streamChat({
          model: COMPOSER_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.9,
          max_tokens: LIMITS.maxOutputTokens,
          response_format: { type: "json_object" },
          signal: abort.signal,
        });

        let buffer = "";
        let sentTitle = false;
        let stage = "start";
        let lyricCursor = 0;

        for await (const event of readSse(upstream)) {
          buffer += deltaText(event);

          // Judul muncul paling awal di JSON — tampilkan begitu terbaca.
          if (!sentTitle) {
            const m = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(buffer);
            if (m) {
              sentTitle = true;
              send({ type: "title", title: unescapeJson(m[1]!) });
            }
          }

          // Tahapan disimpulkan dari kunci yang sudah sampai.
          const next = buffer.includes('"sections"')
            ? "melody"
            : buffer.includes('"instruments"')
              ? "arrange"
              : buffer.includes('"bpm"')
                ? "tempo"
                : "start";
          if (next !== stage) {
            stage = next;
            send({ type: "status", stage, message: STAGE_TEXT[stage]! });
          }

          // Lirik dialirkan baris demi baris supaya terasa hidup.
          const matches = [...buffer.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
          for (let i = lyricCursor; i < matches.length - 1; i += 1) {
            const line = unescapeJson(matches[i]![1]!).trim();
            if (line) send({ type: "lyric", line });
          }
          if (matches.length > 1) lyricCursor = matches.length - 1;
        }

        send({
          type: "status",
          stage: "render",
          message: "Merapikan partitur…",
        });

        const song = normalizeSong(extractJson(buffer), {
          targetDuration: duration,
          instrumental,
          vocalHint: vocal,
        });

        if (!song) {
          console.error("[compose] partitur tidak terbaca", buffer.slice(0, 800));
          send({
            type: "error",
            message:
              "Lagu gagal disusun. Coba ubah deskripsinya atau pilih durasi yang lebih pendek.",
          });
        } else {
          send({ type: "song", song });
        }
      } catch (error) {
        const message =
          error instanceof UpstreamError
            ? error.message
            : "Terjadi gangguan saat menyusun lagu. Coba lagi sebentar lagi.";
        if (!(error instanceof UpstreamError)) console.error("[compose]", error);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
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

const STAGE_TEXT: Record<string, string> = {
  start: "Menyiapkan ide lagu…",
  tempo: "Menentukan tempo dan nada dasar…",
  arrange: "Memilih instrumen dan aransemen…",
  melody: "Menulis lirik dan melodi…",
  render: "Merapikan partitur…",
};

function unescapeJson(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}
