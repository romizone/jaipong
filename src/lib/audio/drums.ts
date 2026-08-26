/**
 * Perkusi. Semuanya disintesis dari osilator dan derau — tidak ada sampel,
 * jadi tidak ada berkas audio yang perlu diunduh pengguna.
 */

import { noiseBuffer } from "@/lib/audio/instruments";

export type DrumName =
  | "kick"
  | "snare"
  | "rim"
  | "clap"
  | "hat"
  | "hatOpen"
  | "tomLow"
  | "tomMid"
  | "tomHigh"
  | "ride"
  | "crash"
  | "shaker"
  | "cowbell"
  | "gong"
  | "kendangDung"
  | "kendangTak"
  | "kendangPak";

export type DrumOptions = {
  ctx: BaseAudioContext;
  dest: AudioNode;
  t: number;
  gain: number;
};

type DrumVoice = (opts: DrumOptions) => void;

function noise(ctx: BaseAudioContext, t: number, dur: number): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;
  // Titik mulai yang berbeda-beda supaya tiap pukulan tidak identik.
  source.playbackRate.setValueAtTime(1, t);
  source.start(t, (t * 7.3) % 1.5);
  source.stop(t + dur + 0.05);
  return source;
}

function decayGain(
  ctx: BaseAudioContext,
  t: number,
  peak: number,
  dur: number,
  attack = 0.001,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
}

/** Membran bernada: dipakai kick, tom, dan kendang. */
function membrane(config: {
  from: number;
  to: number;
  pitchTime: number;
  dur: number;
  level: number;
  click?: number;
  type?: OscillatorType;
}): DrumVoice {
  return ({ ctx, dest, t, gain }) => {
    const o = ctx.createOscillator();
    o.type = config.type ?? "sine";
    o.frequency.setValueAtTime(config.from, t);
    o.frequency.exponentialRampToValueAtTime(config.to, t + config.pitchTime);
    o.start(t);
    o.stop(t + config.dur + 0.05);

    const amp = decayGain(ctx, t, gain * config.level, config.dur, 0.002);
    o.connect(amp).connect(dest);

    if (config.click) {
      const n = noise(ctx, t, 0.02);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(2400, t);
      const clickGain = decayGain(ctx, t, gain * config.click, 0.02);
      n.connect(filter).connect(clickGain).connect(dest);
    }
  };
}

/** Derau berfilter: dipakai snare, hi-hat, dan simbal. */
function metallic(config: {
  type: BiquadFilterType;
  frequency: number;
  q: number;
  dur: number;
  level: number;
  tone?: { freq: number; level: number };
}): DrumVoice {
  return ({ ctx, dest, t, gain }) => {
    const n = noise(ctx, t, config.dur);
    const filter = ctx.createBiquadFilter();
    filter.type = config.type;
    filter.frequency.setValueAtTime(config.frequency, t);
    filter.Q.setValueAtTime(config.q, t);
    const amp = decayGain(ctx, t, gain * config.level, config.dur);
    n.connect(filter).connect(amp).connect(dest);

    if (config.tone) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(config.tone.freq, t);
      o.start(t);
      o.stop(t + config.dur);
      const toneGain = decayGain(ctx, t, gain * config.tone.level, config.dur * 0.6);
      o.connect(toneGain).connect(dest);
    }
  };
}

const DRUMS: Record<DrumName, DrumVoice> = {
  kick: membrane({
    from: 155,
    to: 45,
    pitchTime: 0.06,
    dur: 0.42,
    level: 1,
    click: 0.22,
  }),

  snare: ({ ctx, dest, t, gain }) => {
    metallic({
      type: "highpass",
      frequency: 1500,
      q: 0.7,
      dur: 0.19,
      level: 0.7,
    })({ ctx, dest, t, gain });
    // Nada badan drum di bawah deraunya.
    membrane({ from: 250, to: 170, pitchTime: 0.05, dur: 0.13, level: 0.4 })({
      ctx,
      dest,
      t,
      gain,
    });
  },

  rim: metallic({
    type: "bandpass",
    frequency: 2100,
    q: 6,
    dur: 0.06,
    level: 0.75,
    tone: { freq: 420, level: 0.3 },
  }),

  clap: ({ ctx, dest, t, gain }) => {
    // Tiga letupan berdekatan — inilah yang membuat tepukan terdengar ramai.
    [0, 0.011, 0.023, 0.038].forEach((offset, index) => {
      const n = noise(ctx, t + offset, 0.12);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1350, t + offset);
      filter.Q.setValueAtTime(1.4, t + offset);
      const amp = decayGain(
        ctx,
        t + offset,
        gain * (index === 3 ? 0.6 : 0.32),
        index === 3 ? 0.19 : 0.045,
      );
      n.connect(filter).connect(amp).connect(dest);
    });
  },

  hat: metallic({ type: "highpass", frequency: 8200, q: 1.1, dur: 0.045, level: 0.42 }),
  hatOpen: metallic({ type: "highpass", frequency: 7600, q: 1, dur: 0.32, level: 0.36 }),
  ride: metallic({
    type: "bandpass",
    frequency: 5200,
    q: 1.6,
    dur: 0.7,
    level: 0.3,
    tone: { freq: 3400, level: 0.06 },
  }),
  crash: metallic({ type: "highpass", frequency: 3600, q: 0.6, dur: 1.5, level: 0.5 }),
  shaker: metallic({ type: "highpass", frequency: 6800, q: 2.2, dur: 0.06, level: 0.3 }),

  tomLow: membrane({ from: 180, to: 90, pitchTime: 0.14, dur: 0.4, level: 0.75 }),
  tomMid: membrane({ from: 260, to: 130, pitchTime: 0.12, dur: 0.34, level: 0.72 }),
  tomHigh: membrane({ from: 360, to: 190, pitchTime: 0.1, dur: 0.28, level: 0.7 }),

  cowbell: ({ ctx, dest, t, gain }) => {
    const amp = decayGain(ctx, t, gain * 0.4, 0.16);
    amp.connect(dest);
    [540, 810].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(f, t);
      o.start(t);
      o.stop(t + 0.2);
      const level = ctx.createGain();
      level.gain.setValueAtTime(0.5, t);
      o.connect(level).connect(amp);
    });
  },

  /** Gong: dentuman rendah dengan ekor panjang, penanda awal siklus. */
  gong: ({ ctx, dest, t, gain }) => {
    const amp = decayGain(ctx, t, gain * 0.55, 3.2, 0.02);
    amp.connect(dest);
    // Perbandingan tidak harmonis memberi bunyi logam besar.
    ([[1, 0.5], [1.47, 0.28], [2.09, 0.18], [3.13, 0.1]] as const).forEach(
      ([multiple, level]) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(58 * multiple, t);
        o.start(t);
        o.stop(t + 3.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(level, t);
        o.connect(g).connect(amp);
      },
    );
    const n = noise(ctx, t, 0.3);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(900, t);
    const shimmer = decayGain(ctx, t, gain * 0.12, 0.3);
    n.connect(filter).connect(shimmer).connect(dest);
  },

  /** Kendang "dung": pukulan telapak di sisi besar, bernada rendah dan bulat. */
  kendangDung: membrane({
    from: 210,
    to: 82,
    pitchTime: 0.08,
    dur: 0.34,
    level: 0.85,
    click: 0.1,
  }),

  /** Kendang "tak": tamparan jari di sisi kecil, pendek dan kering. */
  kendangTak: ({ ctx, dest, t, gain }) => {
    const n = noise(ctx, t, 0.07);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(3200, t);
    filter.Q.setValueAtTime(2.4, t);
    const amp = decayGain(ctx, t, gain * 0.55, 0.07);
    n.connect(filter).connect(amp).connect(dest);

    membrane({ from: 720, to: 480, pitchTime: 0.02, dur: 0.06, level: 0.3 })({
      ctx,
      dest,
      t,
      gain,
    });
  },

  /** Kendang "pak": tamparan terbuka, di antara dung dan tak. */
  kendangPak: ({ ctx, dest, t, gain }) => {
    membrane({ from: 420, to: 240, pitchTime: 0.05, dur: 0.18, level: 0.55, click: 0.14 })({
      ctx,
      dest,
      t,
      gain,
    });
  },
};

export function drum(name: DrumName): DrumVoice {
  return DRUMS[name] ?? DRUMS.kick;
}
