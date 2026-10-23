/**
 * SonicForge Studio - Pure TypeScript WAV Encoder
 * Master-quality WAV encoding supporting 16-bit, 24-bit PCM and 32-bit Float.
 * Runs 100% locally with zero external dependencies.
 */

export interface WavEncoderOptions {
  bitDepth?: 16 | 24 | 32;
  sampleRate?: number;
  channels?: 1 | 2;
  normalize?: boolean;
}

export function encodeAudioBufferToWav(
  buffer: AudioBuffer,
  options: WavEncoderOptions = {}
): Blob {
  const bitDepth = options.bitDepth || 16;
  const targetSampleRate = options.sampleRate || buffer.sampleRate;
  const numChannels = options.channels || (buffer.numberOfChannels > 1 ? 2 : 1);
  const normalize = options.normalize ?? false;

  // Resample if required or extract channel data
  const channelsData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const srcCh = Math.min(ch, buffer.numberOfChannels - 1);
    const srcData = buffer.getChannelData(srcCh);
    
    if (targetSampleRate === buffer.sampleRate) {
      channelsData.push(new Float32Array(srcData));
    } else {
      // Linear interpolation resampler
      const ratio = buffer.sampleRate / targetSampleRate;
      const newLen = Math.round(srcData.length / ratio);
      const resampled = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) {
        const srcIdx = i * ratio;
        const i0 = Math.floor(srcIdx);
        const i1 = Math.min(i0 + 1, srcData.length - 1);
        const frac = srcIdx - i0;
        resampled[i] = srcData[i0] * (1 - frac) + srcData[i1] * frac;
      }
      channelsData.push(resampled);
    }
  }

  const numSamples = channelsData[0].length;

  // Optional peak normalization
  if (normalize) {
    let peak = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const data = channelsData[ch];
      for (let i = 0; i < numSamples; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    if (peak > 0.0001 && peak !== 1.0) {
      const scale = 0.999 / peak;
      for (let ch = 0; ch < numChannels; ch++) {
        const data = channelsData[ch];
        for (let i = 0; i < numSamples; i++) {
          data[i] *= scale;
        }
      }
    }
  }

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = targetSampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const bufferLength = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // Helper to write ASCII string to DataView
  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // Total file size - 8
  writeString(8, 'WAVE');

  // fmt subchunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  const audioFormat = bitDepth === 32 ? 3 : 1; // 1 = PCM, 3 = IEEE Float
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data subchunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write audio samples
  let offset = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channelsData[ch][i]));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, Math.round(intSample), true);
        offset += 2;
      }
    }
  } else if (bitDepth === 24) {
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channelsData[ch][i]));
        const intSample = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        view.setUint8(offset, intSample & 0xff);
        view.setUint8(offset + 1, (intSample >> 8) & 0xff);
        view.setUint8(offset + 2, (intSample >> 16) & 0xff);
        offset += 3;
      }
    }
  } else if (bitDepth === 32) {
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        view.setFloat32(offset, channelsData[ch][i], true);
        offset += 4;
      }
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
