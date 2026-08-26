/**
 * Pola ketukan. Satu birama ditulis sebagai deret langkah, satu huruf
 * satu langkah, jadi polanya bisa dibaca sekilas seperti partitur drum.
 *
 *   X = keras   x = normal   o = pelan   - = bayangan   . = diam
 */

import type { DrumName } from "@/lib/audio/drums";
import type { Groove } from "@/lib/types";

export type Pattern = {
  /** Jumlah langkah per birama. 16 = not seperenambelas pada birama 4/4. */
  steps: number;
  voices: Partial<Record<DrumName, number[]>>;
  /** Ayunan 0–1; 0.5 berarti lurus, 0.62 terasa berayun. */
  swing?: number;
  /** Dentuman gong setiap N birama, untuk laras gamelan. */
  gongEvery?: number;
};

const LEVELS: Record<string, number> = {
  X: 1,
  x: 0.72,
  o: 0.45,
  "-": 0.24,
  ".": 0,
};

/** Ubah tulisan pola menjadi deret kekuatan pukulan. */
function p(pattern: string): number[] {
  return pattern
    .replace(/[\s|]/g, "")
    .split("")
    .map((ch) => LEVELS[ch] ?? 0);
}

export const GROOVE_PATTERNS: Record<Groove, Pattern> = {
  none: { steps: 16, voices: {} },

  ballad: {
    steps: 16,
    voices: {
      kick: p("X... .... x... ...."),
      snare: p(".... o... .... o..."),
      hat: p("o... o... o... o..."),
    },
  },

  pop: {
    steps: 16,
    voices: {
      kick: p("X... .... X..x ...."),
      snare: p(".... X... .... X..."),
      hat: p("x.o. x.o. x.o. x.o."),
    },
  },

  rock: {
    steps: 16,
    voices: {
      kick: p("X..x .... X... x..."),
      snare: p(".... X... .... X..."),
      hat: p("x.x. x.x. x.x. x.x."),
    },
  },

  funk: {
    steps: 16,
    voices: {
      kick: p("X..x ..x. ...X ..x."),
      snare: p("...- X..- ...- X..-"),
      hat: p("xoxo xoxo xoxo xoxo"),
    },
  },

  disco: {
    steps: 16,
    voices: {
      kick: p("X... X... X... X..."),
      snare: p(".... X... .... X..."),
      hatOpen: p("..x. ..x. ..x. ..x."),
      shaker: p("x.x. x.x. x.x. x.x."),
    },
  },

  four_on_floor: {
    steps: 16,
    voices: {
      kick: p("X... X... X... X..."),
      clap: p(".... X... .... X..."),
      hatOpen: p("..x. ..x. ..x. ..x."),
    },
  },

  edm: {
    steps: 16,
    voices: {
      kick: p("X... X... X... X..."),
      clap: p(".... X... .... X..."),
      hat: p("x.x. x.x. x.x. x.x."),
      hatOpen: p("..o. ..o. ..o. ..x."),
    },
  },

  hiphop: {
    steps: 16,
    voices: {
      kick: p("X... ..x. ..x. ...."),
      snare: p(".... X... .... X..."),
      hat: p("x.x- x.x- x.x- x.x-"),
    },
    swing: 0.56,
  },

  trap: {
    steps: 16,
    voices: {
      kick: p("X... ..x. .... x..."),
      snare: p(".... .... X... ...."),
      hat: p("x-x- xxx- x-x- xxxx"),
    },
  },

  shuffle: {
    steps: 16,
    voices: {
      kick: p("X... .... X... ...."),
      snare: p(".... X... .... X..."),
      hat: p("x..x x..x x..x x..x"),
    },
    swing: 0.64,
  },

  reggae: {
    steps: 16,
    voices: {
      kick: p(".... .... X... ...."),
      rim: p(".... X... .... X..."),
      hat: p("..x. ..x. ..x. ..x."),
    },
  },

  bossa: {
    steps: 16,
    voices: {
      kick: p("X... ..x. X... ..x."),
      rim: p("..x. ..x. ..x. x..."),
      shaker: p("x.o. x.o. x.o. x.o."),
    },
  },

  latin: {
    steps: 16,
    voices: {
      kick: p("X..x .... X... x..."),
      rim: p("..x. ..x. ..x. x..."),
      tomHigh: p("..x. .-.. ..x. .-.."),
      tomLow: p(".... x... .... x..."),
      cowbell: p("X... x... X... x..."),
    },
  },

  waltz: {
    steps: 12,
    voices: {
      kick: p("X... .... ...."),
      snare: p(".... o... o..."),
      hat: p("o..o ..o. .o.."),
    },
  },

  halftime: {
    steps: 16,
    voices: {
      kick: p("X... .... .... x..."),
      snare: p(".... .... X... ...."),
      hat: p("x.x. x.x. x.x. x.x."),
    },
  },

  /**
   * Dangdut: kendang yang menarik ketukan — "tak" di depan, "dut" jatuh
   * sesaat sesudahnya. Itulah ayunan khasnya.
   */
  dangdut: {
    steps: 16,
    voices: {
      kendangTak: p("X..x ..X. .X.x ..x."),
      kendangDung: p("...X ...x ..X. ..X."),
      kick: p("X... .... X... ...."),
      hat: p("x.o. x.o. x.o. x.o."),
      shaker: p("..x. ..x. ..x. ..x."),
    },
  },

  /** Jaipong: kendang Sunda yang rapat dan penuh sinkopasi, ditutup gong. */
  jaipong: {
    steps: 16,
    voices: {
      kendangDung: p("X..x .X.. x.X. ..X."),
      kendangTak: p(".xx. x.xx .x.x x.x."),
      kendangPak: p("..X. ...X ..X. ...X"),
      shaker: p("x.x. x.x. x.x. x.x."),
    },
    gongEvery: 4,
  },

  keroncong: {
    steps: 16,
    voices: {
      rim: p("..x. ..x. ..x. ..x."),
      tomLow: p("X... .... X... ...."),
      shaker: p("x.o. x.o. x.o. x.o."),
    },
  },

  gamelan: {
    steps: 16,
    voices: {
      kendangDung: p("X... .... X... ...."),
      kendangTak: p(".... x... .... x..."),
    },
    gongEvery: 4,
  },
};

/** Isian drum di birama terakhir sebuah bagian. */
export const FILL: Partial<Record<DrumName, number[]>> = {
  snare: p(".... .... x-x- x-x-"),
  tomMid: p(".... .... .... X.x."),
  tomLow: p(".... .... .... ..X."),
  kick: p("X... .... .... ...X"),
};

/** Isian versi kendang, untuk genre Nusantara. */
export const KENDANG_FILL: Partial<Record<DrumName, number[]>> = {
  kendangTak: p(".... .... xxx. xxxx"),
  kendangDung: p(".... .... ...X ...X"),
};

export function patternFor(groove: Groove): Pattern {
  return GROOVE_PATTERNS[groove] ?? GROOVE_PATTERNS.pop;
}

/** Genre Nusantara memakai isian kendang, sisanya isian drum biasa. */
export function fillFor(groove: Groove): Partial<Record<DrumName, number[]>> {
  return groove === "jaipong" || groove === "dangdut" || groove === "gamelan"
    ? KENDANG_FILL
    : FILL;
}
