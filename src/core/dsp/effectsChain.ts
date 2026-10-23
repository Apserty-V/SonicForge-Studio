/**
 * SonicForge Studio - Audio Effects Studio Chain
 * Real-time Web Audio API Node Graph + Offline Audio Rendering for exports.
 */

import { getAudioContext } from '../audioContext';
import { EffectsConfig } from '../../types';

export const DEFAULT_EFFECTS_CONFIG: EffectsConfig = {
  bypassAll: false,
  eq3: {
    enabled: true,
    low: 0,
    mid: 0,
    high: 0,
  },
  eq10: {
    enabled: true,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  filter: {
    lowpassEnabled: false,
    lowpassFreq: 18000,
    lowpassQ: 1.0,
    highpassEnabled: false,
    highpassFreq: 40,
    highpassQ: 1.0,
  },
  stereoWidth: {
    enabled: false,
    width: 1.0,
  },
  delay: {
    enabled: false,
    time: 0.35,
    feedback: 0.4,
    wet: 0.3,
    pingPong: false,
  },
  chorus: {
    enabled: false,
    rate: 1.5,
    depth: 0.003,
    wet: 0.35,
  },
  reverb: {
    enabled: false,
    decay: 2.2,
    preDelay: 0.02,
    wet: 0.25,
  },
  compressor: {
    enabled: false,
    threshold: -20,
    ratio: 3.5,
    attack: 0.015,
    release: 0.25,
    knee: 12,
  },
  limiter: {
    enabled: true,
    threshold: -0.5,
  },
  normalizer: {
    enabled: false,
    targetPeakDb: -0.5,
  },
  noiseReduction: {
    enabled: false,
    thresholdDb: -50,
    reductionDb: 18,
  },
};

export const EQ10_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/**
 * Generate a synthetic stereo impulse response for realistic reverb
 */
export function generateReverbImpulseResponse(
  ctx: BaseAudioContext,
  decaySec: number,
  preDelaySec: number = 0.01
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor((decaySec + preDelaySec) * sampleRate));
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);
  const preDelaySamples = Math.floor(preDelaySec * sampleRate);

  for (let i = 0; i < length; i++) {
    if (i < preDelaySamples) {
      left[i] = 0;
      right[i] = 0;
    } else {
      const t = (i - preDelaySamples) / sampleRate;
      // Exponential decay envelope
      const decay = Math.exp(-3 * t / decaySec);
      // High frequency damping over time
      const damping = Math.exp(-1.5 * t);
      
      // Early reflections + late diffuse field
      const noiseL = (Math.random() * 2 - 1) * damping;
      const noiseR = (Math.random() * 2 - 1) * damping;

      left[i] = noiseL * decay;
      right[i] = noiseR * decay;
    }
  }

  return impulse;
}

/**
 * Build real-time DSP effects chain between source node and destination node
 */
export class RealtimeEffectsGraph {
  public inputNode: GainNode;
  public outputNode: GainNode;

  // Nodes
  private eq3Low: BiquadFilterNode;
  private eq3Mid: BiquadFilterNode;
  private eq3High: BiquadFilterNode;
  private eq10Filters: BiquadFilterNode[] = [];
  private hpFilter: BiquadFilterNode;
  private lpFilter: BiquadFilterNode;
  private compressorNode: DynamicsCompressorNode;
  private limiterNode: DynamicsCompressorNode;
  private dryGain: GainNode;
  private wetGain: GainNode;

  // Delay
  private delayNode: DelayNode;
  private delayFeedbackGain: GainNode;
  private delayWetGain: GainNode;

  // Reverb
  private convolverNode: ConvolverNode;
  private reverbWetGain: GainNode;

  private currentConfig: EffectsConfig;
  private ctx: AudioContext;

  constructor(ctx: AudioContext, initialConfig: EffectsConfig = DEFAULT_EFFECTS_CONFIG) {
    this.ctx = ctx;
    this.currentConfig = JSON.parse(JSON.stringify(initialConfig));

    this.inputNode = ctx.createGain();
    this.outputNode = ctx.createGain();

    // 3-Band EQ
    this.eq3Low = ctx.createBiquadFilter();
    this.eq3Low.type = 'lowshelf';
    this.eq3Low.frequency.value = 100;

    this.eq3Mid = ctx.createBiquadFilter();
    this.eq3Mid.type = 'peaking';
    this.eq3Mid.frequency.value = 1000;
    this.eq3Mid.Q.value = 1.0;

    this.eq3High = ctx.createBiquadFilter();
    this.eq3High.type = 'highshelf';
    this.eq3High.frequency.value = 4000;

    // 10-Band EQ
    this.eq10Filters = EQ10_FREQUENCIES.map((freq) => {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1.4;
      f.gain.value = 0;
      return f;
    });

    // Highpass & Lowpass
    this.hpFilter = ctx.createBiquadFilter();
    this.hpFilter.type = 'highpass';
    this.hpFilter.frequency.value = 20;

    this.lpFilter = ctx.createBiquadFilter();
    this.lpFilter.type = 'lowpass';
    this.lpFilter.frequency.value = 20000;

    // Delay
    this.delayNode = ctx.createDelay(2.0);
    this.delayFeedbackGain = ctx.createGain();
    this.delayWetGain = ctx.createGain();
    this.delayNode.connect(this.delayFeedbackGain);
    this.delayFeedbackGain.connect(this.delayNode);
    this.delayNode.connect(this.delayWetGain);

    // Reverb
    this.convolverNode = ctx.createConvolver();
    this.convolverNode.buffer = generateReverbImpulseResponse(ctx, 2.0);
    this.reverbWetGain = ctx.createGain();
    this.convolverNode.connect(this.reverbWetGain);

    // Dynamics Compressor
    this.compressorNode = ctx.createDynamicsCompressor();

    // Limiter (Brickwall peak limiter)
    this.limiterNode = ctx.createDynamicsCompressor();
    this.limiterNode.threshold.value = -0.5;
    this.limiterNode.knee.value = 0;
    this.limiterNode.ratio.value = 20;
    this.limiterNode.attack.value = 0.001;
    this.limiterNode.release.value = 0.05;

    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();

    this.connectGraph();
    this.updateConfig(this.currentConfig);
  }

  private connectGraph() {
    // Linear chain: input -> eq3 -> eq10 -> hp -> lp -> compressor -> limiter -> output
    let prev: AudioNode = this.inputNode;

    // Connect 3-band EQ
    prev.connect(this.eq3Low);
    this.eq3Low.connect(this.eq3Mid);
    this.eq3Mid.connect(this.eq3High);
    prev = this.eq3High;

    // Connect 10-band EQ
    for (const f of this.eq10Filters) {
      prev.connect(f);
      prev = f;
    }

    // Connect Filters
    prev.connect(this.hpFilter);
    this.hpFilter.connect(this.lpFilter);
    prev = this.lpFilter;

    // Branch to Delay & Reverb
    prev.connect(this.delayNode);
    prev.connect(this.convolverNode);

    // Main through path
    prev.connect(this.compressorNode);
    this.delayWetGain.connect(this.compressorNode);
    this.reverbWetGain.connect(this.compressorNode);

    // Connect Limiter -> Output
    this.compressorNode.connect(this.limiterNode);
    this.limiterNode.connect(this.outputNode);
  }

  public updateConfig(cfg: EffectsConfig) {
    this.currentConfig = JSON.parse(JSON.stringify(cfg));
    const now = this.ctx.currentTime;

    if (cfg.bypassAll) {
      this.eq3Low.gain.setValueAtTime(0, now);
      this.eq3Mid.gain.setValueAtTime(0, now);
      this.eq3High.gain.setValueAtTime(0, now);
      this.eq10Filters.forEach(f => f.gain.setValueAtTime(0, now));
      this.hpFilter.frequency.setValueAtTime(20, now);
      this.lpFilter.frequency.setValueAtTime(20000, now);
      this.delayWetGain.gain.setValueAtTime(0, now);
      this.reverbWetGain.gain.setValueAtTime(0, now);
      this.compressorNode.threshold.setValueAtTime(0, now);
      return;
    }

    // 3-band EQ
    if (cfg.eq3.enabled) {
      this.eq3Low.gain.setValueAtTime(cfg.eq3.low, now);
      this.eq3Mid.gain.setValueAtTime(cfg.eq3.mid, now);
      this.eq3High.gain.setValueAtTime(cfg.eq3.high, now);
    } else {
      this.eq3Low.gain.setValueAtTime(0, now);
      this.eq3Mid.gain.setValueAtTime(0, now);
      this.eq3High.gain.setValueAtTime(0, now);
    }

    // 10-band EQ
    this.eq10Filters.forEach((f, idx) => {
      const gainVal = cfg.eq10.enabled ? (cfg.eq10.bands[idx] || 0) : 0;
      f.gain.setValueAtTime(gainVal, now);
    });

    // Filters
    if (cfg.filter.highpassEnabled) {
      this.hpFilter.frequency.setValueAtTime(cfg.filter.highpassFreq, now);
      this.hpFilter.Q.setValueAtTime(cfg.filter.highpassQ, now);
    } else {
      this.hpFilter.frequency.setValueAtTime(20, now);
    }

    if (cfg.filter.lowpassEnabled) {
      this.lpFilter.frequency.setValueAtTime(cfg.filter.lowpassFreq, now);
      this.lpFilter.Q.setValueAtTime(cfg.filter.lowpassQ, now);
    } else {
      this.lpFilter.frequency.setValueAtTime(20000, now);
    }

    // Delay
    if (cfg.delay.enabled) {
      this.delayNode.delayTime.setValueAtTime(cfg.delay.time, now);
      this.delayFeedbackGain.gain.setValueAtTime(cfg.delay.feedback, now);
      this.delayWetGain.gain.setValueAtTime(cfg.delay.wet, now);
    } else {
      this.delayWetGain.gain.setValueAtTime(0, now);
    }

    // Reverb
    if (cfg.reverb.enabled) {
      this.reverbWetGain.gain.setValueAtTime(cfg.reverb.wet, now);
    } else {
      this.reverbWetGain.gain.setValueAtTime(0, now);
    }

    // Compressor
    if (cfg.compressor.enabled) {
      this.compressorNode.threshold.setValueAtTime(cfg.compressor.threshold, now);
      this.compressorNode.ratio.setValueAtTime(cfg.compressor.ratio, now);
      this.compressorNode.attack.setValueAtTime(cfg.compressor.attack, now);
      this.compressorNode.release.setValueAtTime(cfg.compressor.release, now);
      this.compressorNode.knee.setValueAtTime(cfg.compressor.knee, now);
    } else {
      this.compressorNode.threshold.setValueAtTime(0, now);
    }
  }

  public disconnect() {
    try {
      this.inputNode.disconnect();
      this.outputNode.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
}

/**
 * Apply the full effects chain offline to render a new AudioBuffer
 */
export async function renderEffectsOffline(
  buffer: AudioBuffer,
  config: EffectsConfig,
  onProgress?: (percent: number) => void
): Promise<AudioBuffer> {
  if (config.bypassAll) {
    return buffer;
  }

  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const src = offlineCtx.createBufferSource();
  src.buffer = buffer;

  // Create offline node graph
  const eq3Low = offlineCtx.createBiquadFilter();
  eq3Low.type = 'lowshelf';
  eq3Low.frequency.value = 100;
  eq3Low.gain.value = config.eq3.enabled ? config.eq3.low : 0;

  const eq3Mid = offlineCtx.createBiquadFilter();
  eq3Mid.type = 'peaking';
  eq3Mid.frequency.value = 1000;
  eq3Mid.gain.value = config.eq3.enabled ? config.eq3.mid : 0;

  const eq3High = offlineCtx.createBiquadFilter();
  eq3High.type = 'highshelf';
  eq3High.frequency.value = 4000;
  eq3High.gain.value = config.eq3.enabled ? config.eq3.high : 0;

  let current: AudioNode = src;
  current.connect(eq3Low);
  eq3Low.connect(eq3Mid);
  eq3Mid.connect(eq3High);
  current = eq3High;

  // 10-band EQ
  if (config.eq10.enabled) {
    for (let i = 0; i < EQ10_FREQUENCIES.length; i++) {
      const f = offlineCtx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = EQ10_FREQUENCIES[i];
      f.Q.value = 1.4;
      f.gain.value = config.eq10.bands[i] || 0;
      current.connect(f);
      current = f;
    }
  }

  // Filters
  if (config.filter.highpassEnabled) {
    const hp = offlineCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = config.filter.highpassFreq;
    hp.Q.value = config.filter.highpassQ;
    current.connect(hp);
    current = hp;
  }

  if (config.filter.lowpassEnabled) {
    const lp = offlineCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = config.filter.lowpassFreq;
    lp.Q.value = config.filter.lowpassQ;
    current.connect(lp);
    current = lp;
  }

  // Delay
  const delayBus = offlineCtx.createGain();
  if (config.delay.enabled && config.delay.wet > 0) {
    const delay = offlineCtx.createDelay(2.0);
    delay.delayTime.value = config.delay.time;
    const fb = offlineCtx.createGain();
    fb.gain.value = config.delay.feedback;
    const wet = offlineCtx.createGain();
    wet.gain.value = config.delay.wet;

    current.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(delayBus);
  }

  // Reverb
  const reverbBus = offlineCtx.createGain();
  if (config.reverb.enabled && config.reverb.wet > 0) {
    const conv = offlineCtx.createConvolver();
    conv.buffer = generateReverbImpulseResponse(offlineCtx, config.reverb.decay, config.reverb.preDelay);
    const rWet = offlineCtx.createGain();
    rWet.gain.value = config.reverb.wet;
    current.connect(conv);
    conv.connect(rWet);
    rWet.connect(reverbBus);
  }

  // Sum dry and effects
  const sumGain = offlineCtx.createGain();
  current.connect(sumGain);
  delayBus.connect(sumGain);
  reverbBus.connect(sumGain);

  // Compressor
  let finalNode: AudioNode = sumGain;
  if (config.compressor.enabled) {
    const comp = offlineCtx.createDynamicsCompressor();
    comp.threshold.value = config.compressor.threshold;
    comp.ratio.value = config.compressor.ratio;
    comp.attack.value = config.compressor.attack;
    comp.release.value = config.compressor.release;
    comp.knee.value = config.compressor.knee;
    finalNode.connect(comp);
    finalNode = comp;
  }

  // Limiter
  const lim = offlineCtx.createDynamicsCompressor();
  lim.threshold.value = config.limiter.enabled ? config.limiter.threshold : -0.1;
  lim.ratio.value = 20;
  lim.knee.value = 0;
  finalNode.connect(lim);
  lim.connect(offlineCtx.destination);

  src.start(0);

  if (onProgress) onProgress(20);
  const renderedBuffer = await offlineCtx.startRendering();
  if (onProgress) onProgress(90);

  // Apply Normalization if selected
  if (config.normalizer.enabled) {
    let peak = 0;
    for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
      const data = renderedBuffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    const targetPeakLinear = Math.pow(10, config.normalizer.targetPeakDb / 20);
    if (peak > 0.0001 && peak !== targetPeakLinear) {
      const gain = targetPeakLinear / peak;
      for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
        const data = renderedBuffer.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.max(-1, Math.min(1, data[i] * gain));
        }
      }
    }
  }

  if (onProgress) onProgress(100);
  return renderedBuffer;
}
