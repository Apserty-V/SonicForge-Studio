/**
 * SonicForge Studio - Core Audio Context Manager
 * Handles singleton AudioContext lifecycle, decoding, and buffer utilities.
 */

let audioCtxInstance: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!audioCtxInstance) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtxInstance = new AudioCtx({
      latencyHint: 'interactive',
      sampleRate: 44100,
    });
  }
  if (audioCtxInstance.state === 'suspended') {
    audioCtxInstance.resume();
  }
  return audioCtxInstance;
}

export async function ensureAudioContextResumed(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
}

/**
 * Decode any audio or video file array buffer into an AudioBuffer.
 * Modern browsers decode both audio tracks of videos and audio files.
 */
export async function decodeAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  // decodeAudioData detaches the arrayBuffer, so we clone it if needed
  const copy = arrayBuffer.slice(0);
  try {
    return await ctx.decodeAudioData(copy);
  } catch (err) {
    throw new Error(`Failed to decode audio data: ${(err as Error).message || err}`);
  }
}

/**
 * Clone an AudioBuffer safely
 */
export function cloneAudioBuffer(buffer: AudioBuffer): AudioBuffer {
  const ctx = getAudioContext();
  const clone = ctx.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    clone.copyToChannel(buffer.getChannelData(ch), ch);
  }
  return clone;
}

/**
 * Create an empty AudioBuffer with specified parameters
 */
export function createEmptyAudioBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
  const ctx = getAudioContext();
  return ctx.createBuffer(channels, Math.max(1, length), sampleRate);
}
