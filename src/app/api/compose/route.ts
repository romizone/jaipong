import { COMPOSER_MODEL, LIMITS, OPENROUTER_API_KEY } from "@/lib/config";
import { UpstreamError, deltaText, readSse, streamChat } from "@/lib/openrouter";
import { createPlanParser } from "@/lib/plan";
import { PLAN_PROMPT, buildUserPrompt } from "@/lib/prompt";
import { checkPlanQuota, clientIp } from "@/lib/ratelimit";
import type { ComposeEvent, ComposeRequest, VocalType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Tahap pertama: model bahasa menulis rencana lagu — judul, gaya, lirik.
 * Judul dan tiap baris lirik dialirkan ke klien begitu selesai ditulis;
 * di akhir, rencana utuhnya dikirim sebagai peristiwa "plan" untuk
 * diteruskan klien ke /api/render.
 */

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
  const title = String(body.title ?? "").trim().slice(0, LIMITS.maxTitleChars);

  if (!prompt && !lyrics && !styleTags) {
    return bad("Tulis dulu lagu seperti apa yang kamu bayangkan.", 400);
  }

  const duration = Math.round(
    Math.min(
      LIMITS.maxDuration,
      Math.max(LIMITS.minDuration, Number(body.duration) || 150),
    ),
  );
  const instrumental = Boolean(body.instrumental);
  const vocal: VocalType = instrumental
    ? "none"
    : body.vocal === "male" || body.vocal === "female"
      ? body.vocal
      : "female";

  const quota = await checkPlanQuota(clientIp(req));
  if (!quota.ok) return bad(quota.message, 429);

  const userPrompt = buildUserPrompt({
    prompt,
    duration,
    vocal,
    instrumental,
    title,
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
      req.signal.addEventListener("abort", () => abort.abort(), { once: true });

      try {
        send({
          type: "status",
          stage: "plan",
          message: "Menulis judul dan lirik…",
        });

        const upstream = await streamChat({
          model: COMPOSER_MODEL,
          messages: [
            { role: "system", content: PLAN_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.9,
          // Rencana itu kecil; batasnya cukup untuk menggemakan lirik kustom
          // terpanjang, tidak perlu jatah token sebesar partitur dulu.
          max_tokens: Math.min(LIMITS.maxOutputTokens, 4_000),
          signal: abort.signal,
        });

        const parser = createPlanParser({
          onTitle: (t) => send({ type: "title", title: t }),
          onLyric: (line) => send({ type: "lyric", line }),
        });

        for await (const event of readSse(upstream)) {
          parser.feed(deltaText(event));
        }

        const plan = parser.end();
        // Pilihan eksplisit pengguna menang atas tebakan model.
        plan.vocal = vocal;
        if (title) plan.title = title;

        // Model bisa menjawab tanpa format (atau ditahan penyaring isi);
        // hasilnya rencana kosong. Lebih baik dijelaskan di sini daripada
        // ditolak /api/render dengan pesan yang tidak menyebut sebabnya.
        if (!plan.style && !plan.lyricsSheet) {
          console.error("[compose] rencana kosong dari model");
          send({
            type: "error",
            message:
              "Model tidak menghasilkan rencana lagu. Coba ubah deskripsinya lalu ulangi.",
          });
          return;
        }

        send({ type: "plan", plan });
      } catch (error) {
        const message =
          error instanceof UpstreamError
            ? error.message
            : "Terjadi gangguan saat menyusun lagu. Coba lagi sebentar lagi.";
        if (!(error instanceof UpstreamError)) console.error("[compose]", error);
        send({ type: "error", message });
      } finally {
        try {
          controller.close();
        } catch {
          // Klien sudah memutus koneksi; alirannya memang sudah tertutup.
        }
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
