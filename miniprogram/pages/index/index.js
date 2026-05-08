const {
  centsBetween,
  createDemoReference,
  frequencyToMidi,
  getReferenceAt,
  getReferenceDuration,
  parseMidiArrayBuffer
} = require("../../utils/music");
const { computeDeviationStats, detectProblemSegments } = require("../../utils/scoring");
const { estimatePitchFromPcm } = require("../../utils/pitch");

const SAMPLE_RATE = 16000;
const CONFIDENCE_THRESHOLD = 0.55;
const MIN_INPUT_LEVEL = 0.006;
const MAX_REFERENCE_DURATION_MS = 30000;
const BACKEND_BASE_URLS = ["http://localhost:8787", "http://127.0.0.1:8787"];

Page({
  data: {
    referenceNotes: createDemoReference(),
    frames: [],
    isRecording: false,
    status: "使用内置 MIDI 示例，或上传一段 MIDI 后开始。",
    inputLevelPercent: 0,
    lastPitchInfo: "等待录音",
    referenceLabel: "示例旋律",
    referenceMeta: "9 个音符 · 4.9s",
    audioStatus: "示例旋律仅显示曲线；上传 MIDI 后会生成播放音频。",
    midiAudioUrl: "",
    canEvaluate: false,
    stats: decorateStats(computeDeviationStats([])),
    problemSegments: [],
    problemSegmentsView: [],
    feedback: null
  },

  onReady() {
    this.recorder = wx.getRecorderManager();
    this.referenceAudio = wx.createInnerAudioContext();
    this.referenceAudio.obeyMuteSwitch = false;
    this.referenceAudio.onError((error) => {
      this.setData({ audioStatus: `参考音播放失败：${error.errMsg || "请检查后端音频地址"}` });
    });
    this.bindRecorder();
    this.initChart();
  },

  onUnload() {
    this.stopSession();
    if (this.referenceAudio) this.referenceAudio.destroy();
  },

  bindRecorder() {
    this.recorder.onStart(() => {
      this.setData({
        isRecording: true,
        status: "录唱中：跟随参考音唱，曲线会实时更新。"
      });
    });

    this.recorder.onFrameRecorded((event) => {
      this.handleAudioFrame(event.frameBuffer);
    });

    this.recorder.onStop(() => {
      this.setData({
        isRecording: false,
        inputLevelPercent: 0,
        status: "录唱结束，可以生成 AI 教练反馈。"
      });
      this.stopReferenceTone();
    });

    this.recorder.onError((error) => {
      this.setData({
        isRecording: false,
        status: `麦克风启动失败：${error.errMsg || "请检查录音权限"}`,
        lastPitchInfo: "麦克风未连接"
      });
      this.stopReferenceTone();
    });
  },

  chooseMidi() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["mid", "midi"],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file) {
          this.setData({ status: "未选择 MIDI 文件。" });
          return;
        }
        this.loadMidiFile(file);
      },
      fail: () => {
        this.setData({ status: "没有选择 MIDI 文件。" });
      }
    });
  },

  loadMidiFile(file) {
    this.setData({ status: `正在解析 ${file.name}...` });
    wx.getFileSystemManager().readFile({
      filePath: file.path,
      success: (result) => {
        try {
          const parsedNotes = parseMidiArrayBuffer(result.data);
          const referenceNotes = limitReferenceNotes(parsedNotes);
          if (!referenceNotes.length) {
            this.setData({ status: "这个 MIDI 没有解析到可用旋律音符，请换一个单旋律 MIDI。" });
            return;
          }
          this.frames = [];
          this.setData(
            {
              referenceNotes,
              referenceLabel: file.name,
              referenceMeta: createReferenceMeta(referenceNotes, parsedNotes.length),
              audioStatus: "正在生成 MIDI 播放音频...",
              midiAudioUrl: "",
              frames: [],
              feedback: null,
              canEvaluate: false,
              stats: decorateStats(computeDeviationStats([])),
              problemSegments: [],
              problemSegmentsView: [],
              status: `已载入 ${referenceNotes.length} 个参考音符，曲线已刷新。`
            },
            () => this.drawChart()
          );
          this.renderMidiAudio(result.data);
        } catch (error) {
          this.setData({ status: error.message || "MIDI 解析失败，请换一个标准 MIDI 文件。" });
        }
      },
      fail: () => {
        this.setData({ status: "读取 MIDI 文件失败。" });
      }
    });
  },

  renderMidiAudio(midiBuffer) {
    this.tryRenderMidiAudio(midiBuffer, 0);
  },

  tryRenderMidiAudio(midiBuffer, backendIndex) {
    const backendBaseUrl = BACKEND_BASE_URLS[backendIndex];
    if (!backendBaseUrl) {
      this.setData({
        audioStatus: "无法连接后端。请确认 npm run server/npm run dev 已启动，并在开发者工具详情中勾选“不校验合法域名”。"
      });
      return;
    }

    wx.request({
      url: `${backendBaseUrl}/api/midi/render`,
      method: "POST",
      data: midiBuffer,
      header: {
        "content-type": "application/octet-stream"
      },
      success: (response) => {
        const data = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300 && data.audioUrl) {
          const audioUrl = String(data.audioUrl).replace(/^https?:\/\/[^/]+/, backendBaseUrl);
          this.setData({
            midiAudioUrl: audioUrl,
            audioStatus: `参考音频已生成，可在录唱时播放。${data.durationMs ? `时长 ${(data.durationMs / 1000).toFixed(1)}s。` : ""}`
          });
          return;
        }
        this.tryRenderMidiAudio(midiBuffer, backendIndex + 1);
      },
      fail: () => {
        this.tryRenderMidiAudio(midiBuffer, backendIndex + 1);
      }
    });
  },

  resetDemo() {
    this.setData(
      {
        referenceNotes: createDemoReference(),
        frames: [],
        feedback: null,
        referenceLabel: "示例旋律",
        referenceMeta: "9 个音符 · 4.9s",
        audioStatus: "示例旋律仅显示曲线；上传 MIDI 后会生成播放音频。",
        midiAudioUrl: "",
        canEvaluate: false,
        stats: decorateStats(computeDeviationStats([])),
        problemSegments: [],
        problemSegmentsView: [],
        status: "已切换到示例旋律。"
      },
      () => this.drawChart()
    );
  },

  startSession() {
    this.requestRecordPermission(() => {
      this.stopSession();
      this.startTime = Date.now();
      this.frames = [];
      this.lastToneIndex = -1;
      this.setData({
        frames: [],
        feedback: null,
        canEvaluate: false,
        inputLevelPercent: 0,
        lastPitchInfo: "正在初始化麦克风",
        status: "正在请求麦克风权限..."
      });

      const duration = Math.min(getReferenceDuration(this.data.referenceNotes), MAX_REFERENCE_DURATION_MS);
      this.recorder.start({
        duration: duration + 1200,
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "PCM",
        frameSize: 8
      });
      this.playReferenceAudio();
      this.scheduleReferenceTone();
    });
  },

  requestRecordPermission(onGranted) {
    wx.getSetting({
      success: (settings) => {
        if (settings.authSetting["scope.record"]) {
          onGranted();
          return;
        }
        wx.authorize({
          scope: "scope.record",
          success: onGranted,
          fail: () => {
            wx.showModal({
              title: "需要麦克风权限",
              content: "请允许录音权限，才能分析你的演唱音准。",
              confirmText: "去设置",
              success: (result) => {
                if (result.confirm) {
                  wx.openSetting();
                }
              }
            });
            this.setData({ status: "麦克风权限未开启。" });
          }
        });
      },
      fail: () => {
        this.setData({ status: "读取授权状态失败，请检查开发者工具权限设置。" });
      }
    });
  },

  stopSession() {
    if (this.data.isRecording) {
      this.recorder.stop();
    }
    this.stopReferenceTone();
    if (this.referenceTimer) {
      clearInterval(this.referenceTimer);
      this.referenceTimer = null;
    }
  },

  handleAudioFrame(frameBuffer) {
    const timeMs = Date.now() - this.startTime;
    const target = getReferenceAt(this.data.referenceNotes, timeMs);
    const result = estimatePitchFromPcm(frameBuffer, SAMPLE_RATE);
    const hasInput = result.level >= MIN_INPUT_LEVEL;
    const voiced =
      hasInput &&
      result.frequencyHz !== null &&
      result.confidence >= CONFIDENCE_THRESHOLD &&
      result.frequencyHz >= 70 &&
      result.frequencyHz <= 1200;
    const targetFrequencyHz = target ? target.frequencyHz : null;
    const centsFromTarget = voiced && targetFrequencyHz ? centsBetween(result.frequencyHz, targetFrequencyHz) : null;
    const frame = {
      timeMs,
      frequencyHz: voiced ? result.frequencyHz : null,
      midi: voiced ? frequencyToMidi(result.frequencyHz) : null,
      centsFromTarget,
      confidence: result.confidence,
      voiced,
      targetFrequencyHz
    };

    const durationMs = Math.min(getReferenceDuration(this.data.referenceNotes), MAX_REFERENCE_DURATION_MS);
    this.frames = [...this.frames, frame].filter((item) => item.timeMs <= durationMs + 1200);
    const stats = computeDeviationStats(this.frames);
    const problemSegments = detectProblemSegments(this.frames);

    this.setData({
      frames: this.frames,
      inputLevelPercent: Math.min(100, Math.round(result.level * 900)),
      lastPitchInfo: createPitchInfo(result.level, result.confidence, voiced, result.frequencyHz),
      canEvaluate: this.frames.some((item) => item.voiced && item.centsFromTarget !== null),
      stats: decorateStats(stats),
      problemSegments,
      problemSegmentsView: problemSegments.map(toProblemSegmentView)
    });
    this.drawChart();
  },

  scheduleReferenceTone() {
    this.referenceTimer = setInterval(() => {
      const timeMs = Date.now() - this.startTime;
      const notes = this.data.referenceNotes;
      const noteIndex = notes.findIndex((note) => timeMs >= note.startMs && timeMs <= note.endMs);
      if (noteIndex !== this.lastToneIndex) {
        this.lastToneIndex = noteIndex;
        if (noteIndex >= 0) {
          this.playReferenceTone(notes[noteIndex]);
        }
      }
      if (timeMs > Math.min(getReferenceDuration(notes), MAX_REFERENCE_DURATION_MS) + 500) {
        this.stopSession();
      }
    }, 60);
  },

  playReferenceTone(note) {
    const frequency = Math.round(note.frequencyHz);
    this.setData({ status: `录唱中：当前参考音 ${note.name} (${frequency} Hz)。` });
  },

  playReferenceAudio() {
    if (!this.data.midiAudioUrl || !this.referenceAudio) {
      this.setData({ audioStatus: "当前没有可播放的 MIDI 音频；请先上传 MIDI 并等待生成完成。" });
      return;
    }
    this.referenceAudio.stop();
    this.referenceAudio.src = this.data.midiAudioUrl;
    this.referenceAudio.play();
    this.setData({ audioStatus: "正在播放 MIDI 参考音。" });
  },

  stopReferenceTone() {
    if (this.referenceAudio) {
      this.referenceAudio.stop();
    }
  },

  initChart() {
    wx.createSelectorQuery()
      .in(this)
      .select("#pitchChart")
      .fields({ node: true, size: true })
      .exec((result) => {
        const canvasInfo = result && result[0];
        if (!canvasInfo || !canvasInfo.node) {
          this.setData({ status: "画布初始化失败，请重新编译小程序。" });
          return;
        }
        const pixelRatio = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
        const canvas = canvasInfo.node;
        canvas.width = canvasInfo.width * pixelRatio;
        canvas.height = canvasInfo.height * pixelRatio;
        const context = canvas.getContext("2d");
        context.scale(pixelRatio, pixelRatio);
        this.chart = {
          canvas,
          context,
          width: canvasInfo.width,
          height: canvasInfo.height
        };
        this.drawChart();
      });
  },

  evaluateWithAi() {
    const stats = computeDeviationStats(this.frames || []);
    const problemSegments = detectProblemSegments(this.frames || []);
    const feedback = createMockFeedback(stats, problemSegments);
    this.setData({
      feedback,
      status: "已生成本地 AI 教练反馈。接入后端域名后可切换为云端大模型。"
    });
  },

  drawChart() {
    if (!this.chart) return;
    const ctx = this.chart.context;
    const width = this.chart.width;
    const height = this.chart.height;
    const padding = { top: 22, right: 16, bottom: 22, left: 32 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const notes = this.data.referenceNotes;
    const frames = this.frames || [];
    const durationMs = Math.max(Math.min(getReferenceDuration(notes), MAX_REFERENCE_DURATION_MS), 5000);
    const allMidi = notes
      .map((note) => note.midi)
      .concat(frames.map((frame) => frame.midi).filter((value) => value !== null));
    const minMidi = Math.floor(Math.min(...allMidi, 55) - 2);
    const maxMidi = Math.ceil(Math.max(...allMidi, 76) + 2);
    const x = (timeMs) => padding.left + (timeMs / durationMs) * plotWidth;
    const y = (midi) => padding.top + ((maxMidi - midi) / (maxMidi - minMidi)) * plotHeight;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#d9e2ec";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#64748b";
    ctx.font = "10px sans-serif";
    for (let midi = Math.ceil(minMidi / 2) * 2; midi <= maxMidi; midi += 2) {
      const yy = y(midi);
      ctx.beginPath();
      ctx.moveTo(padding.left, yy);
      ctx.lineTo(width - padding.right, yy);
      ctx.stroke();
      ctx.fillText(String(midi), 8, yy + 3);
    }

    ctx.strokeStyle = "#0f766e";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    notes.forEach((note) => {
      if (note.startMs > durationMs) return;
      ctx.beginPath();
      ctx.moveTo(x(note.startMs), y(note.midi));
      ctx.lineTo(x(Math.min(note.endMs, durationMs)), y(note.midi));
      ctx.stroke();
    });

    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let hasStarted = false;
    frames.forEach((frame) => {
      if (!frame.voiced || frame.midi === null) {
        hasStarted = false;
        return;
      }
      const xx = x(frame.timeMs);
      const yy = y(frame.midi);
      if (!hasStarted) {
        ctx.moveTo(xx, yy);
        hasStarted = true;
      } else {
        ctx.lineTo(xx, yy);
      }
    });
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.font = "12px sans-serif";
    ctx.fillText("参考", padding.left, 14);
    ctx.fillStyle = "#dc2626";
    ctx.fillText("人声", padding.left + 42, 14);
  }
});

function decorateStats(stats) {
  return {
    ...stats,
    overallScoreText: stats.validFrameCount ? stats.overallScore : "--",
    averageAbsCentsText: stats.validFrameCount ? `${stats.averageAbsCents} cents` : "--",
    stabilityScoreText: stats.validFrameCount ? stats.stabilityScore : "--"
  };
}

function createPitchInfo(level, confidence, voiced, pitch) {
  if (level < MIN_INPUT_LEVEL) return "输入很小，请检查麦克风";
  if (!voiced) return `有声音，音高不稳定 ${Math.round(confidence * 100)}%`;
  return `检测到 ${pitch.toFixed(1)} Hz，置信度 ${Math.round(confidence * 100)}%`;
}

function limitReferenceNotes(notes) {
  return notes
    .filter((note) => note.startMs < MAX_REFERENCE_DURATION_MS)
    .map((note) => ({
      ...note,
      endMs: Math.min(note.endMs, MAX_REFERENCE_DURATION_MS)
    }))
    .filter((note) => note.endMs > note.startMs);
}

function createReferenceMeta(displayNotes, originalCount) {
  const duration = getReferenceDuration(displayNotes);
  const suffix = originalCount > displayNotes.length ? ` · 已截取前 ${Math.round(MAX_REFERENCE_DURATION_MS / 1000)}s` : "";
  return `${displayNotes.length} 个音符 · ${(duration / 1000).toFixed(1)}s${suffix}`;
}

function toProblemSegmentView(segment) {
  return {
    key: `${segment.startMs}-${segment.endMs}`,
    text: `${formatTime(segment.startMs)}-${formatTime(segment.endMs)}：${issueLabel(segment.issue)}，平均 ${segment.averageCents} cents`
  };
}

function createMockFeedback(stats, problemSegments) {
  const primaryBias =
    stats.sharpPercent > stats.flatPercent + 10 ? "整体更容易偏高" : stats.flatPercent > stats.sharpPercent + 10 ? "整体更容易偏低" : "偏高和偏低比较均衡";
  return {
    overallScore: stats.overallScore,
    pitchAccuracyScore: Math.max(0, Math.round(100 - stats.averageAbsCents)),
    stabilityScore: stats.stabilityScore,
    summary: `本次平均音准误差约 ${stats.averageAbsCents} cents，${primaryBias}。`,
    mainIssues: [primaryBias, `有效发声覆盖率约 ${stats.voicedPercent}%。`, `音高稳定度为 ${stats.stabilityScore} 分。`],
    segmentFeedback: problemSegments.length
      ? problemSegments.slice(0, 3).map((segment) => `${formatTime(segment.startMs)}-${formatTime(segment.endMs)} ${issueLabel(segment.issue)}，平均偏差 ${segment.averageCents} cents。`)
      : ["没有检测到持续性的严重跑调片段。"],
    practiceSuggestions: [
      "先用慢速跟唱，把每个长音保持在目标线附近。",
      "对偏高或偏低最明显的时间段单独循环练习。",
      "录唱时尽量使用耳机播放参考音，减少麦克风串音。"
    ],
    provider: "local-mock"
  };
}

function formatTime(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function issueLabel(issue) {
  return issue === "sharp" ? "偏高" : issue === "flat" ? "偏低" : "不稳定";
}
