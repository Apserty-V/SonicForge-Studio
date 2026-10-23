/**
 * SonicForge Studio - Sound Lab Engine
 * Precision tone generation, pink/white noise synthesis, and interactive soundboard.
 */

import { getAudioContext } from '../audioContext';
import { encodeAudioBufferToWav } from '../encoders/wavEncoder';

export interface ToneGeneratorOptions {
  waveform: OscillatorType;
  frequency: number; // Hz (20 - 20000)
  amplitude: number; // 0.0 - 1.0
  durationSec: number; // in seconds
  sampleRate?: number;
}

/**
 * Generate a pure synthesized tone AudioBuffer
 */
export function generateToneBuffer(options: ToneGeneratorOptions): AudioBuffer {
  const ctx = getAudioContext();
  const sampleRate = options.sampleRate || ctx.sampleRate;
  const numSamples = Math.max(1, Math.round(options.durationSec * sampleRate));
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);

  const freq = Math.max(20, Math.min(20000, options.frequency));
  const amp = Math.max(0, Math.min(1.0, options.amplitude));
  const phaseIncr = (2 * Math.PI * freq) / sampleRate;
  let phase = 0;

  // Generate waveform
  for (let i = 0; i < numSamples; i++) {
    let sample = 0;
    switch (options.waveform) {
      case 'sine':
        sample = Math.sin(phase);
        break;
      case 'square':
        sample = Math.sin(phase) >= 0 ? 1 : -1;
        break;
      case 'triangle':
        sample = (2 / Math.PI) * Math.asin(Math.sin(phase));
        break;
      case 'sawtooth':
        sample = (2 * (phase / (2 * Math.PI) - Math.floor(phase / (2 * Math.PI) + 0.5)));
        break;
    }

    // Apply soft fade in / fade out at edges to prevent pop/click
    let envelope = 1.0;
    const fadeSamples = Math.min(sampleRate * 0.01, numSamples * 0.1);
    if (i < fadeSamples) envelope = i / fadeSamples;
    else if (i > numSamples - fadeSamples) envelope = (numSamples - i) / fadeSamples;

    data[i] = sample * amp * envelope;
    phase += phaseIncr;
    if (phase >= 2 * Math.PI) phase -= 2 * Math.PI;
  }

  return buffer;
}

/**
 * Generate White Noise AudioBuffer
 */
export function generateWhiteNoiseBuffer(
  durationSec: number,
  amplitude: number = 0.5,
  sampleRate: number = 44100
): AudioBuffer {
  const ctx = getAudioContext();
  const numSamples = Math.max(1, Math.round(durationSec * sampleRate));
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);
  const amp = Math.max(0, Math.min(1.0, amplitude));

  for (let i = 0; i < numSamples; i++) {
    // Soft clickless envelope
    let envelope = 1.0;
    const fadeSamples = Math.min(sampleRate * 0.01, numSamples * 0.1);
    if (i < fadeSamples) envelope = i / fadeSamples;
    else if (i > numSamples - fadeSamples) envelope = (numSamples - i) / fadeSamples;

    data[i] = (Math.random() * 2 - 1) * amp * envelope;
  }

  return buffer;
}

/**
 * Generate Pink Noise AudioBuffer using Paul Kellet's filtered white noise algorithm (-3dB/octave)
 */
export function generatePinkNoiseBuffer(
  durationSec: number,
  amplitude: number = 0.5,
  sampleRate: number = 44100
): AudioBuffer {
  const ctx = getAudioContext();
  const numSamples = Math.max(1, Math.round(durationSec * sampleRate));
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);
  const amp = Math.max(0, Math.min(1.0, amplitude));

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

  for (let i = 0; i < numSamples; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;

    let envelope = 1.0;
    const fadeSamples = Math.min(sampleRate * 0.01, numSamples * 0.1);
    if (i < fadeSamples) envelope = i / fadeSamples;
    else if (i > numSamples - fadeSamples) envelope = (numSamples - i) / fadeSamples;

    // Scale down Paul Kellet's sum (approx peak 5x)
    data[i] = Math.max(-1, Math.min(1, (pink * 0.12) * amp * envelope));
  }

  return buffer;
}

/**
 * Real-time continuous Tone Synthesizer for live preview
 */
export class LiveSynthesizer {
  private ctx: AudioContext;
  private oscNode: OscillatorNode | null = null;
  private gainNode: GainNode;
  public isRunning = false;

  constructor() {
    this.ctx = getAudioContext();
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 0;
    this.gainNode.connect(this.ctx.destination);
  }

  public start(waveform: OscillatorType, frequency: number, amplitude: number) {
    this.stop();
    this.ctx.resume();

    this.oscNode = this.ctx.createOscillator();
    this.oscNode.type = waveform;
    this.oscNode.frequency.setValueAtTime(frequency, this.ctx.currentTime);

    this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
    this.gainNode.gain.linearRampToValueAtTime(Math.min(1.0, amplitude), this.ctx.currentTime + 0.03);

    this.oscNode.connect(this.gainNode);
    this.oscNode.start();
    this.isRunning = true;
  }

  public update(frequency: number, amplitude: number) {
    if (!this.isRunning || !this.oscNode) return;
    this.oscNode.frequency.setValueAtTime(frequency, this.ctx.currentTime);
    this.gainNode.gain.setValueAtTime(Math.min(1.0, amplitude), this.ctx.currentTime);
  }

  public stop() {
    if (this.isRunning && this.oscNode) {
      try {
        this.gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.02);
        setTimeout(() => {
          if (this.oscNode) {
            try { this.oscNode.stop(); this.oscNode.disconnect(); } catch {}
            this.oscNode = null;
          }
        }, 30);
      } catch {
        this.oscNode = null;
      }
    }
    this.isRunning = false;
  }
}

/**
 * Export generated buffer to downloadable WAV
 */
export function exportSoundLabAudio(buffer: AudioBuffer, filename: string) {
  const blob = encodeAudioBufferToWav(buffer, { bitDepth: 16 });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.wav') ? filename : filename + '.wav';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
