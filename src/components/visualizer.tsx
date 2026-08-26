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

    const draw = () => {
      frame = requestAnimationFrame(draw);

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
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

        const gradient = ctx.createLinearGradient(0, height, 0, y);
        gradient.addColorStop(0, "rgba(220, 79, 125, 0.55)");
        gradient.addColorStop(1, "rgba(245, 199, 119, 0.95)");
        ctx.fillStyle = gradient;

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        ctx.fill();
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [getAnalyser, active]);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
