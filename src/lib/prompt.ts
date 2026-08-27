import type { SongPlan } from "@/lib/types";

/**
 * Penyusunan lagu berjalan dua tahap:
 *
 *   1. Model bahasa menulis RENCANA — judul, genre, deskripsi gaya, dan lirik.
 *      Formatnya baris-per-baris (bukan JSON) supaya bisa dialirkan ke layar
 *      begitu tiap barisnya selesai, dan terpotong pun sisanya tetap terpakai.
 *   2. Model musik (Lyria) menerima rencana itu dan membangkitkan audionya.
 *
 * Kualitas lirik ditentukan di sini; kualitas bunyi ditentukan model musik.
 */
export const PLAN_PROMPT = `Kamu penulis lagu dan penata musik profesional. Tulis rencana SATU lagu utuh dengan format PERSIS seperti ini — tanpa kalimat pembuka, tanpa penutup, tanpa pagar kode:

JUDUL: <judul singkat yang berkarakter>
GENRE: <label genre untuk pengguna, mis. Pop Ballad, Jaipong Modern>
TAG: <3-6 kata kunci gaya, huruf kecil, dipisah koma>
VOKAL: <wanita | pria | instrumental>
GAYA: <satu paragraf untuk model penyusun audio: genre, tempo dan kisaran BPM, instrumen utama, suasana, bahasa dan karakter vokal, serta dinamika antarbagian. Konkret dan spesifik.>
LIRIK:
[Intro]
[Verse 1]
<baris lirik>
<baris lirik>
[Chorus]
<baris lirik>

Aturan:
- Lirik ORISINAL. Jangan mengutip lagu yang sudah ada. Jangan menyebut atau meniru penyanyi tertentu — ambil nuansa genrenya saja.
- Bahasa lirik mengikuti bahasa permintaan pengguna; permintaan berbahasa Indonesia atau bahasa daerah dijawab dalam bahasa itu.
- Citra konkret mengalahkan abstraksi. "Kopi dingin di meja" lebih kuat dari "hatiku sedih". Baris 4-9 suku kata supaya enak dinyanyikan.
- Label bagian dalam kurung siku: [Intro], [Verse 1], [Chorus], [Bridge], [Outro]. Bagian instrumental cukup labelnya tanpa baris lirik.
- Sesuaikan jumlah bagian dengan durasi target: sekitar 45 detik cukup satu verse dan satu chorus; 3-4 menit berarti dua verse, chorus berulang, dan bridge.
- Chorus ditulis penuh setiap kali muncul, dengan kata yang sama persis.`;

export type ComposeInput = {
  prompt: string;
  duration: number;
  vocal: "male" | "female" | "none";
  instrumental: boolean;
  title?: string;
  lyrics?: string;
  styleTags?: string;
};

/** Rakit pesan pengguna untuk tahap rencana dari isian formulir. */
export function buildUserPrompt(input: ComposeInput): string {
  const parts: string[] = [];

  parts.push(`Durasi target: ${input.duration} detik.`);

  if (input.instrumental) {
    parts.push(
      'Lagu INSTRUMENTAL tanpa vokal. Tulis "VOKAL: instrumental" dan isi LIRIK hanya dengan label bagian.',
    );
  } else {
    const suara =
      input.vocal === "male"
        ? "vokal pria (rentang nada lebih rendah)"
        : "vokal wanita (rentang nada lebih tinggi)";
    parts.push(`Lagu dengan ${suara}.`);
  }

  if (input.styleTags?.trim()) {
    parts.push(`Gaya musik yang diminta: ${input.styleTags.trim()}`);
  }

  if (input.title?.trim()) {
    parts.push(`Judul yang harus dipakai: ${input.title.trim()}`);
  }

  if (input.lyrics?.trim()) {
    parts.push(
      `Pakai lirik berikut apa adanya. Bagi ke bagian-bagian lagu dengan label kurung siku, dan jangan mengubah kata-katanya:\n\n${input.lyrics.trim()}`,
    );
  }

  if (input.prompt.trim()) {
    parts.push(`Deskripsi lagu dari pengguna:\n${input.prompt.trim()}`);
  }

  return parts.join("\n\n");
}

/** Rakit pesan untuk model musik dari rencana yang sudah jadi. */
export function buildMusicPrompt(plan: SongPlan, duration: number): string {
  const parts: string[] = [];

  parts.push(plan.style || `Lagu ${plan.genreLabel}.`);
  parts.push(
    plan.vocal === "none"
      ? "Instrumental penuh tanpa vokal."
      : `Vokal ${plan.vocal === "male" ? "pria" : "wanita"}. Nyanyikan lirik berikut apa adanya — jangan mengubah, menambah, atau menerjemahkan kata-katanya.`,
  );
  parts.push(`Durasi sekitar ${duration} detik.`);

  if (plan.vocal !== "none" && plan.lyricsSheet) {
    parts.push(`Lirik:\n${plan.lyricsSheet}`);
  }

  return parts.join("\n\n");
}
