/**
 * Bank suara. Setiap fungsi menjadwalkan satu nada ke dalam AudioContext —
 * bisa konteks langsung (untuk diputar) maupun OfflineAudioContext (untuk
 * diekspor jadi WAV), karena keduanya memakai antarmuka yang sama.
 */

export type VoiceOptions = {
  ctx: BaseAudioContext;
  dest: AudioNode;
  /** Frekuensi nada dalam Hz. */
  freq: number;
  /** Waktu mulai pada jam AudioContext. */
  t: number;
  /** Panjang nada dalam detik. */
  dur: number;
  /** Kekuatan nada, 0–1. */
  gain: number;
  /** Keterbukaan filter, 0–1. Dipakai bagian yang lebih bertenaga. */
  bright?: number;
  /** Suku kata yang sedang dinyanyikan — menentukan vokal formant. */
  syllable?: string;
};

export type Voice = (opts: VoiceOptions) => void;

/* ------------------------------------------------------------ bantuan --- */

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Satu buffer derau putih dipakai ulang oleh seluruh perkusi. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;

  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deret acak yang tetap (LCG) supaya hasil ekspor selalu sama.
  let seed = 22222;
  for (let i = 0; i < data.length; i += 1) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    data[i] = (seed / 2147483648) - 1;
  }
  noiseCache.set(ctx, buffer);
  return buffer;
}

/** Amplop ADSR pada sebuah GainNode. */
function shape(
  param: AudioParam,
  t: number,
  dur: number,
  peak: number,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
): void {
  const hold = Math.max(0.02, dur);
  const end = t + hold;
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  param.exponentialRampToValueAtTime(
    Math.max(0.0002, peak * sustain),
    t + attack + decay,
  );
  param.setValueAtTime(Math.max(0.0002, peak * sustain), Math.max(end, t + attack + decay));
  param.exponentialRampToValueAtTime(0.0001, Math.max(end, t + attack + decay) + release);
}

function osc(
  ctx: BaseAudioContext,
  type: OscillatorType,
  freq: number,
  t: number,
  stop: number,
  detune = 0,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (detune) o.detune.setValueAtTime(detune, t);
  o.start(t);
  o.stop(stop);
  return o;
}

/** Getar nada halus untuk suara yang ditahan lama. */
function vibrato(
  ctx: BaseAudioContext,
  target: AudioParam,
  t: number,
  stop: number,
  rate: number,
  depth: number,
  delay = 0.18,
): void {
  const lfo = ctx.createOscillator();
  lfo.frequency.setValueAtTime(rate, t);
  const amount = ctx.createGain();
  amount.gain.setValueAtTime(0, t);
  amount.gain.linearRampToValueAtTime(depth, t + delay + 0.12);
  lfo.connect(amount).connect(target);
  lfo.start(t);
  lfo.stop(stop);
}

/* ------------------------------------------------------------- mesin ---- */

type SubtractiveConfig = {
  waves: Array<{ type: OscillatorType; detune: number; level: number; octave?: number }>;
  filter: BiquadFilterType;
  /** Cutoff sebagai kelipatan frekuensi nada. */
  cutoffRatio: number;
  cutoffFloor: number;
  resonance: number;
  /** Berapa kali cutoff dibuka di awal nada lalu menutup. */
  sweep: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  vibratoRate?: number;
  vibratoDepth?: number;
};

function subtractive(config: SubtractiveConfig): Voice {
  return ({ ctx, dest, freq, t, dur, gain, bright = 0.5 }) => {
    const stop = t + dur + config.release + 0.12;

    const filter = ctx.createBiquadFilter();
    filter.type = config.filter;
    filter.Q.setValueAtTime(config.resonance, t);

    const open = Math.min(
      16_000,
      Math.max(config.cutoffFloor, freq * config.cutoffRatio * (0.55 + bright * 0.9)),
    );
    if (config.sweep > 1) {
      filter.frequency.setValueAtTime(Math.min(16_000, open * config.sweep), t);
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(80, open),
        t + Math.min(0.45, dur * 0.6 + 0.05),
      );
    } else {
      filter.frequency.setValueAtTime(open, t);
    }

    const amp = ctx.createGain();
    shape(
      amp.gain,
      t,
      dur,
      gain,
      config.attack,
      config.decay,
      config.sustain,
      config.release,
    );

    filter.connect(amp).connect(dest);

    for (const wave of config.waves) {
      const f = freq * Math.pow(2, wave.octave ?? 0);
      const o = osc(ctx, wave.type, f, t, stop, wave.detune);
      if (config.vibratoRate && config.vibratoDepth) {
        vibrato(ctx, o.frequency, t, stop, config.vibratoRate, f * config.vibratoDepth);
      }
      const level = ctx.createGain();
      level.gain.setValueAtTime(wave.level, t);
      o.connect(level).connect(filter);
    }
  };
}

/** Sintesis FM dua operator — untuk lonceng, gamelan, dan piano elektrik. */
function fm(config: {
  ratio: number;
  index: number;
  indexDecay: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  carrier?: OscillatorType;
  detuneCents?: number;
}): Voice {
  return ({ ctx, dest, freq, t, dur, gain }) => {
    const stop = t + dur + config.release + 0.2;

    const carrier = osc(ctx, config.carrier ?? "sine", freq, t, stop, config.detuneCents ?? 0);
    const modulator = osc(ctx, "sine", freq * config.ratio, t, stop);

    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * config.index, t);
    modGain.gain.exponentialRampToValueAtTime(
      Math.max(1, freq * config.index * 0.02),
      t + config.indexDecay,
    );
    modulator.connect(modGain).connect(carrier.frequency);

    const amp = ctx.createGain();
    shape(amp.gain, t, dur, gain, config.attack, config.decay, config.sustain, config.release);
    carrier.connect(amp).connect(dest);
  };
}

const FORMANTS: Record<string, [number, number, number]> = {
  a: [800, 1180, 2800],
  e: [480, 1720, 2520],
  i: [300, 2280, 3000],
  o: [500, 900, 2600],
  u: [325, 780, 2400],
};

/** Ambil vokal utama dari satu suku kata. */
function vowelOf(syllable?: string): [number, number, number] {
  const text = (syllable ?? "a").toLowerCase();
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const formant = FORMANTS[text[i]!];
    if (formant) return formant;
  }
  return FORMANTS.a!;
}

/**
 * Suara "vokal": gelombang gigi gergaji yang dilewatkan tiga filter formant.
 * Bukan suara manusia sungguhan, tapi konturnya mengikuti melodi dan
 * vokalnya (a/i/u/e/o) ikut suku kata, jadi terdengar seperti bersenandung.
 */
const vocalVoice: Voice = ({ ctx, dest, freq, t, dur, gain, syllable }) => {
  const release = 0.16;
  const stop = t + dur + release + 0.2;
  const formants = vowelOf(syllable);

  const source = ctx.createGain();
  source.gain.setValueAtTime(1, t);

  const main = osc(ctx, "sawtooth", freq, t, stop);
  vibrato(ctx, main.frequency, t, stop, 5.2, freq * 0.012);
  const sub = osc(ctx, "sine", freq, t, stop, -4);
  const subLevel = ctx.createGain();
  subLevel.gain.setValueAtTime(0.35, t);

  main.connect(source);
  sub.connect(subLevel).connect(source);

  const amp = ctx.createGain();
  shape(amp.gain, t, dur, gain, 0.045, 0.09, 0.82, release);

  // Sedikit "napas" di awal suku kata membuat serangan nada terasa manusiawi.
  const breath = ctx.createBufferSource();
  breath.buffer = noiseBuffer(ctx);
  breath.loop = true;
  const breathFilter = ctx.createBiquadFilter();
  breathFilter.type = "bandpass";
  breathFilter.frequency.setValueAtTime(2200, t);
  breathFilter.Q.setValueAtTime(0.8, t);
  const breathGain = ctx.createGain();
  breathGain.gain.setValueAtTime(gain * 0.14, t);
  breathGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  breath.connect(breathFilter).connect(breathGain).connect(dest);
  breath.start(t);
  breath.stop(t + 0.15);

  formants.forEach((frequency, index) => {
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(frequency, t);
    band.Q.setValueAtTime(index === 0 ? 7 : 9, t);
    const level = ctx.createGain();
    level.gain.setValueAtTime([1, 0.55, 0.28][index]!, t);
    source.connect(band).connect(level).connect(amp);
  });

  // Sedikit sinyal asli ikut lewat supaya nadanya tetap terasa tebal.
  const direct = ctx.createGain();
  direct.gain.setValueAtTime(0.12, t);
  source.connect(direct).connect(amp);

  amp.connect(dest);
};

/** Suling/flute: nada murni dengan derau napas. */
function breathy(config: {
  breathLevel: number;
  vibratoRate: number;
  vibratoDepth: number;
  attack: number;
}): Voice {
  return ({ ctx, dest, freq, t, dur, gain }) => {
    const release = 0.12;
    const stop = t + dur + release + 0.2;

    const amp = ctx.createGain();
    shape(amp.gain, t, dur, gain, config.attack, 0.1, 0.85, release);
    amp.connect(dest);

    const main = osc(ctx, "sine", freq, t, stop);
    vibrato(ctx, main.frequency, t, stop, config.vibratoRate, freq * config.vibratoDepth, 0.22);
    const mainLevel = ctx.createGain();
    mainLevel.gain.setValueAtTime(0.85, t);
    main.connect(mainLevel).connect(amp);

    // Harmonik kedua tipis memberi warna seruling bambu.
    const overtone = osc(ctx, "triangle", freq * 2, t, stop, 6);
    const overtoneLevel = ctx.createGain();
    overtoneLevel.gain.setValueAtTime(0.12, t);
    overtone.connect(overtoneLevel).connect(amp);

    const breath = ctx.createBufferSource();
    breath.buffer = noiseBuffer(ctx);
    breath.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(freq * 2.2, t);
    band.Q.setValueAtTime(1.6, t);
    const breathGain = ctx.createGain();
    breathGain.gain.setValueAtTime(0.0001, t);
    breathGain.gain.exponentialRampToValueAtTime(gain * config.breathLevel, t + 0.06);
    breathGain.gain.exponentialRampToValueAtTime(gain * config.breathLevel * 0.4, t + dur);
    breath.connect(band).connect(breathGain).connect(dest);
    breath.start(t);
    breath.stop(stop);
  };
}

type StringConfig = { damp: number; level: number; body: number };

/** Dawai yang sudah dihitung, dipakai ulang antar nada yang sama. */
const stringCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
const STRING_CACHE_MAX = 96;

/**
 * Hitung satu dawai Karplus-Strong langsung ke dalam buffer.
 *
 * Cara yang lebih ringkas — DelayNode dengan umpan balik dan delayTime = 1/freq —
 * tidak bisa dipakai: spesifikasi Web Audio menjepit delay di dalam siklus ke
 * minimum satu render quantum (128 sampel, sekitar 2,9 ms pada 44,1 kHz), jadi
 * setiap nada di atas ~345 Hz keluar dengan tinggi nada yang sama. Menghitungnya
 * sendiri membuat nadanya benar di seluruh rentang, dan hasilnya sama persis
 * antara pemutaran langsung dan ekspor WAV.
 */
function stringBuffer(
  ctx: BaseAudioContext,
  freq: number,
  seconds: number,
  config: StringConfig,
): AudioBuffer {
  const rate = ctx.sampleRate;
  // Panjang gelung = satu periode dalam sampel.
  const period = Math.max(2, Math.round(rate / freq));
  const length = Math.max(period + 2, Math.round(seconds * rate));

  const key = period + "|" + length + "|" + config.damp;
  let byKey = stringCache.get(ctx);
  if (!byKey) {
    byKey = new Map();
    stringCache.set(ctx, byKey);
  }
  const cached = byKey.get(key);
  if (cached) return cached;

  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);

  // Petikan awal: derau dengan deret tetap (LCG) supaya ekspor selalu sama.
  let seed = 4159 + period;
  for (let i = 0; i < period; i += 1) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    data[i] = seed / 2147483648 - 1;
  }

  // "damp" berlaku sekali tiap putaran gelung, jadi nada tinggi — yang
  // putarannya jauh lebih sering per detik — akan lenyap terlalu cepat kalau
  // angkanya dipakai apa adanya. Eksponennya disesuaikan supaya lama luruhnya
  // kira-kira sama di seluruh rentang.
  const perLoop = Math.pow(config.damp, 220 / Math.max(60, freq));
  for (let i = period; i < length; i += 1) {
    data[i] = perLoop * 0.5 * (data[i - period]! + data[i - period + 1]!);
  }

  if (byKey.size >= STRING_CACHE_MAX) {
    const oldest = byKey.keys().next().value;
    if (oldest !== undefined) byKey.delete(oldest);
  }
  byKey.set(key, buffer);
  return buffer;
}

/** Petikan dawai gaya Karplus-Strong. */
function plucked(config: StringConfig): Voice {
  return ({ ctx, dest, freq, t, dur, gain }) => {
    if (!Number.isFinite(freq) || freq <= 20) return;

    // Panjang dibulatkan ke seperempat detik supaya buffer-nya bisa dipakai ulang.
    const seconds = Math.min(4, Math.max(0.3, Math.ceil((dur + 0.6) * 4) / 4));
    const stop = t + seconds;

    const source = ctx.createBufferSource();
    source.buffer = stringBuffer(ctx, freq, seconds, config);
    source.start(t);
    source.stop(stop);

    // "body" mengatur warna badan dawai, seperti sebelumnya.
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.setValueAtTime(
      Math.min(9000, Math.max(300, freq * config.body)),
      t,
    );

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(Math.max(0.0002, gain * config.level), t);
    amp.gain.exponentialRampToValueAtTime(0.0001, stop);

    source.connect(tone).connect(amp).connect(dest);
  };
}

/* ---------------------------------------------------------- daftar ------ */

const VOICES: Record<string, Voice> = {
  vocal: vocalVoice,

  lead_synth: subtractive({
    waves: [
      { type: "sawtooth", detune: -7, level: 0.5 },
      { type: "sawtooth", detune: 7, level: 0.5 },
      { type: "square", detune: 0, level: 0.18, octave: -1 },
    ],
    filter: "lowpass",
    cutoffRatio: 7,
    cutoffFloor: 900,
    resonance: 5,
    sweep: 2.4,
    attack: 0.012,
    decay: 0.14,
    sustain: 0.72,
    release: 0.2,
    vibratoRate: 5.5,
    vibratoDepth: 0.006,
  }),

  guitar_clean: plucked({ damp: 0.965, level: 0.55, body: 6 }),
  guitar_nylon: plucked({ damp: 0.955, level: 0.5, body: 4.2 }),
  harp: plucked({ damp: 0.972, level: 0.45, body: 7 }),
  pluck: plucked({ damp: 0.94, level: 0.5, body: 9 }),

  guitar_dist: subtractive({
    waves: [
      { type: "square", detune: -9, level: 0.42 },
      { type: "sawtooth", detune: 9, level: 0.42 },
      { type: "square", detune: 0, level: 0.3, octave: -1 },
    ],
    filter: "lowpass",
    cutoffRatio: 9,
    cutoffFloor: 1400,
    resonance: 3,
    sweep: 1.6,
    attack: 0.006,
    decay: 0.1,
    sustain: 0.8,
    release: 0.18,
  }),

  piano: subtractive({
    waves: [
      { type: "triangle", detune: 0, level: 0.6 },
      { type: "sawtooth", detune: 4, level: 0.22 },
      { type: "sine", detune: 0, level: 0.3, octave: 1 },
    ],
    filter: "lowpass",
    cutoffRatio: 8,
    cutoffFloor: 1100,
    resonance: 0.7,
    sweep: 3.2,
    attack: 0.004,
    decay: 0.9,
    sustain: 0.22,
    release: 0.35,
  }),

  epiano: fm({
    ratio: 3.02,
    index: 1.6,
    indexDecay: 0.42,
    attack: 0.006,
    decay: 0.7,
    sustain: 0.3,
    release: 0.4,
  }),

  bell: fm({
    ratio: 3.51,
    index: 4.2,
    indexDecay: 0.32,
    attack: 0.003,
    decay: 1.1,
    sustain: 0.14,
    release: 0.9,
  }),

  gamelan: fm({
    // Perbandingan tidak harmonis inilah yang memberi warna logam gamelan.
    ratio: 2.76,
    index: 5.4,
    indexDecay: 0.22,
    attack: 0.002,
    decay: 0.85,
    sustain: 0.1,
    release: 1.2,
    detuneCents: 6,
  }),

  marimba: fm({
    ratio: 4.01,
    index: 2.6,
    indexDecay: 0.12,
    attack: 0.002,
    decay: 0.36,
    sustain: 0.06,
    release: 0.3,
  }),

  organ: ({ ctx, dest, freq, t, dur, gain }) => {
    const release = 0.08;
    const stop = t + dur + release + 0.1;
    const amp = ctx.createGain();
    shape(amp.gain, t, dur, gain, 0.008, 0.03, 0.95, release);
    amp.connect(dest);
    // Drawbar: dasar, oktaf, kuint, dua oktaf.
    ([[1, 0.5], [2, 0.28], [3, 0.16], [4, 0.12]] as const).forEach(
      ([multiple, level]) => {
        const o = osc(ctx, "sine", freq * multiple, t, stop);
        const g = ctx.createGain();
        g.gain.setValueAtTime(level, t);
        o.connect(g).connect(amp);
      },
    );
  },

  pad: subtractive({
    waves: [
      { type: "sawtooth", detune: -11, level: 0.34 },
      { type: "sawtooth", detune: 11, level: 0.34 },
      { type: "triangle", detune: 0, level: 0.3, octave: -1 },
    ],
    filter: "lowpass",
    cutoffRatio: 4.5,
    cutoffFloor: 500,
    resonance: 1.2,
    sweep: 1.8,
    attack: 0.5,
    decay: 0.6,
    sustain: 0.8,
    release: 0.9,
    vibratoRate: 0.25,
    vibratoDepth: 0.003,
  }),

  strings: subtractive({
    waves: [
      { type: "sawtooth", detune: -6, level: 0.3 },
      { type: "sawtooth", detune: 6, level: 0.3 },
      { type: "sawtooth", detune: 0, level: 0.24, octave: 1 },
    ],
    filter: "lowpass",
    cutoffRatio: 6,
    cutoffFloor: 800,
    resonance: 0.9,
    sweep: 1.5,
    attack: 0.22,
    decay: 0.3,
    sustain: 0.85,
    release: 0.55,
    vibratoRate: 5,
    vibratoDepth: 0.005,
  }),

  violin: subtractive({
    waves: [
      { type: "sawtooth", detune: -3, level: 0.45 },
      { type: "sawtooth", detune: 3, level: 0.35 },
    ],
    filter: "lowpass",
    cutoffRatio: 8,
    cutoffFloor: 1200,
    resonance: 2.4,
    sweep: 1.3,
    attack: 0.09,
    decay: 0.16,
    sustain: 0.86,
    release: 0.3,
    vibratoRate: 6,
    vibratoDepth: 0.011,
  }),

  brass: subtractive({
    waves: [
      { type: "sawtooth", detune: -5, level: 0.42 },
      { type: "sawtooth", detune: 5, level: 0.42 },
    ],
    filter: "lowpass",
    cutoffRatio: 5,
    cutoffFloor: 700,
    resonance: 4,
    sweep: 3,
    attack: 0.05,
    decay: 0.2,
    sustain: 0.78,
    release: 0.22,
    vibratoRate: 5,
    vibratoDepth: 0.004,
  }),

  sax: subtractive({
    waves: [
      { type: "sawtooth", detune: 0, level: 0.5 },
      { type: "square", detune: 6, level: 0.22 },
    ],
    filter: "bandpass",
    cutoffRatio: 3.2,
    cutoffFloor: 600,
    resonance: 3.5,
    sweep: 1.8,
    attack: 0.04,
    decay: 0.18,
    sustain: 0.8,
    release: 0.25,
    vibratoRate: 5.6,
    vibratoDepth: 0.01,
  }),

  choir: ({ ctx, dest, freq, t, dur, gain, syllable }) => {
    // Paduan suara = beberapa suara formant yang sedikit berbeda nada.
    ([-8, 0, 9] as const).forEach((detune, index) => {
      vocalVoice({
        ctx,
        dest,
        freq: freq * Math.pow(2, detune / 1200),
        t: t + index * 0.012,
        dur,
        gain: gain * 0.42,
        syllable: syllable ?? "a",
      });
    });
  },

  flute: breathy({ breathLevel: 0.1, vibratoRate: 5, vibratoDepth: 0.007, attack: 0.06 }),
  suling: breathy({ breathLevel: 0.16, vibratoRate: 6.2, vibratoDepth: 0.014, attack: 0.05 }),

  bass_round: subtractive({
    waves: [
      { type: "sine", detune: 0, level: 0.7 },
      { type: "triangle", detune: 0, level: 0.3, octave: 1 },
    ],
    filter: "lowpass",
    cutoffRatio: 5,
    cutoffFloor: 180,
    resonance: 1,
    sweep: 2.2,
    attack: 0.008,
    decay: 0.2,
    sustain: 0.68,
    release: 0.14,
  }),

  bass_pick: subtractive({
    waves: [
      { type: "sawtooth", detune: 0, level: 0.45 },
      { type: "square", detune: 0, level: 0.25 },
    ],
    filter: "lowpass",
    cutoffRatio: 6,
    cutoffFloor: 240,
    resonance: 3,
    sweep: 3.4,
    attack: 0.004,
    decay: 0.14,
    sustain: 0.5,
    release: 0.12,
  }),

  bass_sub: subtractive({
    waves: [{ type: "sine", detune: 0, level: 0.95 }],
    filter: "lowpass",
    cutoffRatio: 3,
    cutoffFloor: 110,
    resonance: 0.5,
    sweep: 1.2,
    attack: 0.02,
    decay: 0.12,
    sustain: 0.85,
    release: 0.18,
  }),

  bass_synth: subtractive({
    waves: [
      { type: "sawtooth", detune: -6, level: 0.4 },
      { type: "square", detune: 6, level: 0.3 },
      { type: "sine", detune: 0, level: 0.4, octave: -1 },
    ],
    filter: "lowpass",
    cutoffRatio: 4.5,
    cutoffFloor: 200,
    resonance: 6,
    sweep: 4,
    attack: 0.006,
    decay: 0.18,
    sustain: 0.6,
    release: 0.12,
  }),

  upright: plucked({ damp: 0.93, level: 0.85, body: 2.6 }),
};

/**
 * Ambil suara berdasarkan nama; jatuh ke pad kalau namanya tidak dikenal.
 * Diperiksa dengan Object.hasOwn supaya nama seperti "constructor" atau
 * "toString" tidak mengembalikan sesuatu dari prototipe.
 */
export function voice(name: string): Voice {
  return Object.hasOwn(VOICES, name) ? VOICES[name]! : VOICES.pad!;
}

export function hasVoice(name: string): boolean {
  return name !== "none" && Object.hasOwn(VOICES, name);
}
