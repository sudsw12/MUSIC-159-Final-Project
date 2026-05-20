import { DEPTH_PROFILES, SOUNDSPACE } from './soundbox-data.js';

const DEFAULT_INTERVAL_SECONDS = 0.5;
const DEFAULT_WINDOW_SECONDS = 0.24;
const REGISTER_BIN_COUNT = 42;
const REGISTER_SAMPLE_COUNT = 384;
const DEFAULT_ACTIVE_THRESHOLD = 0.06;
const DEFAULT_ACTIVITY_START = 0.012;
const DEFAULT_ACTIVITY_FULL = 0.34;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function getChannels(buffer) {
  const channels = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    channels.push(buffer.getChannelData(channel));
  }
  return channels;
}

function getWindowBounds(buffer, centerTime, windowSeconds) {
  const sampleRate = buffer.sampleRate;
  const windowLength = Math.max(32, Math.floor(windowSeconds * sampleRate));
  let start = Math.floor(centerTime * sampleRate - windowLength / 2);
  start = clamp(start, 0, Math.max(0, buffer.length - windowLength));
  return {
    start,
    end: Math.min(buffer.length, start + windowLength),
  };
}

function rmsForChannel(channelData, start, end, step) {
  let sum = 0;
  let count = 0;

  for (let i = start; i < end; i += step) {
    const sample = channelData[i] || 0;
    sum += sample * sample;
    count++;
  }

  return count > 0 ? Math.sqrt(sum / count) : 0;
}

function averageSample(channels, sampleIndex) {
  if (channels.length === 0) return 0;
  let sum = 0;
  for (const channel of channels) {
    sum += channel[sampleIndex] || 0;
  }
  return sum / channels.length;
}

function estimateZeroCrossingHz(channels, sampleRate, start, end) {
  if (end - start < 2 || channels.length === 0) return SOUNDSPACE.minRegisterHz;

  let crossings = 0;
  let previous = averageSample(channels, start);
  const step = Math.max(1, Math.floor((end - start) / REGISTER_SAMPLE_COUNT));

  for (let i = start + step; i < end; i += step) {
    const current = averageSample(channels, i);
    if ((previous < 0 && current >= 0) || (previous > 0 && current <= 0)) {
      crossings++;
    }
    if (Math.abs(current) > 1e-5) previous = current;
  }

  const duration = (end - start) / sampleRate;
  const estimate = crossings / Math.max(1e-6, 2 * duration);
  return clamp(estimate, SOUNDSPACE.minRegisterHz, SOUNDSPACE.maxRegisterHz);
}

function logFrequencyAt(index, count, minHz, maxHz) {
  const t = count <= 1 ? 0 : index / (count - 1);
  return minHz * Math.pow(maxHz / minHz, t);
}

function estimateSpectralCentroid(channels, sampleRate, start, end) {
  if (end <= start || channels.length === 0) return SOUNDSPACE.minRegisterHz;

  const sampleCount = Math.min(REGISTER_SAMPLE_COUNT, Math.max(64, end - start));
  const powers = [];
  let powerSum = 0;
  let weightedSum = 0;

  for (let bin = 0; bin < REGISTER_BIN_COUNT; bin++) {
    const frequency = logFrequencyAt(bin, REGISTER_BIN_COUNT, SOUNDSPACE.minRegisterHz, SOUNDSPACE.maxRegisterHz);
    const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;

    for (let n = 0; n < sampleCount; n++) {
      const t = sampleCount <= 1 ? 0 : n / (sampleCount - 1);
      const sampleIndex = Math.min(end - 1, Math.floor(lerp(start, end - 1, t)));
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
      s0 = averageSample(channels, sampleIndex) * window + coefficient * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    const power = Math.max(0, s1 * s1 + s2 * s2 - coefficient * s1 * s2);
    powers.push(power);
    powerSum += power;
    weightedSum += frequency * power;
  }

  const zeroCrossingHz = estimateZeroCrossingHz(channels, sampleRate, start, end);
  if (powerSum <= 1e-12) return zeroCrossingHz;

  const centroidHz = clamp(weightedSum / powerSum, SOUNDSPACE.minRegisterHz, SOUNDSPACE.maxRegisterHz);
  const ratio = Math.max(centroidHz, zeroCrossingHz) / Math.max(SOUNDSPACE.minRegisterHz, Math.min(centroidHz, zeroCrossingHz));

  // MP3 stems often contain separation noise. Use zero crossings as a guard
  // when the sparse-bin centroid is clearly being pulled toward broadband hiss.
  if (ratio > 4) return zeroCrossingHz;
  return clamp(Math.sqrt(centroidHz * zeroCrossingHz), SOUNDSPACE.minRegisterHz, SOUNDSPACE.maxRegisterHz);
}

export function normalizeRegister(registerHz) {
  const min = Math.log2(SOUNDSPACE.minRegisterHz);
  const max = Math.log2(SOUNDSPACE.maxRegisterHz);
  return clamp((Math.log2(clamp(registerHz, SOUNDSPACE.minRegisterHz, SOUNDSPACE.maxRegisterHz)) - min) / (max - min), 0, 1);
}

export function analyzeStemBuffer(buffer, options = {}) {
  const intervalSeconds = options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const channels = getChannels(buffer);
  const leftChannel = channels[0];
  const rightChannel = channels[1] || channels[0];
  const frames = [];
  const maxFrames = Math.floor(buffer.duration / intervalSeconds);

  for (let frameIndex = 0; frameIndex <= maxFrames; frameIndex++) {
    const time = Math.min(buffer.duration, frameIndex * intervalSeconds);
    const { start, end } = getWindowBounds(buffer, time, windowSeconds);
    const sampleCount = Math.max(1, end - start);
    const step = Math.max(1, Math.floor(sampleCount / 1600));
    const leftRms = rmsForChannel(leftChannel, start, end, step);
    const rightRms = rmsForChannel(rightChannel, start, end, step);
    const total = leftRms + rightRms;
    const pan = total > 1e-8 ? clamp((rightRms - leftRms) / total, -1, 1) : 0;
    const energy = Math.sqrt((leftRms * leftRms + rightRms * rightRms) / 2);
    const registerHz = estimateSpectralCentroid(channels, buffer.sampleRate, start, end);

    frames.push({
      time,
      pan,
      energy,
      energyNorm: energy,
      registerHz,
      registerNorm: normalizeRegister(registerHz),
    });
  }

  const energies = frames.map((frame) => frame.energy);
  const peakEnergy = Math.max(...energies, 1e-6);
  const noiseFloor = percentile(energies, 0.2);
  const dynamicRange = peakEnergy - noiseFloor;

  return frames.map((frame) => ({
    ...frame,
    energyNorm: dynamicRange > peakEnergy * 0.08
      ? Math.pow(clamp((frame.energy - (noiseFloor + dynamicRange * 0.08)) / Math.max(dynamicRange * 0.92, 1e-6), 0, 1), 1.55)
      : clamp(frame.energy / peakEnergy, 0, 1),
  }));
}

export function mapFrameToSoundboxPosition(frame, profile = {}, space = SOUNDSPACE) {
  const baseDepth = profile.baseDepth ?? 0;
  const breathAmount = profile.breathAmount ?? 0.2;
  const energyNorm = clamp(frame.energyNorm, 0, 1);
  const activity = frame.activity ?? smoothstep(
    profile.activityStart ?? DEFAULT_ACTIVITY_START,
    profile.activityFull ?? DEFAULT_ACTIVITY_FULL,
    energyNorm
  );
  const isActive = activity >= (profile.activeThreshold ?? DEFAULT_ACTIVE_THRESHOLD);
  const pan = lerp(profile.restPan ?? 0, frame.pan, activity);
  const registerNorm = lerp(profile.restRegisterNorm ?? 0.5, frame.registerNorm, activity);
  const x = clamp(pan, -1, 1) * space.xMax;
  const y = lerp(space.yMin, space.yMax, clamp(registerNorm, 0, 1));
  const z = clamp(baseDepth + energyNorm * breathAmount * activity, space.zMin, space.zMax);

  return {
    ...frame,
    activity,
    isActive,
    x,
    y,
    z,
    radius: 0.055 + energyNorm * 0.42,
  };
}

export function getFrameAtTime(frames, time) {
  if (!frames || frames.length === 0) return null;
  if (time <= frames[0].time) return frames[0];
  const last = frames[frames.length - 1];
  if (time >= last.time) return last;

  let low = 0;
  let high = frames.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].time < time) low = mid + 1;
    else high = mid - 1;
  }

  const previous = frames[Math.max(0, low - 1)];
  const next = frames[low];
  const span = next.time - previous.time || 1;
  const t = clamp((time - previous.time) / span, 0, 1);

  return {
    time,
    pan: lerp(previous.pan, next.pan, t),
    energy: lerp(previous.energy, next.energy, t),
    energyNorm: lerp(previous.energyNorm, next.energyNorm, t),
    registerHz: lerp(previous.registerHz, next.registerHz, t),
    registerNorm: lerp(previous.registerNorm, next.registerNorm, t),
  };
}

export function analyzeSoundboxBuffers(buffersByStem, options = {}) {
  const analyses = {};
  Object.entries(buffersByStem).forEach(([stemId, buffer]) => {
    const frames = analyzeStemBuffer(buffer, options);
    const profile = DEPTH_PROFILES[stemId] || {};
    const positions = frames.map((frame) => mapFrameToSoundboxPosition(frame, profile));
    analyses[stemId] = { frames, positions };
  });
  return analyses;
}
