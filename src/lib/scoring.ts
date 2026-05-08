import type { DeviationStats, PitchFrame, ProblemSegment } from "../types";

const GOOD_CENTS = 15;
const MAX_CENTS_FOR_SCORE = 100;

export function computeDeviationStats(frames: PitchFrame[]): DeviationStats {
  const comparable = frames.filter(
    (frame) => frame.voiced && frame.centsFromTarget !== null && Number.isFinite(frame.centsFromTarget)
  );
  const absErrors = comparable.map((frame) => Math.abs(frame.centsFromTarget ?? 0)).sort((a, b) => a - b);
  const averageAbsCents = absErrors.length ? absErrors.reduce((sum, value) => sum + value, 0) / absErrors.length : 0;
  const medianAbsCents = absErrors.length ? absErrors[Math.floor(absErrors.length / 2)] : 0;
  const sharpCount = comparable.filter((frame) => (frame.centsFromTarget ?? 0) > GOOD_CENTS).length;
  const flatCount = comparable.filter((frame) => (frame.centsFromTarget ?? 0) < -GOOD_CENTS).length;
  const voicedCount = frames.filter((frame) => frame.voiced).length;
  const variance = comparable.length
    ? comparable.reduce((sum, frame) => sum + Math.abs((frame.centsFromTarget ?? 0) - averageAbsCents), 0) /
      comparable.length
    : 0;

  const accuracyScore = clamp(100 - (averageAbsCents / MAX_CENTS_FOR_SCORE) * 100, 0, 100);
  const stabilityScore = clamp(100 - (variance / 90) * 100, 0, 100);
  const voicedPercent = frames.length ? (voicedCount / frames.length) * 100 : 0;

  return {
    overallScore: Math.round(accuracyScore * 0.72 + stabilityScore * 0.18 + Math.min(voicedPercent, 100) * 0.1),
    averageAbsCents: Math.round(averageAbsCents),
    medianAbsCents: Math.round(medianAbsCents),
    sharpPercent: comparable.length ? Math.round((sharpCount / comparable.length) * 100) : 0,
    flatPercent: comparable.length ? Math.round((flatCount / comparable.length) * 100) : 0,
    voicedPercent: Math.round(voicedPercent),
    stabilityScore: Math.round(stabilityScore),
    validFrameCount: comparable.length
  };
}

export function detectProblemSegments(frames: PitchFrame[]): ProblemSegment[] {
  const segments: ProblemSegment[] = [];
  let active: PitchFrame[] = [];
  let currentIssue: ProblemSegment["issue"] | null = null;

  const flush = () => {
    if (active.length < 4 || currentIssue === null) {
      active = [];
      currentIssue = null;
      return;
    }
    const startMs = active[0].timeMs;
    const endMs = active[active.length - 1].timeMs;
    if (endMs - startMs < 350) {
      active = [];
      currentIssue = null;
      return;
    }
    const averageCents =
      active.reduce((sum, frame) => sum + (frame.centsFromTarget ?? 0), 0) / Math.max(active.length, 1);
    segments.push({
      startMs,
      endMs,
      averageCents: Math.round(averageCents),
      issue: currentIssue
    });
    active = [];
    currentIssue = null;
  };

  for (const frame of frames) {
    const cents = frame.centsFromTarget;
    if (!frame.voiced || cents === null) {
      flush();
      continue;
    }

    const issue = cents > 45 ? "sharp" : cents < -45 ? "flat" : Math.abs(cents) > 30 ? "unstable" : null;
    if (issue === null) {
      flush();
      continue;
    }

    if (currentIssue !== issue) {
      flush();
      currentIssue = issue;
    }
    active.push(frame);
  }
  flush();

  return segments.slice(0, 8);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
