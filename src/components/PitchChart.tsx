import { useEffect, useRef } from "react";
import type { PitchFrame, ReferenceNote } from "../types";

type Props = {
  notes: ReferenceNote[];
  frames: PitchFrame[];
  durationMs: number;
};

export function PitchChart({ notes, frames, durationMs }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 24, right: 24, bottom: 34, left: 48 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const allMidi = [
      ...notes.map((note) => note.midi),
      ...frames.map((frame) => frame.midi).filter((value): value is number => value !== null)
    ];
    const minMidi = Math.floor(Math.min(...allMidi, 55) - 2);
    const maxMidi = Math.ceil(Math.max(...allMidi, 76) + 2);

    const x = (timeMs: number) => padding.left + (timeMs / durationMs) * plotWidth;
    const y = (midi: number) => padding.top + ((maxMidi - midi) / (maxMidi - minMidi)) * plotHeight;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#d9e2ec";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#64748b";
    ctx.font = "12px Inter, system-ui, sans-serif";
    for (let midi = Math.ceil(minMidi / 2) * 2; midi <= maxMidi; midi += 2) {
      const yy = y(midi);
      ctx.beginPath();
      ctx.moveTo(padding.left, yy);
      ctx.lineTo(width - padding.right, yy);
      ctx.stroke();
      ctx.fillText(String(midi), 12, yy + 4);
    }

    ctx.strokeStyle = "#0f766e";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const note of notes) {
      ctx.beginPath();
      ctx.moveTo(x(note.startMs), y(note.midi));
      ctx.lineTo(x(note.endMs), y(note.midi));
      ctx.stroke();
    }

    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let hasStarted = false;
    for (const frame of frames) {
      if (!frame.voiced || frame.midi === null) {
        hasStarted = false;
        continue;
      }
      const xx = x(frame.timeMs);
      const yy = y(frame.midi);
      if (!hasStarted) {
        ctx.moveTo(xx, yy);
        hasStarted = true;
      } else {
        ctx.lineTo(xx, yy);
      }
    }
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.font = "13px Inter, system-ui, sans-serif";
    ctx.fillText("参考旋律", padding.left, 18);
    ctx.fillStyle = "#dc2626";
    ctx.fillText("人声", padding.left + 78, 18);
  }, [durationMs, frames, notes]);

  return (
    <div className="chart-frame">
      <canvas ref={canvasRef} aria-label="参考旋律与人声音高曲线" />
    </div>
  );
}
