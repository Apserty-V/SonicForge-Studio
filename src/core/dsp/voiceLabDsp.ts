/**
 * SonicForge Studio - Voice Lab DSP Engine
 * Non-AI Digital Signal Processing for pitch shifting, formant adjustment,
 * voice transformations (male-to-female, female-to-male, robot, deep, chipmunk, radio/telephone).
 */

import { getAudioContext } from '../audioContext';
import { VoicePreset } from '../../types';

/**
 * WSOLA (Waveform Similarity Overlap-Add) Time-Scale Modification
 * Stretches or compresses audio duration by stretchFactor without changing pitch.
 */
export function timeStretchWsola(
  input: Float32Array,
  stretchFactor: number,
  sampleRate: number
): Float32Array {
  if (Math.abs(stretchFactor - 1.0) < 0.005) {
    return new Float32Array(input);
  }

  // Window size ~35ms
  const winSize = Math.min(2048, Math.max(512, Math.pow(2, Math.round(Math.log2(sampleRate * 0.035)))));
  const halfWin = Math.floor(winSize / 2);
  const synthHop = halfWin;
  const analysisHop = Math.round(synthHop / stretchFactor);
  const maxOffset = Math.floor(winSize / 4);

  // Precompute Hann window
  const window = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (winSize - 1)));
  }

  const outputLength = Math.max(1, Math.round(input.length * stretchFactor));
  const output = new Float32Array(outputLength + winSize);
  const normWeight = new Float32Array(outputLength + winSize);

  let inPos = 0;
  let outPos = 0;

  // Initial window
  for (let i = 0; i < winSize && i < input.length; i++) {
    const w = window[i];
    output[i] += input[i] * w;
    normWeight[i] += w;
  }

  outPos += synthHop;
  inPos += analysisHop;

  while (outPos < outputLength && inPos + winSize + maxOffset < input.length) {
    // Waveform similarity search around inPos
    let bestOffset = 0;
    let maxCorr = -Infinity;

    // Search window for phase alignment
    const targetIdx = outPos;
    for (let offset = -maxOffset; offset <= maxOffset; offset += 2) {
      const candidateIdx = inPos + offset;
      if (candidateIdx < 0 || candidateIdx + winSize >= input.length) continue;

      let corr = 0;
      // Cross-correlation over overlap region (first half of window)
      for (let k = 0; k < halfWin; k += 4) {
        corr += output[targetIdx + k] * input[candidateIdx + k];
      }
      if (corr > maxCorr) {
        maxCorr = corr;
        bestOffset = offset;
      }
    }

    const naturalIn = inPos + bestOffset;
    for (let i = 0; i < winSize; i++) {
      const sample = input[naturalIn + i];
      const w = window[i];
      output[outPos + i] += sample * w;
      normWeight[outPos + i] += w;
    }

    outPos += synthHop;
    inPos += analysisHop;
  }

  // Normalize by overlap window weights to eliminate amplitude modulation
  const finalOutput = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const w = normWeight[i];
    finalOutput[i] = w > 0.001 ? output[i] / w : output[i];
  }

  return finalOutput;
}

/**
 * High-quality linear resampling
 */
export function resampleChannel(
  input: Float32Array,
  resampleFactor: number
): Float32Array {
  if (Math.abs(resampleFactor - 1.0) < 0.001) {
    return new Float32Array(input);
  }
  const outputLen = Math.max(1, Math.round(input.length / resampleFactor));
  const output = new Float32Array(outputLen);

  for (let i = 0; i < outputLen; i++) {
    const srcPos = i * resampleFactor;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    output[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return output;
}

/**
 * Pure DSP Pitch Shift without changing duration.
 * pitchFactor = 2^(semitones / 12)
 * We time-stretch by pitchFactor, then resample by pitchFactor!
 */
export function pitchShiftChannel(
  input: Float32Array,
  semitones: number,
  sampleRate: number
): Float32Array {
  if (Math.abs(semitones) < 0.05) {
    return new Float32Array(input);
  }
  const pitchFactor = Math.pow(2, semitones / 12);
  
  // Step 1: Time stretch by pitchFactor (preserves pitch, changes length to length * pitchFactor)
  const stretched = timeStretchWsola(input, pitchFactor, sampleRate);
  
  // Step 2: Resample by pitchFactor (shifts pitch by pitchFactor, restores length back to original)
  const shifted = resampleChannel(stretched, pitchFactor);

  // Match exact original length
  const result = new Float32Array(input.length);
  for (let i = 0; i < input.length && i < shifted.length; i++) {
    result[i] = shifted[i];
  }
  return result;
}

/**
 * Vocal Tract Formant Shifting Filter Bank
 * Simulates vocal tract resonance frequency shifting (F1, F2, F3)
 */
export function applyFormantFilter(
  input: Float32Array,
  formantShift: number, // 0.7 = deeper vocal tract (masculine), 1.3 = shorter vocal tract (feminine)
  sampleRate: number
): Float32Array {
  if (Math.abs(formantShift - 1.0) < 0.03) {
    return new Float32Array(input);
  }

  // Base human vowel formant centers (in Hz)
  const baseFormants = [
    { freq: 500, q: 3.5, gainDb: 3 },  // F1
    { freq: 1500, q: 4.0, gainDb: 4 }, // F2
    { freq: 2500, q: 5.0, gainDb: 2 }, // F3
  ];

  let current: Float32Array<any> = new Float32Array(input);

  for (const f of baseFormants) {
    const targetFreq = Math.min(sampleRate * 0.45, Math.max(100, f.freq * formantShift));
    current = applyPeakingFilter(current, targetFreq, f.q, f.gainDb * (formantShift > 1 ? 1 : -0.5), sampleRate);
  }

  return current;
}

/**
 * Biquad Peaking Filter implementation in pure DSP
 */
function applyPeakingFilter(
  data: Float32Array,
  freq: number,
  q: number,
  gainDb: number,
  sampleRate: number
): Float32Array {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const A = Math.pow(10, gainDb / 40);
  const alpha = Math.sin(w0) / (2 * q);

  const b0 = 1 + alpha * A;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;

  const out = new Float32Array(data.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < data.length; i++) {
    const x0 = data[i];
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = y0;
  }
  return out;
}

/**
 * Robot Voice Effect: Ring modulation + metallic comb filter
 */
export function applyRobotEffect(
  input: Float32Array,
  carrierFreq: number = 75,
  sampleRate: number = 44100
): Float32Array {
  const out = new Float32Array(input.length);
  const delaySamples = Math.floor(sampleRate / carrierFreq);
  const delayBuffer = new Float32Array(delaySamples);
  let delayIndex = 0;

  for (let i = 0; i < input.length; i++) {
    const carrier = Math.sin((2 * Math.PI * carrierFreq * i) / sampleRate);
    // Ring modulation
    const ring = input[i] * carrier;

    // Resonant feedback comb filter for metallic resonance
    const delayed = delayBuffer[delayIndex];
    const comb = ring + delayed * 0.65;
    delayBuffer[delayIndex] = ring;
    delayIndex = (delayIndex + 1) % delaySamples;

    // Mix 50% dry + 50% robotic comb
    out[i] = input[i] * 0.35 + comb * 0.65;
  }
  return out;
}

/**
 * Radio / Telephone Voice Effect:
 * Bandpass 350Hz - 3400Hz + gentle saturation
 */
export function applyTelephoneEffect(
  input: Float32Array,
  sampleRate: number
): Float32Array {
  // Simple high-pass at 350Hz, low-pass at 3400Hz
  const hpW = (2 * Math.PI * 350) / sampleRate;
  const lpW = (2 * Math.PI * 3400) / sampleRate;
  
  const hpAlpha = Math.cos(hpW) / (1 + Math.sin(hpW));
  const lpAlpha = Math.sin(lpW) / (1 + Math.cos(lpW));

  const out = new Float32Array(input.length);
  let hpPrevX = 0, hpPrevY = 0;
  let lpPrevY = 0;

  for (let i = 0; i < input.length; i++) {
    // High-pass
    const x = input[i];
    const hp = hpAlpha * (hpPrevY + x - hpPrevX);
    hpPrevX = x;
    hpPrevY = hp;

    // Low-pass
    const lp = lpPrevY + lpAlpha * (hp - lpPrevY);
    lpPrevY = lp;

    // Mild saturation (telephone mic distortion)
    out[i] = Math.tanh(lp * 1.8) * 0.9;
  }
  return out;
}

/**
 * Process entire AudioBuffer through Voice Lab parameters
 */
export async function processVoiceLabBuffer(
  buffer: AudioBuffer,
  preset: VoicePreset,
  onProgress?: (percent: number) => void
): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const result = ctx.createBuffer(numChannels, buffer.length, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    let channelData: Float32Array<any> = buffer.getChannelData(ch);

    // 1. Pitch Shifting
    if (Math.abs(preset.pitchSemitones) >= 0.1) {
      channelData = pitchShiftChannel(channelData, preset.pitchSemitones, sampleRate);
    }

    // 2. Formant Shifting
    if (preset.formantShift && Math.abs(preset.formantShift - 1.0) >= 0.03) {
      channelData = applyFormantFilter(channelData, preset.formantShift, sampleRate);
    }

    // 3. Robot effect
    if (preset.isRobot) {
      channelData = applyRobotEffect(channelData, preset.robotFreq || 80, sampleRate);
    }

    // 4. Telephone / Radio effect
    if (preset.telephoneBandpass) {
      channelData = applyTelephoneEffect(channelData, sampleRate);
    }

    // 5. Resonance / Peak shaping
    if (preset.resonanceFreq && preset.resonanceGain) {
      channelData = applyPeakingFilter(
        channelData,
        preset.resonanceFreq,
        2.5,
        preset.resonanceGain,
        sampleRate
      );
    }

    // 6. Wet/Dry Mix
    const orig = buffer.getChannelData(ch);
    const dest = result.getChannelData(ch);
    const mix = preset.mix ?? 1.0;
    for (let i = 0; i < buffer.length; i++) {
      const s = orig[i] * (1 - mix) + (channelData[i] || 0) * mix;
      dest[i] = Math.max(-1, Math.min(1, s));
    }

    if (onProgress) {
      onProgress(Math.round(((ch + 1) / numChannels) * 100));
    }
  }

  return result;
}

/**
 * Standard Voice Lab Presets
 */
export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'male-to-female',
    name: 'Male to Female Voice',
    description: 'Elevates pitch by +4.2 semitones, shifts vocal tract formants upward by 1.22x with high-end presence.',
    pitchSemitones: 4.2,
    formantShift: 1.22,
    resonanceFreq: 3200,
    resonanceGain: 3.5,
    mix: 1.0,
  },
  {
    id: 'female-to-male',
    name: 'Female to Male Voice',
    description: 'Lowers pitch by -4.5 semitones, scales vocal tract formants downward to 0.82x with low-mid resonance.',
    pitchSemitones: -4.5,
    formantShift: 0.82,
    resonanceFreq: 180,
    resonanceGain: 4.0,
    mix: 1.0,
  },
  {
    id: 'deep-voice',
    name: 'Deep Voice (Sub-Bass)',
    description: 'Deep pitch shift of -8.0 semitones with sub-fundamental boost.',
    pitchSemitones: -8.0,
    formantShift: 0.75,
    resonanceFreq: 120,
    resonanceGain: 5.0,
    mix: 1.0,
  },
  {
    id: 'chipmunk',
    name: 'Chipmunk (High Pitch)',
    description: 'High-frequency transformation +11.5 semitones with hyper-compact vocal tract formants.',
    pitchSemitones: 11.5,
    formantShift: 1.45,
    resonanceFreq: 4500,
    resonanceGain: 4.0,
    mix: 1.0,
  },
  {
    id: 'robot',
    name: 'Cybernetic Robot',
    description: 'Non-AI ring modulator and resonant comb filter creating a mechanical robotic timbre.',
    pitchSemitones: -1.0,
    formantShift: 1.0,
    resonanceFreq: 1000,
    resonanceGain: 0,
    mix: 1.0,
    isRobot: true,
    robotFreq: 82,
  },
  {
    id: 'telephone',
    name: 'Vintage Radio / Telephone',
    description: 'Narrow bandpass filtering (350Hz - 3.4kHz) with analog harmonic saturation.',
    pitchSemitones: 0,
    formantShift: 1.0,
    resonanceFreq: 1800,
    resonanceGain: 2.0,
    mix: 1.0,
    telephoneBandpass: true,
  },
  {
    id: 'custom',
    name: 'Custom DSP Configuration',
    description: 'Fully adjustable manual pitch, formant factor, and resonance controls.',
    pitchSemitones: 0,
    formantShift: 1.0,
    resonanceFreq: 1000,
    resonanceGain: 0,
    mix: 1.0,
  },
];
