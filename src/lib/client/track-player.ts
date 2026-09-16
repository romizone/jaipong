"use client";

import type { PlayerCallbacks, PlayerState } from "@/lib/audio/engine";

/**
 * Pemutar untuk lagu yang audionya berkas jadi (hasil model musik).
 *
 * Berkasnya didekode penuh ke AudioBuffer lalu diputar lewat Web Audio,
 * bukan lewat <audio>: mulai putarnya tunduk pada AudioContext yang sudah
 * dibuka saat pengguna mengeklik — bukan pada kebijakan autoplay elemen
 * media, yang menolak play() beberapa puluh detik setelah klik terakhir.
 * Bonusnya, analisernya sama dengan pemutar synth, jadi visualizer dan
 * kendali volume tinggal pakai.
 */
export class TrackPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;

  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private startCtxTime = 0;
  private startOffset = 0;
  private pausedAt = 0;
  private state: PlayerState = "idle";
  private volume = 0.9;

  constructor(private callbacks: PlayerCallbacks = {}) {}

  get currentState(): PlayerState {
    return this.state;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get frequencyData(): AnalyserNode | null {
    return this.analyserNode;
  }

  /**
   * Buka kunci audio selagi klik pengguna masih berlaku. Selain "suspended",
   * iOS Safari punya "interrupted" (telepon masuk, layar terkunci) — apa pun
   * selain "running" perlu dibangunkan.
   */
  unlock(): void {
    const ctx = this.ensure();
    if (ctx.state !== "running") void ctx.resume();
  }

  /** Dekode berkas ke buffer — murni, tidak menyentuh keadaan pemutar. */
  async decode(blob: Blob): Promise<AudioBuffer> {
    const ctx = this.ensure();
    const bytes = await blob.arrayBuffer();
    return ctx.decodeAudioData(bytes);
  }

  /**
   * Pasang buffer sebagai lagu aktif. Dipisah dari decode() supaya pemanggil
   * bisa memutuskan dulu — dibatalkan? tersalip klik lain? — sebelum lagu
   * yang sedang berbunyi dihentikan dan buffer-nya diganti.
   */
  use(buffer: AudioBuffer): void {
    this.stop();
    this.buffer = buffer;
    this.pausedAt = 0;
  }

  position(): number {
    if (this.state !== "playing" || !this.ctx) return this.pausedAt;
    return Math.min(
      this.duration,
      this.startOffset + (this.ctx.currentTime - this.startCtxTime),
    );
  }

  async play(from?: number): Promise<void> {
    if (!this.buffer) return;
    const ctx = this.ensure();
    if (ctx.state !== "running") await ctx.resume();

    this.stopSource();
    const offset = Math.min(
      Math.max(0, from ?? this.pausedAt),
      Math.max(0, this.duration - 0.05),
    );

    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.master!);
    source.start(0, offset);

    this.source = source;
    this.startOffset = offset;
    this.startCtxTime = ctx.currentTime;
    this.setState("playing");
    this.timer = setInterval(() => this.tick(), 120);
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.pausedAt = this.position();
    this.stopSource();
    this.setState("paused");
  }

  stop(): void {
    this.pausedAt = 0;
    this.stopSource();
    this.setState("idle");
    this.callbacks.onPosition?.(0);
  }

  seek(seconds: number): void {
    const target = Math.min(this.duration, Math.max(0, seconds));
    const wasPlaying = this.state === "playing";
    this.stopSource();
    this.pausedAt = target;
    this.callbacks.onPosition?.(target);
    if (wasPlaying) void this.play(target);
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.master) this.master.gain.value = this.volume;
  }

  dispose(): void {
    this.stopSource();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.analyserNode = null;
    this.buffer = null;
  }

  /* ------------------------------------------------------------- dalam --- */

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctor();

    const master = ctx.createGain();
    master.gain.value = this.volume;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    master.connect(analyser).connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    this.analyserNode = analyser;
    return ctx;
  }

  private tick(): void {
    const pos = this.position();
    this.callbacks.onPosition?.(pos);
    if (pos >= this.duration - 0.05) {
      this.stopSource();
      this.pausedAt = 0;
      this.setState("idle");
      this.callbacks.onPosition?.(0);
      this.callbacks.onEnd?.();
    }
  }

  private stopSource(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // Sudah berhenti sendiri.
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  private setState(state: PlayerState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks.onState?.(state);
  }
}
