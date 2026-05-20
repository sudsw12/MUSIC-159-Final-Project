import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeStemBuffer,
  mapFrameToSoundboxPosition,
} from './js/soundbox-analyzer.js';

function createStereoSineBuffer({ frequency, leftGain, rightGain, duration = 1, sampleRate = 48000 }) {
  const length = Math.floor(duration * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    left[i] = sample * leftGain;
    right[i] = sample * rightGain;
  }

  return {
    duration,
    length,
    numberOfChannels: 2,
    sampleRate,
    getChannelData(channel) {
      return channel === 0 ? left : right;
    },
  };
}

function createDelayedEntryBuffer({ quietGain, activeGain, entryTime = 1.5, duration = 3, sampleRate = 48000 }) {
  const length = Math.floor(duration * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;
    const gain = time < entryTime ? quietGain : activeGain;
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * gain;
    left[i] = sample;
    right[i] = sample;
  }

  return {
    duration,
    length,
    numberOfChannels: 2,
    sampleRate,
    getChannelData(channel) {
      return channel === 0 ? left : right;
    },
  };
}

test('analyzeStemBuffer derives pan, energy, and register from stereo audio', () => {
  const lowLeft = createStereoSineBuffer({ frequency: 180, leftGain: 0.9, rightGain: 0.15 });
  const highRight = createStereoSineBuffer({ frequency: 2400, leftGain: 0.15, rightGain: 0.9 });

  const lowFrames = analyzeStemBuffer(lowLeft, { intervalSeconds: 0.5, windowSeconds: 0.25 });
  const highFrames = analyzeStemBuffer(highRight, { intervalSeconds: 0.5, windowSeconds: 0.25 });

  assert.equal(lowFrames.length, 3);
  assert.equal(highFrames.length, 3);
  assert.ok(lowFrames[1].pan < -0.55, `expected left pan, got ${lowFrames[1].pan}`);
  assert.ok(highFrames[1].pan > 0.55, `expected right pan, got ${highFrames[1].pan}`);
  assert.ok(lowFrames[1].energy > 0.1);
  assert.ok(highFrames[1].registerHz > lowFrames[1].registerHz * 4);
  assert.ok(highFrames[1].registerNorm > lowFrames[1].registerNorm);
});

test('analyzeStemBuffer gates residual leakage so absent sections render tiny', () => {
  const buffer = createDelayedEntryBuffer({ quietGain: 0.12, activeGain: 0.9 });
  const frames = analyzeStemBuffer(buffer, { intervalSeconds: 0.5, windowSeconds: 0.25 });
  const absentFrame = frames.find((frame) => frame.time === 0.5);
  const activeFrame = frames.find((frame) => frame.time === 2);
  const absentPosition = mapFrameToSoundboxPosition(absentFrame, { baseDepth: 2, breathAmount: 0.3 });
  const activePosition = mapFrameToSoundboxPosition(activeFrame, { baseDepth: 2, breathAmount: 0.3 });

  assert.ok(absentFrame.energy > 0, 'synthetic leakage should still have measurable energy');
  assert.ok(absentFrame.energyNorm < 0.03, `expected gated absence, got ${absentFrame.energyNorm}`);
  assert.ok(activeFrame.energyNorm > 0.75, `expected active entry, got ${activeFrame.energyNorm}`);
  assert.ok(absentPosition.radius < 0.08, `expected tiny absent radius, got ${absentPosition.radius}`);
  assert.ok(activePosition.radius > absentPosition.radius * 5);
});

test('mapFrameToSoundboxPosition parks inactive frames instead of moving with noise', () => {
  const profile = {
    baseDepth: 2,
    breathAmount: 0.3,
    restPan: 0,
    restRegisterNorm: 0.46,
  };
  const noisyAbsentLeft = {
    time: 0,
    pan: -0.75,
    energy: 0.01,
    energyNorm: 0,
    registerNorm: 0.2,
    registerHz: 180,
  };
  const noisyAbsentRight = {
    time: 0.5,
    pan: 0.8,
    energy: 0.01,
    energyNorm: 0.01,
    registerNorm: 0.9,
    registerHz: 5200,
  };

  const first = mapFrameToSoundboxPosition(noisyAbsentLeft, profile);
  const second = mapFrameToSoundboxPosition(noisyAbsentRight, profile);

  assert.equal(first.isActive, false);
  assert.equal(second.isActive, false);
  assert.equal(first.x, second.x);
  assert.equal(first.y, second.y);
  assert.equal(first.z, second.z);
  assert.ok(first.radius < 0.08);
});

test('mapFrameToSoundboxPosition blends near-threshold frames instead of snapping', () => {
  const profile = {
    baseDepth: 0,
    breathAmount: 0.3,
    restPan: 0,
    restRegisterNorm: 0.5,
  };
  const almostInactive = {
    time: 1,
    pan: -1,
    energy: 0.01,
    energyNorm: 0.034,
    registerNorm: 0.2,
    registerHz: 220,
  };
  const barelyActive = {
    time: 1.5,
    pan: 1,
    energy: 0.011,
    energyNorm: 0.036,
    registerNorm: 0.9,
    registerHz: 4200,
  };

  const first = mapFrameToSoundboxPosition(almostInactive, profile);
  const second = mapFrameToSoundboxPosition(barelyActive, profile);
  const jumpDistance = Math.hypot(second.x - first.x, second.y - first.y, second.z - first.z);

  assert.ok(jumpDistance < 0.25, `expected smooth threshold crossing, got jump ${jumpDistance}`);
  assert.ok(second.activity >= first.activity);
});

test('mapFrameToSoundboxPosition maps measured metrics onto pan/register/depth axes', () => {
  const frame = {
    time: 12,
    pan: 0.5,
    energy: 0.5,
    energyNorm: 0.75,
    registerNorm: 0.8,
    registerHz: 2500,
  };

  const position = mapFrameToSoundboxPosition(frame, {
    baseDepth: 1.25,
    breathAmount: 0.4,
  });

  assert.equal(position.time, 12);
  assert.ok(position.x > 1.5 && position.x < 1.9);
  assert.ok(position.y > 1.7 && position.y < 2.2);
  assert.ok(position.z > 1.4 && position.z < 1.7);
  assert.equal(position.pan, frame.pan);
  assert.equal(position.registerHz, frame.registerHz);
});
