/**
 * Penata aransemen. Partitur dari model hanya berisi akor dan melodi;
 * di sinilah ia menjadi daftar peristiwa lengkap dengan bas, arpeggio,
 * dan pukulan drum, masing-masing sudah punya waktu dalam detik.
 */

import type { DrumName } from "@/lib/audio/drums";
import { fillFor, patternFor } from "@/lib/audio/grooves";
import {
  bassMidi,
  degreeToMidi,
  midiToFreq,
  noteToMidi,
  noteToSemitone,
  parseChord,
  voiceChord,
  type Chord,
} from "@/lib/audio/theory";
import { beatsPerBar } from "@/lib/types";
import type { Song } from "@/lib/types";

export type Bus = "lead" | "chords" | "bass" | "arp" | "drums";

export type NoteEvent = {
  kind: "note";
  bus: Bus;
  voice: string;
  t: number;
  dur: number;
  freq: number;
  gain: number;
  bright: number;
  syllable?: string;
};

export type DrumEvent = {
  kind: "drum";
  drum: DrumName;
  t: number;
  gain: number;
};

export type AudioEvent = NoteEvent | DrumEvent;

/** Baris lirik beserta waktunya, dipakai untuk menyorot lirik saat diputar. */
export type LineMark = {
  text: string;
  start: number;
  end: number;
  syllables: Array<{ text: string; start: number }>;
};

export type SectionMark = {
  id: string;
  label: string;
  type: string;
  start: number;
  end: number;
  lines: LineMark[];
};

export type Timeline = {
  events: AudioEvent[];
  sections: SectionMark[];
  duration: number;
};

/** Pilih oktaf supaya nada dasar jatuh di rentang yang enak dinyanyikan. */
function rootMidiFor(key: string, target: number): number {
  const semitone = noteToSemitone(key) ?? 9;
  let best = noteToMidi(key, 3);
  let bestDistance = Infinity;
  for (let octave = 1; octave <= 6; octave += 1) {
    const midi = (octave + 1) * 12 + semitone;
    const distance = Math.abs(midi - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = midi;
    }
  }
  return best;
}

/** Beberapa instrumen terdengar lebih pantas satu oktaf di atas vokal. */
const OCTAVE_SHIFT: Record<string, number> = {
  flute: 12,
  suling: 12,
  bell: 12,
  gamelan: 12,
  marimba: 12,
  harp: 12,
  violin: 12,
};

/** Instrumen akor yang dibiarkan mengambang panjang, bukan dipetik ritmis. */
const SUSTAINED = new Set(["pad", "strings", "choir", "brass", "organ", "gamelan"]);

/**
 * Kekuatan tiap jalur dalam campuran. Pengukuran tenaga (gain² × durasi)
 * pada lagu jaipong menunjukkan drum menelan >50% campuran sementara melodi
 * cuma ~6% — melodi naik dan perkusi turun supaya liriknya terdengar.
 */
const MIX: Record<Bus, number> = {
  lead: 0.95,
  chords: 0.34,
  bass: 0.52,
  arp: 0.24,
  drums: 0.55,
};

/**
 * Timeline yang sudah pernah dihitung, disimpan per objek lagu.
 *
 * Satu lagu dibangun beberapa kali dalam satu putaran — panel lirik, pemutar,
 * dan perender WAV masing-masing memintanya. Lagu tidak pernah diubah setelah
 * dibuat, jadi identitas objeknya cukup jadi kunci.
 */
const timelineCache = new WeakMap<Song, Timeline>();

export function buildTimeline(song: Song): Timeline {
  const cached = timelineCache.get(song);
  if (cached) return cached;
  const built = computeTimeline(song);
  timelineCache.set(song, built);
  return built;
}

function computeTimeline(song: Song): Timeline {
  const events: AudioEvent[] = [];
  const sections: SectionMark[] = [];

  const beat = 60 / song.bpm;
  const pattern = patternFor(song.groove);
  const fill = fillFor(song.groove);
  const swing = pattern.swing ?? 0.5;

  // Lagu bervokal tetap dinyanyikan suara formant, tapi nada tanpa suku kata —
  // intro, solo, isian antar-baris — dibawakan instrumen "lead" pilihan model.
  // Tanpa ini, suling yang diminta untuk jaipong tidak pernah kedengaran.
  const singVoice = song.vocal === "none" ? song.instruments.lead : "vocal";
  const playVoice = song.instruments.lead === "none" ? singVoice : song.instruments.lead;

  const rootFor = (name: string) =>
    rootMidiFor(song.key, song.vocal === "male" ? 48 : 60) + (OCTAVE_SHIFT[name] ?? 0);
  const singRoot = rootFor(singVoice);
  const playRoot = rootFor(playVoice);

  const barBeats = beatsPerBar(song.groove);
  let barCursor = 0;
  let timeCursor = 0;
  let previousTop: number | undefined;

  for (const section of song.sections) {
    const sectionStart = timeCursor;
    const sectionBeats = section.bars * barBeats;
    const energy = section.energy;
    const marks: LineMark[] = [];

    /* --------------------------------------------------------- melodi --- */

    for (const line of section.lines) {
      if (!line.notes.length) {
        if (line.text) {
          marks.push({ text: line.text, start: sectionStart, end: sectionStart, syllables: [] });
        }
        continue;
      }

      const syllableMarks: Array<{ text: string; start: number }> = [];
      let first = Infinity;
      let last = 0;

      for (const note of line.notes) {
        const t = sectionStart + note.t * beat;
        const dur = note.l * beat;
        const sung = Boolean(note.s);
        const voice = sung ? singVoice : playVoice;
        const midi = degreeToMidi(note.d, song.mode, sung ? singRoot : playRoot);

        events.push({
          kind: "note",
          bus: "lead",
          voice,
          t,
          dur: Math.max(0.08, dur * 0.94),
          freq: midiToFreq(midi),
          gain: MIX.lead * (0.68 + energy * 0.32),
          bright: energy,
          syllable: note.s,
        });

        if (note.s) syllableMarks.push({ text: note.s, start: t });
        first = Math.min(first, t);
        last = Math.max(last, t + dur);
      }

      if (line.text) {
        marks.push({
          text: line.text,
          start: Number.isFinite(first) ? first : sectionStart,
          end: last,
          syllables: syllableMarks,
        });
      }
    }

    /* ------------------------------------------ akor, bas, dan hiasan --- */

    const sustained = SUSTAINED.has(song.instruments.chords);
    const chordCenter = rootMidiFor(song.key, 60);

    for (let bar = 0; bar < section.bars; bar += 1) {
      const barTime = sectionStart + bar * barBeats * beat;
      const chord = parseChord(section.chords[bar] ?? section.chords[0] ?? song.key);
      if (!chord) continue;

      const notes = voiceChord(chord, chordCenter, previousTop);
      previousTop = notes[notes.length - 1];

      if (song.instruments.chords !== "none") {
        pushChord({
          events,
          chord,
          notes,
          voice: song.instruments.chords,
          barTime,
          beat,
          barBeats,
          energy,
          sustained,
          groove: song.groove,
        });
      }

      if (song.instruments.bass !== "none") {
        pushBass({
          events,
          chord,
          voice: song.instruments.bass,
          barTime,
          beat,
          energy,
          kick: pattern.voices.kick,
          steps: pattern.steps,
          barBeats,
          swing,
        });
      }

      if (song.instruments.arp !== "none" && energy >= 0.45) {
        pushArp({
          events,
          notes,
          voice: song.instruments.arp,
          barTime,
          beat,
          barBeats,
          energy,
          bar,
        });
      }

      /* ------------------------------------------------------- drum --- */

      const isLastBar = bar === section.bars - 1;
      const useFill = isLastBar && section.bars > 1 && energy >= 0.4;

      for (const [name, steps] of Object.entries(pattern.voices)) {
        if (!steps) continue;
        const overrideFill = useFill ? fill[name as DrumName] : undefined;
        const active = overrideFill ?? steps;
        pushDrumBar({
          events,
          drum: name as DrumName,
          steps: active,
          stepCount: pattern.steps,
          barTime,
          beat,
          barBeats,
          energy,
          swing,
        });
      }

      // Isian memakai suara yang mungkin tidak ada di pola aslinya.
      if (useFill) {
        for (const [name, steps] of Object.entries(fill)) {
          if (!steps || pattern.voices[name as DrumName]) continue;
          pushDrumBar({
            events,
            drum: name as DrumName,
            steps,
            stepCount: pattern.steps,
            barTime,
            beat,
            barBeats,
            energy,
            swing,
          });
        }
      }

      // Gong menandai awal tiap siklus pada laras gamelan.
      if (pattern.gongEvery && (barCursor + bar) % pattern.gongEvery === 0) {
        events.push({ kind: "drum", drum: "gong", t: barTime, gain: 0.8 });
      }
    }

    // Simbal menyambut bagian yang bertenaga.
    if (energy >= 0.65 && song.groove !== "none" && sectionStart > 0) {
      events.push({ kind: "drum", drum: "crash", t: sectionStart, gain: 0.5 * energy });
    }

    sections.push({
      id: section.id,
      label: section.label,
      type: section.type,
      start: sectionStart,
      end: sectionStart + sectionBeats * beat,
      lines: marks,
    });

    barCursor += section.bars;
    timeCursor += sectionBeats * beat;
  }

  events.sort((a, b) => a.t - b.t);

  return { events, sections, duration: timeCursor };
}

/* ------------------------------------------------------------- bagian --- */

function pushChord(args: {
  events: AudioEvent[];
  chord: Chord;
  notes: number[];
  voice: string;
  barTime: number;
  beat: number;
  barBeats: number;
  energy: number;
  sustained: boolean;
  groove: string;
}): void {
  const { events, notes, voice, barTime, beat, barBeats, energy, sustained } = args;

  // Ritme comping: kapan akor dipukul dalam satu birama (dalam ketukan).
  // Pukulan yang jatuh di luar birama dibuang, jadi pola 4/4 di bawah tetap
  // masuk akal saat dipakai birama 3/4.
  const hits = (
    sustained
      ? [{ at: 0, len: barBeats, level: 1 }]
      : energy >= 0.7
        ? [
            { at: 0, len: 0.9, level: 1 },
            { at: 1.5, len: 0.5, level: 0.6 },
            { at: 2, len: 0.9, level: 0.85 },
            { at: 3.5, len: 0.5, level: 0.6 },
          ]
        : [
            { at: 0, len: 1.8, level: 1 },
            { at: 2, len: 1.8, level: 0.8 },
          ]
  ).filter((hit) => hit.at < barBeats);

  for (const hit of hits) {
    for (const midi of notes) {
      events.push({
        kind: "note",
        bus: "chords",
        voice,
        t: barTime + hit.at * beat,
        dur: hit.len * beat,
        freq: midiToFreq(midi),
        gain: (MIX.chords * hit.level * (0.6 + energy * 0.4)) / Math.sqrt(notes.length),
        bright: energy,
      });
    }
  }
}

function pushBass(args: {
  events: AudioEvent[];
  chord: Chord;
  voice: string;
  barTime: number;
  beat: number;
  energy: number;
  kick?: number[];
  steps: number;
  barBeats: number;
  swing: number;
}): void {
  const { events, chord, voice, barTime, beat, energy, kick, steps, barBeats, swing } = args;
  const root = bassMidi(chord, 2);
  const fifth = root + (chord.intervals.includes(7) ? 7 : 6);

  // Bas mengikuti bass drum kalau ada polanya — itu yang membuat groove menyatu.
  const hits: Array<{ at: number; len: number; midi: number }> = [];

  if (kick && energy >= 0.35) {
    kick.forEach((level, index) => {
      if (level <= 0) return;
      const beatPos = stepToBeat(index, steps, barBeats, swing);
      hits.push({
        at: beatPos,
        len: 0.7,
        midi: index === 0 ? root : index > steps / 2 ? fifth : root,
      });
    });
  }

  if (!hits.length) {
    const half = barBeats / 2;
    hits.push(
      { at: 0, len: half * 0.95, midi: root },
      { at: half, len: half * 0.95, midi: root },
    );
  }

  for (const hit of hits) {
    events.push({
      kind: "note",
      bus: "bass",
      voice,
      t: barTime + hit.at * beat,
      dur: hit.len * beat,
      freq: midiToFreq(hit.midi),
      gain: MIX.bass * (0.7 + energy * 0.3),
      bright: 0.3 + energy * 0.4,
    });
  }
}

function pushArp(args: {
  events: AudioEvent[];
  notes: number[];
  voice: string;
  barTime: number;
  beat: number;
  barBeats: number;
  energy: number;
  bar: number;
}): void {
  const { events, notes, voice, barTime, beat, barBeats, energy, bar } = args;
  if (!notes.length) return;

  const density = energy >= 0.75 ? 4 : 2; // per ketukan
  const total = barBeats * density;
  // Naik-turun, digeser tiap birama supaya tidak terdengar berulang kaku.
  const shape = [...notes, ...[...notes].reverse().slice(1, -1)];

  for (let i = 0; i < total; i += 1) {
    const midi = shape[(i + bar) % shape.length]! + (i % 8 >= 4 ? 12 : 0);
    events.push({
      kind: "note",
      bus: "arp",
      voice,
      t: barTime + (i / density) * beat,
      dur: (0.9 / density) * beat,
      freq: midiToFreq(midi),
      gain: MIX.arp * (0.5 + energy * 0.5) * (i % density === 0 ? 1 : 0.65),
      bright: energy,
    });
  }
}

/**
 * Ubah nomor langkah menjadi posisi ketukan, dengan ayunan kalau diminta.
 *
 * "swing" adalah letak offbeat seperdelapan di dalam ketukan: 0.5 lurus,
 * 0.667 rasa triplet. Karena "position" sudah dalam satuan ketukan,
 * geserannya persis (swing - 0.5) — tidak perlu dibagi lagi dengan
 * kerapatan langkah.
 */
function stepToBeat(
  index: number,
  steps: number,
  barBeats: number,
  swing: number,
): number {
  const perBeat = steps / barBeats;
  let position = index / perBeat;
  if (swing > 0.5 && perBeat >= 2) {
    // Langkah pada offbeat seperdelapan digeser mundur.
    const eighth = index / (perBeat / 2);
    if (Math.abs((eighth % 2) - 1) < 0.01) {
      position += swing - 0.5;
    }
  }
  return position;
}

function pushDrumBar(args: {
  events: AudioEvent[];
  drum: DrumName;
  steps: number[];
  stepCount: number;
  barTime: number;
  beat: number;
  barBeats: number;
  energy: number;
  swing: number;
}): void {
  const { events, drum, steps, stepCount, barTime, beat, barBeats, energy, swing } = args;

  steps.forEach((level, index) => {
    // Pola isian bisa lebih panjang dari polanya sendiri (mis. isian 16 langkah
    // pada birama 3/4); kelebihannya dibuang, bukan dibiarkan meluber ke birama
    // berikutnya.
    if (level <= 0 || index >= stepCount) return;
    const at = stepToBeat(index, stepCount, barBeats, swing);
    events.push({
      kind: "drum",
      drum,
      t: barTime + at * beat,
      gain: MIX.drums * level * (0.55 + energy * 0.45),
    });
  });
}
