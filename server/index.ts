import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import Fastify from "fastify";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { CoachFeedback, EvaluationPayload } from "../src/types.js";

dotenv.config();

const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi") as {
  Midi: new (buffer: Buffer | ArrayBuffer | Uint8Array) => MidiFile;
};
const server = Fastify({ logger: true });
const renderedDir = path.join(process.cwd(), "server", "generated");

server.addContentTypeParser(
  ["application/octet-stream", "audio/midi", "audio/x-midi", "audio/mid"],
  { parseAs: "buffer" },
  (_request, body, done) => done(null, body)
);
await server.register(cors, { origin: true });

server.get("/api/health", async () => ({ ok: true }));

server.get<{ Params: { fileName: string } }>("/rendered/:fileName", async (request, reply) => {
  if (!/^[a-zA-Z0-9-]+\.wav$/.test(request.params.fileName)) {
    return reply.status(400).send({ message: "Invalid file name." });
  }
  const filePath = path.join(renderedDir, request.params.fileName);
  return reply.type("audio/wav").send(createReadStream(filePath));
});

server.post<{ Body: Buffer }>("/api/midi/render", async (request, reply) => {
  if (!Buffer.isBuffer(request.body) || request.body.byteLength === 0) {
    return reply.status(400).send({ message: "MIDI file body is required." });
  }

  const wav = renderMidiToWav(request.body);
  const fileName = `${randomUUID()}.wav`;
  await mkdir(renderedDir, { recursive: true });
  await writeFile(path.join(renderedDir, fileName), wav);

  const host = request.headers.host || `localhost:${port}`;
  const protocol = host.includes("localhost") || host.startsWith("127.") ? "http" : "https";
  return {
    audioUrl: `${protocol}://${host}/rendered/${fileName}`,
    durationMs: wav.durationMs,
    renderer: "sine-wav-v1"
  };
});

server.post<{ Body: EvaluationPayload }>("/api/evaluate", async (request, reply) => {
  const payload = request.body;
  if (!payload?.deviationStats || !Array.isArray(payload.singerFrames)) {
    return reply.status(400).send({ message: "Invalid evaluation payload." });
  }

  const provider = (process.env.AI_PROVIDER || "mock").toLowerCase();
  const feedback = await evaluateWithProvider(provider, payload);
  return feedback;
});

const port = Number(process.env.SERVER_PORT || 8787);
await server.listen({ port, host: "0.0.0.0" });

async function evaluateWithProvider(provider: string, payload: EvaluationPayload): Promise<CoachFeedback> {
  if (provider === "openai") return evaluateWithOpenAi(payload);
  if (provider === "minimax") return evaluateWithMiniMax(payload);
  if (provider === "gemini") return evaluateWithGemini(payload);
  return createMockFeedback(payload);
}

function buildPrompt(payload: EvaluationPayload): string {
  const compactPayload = {
    stats: payload.deviationStats,
    problemSegments: payload.problemSegments,
    referenceNoteCount: payload.referenceNotes.length,
    sampledFrames: payload.singerFrames.map((frame) => ({
      t: Math.round(frame.timeMs),
      cents: frame.centsFromTarget === null ? null : Math.round(frame.centsFromTarget),
      confidence: Number(frame.confidence.toFixed(2)),
      voiced: frame.voiced
    }))
  };

  return [
    "你是专业声乐音准教练。请基于结构化音准数据给中文反馈，不要声称你直接听到了原始录音。",
    "评分依据：cents 偏差越小越准；正数表示偏高，负数表示偏低；置信度低或未发声帧不能当作跑调。",
    "请返回严格 JSON，字段为 overallScore, pitchAccuracyScore, stabilityScore, summary, mainIssues, segmentFeedback, practiceSuggestions。",
    "数组字段各给 2-4 条，summary 一句话。",
    JSON.stringify(compactPayload)
  ].join("\n");
}

async function evaluateWithOpenAi(payload: EvaluationPayload): Promise<CoachFeedback> {
  const apiKey = requireApiKey("OPENAI");
  const model = process.env.AI_MODEL || "gpt-4.1-mini";
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: buildPrompt(payload) }],
      response_format: { type: "json_object" },
      temperature: 0.3
    })
  });

  if (!response.ok) throw new Error(`OpenAI request failed: ${await response.text()}`);
  const data = (await response.json()) as OpenAiChatResponse;
  return normalizeFeedback(JSON.parse(data.choices[0]?.message?.content || "{}"), payload, `openai:${model}`);
}

async function evaluateWithMiniMax(payload: EvaluationPayload): Promise<CoachFeedback> {
  const apiKey = requireApiKey("MINIMAX");
  const model = process.env.AI_MODEL || "MiniMax-M2.7";
  const baseUrl = process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1";
  const response = await fetch(`${baseUrl}/text/chatcompletion_v2`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: buildPrompt(payload) }],
      temperature: 0.3
    })
  });

  if (!response.ok) throw new Error(`MiniMax request failed: ${await response.text()}`);
  const data = (await response.json()) as MiniMaxChatResponse;
  const content = data.choices?.[0]?.message?.content || data.reply || "{}";
  return normalizeFeedback(parseJsonObject(content), payload, `minimax:${model}`);
}

async function evaluateWithGemini(payload: EvaluationPayload): Promise<CoachFeedback> {
  const apiKey = requireApiKey("GEMINI");
  const model = process.env.AI_MODEL || "gemini-2.5-flash";
  const baseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
  const response = await fetch(`${baseUrl}/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(payload) }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini request failed: ${await response.text()}`);
  const data = (await response.json()) as GeminiResponse;
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return normalizeFeedback(parseJsonObject(content), payload, `gemini:${model}`);
}

function createMockFeedback(payload: EvaluationPayload): CoachFeedback {
  const stats = payload.deviationStats;
  const primaryBias =
    stats.sharpPercent > stats.flatPercent + 10 ? "整体更容易偏高" : stats.flatPercent > stats.sharpPercent + 10 ? "整体更容易偏低" : "偏高和偏低比较均衡";
  const segmentText = payload.problemSegments.length
    ? payload.problemSegments
        .slice(0, 3)
        .map((segment) => `${formatTime(segment.startMs)}-${formatTime(segment.endMs)} ${issueLabel(segment.issue)}，平均偏差 ${segment.averageCents} cents。`)
    : ["没有检测到持续性的严重跑调片段。"];

  return {
    overallScore: stats.overallScore,
    pitchAccuracyScore: Math.max(0, Math.round(100 - stats.averageAbsCents)),
    stabilityScore: stats.stabilityScore,
    summary: `本次平均音准误差约 ${stats.averageAbsCents} cents，${primaryBias}。`,
    mainIssues: [
      primaryBias,
      `有效发声覆盖率约 ${stats.voicedPercent}%。`,
      `音高稳定度为 ${stats.stabilityScore} 分。`
    ],
    segmentFeedback: segmentText,
    practiceSuggestions: [
      "先用慢速跟唱，把每个长音保持在目标线附近。",
      "对偏高或偏低最明显的时间段单独循环练习。",
      "录唱时尽量使用耳机播放参考音，减少麦克风串音。"
    ],
    provider: "mock"
  };
}

function normalizeFeedback(raw: Partial<CoachFeedback>, payload: EvaluationPayload, provider: string): CoachFeedback {
  const mock = createMockFeedback(payload);
  return {
    overallScore: numberOr(raw.overallScore, mock.overallScore),
    pitchAccuracyScore: numberOr(raw.pitchAccuracyScore, mock.pitchAccuracyScore),
    stabilityScore: numberOr(raw.stabilityScore, mock.stabilityScore),
    summary: stringOr(raw.summary, mock.summary),
    mainIssues: stringArrayOr(raw.mainIssues, mock.mainIssues),
    segmentFeedback: stringArrayOr(raw.segmentFeedback, mock.segmentFeedback),
    practiceSuggestions: stringArrayOr(raw.practiceSuggestions, mock.practiceSuggestions),
    provider
  };
}

function requireApiKey(name: "OPENAI" | "MINIMAX" | "GEMINI"): string {
  const key = process.env.AI_API_KEY || process.env[`${name}_API_KEY`];
  if (!key) throw new Error(`${name}_API_KEY or AI_API_KEY is required when AI_PROVIDER=${name.toLowerCase()}.`);
  return key;
}

function parseJsonObject(content: string): Partial<CoachFeedback> {
  try {
    return JSON.parse(content) as Partial<CoachFeedback>;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    return match ? (JSON.parse(match[0]) as Partial<CoachFeedback>) : {};
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function issueLabel(issue: string): string {
  return issue === "sharp" ? "偏高" : issue === "flat" ? "偏低" : "不稳定";
}

type OpenAiChatResponse = {
  choices: Array<{ message?: { content?: string } }>;
};

type MiniMaxChatResponse = {
  reply?: string;
  choices?: Array<{ message?: { content?: string } }>;
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

type MidiFile = {
  tracks: Array<{
    notes: Array<{
      time: number;
      duration: number;
      midi: number;
      velocity?: number;
    }>;
  }>;
};

function renderMidiToWav(midiBuffer: Buffer): Buffer & { durationMs?: number } {
  const midi = new Midi(midiBuffer);
  const sampleRate = 22050;
  const maxDurationSeconds = 30;
  const notes = midi.tracks
    .flatMap((track) => track.notes)
    .filter((note) => note.duration > 0 && note.time < maxDurationSeconds)
    .sort((a, b) => a.time - b.time);

  if (!notes.length) {
    throw new Error("MIDI file has no playable notes.");
  }

  const durationSeconds = Math.min(
    maxDurationSeconds,
    Math.max(...notes.map((note) => Math.min(note.time + note.duration, maxDurationSeconds))) + 0.25
  );
  const sampleCount = Math.ceil(durationSeconds * sampleRate);
  const samples = new Float32Array(sampleCount);

  for (const note of notes) {
    const start = Math.max(0, Math.floor(note.time * sampleRate));
    const end = Math.min(sampleCount, Math.ceil(Math.min(note.time + note.duration, durationSeconds) * sampleRate));
    const frequency = 440 * 2 ** ((note.midi - 69) / 12);
    const velocity = Math.max(0.15, Math.min(1, note.velocity || 0.7));
    const attackSamples = Math.max(1, Math.floor(0.01 * sampleRate));
    const releaseSamples = Math.max(1, Math.floor(0.04 * sampleRate));

    for (let index = start; index < end; index += 1) {
      const local = index - start;
      const remaining = end - index;
      const envelope = Math.min(1, local / attackSamples, remaining / releaseSamples);
      samples[index] += Math.sin((2 * Math.PI * frequency * index) / sampleRate) * velocity * envelope * 0.16;
    }
  }

  let peak = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
  }
  const gain = peak > 0.95 ? 0.95 / peak : 1;
  const wav = encodeWav(samples, sampleRate, gain) as Buffer & { durationMs?: number };
  wav.durationMs = Math.round(durationSeconds * 1000);
  return wav;
}

function encodeWav(samples: Float32Array, sampleRate: number, gain: number): Buffer {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] * gain));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return buffer;
}
