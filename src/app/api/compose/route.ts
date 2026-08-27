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
  // Judul ikut dijepit seperti isian lain. Tanpa String() nilai bukan teks
  // membuat buildUserPrompt melempar kesalahan, dan tanpa slice() judul
  // sepanjang apa pun ikut terkirim ke penyedia.
  const title = String(body.title ?? "").trim().slice(0, LIMITS.maxTitleChars);

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

        // Regex dibuat per permintaan, bukan di tingkat modul: keduanya
        // menyimpan lastIndex, dan dua permintaan bersamaan akan saling
        // mengacak posisi pemindaian.
        const titleRe = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/;
        const lyricRe = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

        let buffer = "";
        let titleDone = false;
        let stage = "start";
        /** Sampai mana buffer sudah dipindai untuk mencari baris lirik. */
        let scanned = 0;
        /** Baris terakhir ditahan — kutipnya bisa saja belum lengkap. */
        let pendingLyric: string | null = null;

        for await (const event of readSse(upstream)) {
          buffer += deltaText(event);

          // Judul muncul paling awal di JSON — tampilkan begitu terbaca.
          if (!titleDone) {
            const m = titleRe.exec(buffer);
            if (m) {
              titleDone = true;
              send({ type: "title", title: unescapeJson(m[1]!) });
            } else if (buffer.length > TITLE_SCAN_LIMIT) {
              // Judulnya ternyata jauh di belakang. Berhenti mencari daripada
              // membaca ulang seluruh buffer tiap potongan; judulnya tetap ikut
              // di peristiwa "song" nanti.
              titleDone = true;
            }
          }

          // Tahapan disimpulkan dari kunci yang sudah sampai. Setelah sampai
          // "melody" tidak ada lagi yang perlu dicari.
          if (stage !== "melody") {
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
          }

          // Lirik dialirkan baris demi baris supaya terasa hidup. Pemindaian
          // dilanjutkan dari tempat terakhir berhenti: kalau seluruh buffer
          // dipindai ulang tiap potongan, satu lagu penuh berarti ratusan juta
          // karakter yang dibaca percuma.
          lyricRe.lastIndex = scanned;
          let match: RegExpExecArray | null;
          while ((match = lyricRe.exec(buffer)) !== null) {
            if (pendingLyric) send({ type: "lyric", line: pendingLyric });
            const line = unescapeJson(match[1]!).trim();
            pendingLyric = line || null;
            scanned = lyricRe.lastIndex;
          }
        }

        // Aliran selesai, jadi baris terakhir sudah pasti utuh.
        if (pendingLyric) send({ type: "lyric", line: pendingLyric });

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

/** Sesudah sekian karakter, judul dianggap tidak akan muncul di awal JSON. */
const TITLE_SCAN_LIMIT = 8_000;

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
