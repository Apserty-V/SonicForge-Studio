export type NavigationTab = 
  | 'home'
  | 'voice-lab'
  | 'audio-editor'
  | 'audio-effects'
  | 'video-tools'
  | 'sound-lab'
  | 'settings';

export interface AudioMetadata {
  name: string;
  size: number;
  type: string;
  duration: number;
  sampleRate: number;
  channels: number;
  url?: string;
}

export interface VideoMetadata {
  name: string;
  size: number;
  type: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  url?: string;
  file?: File;
}

export interface SelectionRange {
  start: number; // in seconds
  end: number;   // in seconds
}

export interface VoicePreset {
  id: string;
  name: string;
  description: string;
  pitchSemitones: number;
  formantShift: number; // formant scale factor e.g. 0.7 - 1.4
  resonanceFreq: number; // Hz
  resonanceGain: number; // dB
  mix: number; // 0 to 1
  isRobot?: boolean;
  robotFreq?: number;
  telephoneBandpass?: boolean;
  distortion?: number;
}

export interface EffectsConfig {
  bypassAll: boolean;
  // 3-Band EQ
  eq3: {
    enabled: boolean;
    low: number;  // -24 to +24 dB (100Hz shelf)
    mid: number;  // -24 to +24 dB (1000Hz peak)
    high: number; // -24 to +24 dB (4000Hz shelf)
  };
  // 10-Band Graphic EQ
  eq10: {
    enabled: boolean;
    bands: number[]; // 10 gain values in dB for [31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k]
  };
  // Filters
  filter: {
    lowpassEnabled: boolean;
    lowpassFreq: number; // 20 - 20000 Hz
    lowpassQ: number;    // 0.5 - 20
    highpassEnabled: boolean;
    highpassFreq: number; // 20 - 20000 Hz
    highpassQ: number;   // 0.5 - 20
  };
  // Spatial
  stereoWidth: {
    enabled: boolean;
    width: number; // 0 (mono) to 2.0 (super-wide), 1.0 = normal
  };
  // Delay & Echo
  delay: {
    enabled: boolean;
    time: number;     // 0.01 to 1.5 seconds
    feedback: number; // 0 to 0.95
    wet: number;      // 0 to 1.0
    pingPong: boolean;
  };
  // Chorus
  chorus: {
    enabled: boolean;
    rate: number;  // 0.1 to 8 Hz
    depth: number; // 0.001 to 0.02 seconds
    wet: number;   // 0 to 1.0
  };
  // Reverb (Algorithmic / Convolver)
  reverb: {
    enabled: boolean;
    decay: number;   // 0.5 to 10 seconds
    preDelay: number;// 0 to 0.1s
    wet: number;     // 0 to 1.0
  };
  // Dynamics
  compressor: {
    enabled: boolean;
    threshold: number; // -60 to 0 dB
    ratio: number;     // 1 to 20
    attack: number;    // 0 to 1 s
    release: number;   // 0 to 1 s
    knee: number;      // 0 to 40 dB
  };
  // Limiter / Normalization
  limiter: {
    enabled: boolean;
    threshold: number; // -6 to 0 dB
  };
  normalizer: {
    enabled: boolean;
    targetPeakDb: number; // -12 to 0 dBFS (default -0.5 dBFS)
  };
  // Noise Reduction
  noiseReduction: {
    enabled: boolean;
    thresholdDb: number; // -80 to -20 dB
    reductionDb: number; // 0 to 40 dB
  };
}

export type ExportAudioFormat = 'wav' | 'mp3' | 'webm' | 'ogg' | 'flac' | 'aac';
export type ExportVideoFormat = 'mp4' | 'webm';

export interface ExportConfig {
  filename: string;
  format: ExportAudioFormat | ExportVideoFormat;
  sampleRate: number;      // 22050, 44100, 48000, 96000
  bitDepth?: 16 | 24 | 32; // for WAV
  channels: 1 | 2;         // mono or stereo
  bitrate?: number;        // in kbps (128, 192, 256, 320)
  normalizeAudio: boolean;
  range?: SelectionRange;
}

export interface SoundboardPad {
  id: number;
  label: string;
  key: string;
  frequency?: number;
  waveform?: OscillatorType;
  audioBuffer?: AudioBuffer;
  color: string;
}
