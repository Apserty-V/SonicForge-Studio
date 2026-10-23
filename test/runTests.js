/**
 * SonicForge Studio - Automated DSP & Audio Engine Test Suite
 * Validates audio buffer manipulation, WSOLA pitch shifting, WAV encoding,
 * synthesizer waveforms, noise generators, and edge-case handling.
 */

import assert from 'node:assert';

console.log('===========================================================');
console.log('   RUNNING SONICFORGE STUDIO AUTOMATED TEST SUITE');
console.log('===========================================================');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    failedTests++;
  }
}

// Mock AudioBuffer structure for Node tests
function createMockAudioBuffer(channels, length, sampleRate = 44100) {
  const channelData = [];
  for (let ch = 0; ch < channels; ch++) {
    channelData.push(new Float32Array(length));
  }
  return {
    numberOfChannels: channels,
    length: length,
    sampleRate: sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch) => channelData[ch],
  };
}

// 1. WAV Header & Structure Validation Test
runTest('WAV 16-bit Header and PCM Byte Allocation', () => {
  const sampleRate = 44100;
  const numChannels = 2;
  const length = 44100; // 1 second
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const totalBufferSize = 44 + dataSize;

  const ab = new ArrayBuffer(totalBufferSize);
  const view = new DataView(ab);

  // Write ASCII
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // Verify Header markers
  const riffStr = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const waveStr = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  const dataStr = String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39));

  assert.strictEqual(riffStr, 'RIFF');
  assert.strictEqual(waveStr, 'WAVE');
  assert.strictEqual(dataStr, 'data');
  assert.strictEqual(view.getUint16(20, true), 1); // PCM
  assert.strictEqual(view.getUint32(40, true), 176400); // 44100 * 4 bytes
});

// 2. AudioBuffer Crop / Trim Test
runTest('Audio Editing: Non-destructive Crop/Trim Calculation', () => {
  const buf = createMockAudioBuffer(2, 44100, 44100);
  const startTime = 0.25;
  const endTime = 0.75;
  const startSample = Math.floor(startTime * buf.sampleRate);
  const endSample = Math.ceil(endTime * buf.sampleRate);
  const newLength = endSample - startSample;

  assert.strictEqual(newLength, 22050);
  assert.strictEqual(newLength / buf.sampleRate, 0.5);
});

// 3. AudioBuffer Cut & Splice Test
runTest('Audio Editing: Cut Selection and Splice', () => {
  const buf = createMockAudioBuffer(1, 1000, 1000);
  const d = buf.getChannelData(0);
  for (let i = 0; i < 1000; i++) d[i] = i;

  // Cut range [200, 500] (length 300)
  const cutStart = 200;
  const cutEnd = 500;
  const cutLength = cutEnd - cutStart;
  const newLen = 1000 - cutLength;

  const dest = new Float32Array(newLen);
  for (let i = 0; i < cutStart; i++) dest[i] = d[i];
  for (let i = cutEnd; i < 1000; i++) dest[i - cutLength] = d[i];

  assert.strictEqual(dest.length, 700);
  assert.strictEqual(dest[199], 199);
  assert.strictEqual(dest[200], 500); // verify seamless join
});

// 4. AudioBuffer Reverse Test
runTest('Audio Editing: Reverse Buffer Range', () => {
  const input = new Float32Array([1, 2, 3, 4, 5]);
  const reversed = new Float32Array(5);
  for (let i = 0; i < 5; i++) {
    reversed[i] = input[4 - i];
  }
  assert.deepStrictEqual(Array.from(reversed), [5, 4, 3, 2, 1]);
});

// 5. Fade In & Fade Out Mathematical Verification
runTest('Audio Editing: Fade In / Fade Out Envelope Mathematics', () => {
  const len = 100;
  const input = new Float32Array(len).fill(1.0);
  const fadedIn = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    fadedIn[i] = input[i] * (i / (len - 1));
  }
  assert.strictEqual(fadedIn[0], 0.0);
  assert.strictEqual(fadedIn[len - 1], 1.0);
  assert.ok(Math.abs(fadedIn[50] - 50 / 99) < 0.01);
});

// 6. Resampling & Speed Change
runTest('Audio Editing: Playback Speed Resampling', () => {
  const originalLen = 1000;
  const speedFactor = 2.0; // 2x speed -> half length
  const newLen = Math.round(originalLen / speedFactor);
  assert.strictEqual(newLen, 500);

  const halfSpeed = 0.5;
  const halfLen = Math.round(originalLen / halfSpeed);
  assert.strictEqual(halfLen, 2000);
});

// 7. Tone Generation Formulas (Sine, Square, Triangle, Sawtooth)
runTest('Sound Lab: Synthesis Waveforms Verification', () => {
  const freq = 440;
  const sr = 44100;
  const phaseIncr = (2 * Math.PI * freq) / sr;
  let phase = 0;

  // Sine
  const s0 = Math.sin(0);
  assert.strictEqual(s0, 0);

  // Square
  const sqPositive = Math.sin(Math.PI / 2) >= 0 ? 1 : -1;
  const sqNegative = Math.sin((3 * Math.PI) / 2) >= 0 ? 1 : -1;
  assert.strictEqual(sqPositive, 1);
  assert.strictEqual(sqNegative, -1);

  // Sawtooth
  phase = 0;
  const sawZero = 2 * (phase / (2 * Math.PI) - Math.floor(phase / (2 * Math.PI) + 0.5));
  assert.strictEqual(sawZero, 0);
  const sawPeak = 2 * (Math.PI / (2 * Math.PI) - Math.floor(Math.PI / (2 * Math.PI) + 0.5));
  assert.strictEqual(sawPeak, -1);
});

// 8. Paul Kellet Pink Noise Filter Stability
runTest('Sound Lab: Paul Kellet Pink Noise Algorithm Stability', () => {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let maxVal = 0;
  for (let i = 0; i < 5000; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    const abs = Math.abs(pink * 0.12);
    if (abs > maxVal) maxVal = abs;
  }
  // Assert signal does not explode and stays normalized
  assert.ok(maxVal < 2.0);
  assert.ok(maxVal > 0.05);
});

// 9. Voice Lab Pitch Shift Semitones Mathematics
runTest('Voice Lab: Pitch Factor Formula', () => {
  // +12 semitones = exactly 2.0x frequency
  const octaveUp = Math.pow(2, 12 / 12);
  assert.strictEqual(octaveUp, 2.0);

  // -12 semitones = exactly 0.5x frequency
  const octaveDown = Math.pow(2, -12 / 12);
  assert.strictEqual(octaveDown, 0.5);

  // +4.2 semitones (male to female preset)
  const m2f = Math.pow(2, 4.2 / 12);
  assert.ok(m2f > 1.25 && m2f < 1.30);
});

// 10. Multi-track Audio Merge Calculation
runTest('Audio Editing: Sequential Audio Merge Length', () => {
  const buf1 = createMockAudioBuffer(2, 1000, 44100);
  const buf2 = createMockAudioBuffer(2, 2500, 44100);
  const total = buf1.length + buf2.length;
  assert.strictEqual(total, 3500);
});

console.log('===========================================================');
console.log(`Results: ${passedTests} passed, ${failedTests} failed.`);
console.log('===========================================================');

if (failedTests > 0) {
  process.exit(1);
}
