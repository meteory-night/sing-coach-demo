# 歌唱音准评估网页 MVP

一个用于验证“参考 MIDI + 人声实时音高检测 + AI 教练反馈”的网页 MVP。

## 功能

- 上传 MIDI 或使用内置示例旋律。
- 播放参考旋律并录制麦克风输入。
- 实时显示参考音高曲线与人声音高曲线。
- 逐帧计算 cents 偏差、偏高/偏低比例、稳定度和整体分。
- 后端 `/api/evaluate` 只接收结构化音准特征，不上传原始录音。
- AI Provider 支持 `mock`、`openai`、`minimax`、`gemini`。

## 运行

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址，通常是 `http://localhost:5173`。

## AI 配置

复制 `.env.example` 为 `.env`，默认可不配置密钥，使用 mock 反馈。

```bash
AI_PROVIDER=mock
```

OpenAI 示例：

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=your_key
AI_MODEL=gpt-4.1-mini
```

MiniMax 示例：

```bash
AI_PROVIDER=minimax
MINIMAX_API_KEY=your_key
AI_MODEL=MiniMax-M2.7
```

Gemini 示例：

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key
AI_MODEL=gemini-2.5-flash
```

## 验证

```bash
npm test
npm run build
```

## 微信小程序版本

小程序代码在 `miniprogram/`，不会影响网页版代码。

使用微信开发者工具打开 `miniprogram/` 目录即可预览。当前小程序 MVP 保持与网页版一致的信息结构：

- 示例旋律/上传 MIDI 入口
- 开始录唱/停止
- 参考曲线与人声曲线
- 麦克风电平与音高检测状态
- 音准分数、偏高/偏低比例、稳定度
- 本地 mock 教练反馈

说明：小程序端已用 `RecorderManager.onFrameRecorded` + PCM 自相关算法做实时音高检测骨架。由于小程序没有浏览器 Web Audio 的正弦波合成能力，参考旋律播放在该版本先显示为“当前参考音”提示；后续可接入预生成参考音频或服务端 MIDI 转音频。
