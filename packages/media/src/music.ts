import { writeFile } from "node:fs/promises";
import { mulberry32 } from "@jarvis/core";

/*
 * Trilha própria gerada por código (lo-fi/synthwave): sem direitos de
 * terceiros, nunca repete igual (seed) e vira a assinatura sonora do perfil.
 */
const SR = 44100;
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// Acordes de 4 notas, em semitons a partir da tônica.
const PROGRESSIONS: number[][][] = [
  [[9, 12, 16, 19], [5, 9, 12, 16], [0, 4, 7, 11], [7, 11, 14, 17]], // vi IV I V
  [[0, 3, 7, 10], [8, 12, 15, 19], [3, 7, 10, 14], [10, 14, 17, 21]], // i VI III VII
  [[2, 5, 9, 12], [7, 11, 14, 17], [0, 4, 7, 11], [9, 12, 16, 19]], // ii V I vi
  [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]], // I vi IV V
];

export interface TrackOptions {
  seed: number;
  seconds: number;
  /** "calma" para explicações, "energia" para ganchos e simulações. */
  energy?: "calma" | "energia";
}

export function synthesize(opts: TrackOptions): [Float32Array, Float32Array] {
  const rnd = mulberry32(opts.seed);
  const energy = opts.energy ?? "energia";
  const bpm = energy === "energia" ? 96 + Math.floor(rnd() * 16) : 78 + Math.floor(rnd() * 12);
  const beat = 60 / bpm;
  const bar = beat * 4;
  const root = 45 + Math.floor(rnd() * 7);
  const prog = PROGRESSIONS[Math.floor(rnd() * PROGRESSIONS.length)]!;
  const n = Math.ceil(opts.seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);

  const add = (i: number, v: number, pan = 0) => {
    if (i < 0 || i >= n) return;
    L[i]! += v * (1 - Math.max(0, pan));
    R[i]! += v * (1 + Math.min(0, pan));
  };
  const noise = (len: number, s0: number, gain: number, decay: number, pan: number) => {
    let prev = 0;
    for (let j = 0; j < len; j++) {
      const w = rnd() * 2 - 1;
      add(s0 + j, gain * Math.exp((-j / SR) * decay) * (w - prev), pan);
      prev = w;
    }
  };

  const bars = Math.ceil(opts.seconds / bar);
  for (let b = 0; b < bars; b++) {
    const chord = prog[b % prog.length]!;
    const t0 = b * bar;

    // Pad: harmônicos ímpares suaves, leve desafinação estéreo, ataque lento.
    for (const [k, iv] of chord.entries()) {
      const f = midi(root + 12 + iv);
      const s0 = Math.floor(t0 * SR);
      const len = Math.floor(bar * SR);
      for (let j = 0; j < len; j++) {
        const t = j / SR;
        const env = Math.min(1, t / 0.35) * Math.min(1, (bar - t) / 0.4 + 0.2);
        const ph = 2 * Math.PI * f * t;
        const tone = Math.sin(ph) + Math.sin(3 * ph) / 9 + Math.sin(5 * ph) / 25;
        add(s0 + j, 0.035 * env * tone, -0.3 + k * 0.2);
        add(s0 + j, 0.02 * env * Math.sin(2 * Math.PI * f * 1.004 * t), 0.3 - k * 0.2);
      }
    }

    // Baixo nos tempos 1 e 3.
    for (const bt of [0, 2]) {
      const f = midi(root - 12 + (chord[0]! % 12));
      const s0 = Math.floor((t0 + bt * beat) * SR);
      for (let j = 0; j < Math.floor(beat * 1.8 * SR); j++) {
        const t = j / SR;
        add(s0 + j, 0.16 * Math.exp(-t * 2.2) * Math.min(1, t / 0.01) * Math.sin(2 * Math.PI * f * t));
      }
    }

    // Bateria: bumbo, palma, chimbal.
    for (let bt = 0; bt < 4; bt++) {
      const s0 = Math.floor((t0 + bt * beat) * SR);
      if (bt === 0 || bt === 2 || (energy === "energia" && bt === 3 && rnd() < 0.35)) {
        let ph = 0;
        for (let j = 0; j < 0.3 * SR; j++) {
          const t = j / SR;
          ph += (2 * Math.PI * (45 + 90 * Math.exp(-t * 30))) / SR;
          add(s0 + j, 0.45 * Math.exp(-t * 9) * Math.sin(ph));
        }
      }
      if (bt === 1 || bt === 3) noise(Math.floor(0.18 * SR), s0, 0.08, 22, 0.1);
      const hats = energy === "energia" ? 2 : 1;
      for (let h = 0; h < hats; h++) noise(Math.floor(0.04 * SR), s0 + Math.floor((h * beat * SR) / hats), 0.035, 90, h ? 0.4 : -0.4);
    }

    // Arpejo pentatônico com eco: a "cara" da trilha.
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    for (let e = 0; e < 8; e++) {
      if (rnd() < (energy === "energia" ? 0.3 : 0.5)) continue;
      const f = midi(root + 24 + (chord[0]! % 12) + scale[Math.floor(rnd() * scale.length)]!);
      for (const [echo, gain, pan] of [[0, 1, 0], [0.75, 0.35, 0.5], [1.5, 0.12, -0.5]] as const) {
        const s0 = Math.floor((t0 + e * beat * 0.5 + echo * beat) * SR);
        for (let j = 0; j < 0.5 * SR; j++) {
          const t = j / SR;
          const ph = 2 * Math.PI * f * t;
          add(s0 + j, 0.05 * gain * Math.exp(-t * 7) * (Math.sin(ph) + 0.3 * Math.sin(2 * ph)), pan);
        }
      }
    }
  }

  // Master: passa-baixa suave (cara de lo-fi), fades e normalização.
  for (const ch of [L, R]) {
    let y = 0;
    for (let i = 0; i < n; i++) {
      y += 0.35 * (ch[i]! - y);
      ch[i] = y;
    }
  }
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]!), Math.abs(R[i]!));
  const fadeIn = 0.4 * SR;
  const fadeOut = 1.5 * SR;
  for (let i = 0; i < n; i++) {
    const g = (0.7 / peak) * Math.min(1, i / fadeIn) * Math.min(1, (n - i) / fadeOut);
    L[i]! *= g;
    R[i]! *= g;
  }
  return [L, R];
}

export async function writeTrack(file: string, opts: TrackOptions): Promise<void> {
  const [L, R] = synthesize(opts);
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i]!)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i]!)) * 32767), 46 + i * 4);
  }
  await writeFile(file, buf);
}
