"use client";

import type { ComposeEvent } from "@/lib/types";

/** Baca aliran SSE dari /api/compose menjadi peristiwa satu per satu. */
export async function* readComposeStream(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<ComposeEvent> {
  if (!response.body) throw new Error("Aliran tidak tersedia.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index: number;
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            yield JSON.parse(line.slice(5).trim()) as ComposeEvent;
          } catch {
            // Potongan rusak diabaikan.
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
