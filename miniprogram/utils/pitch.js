function estimatePitchFromPcm(frameBuffer, sampleRate) {
  const samples = pcm16ToFloat32(frameBuffer);
  if (samples.length < 256) return { frequencyHz: null, confidence: 0, level: 0 };

  const level = calculateRms(samples);
  if (level < 0.006) return { frequencyHz: null, confidence: 0, level };

  const minLag = Math.floor(sampleRate / 1200);
  const maxLag = Math.min(Math.floor(sampleRate / 70), samples.length - 1);
  let bestLag = -1;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    const limit = samples.length - lag;
    for (let i = 0; i < limit; i += 1) {
      const left = samples[i];
      const right = samples[i + lag];
      sum += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const correlation = sum / Math.sqrt(leftEnergy * rightEnergy || 1);
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorrelation < 0.42) {
    return { frequencyHz: null, confidence: Math.max(0, bestCorrelation), level };
  }

  return {
    frequencyHz: sampleRate / bestLag,
    confidence: Math.max(0, Math.min(1, bestCorrelation)),
    level
  };
}

function pcm16ToFloat32(frameBuffer) {
  const view = new DataView(frameBuffer);
  const samples = new Float32Array(Math.floor(view.byteLength / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return samples;
}

function calculateRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

module.exports = {
  estimatePitchFromPcm
};
