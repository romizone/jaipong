"use client";

import { useEffect, useRef } from "react";

type Props = {
  /** Diambil lewat fungsi karena node analiser dibuat setelah tombol putar ditekan. */
  getAnalyser: () => AnalyserNode | null;
  active: boolean;
  className?: string;
};

/** Pita spektrum sederhana di belakang bilah pemutar. */
export function Visualizer({ getAnalyser, active, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let data: Uint8Array<ArrayBuffer> | null = null;
    // Nilai yang meluruh pelan supaya batang tidak berkedip kasar.
    let smoothed: Float32Array | null = null;
    // Berapa frame berturut-turut tidak ada yang bergerak lagi.
    let settled = 0;

    // Gradien dikelompokkan per tinggi batang (dibulatkan 4 piksel). Tanpa ini
    // ada 56 objek gradien baru tiap frame — 3.000-an per detik, terus-menerus.
    let gradients = new Map<number, CanvasGradient>();

    const gradientFor = (height: number, barHeight: number): CanvasGradient => {
      const bucket = Math.max(4, Math.round(barHeight / 4) * 4);
      const cached = gradients.get(bucket);
      if (cached) return cached;
      const made = ctx.createLinearGradient(0, height, 0, height - bucket);
      made.addColorStop(0, "rgba(220, 79, 125, 0.55)");
      made.addColorStop(1, "rgba(245, 199, 119, 0.95)");
      gradients.set(bucket, made);
      return made;
    };

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        gradients = new Map();
      }

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const analyser = active ? getAnalyser() : null;
      const bars = 56;
      if (!smoothed || smoothed.length !== bars) smoothed = new Float32Array(bars);

      if (analyser) {
        if (!data || data.length !== analyser.frequencyBinCount) {
          data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        }
        analyser.getByteFrequencyData(data);
      }

      const gap = 2;
      const barWidth = Math.max(1, (width - gap * (bars - 1)) / bars);

      for (let i = 0; i < bars; i += 1) {
        let target = 0;
        if (analyser && data) {
          // Sebaran logaritmik: nada rendah dapat porsi lebih lebar.
          const from = Math.floor(Math.pow(i / bars, 1.7) * data.length);
          const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / bars, 1.7) * data.length));
          let sum = 0;
          for (let j = from; j < to; j += 1) sum += data[j]!;
          target = sum / (to - from) / 255;
        }
        smoothed[i] = smoothed[i]! + (target - smoothed[i]!) * (target > smoothed[i]! ? 0.55 : 0.12);

        const value = Math.max(0.015, smoothed[i]!);
        const barHeight = Math.max(2, value * height);
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        ctx.fillStyle = gradientFor(height, barHeight);
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        ctx.fill();
      }

      // Kalau tidak ada lagu berjalan dan batangnya sudah rata di dasar,
      // tidak ada gunanya menggambar 60 kali per detik. Effect dijalankan
      // ulang saat "active" berubah, jadi gerakannya kembali dengan sendirinya.
      settled = analyser ? 0 : settled + 1;
      if (settled > 45) {
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [getAnalyser, active]);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
