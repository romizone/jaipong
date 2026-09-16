import {
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL,
  SITE_NAME,
  SITE_URL,
} from "@/lib/config";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": SITE_URL,
    "X-Title": SITE_NAME,
  };
}

/**
 * Pesan kesalahan dari penyedia sering menyebut nama model. Situs ini
 * menyembunyikan detail itu, jadi kesalahan diterjemahkan ke bahasa netral.
 */
export function friendlyError(status: number): string {
  if (status === 401 || status === 403)
    return "Layanan sedang tidak dapat diakses. Hubungi pengelola situs.";
  if (status === 402)
    return "Kuota layanan sedang habis. Silakan coba lagi nanti.";
  if (status === 429)
    return "Layanan sedang sibuk. Tunggu sebentar lalu coba lagi.";
  if (status === 408 || status === 504)
    return "Lagu terlalu lama disusun. Coba durasi yang lebih pendek.";
  return "Terjadi gangguan saat menyusun lagu. Coba lagi sebentar lagi.";
}

export type UpstreamMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Panggil chat completions dengan streaming SSE. */
export async function streamChat(body: {
  model: string;
  messages: UpstreamMessage[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
  /** Untuk model audio: minta keluaran audio, bukan hanya teks. */
  modalities?: string[];
  audio?: { format?: string; voice?: string };
  signal?: AbortSignal;
}): Promise<Response> {
  const { signal, ...payload } = body;
  const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error("[openrouter] gagal", res.status, detail.slice(0, 500));
    throw new UpstreamError(friendlyError(res.status), res.status);
  }
  return res;
}

/** Pecah aliran SSE menjadi objek JSON per event. */
export async function* readSse(
  res: Response,
): AsyncGenerator<Record<string, unknown>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data) as Record<string, unknown>;
        } catch {
          // Potongan JSON yang rusak diabaikan; aliran berikutnya tetap jalan.
          continue;
        }
        // Kesalahan yang terjadi setelah aliran dimulai (kredit habis, model
        // sibuk) datang sebagai event biasa dengan HTTP 200. Tanpa ini ia
        // lewat diam-diam dan tahapnya berakhir sebagai "rencana kosong"
        // atau "audio kosong" tanpa sebab yang bisa dipahami pengguna.
        if (event.error) throw midStreamError(event.error);
        yield event;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function midStreamError(failure: unknown): UpstreamError {
  const detail =
    failure && typeof failure === "object"
      ? (failure as { code?: unknown; message?: unknown })
      : { message: failure };
  const code = Number(detail.code);
  const status = Number.isInteger(code) && code >= 400 && code < 600 ? code : 502;
  console.error(
    "[openrouter] gagal di tengah aliran",
    status,
    String(detail.message ?? "").slice(0, 300),
  );
  return new UpstreamError(friendlyError(status), status);
}

/** Ambil potongan teks dari satu event SSE chat completions. */
export function deltaText(event: Record<string, unknown>): string {
  const choices = event.choices as
    | Array<{ delta?: { content?: string | null } }>
    | undefined;
  return choices?.[0]?.delta?.content ?? "";
}

/**
 * Ambil potongan audio (base64) dari satu event SSE. Model musik mengirim
 * audionya lewat delta.audio.data — hanya kalau permintaannya streaming.
 */
export function deltaAudio(event: Record<string, unknown>): string {
  const choices = event.choices as
    | Array<{ delta?: { audio?: { data?: string | null } } }>
    | undefined;
  return choices?.[0]?.delta?.audio?.data ?? "";
}
