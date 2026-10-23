/**
 * SonicForge Studio - MP3 Encoder
 * Encodes AudioBuffer into MP3 format locally using lamejs.
 */
// @ts-ignore
import lamejs from 'lamejs';

export interface Mp3EncoderOptions {
  sampleRate?: number;
  channels?: 1 | 2;
  bitrate?: number; // kbps, e.g. 128, 192, 256, 320
}

export function encodeAudioBufferToMp3(
  buffer: AudioBuffer,
  options: Mp3EncoderOptions = {},
  onProgress?: (percent: number) => void
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const sampleRate = options.sampleRate || (buffer.sampleRate <= 48000 ? buffer.sampleRate : 44100);
      const channels = options.channels || (buffer.numberOfChannels > 1 ? 2 : 1);
      const kbps = options.bitrate || 192;

      // Resample / extract channels
      const leftSrc = buffer.getChannelData(0);
      const rightSrc = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : leftSrc;

      let leftSamples: Float32Array;
      let rightSamples: Float32Array;

      if (buffer.sampleRate === sampleRate) {
        leftSamples = leftSrc;
        rightSamples = rightSrc;
      } else {
        const ratio = buffer.sampleRate / sampleRate;
        const newLen = Math.round(leftSrc.length / ratio);
        leftSamples = new Float32Array(newLen);
        rightSamples = new Float32Array(newLen);
        for (let i = 0; i < newLen; i++) {
          const srcIdx = i * ratio;
          const i0 = Math.floor(srcIdx);
          const i1 = Math.min(i0 + 1, leftSrc.length - 1);
          const frac = srcIdx - i0;
          leftSamples[i] = leftSrc[i0] * (1 - frac) + leftSrc[i1] * frac;
          rightSamples[i] = rightSrc[i0] * (1 - frac) + rightSrc[i1] * frac;
        }
      }

      const numSamples = leftSamples.length;
      const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
      const mp3Data: Uint8Array[] = [];

      // Convert Float32 to Int16
      const sampleBlockSize = 1152;
      const leftChunk = new Int16Array(sampleBlockSize);
      const rightChunk = channels === 2 ? new Int16Array(sampleBlockSize) : null;

      let currentSample = 0;

      function processChunk() {
        const startTime = performance.now();
        while (currentSample < numSamples) {
          const remaining = numSamples - currentSample;
          const chunkSize = Math.min(remaining, sampleBlockSize);

          for (let i = 0; i < chunkSize; i++) {
            const idx = currentSample + i;
            // Left
            let sL = leftSamples[idx];
            sL = Math.max(-1, Math.min(1, sL));
            leftChunk[i] = sL < 0 ? sL * 0x8000 : sL * 0x7fff;

            // Right
            if (rightChunk) {
              let sR = rightSamples[idx];
              sR = Math.max(-1, Math.min(1, sR));
              rightChunk[i] = sR < 0 ? sR * 0x8000 : sR * 0x7fff;
            }
          }

          let mp3buf: Int8Array | Uint8Array;
          if (channels === 1) {
            mp3buf = mp3encoder.encodeBuffer(leftChunk.subarray(0, chunkSize));
          } else {
            mp3buf = mp3encoder.encodeBuffer(
              leftChunk.subarray(0, chunkSize),
              rightChunk!.subarray(0, chunkSize)
            );
          }

          if (mp3buf.length > 0) {
            mp3Data.push(new Uint8Array(mp3buf));
          }

          currentSample += chunkSize;

          if (onProgress) {
            onProgress(Math.round((currentSample / numSamples) * 95));
          }

          // Yield to UI thread every 25ms to keep interface responsive
          if (performance.now() - startTime > 25 && currentSample < numSamples) {
            setTimeout(processChunk, 0);
            return;
          }
        }

        // Flush encoder
        const mp3buf = mp3encoder.flush();
        if (mp3buf.length > 0) {
          mp3Data.push(new Uint8Array(mp3buf));
        }

        if (onProgress) onProgress(100);

        const blob = new Blob(mp3Data as any, { type: 'audio/mp3' });
        resolve(blob);
      }

      processChunk();
    } catch (err) {
      reject(err);
    }
  });
}
