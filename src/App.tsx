import { PitchDetector } from "pitchy";
import { useEffect, useMemo, useRef, useState } from "react";
import { CoachPanel } from "./components/CoachPanel";
import { PitchChart } from "./components/PitchChart";
import { centsBetween, createDemoReference, frequencyToMidi, getReferenceAt, getReferenceDuration, parseMidiFile } from "./lib/music";
import { computeDeviationStats, detectProblemSegments } from "./lib/scoring";
import type { CoachFeedback, EvaluationPayload, PitchFrame, ReferenceNote } from "./types";

const FRAME_SIZE = 2048;
const CONFIDENCE_THRESHOLD = 0.82;
const FRAME_INTERVAL_MS = 45;
const MIN_INPUT_LEVEL = 0.006;

export default function App() {
  const [referenceNotes, setReferenceNotes] = useState<ReferenceNote[]>(createDemoReference());
  const [frames, setFrames] = useState<PitchFrame[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [feedback, setFeedback] = useState<CoachFeedback | null>(null);
  const [status, setStatus] = useState("使用内置 MIDI 示例，或上传一段 MIDI 后开始。");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [inputLevel, setInputLevel] = useState(0);
  const [lastPitchInfo, setLastPitchInfo] = useState("等待录音");

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const synthNodesRef = useRef<OscillatorNode[]>([]);
  const framesRef = useRef<PitchFrame[]>([]);

  const durationMs = useMemo(() => Math.max(getReferenceDuration(referenceNotes), 5000), [referenceNotes]);
  const stats = useMemo(() => computeDeviationStats(frames), [frames]);
  const problemSegments = useMemo(() => detectProblemSegments(frames), [frames]);

  useEffect(() => {
    void refreshAudioDevices();
  }, []);

  async function refreshAudioDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    setAudioDevices(devices.filter((device) => device.kind === "audioinput"));
  }

  async function handleMidiUpload(file: File | null) {
    if (!file) return;
    try {
      const notes = await parseMidiFile(file);
      if (!notes.length) {
        setStatus("这个 MIDI 没有可用音符，请换一段旋律轨道更清晰的文件。");
        return;
      }
      setReferenceNotes(notes);
      setFrames([]);
      setFeedback(null);
      setStatus(`已载入 ${notes.length} 个参考音符。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "MIDI 解析失败。");
    }
  }

  async function startSession() {
    try {
      stopSession(false);
      setFeedback(null);
      setFrames([]);
      setInputLevel(0);
      setLastPitchInfo("正在初始化麦克风");
      framesRef.current = [];
      setStatus("正在请求麦克风权限...");

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("当前浏览器不支持麦克风录音。请使用 Chrome、Edge 或 Safari，并通过 localhost/HTTPS 打开。");
        return;
      }

      const audioContext = new AudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      await refreshAudioDevices();
      const track = stream.getAudioTracks()[0];
      if (track?.label) {
        setStatus(`已连接麦克风：${track.label}`);
      }

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = FRAME_SIZE;
      audioContext.createMediaStreamSource(stream).connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      streamRef.current = stream;
      startTimeRef.current = audioContext.currentTime;
      playReference(audioContext, referenceNotes);

      const detector = PitchDetector.forFloat32Array(FRAME_SIZE);
      const input = new Float32Array(FRAME_SIZE);

      intervalRef.current = window.setInterval(() => {
        analyser.getFloatTimeDomainData(input);
        const level = calculateRms(input);
        setInputLevel(level);

        const [pitch, clarity] = detector.findPitch(input, audioContext.sampleRate);
        const timeMs = (audioContext.currentTime - startTimeRef.current) * 1000;
        const target = getReferenceAt(referenceNotes, timeMs);
        const hasInput = level >= MIN_INPUT_LEVEL;
        const voiced = hasInput && clarity >= CONFIDENCE_THRESHOLD && Number.isFinite(pitch) && pitch >= 70 && pitch <= 1200;
        const targetFrequencyHz = target?.frequencyHz ?? null;
        const centsFromTarget = voiced && targetFrequencyHz ? centsBetween(pitch, targetFrequencyHz) : null;
        const nextFrame: PitchFrame = {
          timeMs,
          frequencyHz: voiced ? pitch : null,
          midi: voiced ? frequencyToMidi(pitch) : null,
          centsFromTarget,
          confidence: clarity,
          voiced,
          targetFrequencyHz
        };

        setLastPitchInfo(createPitchInfo(level, clarity, voiced, pitch));
        framesRef.current = [...framesRef.current, nextFrame].filter((frame) => frame.timeMs <= durationMs + 1200);
        setFrames(framesRef.current);

        if (timeMs >= durationMs + 500) {
          stopSession(true);
        }
      }, FRAME_INTERVAL_MS);

      setIsRecording(true);
      setStatus("录唱中：跟随参考音唱，曲线会实时更新。");
    } catch (error) {
      stopSession(false);
      setStatus(formatMicrophoneError(error));
      setLastPitchInfo("麦克风未连接");
    }
  }

  function stopSession(autoEnded: boolean) {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    synthNodesRef.current.forEach((node) => {
      try {
        node.stop();
      } catch {
        // Node may already be stopped.
      }
    });
    synthNodesRef.current = [];
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
    setIsRecording(false);
    setInputLevel(0);
    if (autoEnded) setStatus("录唱结束，可以生成 AI 教练反馈。");
  }

  function playReference(audioContext: AudioContext, notes: ReferenceNote[]) {
    const gain = audioContext.createGain();
    gain.gain.value = 0.08;
    gain.connect(audioContext.destination);

    synthNodesRef.current = notes.map((note) => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequencyHz;
      oscillator.connect(gain);
      oscillator.start(audioContext.currentTime + note.startMs / 1000);
      oscillator.stop(audioContext.currentTime + note.endMs / 1000);
      return oscillator;
    });
  }

  async function evaluateWithAi() {
    const payload: EvaluationPayload = {
      referenceNotes,
      singerFrames: downsampleFrames(frames, 220),
      deviationStats: stats,
      problemSegments
    };

    setIsEvaluating(true);
    setStatus("正在生成 AI 教练反馈...");
    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as CoachFeedback;
      setFeedback(result);
      setStatus(`已生成反馈，Provider: ${result.provider}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI 评估失败。");
    } finally {
      setIsEvaluating(false);
    }
  }

  const canEvaluate = frames.some((frame) => frame.voiced && frame.centsFromTarget !== null);

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Singing Pitch Coach</p>
            <h1>音准教练</h1>
          </div>
          <div className="actions">
            <select
              aria-label="选择麦克风"
              value={selectedDeviceId}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
              disabled={isRecording}
            >
              <option value="">默认麦克风</option>
              {audioDevices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `麦克风 ${index + 1}`}
                </option>
              ))}
            </select>
            <label className="file-button">
              <input type="file" accept=".mid,.midi,audio/midi" onChange={(event) => void handleMidiUpload(event.target.files?.[0] ?? null)} />
              上传 MIDI
            </label>
            <button type="button" onClick={() => setReferenceNotes(createDemoReference())} disabled={isRecording}>
              示例旋律
            </button>
            <button type="button" className="primary" onClick={() => void startSession()} disabled={isRecording}>
              开始录唱
            </button>
            <button type="button" onClick={() => stopSession(false)} disabled={!isRecording}>
              停止
            </button>
          </div>
        </header>

        <PitchChart notes={referenceNotes} frames={frames} durationMs={durationMs} />

        <section className="stats-grid">
          <Metric label="总分" value={stats.overallScore || "--"} />
          <Metric label="平均误差" value={stats.validFrameCount ? `${stats.averageAbsCents} cents` : "--"} />
          <Metric label="偏高比例" value={`${stats.sharpPercent}%`} />
          <Metric label="偏低比例" value={`${stats.flatPercent}%`} />
          <Metric label="稳定度" value={stats.validFrameCount ? stats.stabilityScore : "--"} />
          <Metric label="有效帧" value={stats.validFrameCount} />
        </section>

        <section className="mic-panel">
          <div>
            <span>麦克风电平</span>
            <strong>{lastPitchInfo}</strong>
          </div>
          <div className="level-meter" aria-label="麦克风输入电平">
            <i style={{ width: `${Math.min(100, inputLevel * 900)}%` }} />
          </div>
        </section>

        <div className="status-row">
          <span>{status}</span>
          <button type="button" className="primary" onClick={() => void evaluateWithAi()} disabled={!canEvaluate || isEvaluating || isRecording}>
            {isEvaluating ? "生成中..." : "生成 AI 反馈"}
          </button>
        </div>
      </section>

      <CoachPanel feedback={feedback} problemSegments={problemSegments} />
    </main>
  );
}

function calculateRms(input: Float32Array): number {
  const sum = input.reduce((total, sample) => total + sample * sample, 0);
  return Math.sqrt(sum / input.length);
}

function createPitchInfo(level: number, clarity: number, voiced: boolean, pitch: number): string {
  if (level < MIN_INPUT_LEVEL) return "输入很小，请检查麦克风或靠近一点";
  if (!voiced) return `有声音，但音高不稳定：置信度 ${(clarity * 100).toFixed(0)}%`;
  return `检测到 ${pitch.toFixed(1)} Hz，置信度 ${(clarity * 100).toFixed(0)}%`;
}

function formatMicrophoneError(error: unknown): string {
  if (!(error instanceof DOMException)) {
    return error instanceof Error ? error.message : "麦克风启动失败。";
  }
  if (error.name === "NotAllowedError") return "麦克风权限被拒绝。请在浏览器地址栏左侧重新允许麦克风权限。";
  if (error.name === "NotFoundError") return "没有找到可用麦克风。请确认系统已连接输入设备。";
  if (error.name === "NotReadableError") return "麦克风被其他程序占用，关闭会议软件或录音软件后再试。";
  if (error.name === "OverconstrainedError") return "选中的麦克风不可用，请切回默认麦克风再试。";
  return `麦克风启动失败：${error.name}`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function downsampleFrames(frames: PitchFrame[], maxFrames: number): PitchFrame[] {
  if (frames.length <= maxFrames) return frames;
  const step = Math.ceil(frames.length / maxFrames);
  return frames.filter((_, index) => index % step === 0);
}
