/**
 * SonicForge Studio - Audio Buffer Manipulation Utilities
 * Pure DSP operations on AudioBuffer for non-destructive & destructive editing.
 */

import { getAudioContext } from '../audioContext';

/**
 * Crop / Trim buffer to [startTime, endTime]
 */
export function cropAudioBuffer(
  buffer: AudioBuffer,
  startTime: number,
  endTime: number
): AudioBuffer {
  const ctx = getAudioContext();
  const startSample = Math.max(0, Math.floor(startTime * buffer.sampleRate));
  const endSample = Math.min(buffer.length, Math.ceil(endTime * buffer.sampleRate));
  const newLength = Math.max(1, endSample - startSample);

  const cropped = ctx.createBuffer(
    buffer.numberOfChannels,
    newLength,
    buffer.sampleRate
  );

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dest = cropped.getChannelData(ch);
    for (let i = 0; i < newLength; i++) {
      dest[i] = src[startSample + i];
    }
  }

  return cropped;
}

/**
 * Cut (delete) selected range [startTime, endTime] and splice remaining sections
 */
export function cutAudioBufferRange(
  buffer: AudioBuffer,
  startTime: number,
  endTime: number
): AudioBuffer {
  const ctx = getAudioContext();
  const startSample = Math.max(0, Math.floor(startTime * buffer.sampleRate));
  const endSample = Math.min(buffer.length, Math.ceil(endTime * buffer.sampleRate));
  const cutLength = endSample - startSample;
  const newLength = Math.max(1, buffer.length - cutLength);

  const result = ctx.createBuffer(
    buffer.numberOfChannels,
    newLength,
    buffer.sampleRate
  );

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dest = result.getChannelData(ch);
    // Copy pre-cut
    for (let i = 0; i < startSample; i++) {
      dest[i] = src[i];
    }
    // Copy post-cut
    for (let i = endSample; i < buffer.length; i++) {
      dest[i - cutLength] = src[i];
    }
  }

  return result;
}

/**
 * Reverse buffer (optionally within a time range)
 */
export function reverseAudioBuffer(
  buffer: AudioBuffer,
  startTime?: number,
  endTime?: number
): AudioBuffer {
  const ctx = getAudioContext();
  const result = ctx.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const startSample = startTime !== undefined ? Math.max(0, Math.floor(startTime * buffer.sampleRate)) : 0;
  const endSample = endTime !== undefined ? Math.min(buffer.length, Math.ceil(endTime * buffer.sampleRate)) : buffer.length;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dest = result.getChannelData(ch);
    
    // Copy unaffected parts
    for (let i = 0; i < startSample; i++) dest[i] = src[i];
    for (let i = endSample; i < buffer.length; i++) dest[i] = src[i];

    // Reverse range
    const rangeLen = endSample - startSample;
    for (let i = 0; i < rangeLen; i++) {
      dest[startSample + i] = src[endSample - 1 - i];
    }
  }

  return result;
}

/**
 * Apply Fade In
 */
export function applyFadeIn(
  buffer: AudioBuffer,
  durationSec: number,
  curve: 'linear' | 'exponential' | 'logarithmic' = 'linear'
): AudioBuffer {
  const ctx = getAudioContext();
  const result = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const fadeSamples = Math.min(buffer.length, Math.round(durationSec * buffer.sampleRate));

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dest = result.getChannelData(ch);
    
    for (let i = 0; i < buffer.length; i++) {
      if (i < fadeSamples) {
        const t = i / fadeSamples;
        let gain = t;
        if (curve === 'exponential') gain = Math.pow(t, 2);
        else if (curve === 'logarithmic') gain = Math.sin((t * Math.PI) / 2);
        dest[i] = src[i] * gain;
      } else {
        dest[i] = src[i];
      }
    }
  }
  return result;
}

/**
 * Apply Fade Out
 */
export function applyFadeOut(
  buffer: AudioBuffer,
  durationSec: number,
  curve: 'linear' | 'exponential' | 'logarithmic' = 'linear'
): AudioBuffer {
  const ctx = getAudioContext();
  const result = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const fadeSamples = Math.min(buffer.length, Math.round(durationSec * buffer.sampleRate));
  const startFade = buffer.length - fadeSamples;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dest = result.getChannelData(ch);
    
    for (let i = 0; i < buffer.length; i++) {
      if (i >= startFade) {
        const t = (buffer.length - 1 - i) / fadeSamples;
        let gain = t;
        if (curve === 'exponential') gain = Math.pow(t, 2);
        else if (curve === 'logarithmic') gain = Math.sin((t * Math.PI) / 2);
        dest[i] = src[i] * gain;
      } else {
        dest[i] = src[i];
      }
    }
  }
  return result;
}

/**
 * Change volume / gain of the buffer (in dB)
 */
export function applyGain(buffer: AudioBuffer, gainDb: number): AudioBuffer {
  const ctx = getAudioContext();
  const result = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const linearGain = Math.pow(10, gainDb / 20);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dest = result.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) {
      dest[i] = Math.max(-1, Math.min(1, src[i] * linearGain));
    }
  }
  return result;
}

/**
 * Change playback speed (resampling)
 * speedFactor: 0.5 = half speed (lower pitch), 2.0 = double speed (higher pitch)
 */
export function applySpeedChange(buffer: AudioBuffer, speedFactor: number): AudioBuffer {
  if (speedFactor === 1.0) return buffer;
  const ctx = getAudioContext();
  const newLength = Math.max(1, Math.round(buffer.length / speedFactor));
  const result = ctx.createBuffer(buffer.numberOfChannels, newLength, buffer.sampleRate);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dest = result.getChannelData(ch);
    for (let i = 0; i < newLength; i++) {
      const srcIdx = i * speedFactor;
      const i0 = Math.floor(srcIdx);
      const i1 = Math.min(i0 + 1, buffer.length - 1);
      const frac = srcIdx - i0;
      dest[i] = src[i0] * (1 - frac) + src[i1] * frac;
    }
  }
  return result;
}

/**
 * Merge multiple audio buffers sequentially or overlay mix
 */
export function mergeAudioBuffers(
  buffers: AudioBuffer[],
  mode: 'sequential' | 'overlay' = 'sequential'
): AudioBuffer {
  if (buffers.length === 0) {
    throw new Error('No buffers provided to merge');
  }
  if (buffers.length === 1) return buffers[0];

  const ctx = getAudioContext();
  const maxChannels = Math.max(...buffers.map(b => b.numberOfChannels));
  const sampleRate = buffers[0].sampleRate;

  if (mode === 'sequential') {
    const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
    const result = ctx.createBuffer(maxChannels, totalLength, sampleRate);

    let offset = 0;
    for (const b of buffers) {
      for (let ch = 0; ch < maxChannels; ch++) {
        const dest = result.getChannelData(ch);
        const srcCh = Math.min(ch, b.numberOfChannels - 1);
        const src = b.getChannelData(srcCh);
        for (let i = 0; i < b.length; i++) {
          dest[offset + i] = src[i];
        }
      }
      offset += b.length;
    }
    return result;
  } else {
    // Overlay mix
    const maxLength = Math.max(...buffers.map(b => b.length));
    const result = ctx.createBuffer(maxChannels, maxLength, sampleRate);

    for (const b of buffers) {
      for (let ch = 0; ch < maxChannels; ch++) {
        const dest = result.getChannelData(ch);
        const srcCh = Math.min(ch, b.numberOfChannels - 1);
        const src = b.getChannelData(srcCh);
        for (let i = 0; i < b.length; i++) {
          dest[i] = Math.max(-1, Math.min(1, dest[i] + src[i] * 0.7));
        }
      }
    }
    return result;
  }
}
