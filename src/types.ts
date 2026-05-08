export type PitchFrame = {
  timeMs: number;
  frequencyHz: number | null;
  midi: number | null;
  centsFromTarget: number | null;
  confidence: number;
  voiced: boolean;
  targetFrequencyHz: number | null;
};

export type ReferenceNote = {
  id: string;
  startMs: number;
  endMs: number;
  midi: number;
  frequencyHz: number;
  name: string;
};

export type ProblemSegment = {
  startMs: number;
  endMs: number;
  averageCents: number;
  issue: "sharp" | "flat" | "unstable";
};

export type DeviationStats = {
  overallScore: number;
  averageAbsCents: number;
  medianAbsCents: number;
  sharpPercent: number;
  flatPercent: number;
  voicedPercent: number;
  stabilityScore: number;
  validFrameCount: number;
};

export type EvaluationPayload = {
  referenceNotes: ReferenceNote[];
  singerFrames: PitchFrame[];
  deviationStats: DeviationStats;
  problemSegments: ProblemSegment[];
};

export type CoachFeedback = {
  overallScore: number;
  pitchAccuracyScore: number;
  stabilityScore: number;
  summary: string;
  mainIssues: string[];
  segmentFeedback: string[];
  practiceSuggestions: string[];
  provider: string;
};
