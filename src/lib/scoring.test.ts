import { describe, expect, it } from "vitest";
import type { PitchFrame } from "../types";
import { computeDeviationStats, detectProblemSegments } from "./scoring";

function frame(timeMs: number, centsFromTarget: number | null, voiced = true): PitchFrame {
  return {
    timeMs,
    frequencyHz: voiced ? 440 : null,
    midi: voiced ? 69 : null,
    centsFromTarget,
    confidence: voiced ? 0.95 : 0,
    voiced,
    targetFrequencyHz: 440
  };
}

describe("computeDeviationStats", () => {
  it("scores accurate frames highly", () => {
    const stats = computeDeviationStats([frame(0, 0), frame(50, 8), frame(100, -10)]);
    expect(stats.overallScore).toBeGreaterThan(85);
    expect(stats.averageAbsCents).toBeLessThan(10);
  });

  it("tracks sharp and flat bias", () => {
    const stats = computeDeviationStats([frame(0, 60), frame(50, 50), frame(100, -20)]);
    expect(stats.sharpPercent).toBe(67);
    expect(stats.flatPercent).toBe(33);
  });
});

describe("detectProblemSegments", () => {
  it("groups sustained sharp frames", () => {
    const segments = detectProblemSegments([
      frame(0, 55),
      frame(120, 60),
      frame(240, 62),
      frame(360, 58),
      frame(480, 61)
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].issue).toBe("sharp");
  });
});
