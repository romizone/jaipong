/**
 * Mesin audio. Menyusun jalur campuran (bus, reverb, delay, kompresor),
 * lalu menjadwalkan peristiwa dari timeline — baik untuk didengarkan
 * langsung maupun untuk dirender jadi berkas WAV.
 */

import { drum } from "@/lib/audio/drums";
import { voice } from "@/lib/audio/instruments";
import {
  buildTimeline,
  type AudioEvent,
  type Bus,
  type LineMark,
  type Timeline,
} from "@/lib/audio/timeline";
import type { Song } from "@/lib/types";

export type Graph = {
  buses: Record<Bus, AudioNode>;
  master: GainNode;
};

/**
 * Impuls buatan untuk reverb — derau yang meluruh secara eksponensial.
 *
 * Menghitungnya berarti mengisi 2 x 106.000 sampel, dan jalur audio dibangun
 * ulang tiap kali tombol putar ditekan atau posisi digeser. Karena deretnya
 * tetap, hasilnya cukup dihitung sekali per AudioContext.
 */
const impulseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const cached = impulseCache.get(ctx);
  if (cached) return cached;

  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 9781;
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      const white = seed / 2147483648 - 1;
      data[i] = white * Math.pow(1 - i / length, decay);
    }
  }
  impulseCache.set(ctx, buffer);
  return buffer;
}

/**
 * Kurva pembatas puncak. Di bawah ambang batas sinyal dibiarkan apa adanya,
 * di atasnya ditekuk halus — jadi puncak tidak pernah melewati 0 dBFS
 * tanpa membuat bagian yang pelan ikut berubah warnanya.
 */
function softClipCurve(samples = 4096): Float32Array<ArrayBuffer> {
  const knee = 0.7;
  const ceiling = 1 - knee;
  // Buffer dibuat eksplisit supaya tipenya cocok dengan WaveShaperNode.curve.
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1;
    const magnitude = Math.abs(x);
    const shaped =
      magnitude <= knee
        ? magnitude
        : knee + ceiling * Math.tanh((magnitude - knee) / ceiling);
    curve[i] = Math.sign(x) * shaped;
  }
  return curve;
}

/** Sedikit sebaran kiri-kanan supaya campuran tidak menumpuk di tengah. */
const PAN: Record<Bus, number> = {
  lead: 0,
  chords: 0.18,
  bass: 0,
  arp: -0.28,
  drums: 0,
};

/** Seberapa banyak tiap jalur dikirim ke reverb. */
const REVERB_SEND: Record<Bus, number> = {
  lead: 0.22,
  chords: 0.3,
  bass: 0,
  arp: 0.34,
  drums: 0.1,
};

export function createGraph(ctx: BaseAudioContext, output: AudioNode): Graph {
  const master = ctx.createGain();
  master.gain.value = 0.85;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 20;
  compressor.ratio.value = 4.5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.22;

  // Kompresor masih meloloskan hentakan sesaat, jadi puncaknya dijaga
  // pembatas terakhir ini.
  const limiter = ctx.createWaveShaper();
  limiter.curve = softClipCurve();
  limiter.oversample = "4x";

  // Sedikit potongan bawah membersihkan dengung yang menumpuk.
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 32;

  master.connect(compressor).connect(limiter).connect(highpass).connect(output);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 2.4, 2.6);
  const reverbLevel = ctx.createGain();
  reverbLevel.gain.value = 0.5;
  reverb.connect(reverbLevel).connect(master);

  // Delay pendek khusus melodi utama, memberi ruang tanpa mengaburkan lirik.
  const delay = ctx.createDelay(1.2);
  delay.delayTime.value = 0.28;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.26;
  const delayLevel = ctx.createGain();
  delayLevel.gain.value = 0.18;
  delay.connect(feedback).connect(delay);
  delay.connect(delayLevel).connect(master);

  const buses = {} as Record<Bus, AudioNode>;

  for (const name of ["lead", "chords", "bass", "arp", "drums"] as Bus[]) {
    const gain = ctx.createGain();
    gain.gain.value = 1;

    const panner = ctx.createStereoPanner?.();
    if (panner) {
      panner.pan.value = PAN[name];
      gain.connect(panner).connect(master);
    } else {
      gain.connect(master);
    }

    const send = REVERB_SEND[name];
    if (send > 0) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = send;
      gain.connect(sendGain).connect(reverb);
    }

    if (name === "lead") {
      const sendGain = ctx.createGain();
      sendGain.gain.value = 0.3;
      gain.connect(sendGain).connect(delay);
    }

    buses[name] = gain;
  }

  return { buses, master };
}

/**
 * Jadwalkan satu peristiwa pada waktu AudioContext tertentu.
 *
 * Angka yang bukan bilangan berhingga dibuang di sini. Lagu tersimpan bisa
 * saja rusak (localStorage disunting, atau versi lama yang bentuknya beda),
 * dan osc.start(NaN) melempar kesalahan yang menjatuhkan seluruh halaman.
 */
function schedule(ctx: BaseAudioContext, graph: Graph, event: AudioEvent, at: number): void {
  if (!Number.isFinite(at) || !Number.isFinite(event.gain)) return;

  if (event.kind === "drum") {
    drum(event.drum)({ ctx, dest: graph.buses.drums, t: at, gain: event.gain });
    return;
  }
  if (!Number.isFinite(event.freq) || !Number.isFinite(event.dur)) return;

  voice(event.voice)({
    ctx,
    dest: graph.buses[event.bus],
    freq: event.freq,
    t: at,
    dur: event.dur,
    gain: event.gain,
    bright: event.bright,
    syllable: event.syllable,
  });
}

/* ------------------------------------------------------------- ekspor --- */

/** Render seluruh lagu menjadi AudioBuffer. Vokal ucapan tidak ikut. */
export async function renderSong(
  song: Song,
  onProgress?: (ratio: number) => void,
): Promise<AudioBuffer> {
  const timeline = buildTimeline(song);
  const sampleRate = 44_100;
  const tail = 3;
  const length = Math.ceil((timeline.duration + tail) * sampleRate);

  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const graph = createGraph(ctx, ctx.destination);

  timeline.events.forEach((event, index) => {
    schedule(ctx, graph, event, event.t + 0.05);
    if (onProgress && index % 200 === 0) {
      onProgress((index / timeline.events.length) * 0.5);
    }
  });

  const buffer = await ctx.startRendering();
  onProgress?.(1);
  return buffer;
}

/* ------------------------------------------------------------ pemutar --- */

const LOOKAHEAD_SEC = 1.4;
const TICK_MS = 120;

export type PlayerState = "idle" | "playing" | "paused";

export type PlayerCallbacks = {
  onPosition?: (seconds: number) => void;
  onState?: (state: PlayerState) => void;
  onEnd?: () => void;
};

/**
 * Pemutar dengan penjadwalan bertahap: peristiwa dijadwalkan sedikit demi
 * sedikit menjelang waktunya, bukan sekaligus di awal. Tanpa ini, lagu tiga
 * menit akan membuat browser tersendat saat tombol putar ditekan.
 */
export class SongPlayer {
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private analyser: AnalyserNode | null = null;
  private outlet: GainNode | null = null;

  private timeline: Timeline | null = null;
  private song: Song | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private cursor = 0;
  private startCtxTime = 0;
  private startSongTime = 0;
  private pausedAt = 0;
  private state: PlayerState = "idle";
  private volume = 0.9;

  /**
   * Nyanyian lewat SpeechSynthesis — hanya saat diputar langsung, dan kini
   * mati bawaan: pembaca teks bernada tunggal terdengar seperti orang
   * berpuisi di atas lagu, bukan menyanyi. Tombol mikrofon menyalakannya
   * kembali bagi yang mau.
   */
  private singing = false;
  private spoken = new Set<number>();
  private lineIndex: Array<{ line: LineMark; id: number }> = [];
  /** Ucapan yang sudah dijadwalkan tapi belum berbunyi; dibatalkan saat berhenti. */
  private pendingSpeech = new Set<ReturnType<typeof setTimeout>>();

  constructor(private callbacks: PlayerCallbacks = {}) {}

  get currentState(): PlayerState {
    return this.state;
  }

  get duration(): number {
    return this.timeline?.duration ?? 0;
  }

  get sections() {
    return this.timeline?.sections ?? [];
  }

  get frequencyData(): AnalyserNode | null {
    return this.analyser;
  }

  get songId(): string | null {
    return this.song?.id ?? null;
  }

  setSinging(enabled: boolean): void {
    this.singing = enabled;
    if (!enabled) cancelSpeech();
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.graph) this.graph.master.gain.value = this.volume;
  }

  /**
   * Buka kunci audio. Browser hanya mengizinkan suara berbunyi kalau
   * AudioContext dibuat dari sentuhan pengguna, jadi ini dipanggil langsung
   * di penangan klik — jauh sebelum lagunya selesai disusun.
   */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") void ctx.resume();
  }

  load(song: Song): void {
    this.stop();
    this.song = song;
    // buildTimeline menyimpan hasilnya per lagu, jadi panel lirik dan pemutar
    // memakai perhitungan yang sama, bukan menghitung dua kali.
    this.timeline = buildTimeline(song);
    this.pausedAt = 0;

    let id = 0;
    this.lineIndex = this.timeline.sections.flatMap((section) =>
      section.lines
        .filter((line) => line.text && line.syllables.length)
        .map((line) => ({ line, id: id++ })),
    );
  }

  /** Jam lagu dalam detik. */
  position(): number {
    if (this.state !== "playing" || !this.ctx) return this.pausedAt;
    return this.startSongTime + (this.ctx.currentTime - this.startCtxTime);
  }

  async play(from?: number): Promise<void> {
    if (!this.timeline) return;

    const ctx = this.ensureContext();
    if (ctx.state === "suspended") await ctx.resume();

    const start = from ?? this.pausedAt;
    this.rebuildGraph();
    this.spoken.clear();

    this.cursor = start;
    this.startSongTime = start;
    this.startCtxTime = ctx.currentTime + 0.08;
    this.setState("playing");

    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.pausedAt = this.position();
    this.silence();
    this.setState("paused");
  }

  stop(): void {
    this.pausedAt = 0;
    this.silence();
    this.setState("idle");
    this.callbacks.onPosition?.(0);
  }

  seek(seconds: number): void {
    const target = Math.min(this.duration, Math.max(0, seconds));
    const wasPlaying = this.state === "playing";
    this.silence();
    this.pausedAt = target;
    this.callbacks.onPosition?.(target);
    if (wasPlaying) void this.play(target);
    else this.setState(this.state === "idle" ? "idle" : "paused");
  }

  dispose(): void {
    this.silence();
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.outlet = null;
  }

  /* ------------------------------------------------------------ dalam --- */

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctor();

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;

    const outlet = ctx.createGain();
    outlet.connect(analyser);
    analyser.connect(ctx.destination);

    this.ctx = ctx;
    this.analyser = analyser;
    this.outlet = outlet;
    return ctx;
  }

  /**
   * Bangun ulang jalur audio. Node lama dilepas dari keluaran, jadi bunyi
   * yang sudah terlanjur dijadwalkan langsung senyap tanpa perlu dilacak
   * satu per satu.
   */
  private rebuildGraph(): void {
    const ctx = this.ensureContext();
    this.graph?.master.disconnect();
    this.graph = createGraph(ctx, this.outlet!);
    this.graph.master.gain.value = this.volume;
  }

  private silence(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.graph?.master.disconnect();
    this.graph = null;
    for (const handle of this.pendingSpeech) clearTimeout(handle);
    this.pendingSpeech.clear();
    cancelSpeech();
  }

  private setState(state: PlayerState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks.onState?.(state);
  }

  private tick(): void {
    if (!this.ctx || !this.graph || !this.timeline) return;

    const now = this.position();
    this.callbacks.onPosition?.(Math.min(now, this.duration));

    if (now >= this.duration) {
      this.silence();
      this.pausedAt = 0;
      this.setState("idle");
      this.callbacks.onEnd?.();
      return;
    }

    const until = now + LOOKAHEAD_SEC;
    const events = this.timeline.events;

    // Cari titik awal sekali saja; setelahnya cukup maju berurutan.
    let index = lowerBound(events, this.cursor);
    while (index < events.length && events[index]!.t < until) {
      const event = events[index]!;
      const at = this.startCtxTime + (event.t - this.startSongTime);
      if (at >= this.ctx.currentTime) {
        schedule(this.ctx, this.graph, event, at);
      }
      index += 1;
    }
    this.cursor = until;

    if (this.singing) this.scheduleSinging(now, until);
  }

  /** Ucapkan lirik baris demi baris, disetel mengikuti melodinya. */
  private scheduleSinging(now: number, until: number): void {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!this.song || this.song.vocal === "none") return;

    for (const { line, id } of this.lineIndex) {
      if (this.spoken.has(id)) continue;
      if (line.start < now - 0.3 || line.start >= until) continue;
      this.spoken.add(id);

      const delayMs = Math.max(0, (line.start - now) * 1000);
      const seconds = Math.max(0.6, line.end - line.start);
      const syllableCount = Math.max(1, line.syllables.length);

      const handle = setTimeout(() => {
        this.pendingSpeech.delete(handle);
        if (this.state !== "playing") return;
        speakLine(line.text, seconds, syllableCount, this.song!.vocal);
      }, delayMs);
      this.pendingSpeech.add(handle);
    }
  }
}

/** Cari indeks peristiwa pertama yang waktunya >= target. */
function lowerBound(events: AudioEvent[], target: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (events[mid]!.t < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/* -------------------------------------------------------------- suara --- */

/**
 * Satu simpanan per jenis suara. Sebelumnya hanya ada satu, jadi lagu vokal
 * pria yang diputar setelah lagu vokal wanita ikut memakai suara wanita.
 */
const cachedVoices: Record<"male" | "female", SpeechSynthesisVoice | null | undefined> = {
  male: undefined,
  female: undefined,
};

// Nama suara tidak baku antar sistem, jadi pencocokannya sekadar usaha.
// "damayanti" sengaja hanya ada di daftar wanita — itu suara wanita id-ID,
// dan mencantumkannya di kedua daftar membuat vokal pria salah pilih.
const VOICE_HINT: Record<"male" | "female", RegExp> = {
  male: /(male|pria|laki|arif|ardi|budi)/i,
  female: /(female|wanita|perempuan|damayanti|siti|dewi)/i,
};

function pickSpeechVoice(vocal: "male" | "female"): SpeechSynthesisVoice | null {
  const cached = cachedVoices[vocal];
  if (cached !== undefined) return cached;

  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const indonesian = voices.filter((v) => v.lang.toLowerCase().startsWith("id"));
  const pool = indonesian.length ? indonesian : voices;

  // Kalau tidak ada yang cocok, jangan ambil suara yang sudah jelas milik
  // jenis lain — lebih baik jatuh ke suara pertama yang netral.
  const other = VOICE_HINT[vocal === "male" ? "female" : "male"];
  const picked =
    pool.find((v) => VOICE_HINT[vocal].test(v.name)) ??
    pool.find((v) => !other.test(v.name)) ??
    pool[0] ??
    null;

  cachedVoices[vocal] = picked;
  return picked;
}

function speakLine(
  text: string,
  seconds: number,
  syllables: number,
  vocal: "male" | "female" | "none",
): void {
  if (vocal === "none" || !text.trim()) return;

  const utterance = new SpeechSynthesisUtterance(text);
  const selected = pickSpeechVoice(vocal);
  if (selected) {
    utterance.voice = selected;
    utterance.lang = selected.lang;
  } else {
    utterance.lang = "id-ID";
  }

  // Kira-kira 3,6 suku kata per detik pada kecepatan normal.
  utterance.rate = Math.min(2, Math.max(0.5, syllables / seconds / 3.6));
  utterance.pitch = vocal === "male" ? 0.75 : 1.35;
  utterance.volume = 0.95;

  window.speechSynthesis.speak(utterance);
}

function cancelSpeech(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}

/** Panaskan daftar suara — beberapa browser baru mengisinya setelah dipanggil. */
export function warmSpeechVoices(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoices.male = undefined;
    cachedVoices.female = undefined;
    window.speechSynthesis.getVoices();
  };
}
