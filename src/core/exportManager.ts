/**
 * SonicForge Studio - Export Manager
 * High-reliability multi-format offline exporter.
 * Seamlessly routes between pure JS encoders (WAV 16/24/32-bit, MP3) and WebAssembly FFmpeg.
 */

import { ExportConfig } from '../types';
import { encodeAudioBufferToWav } from './encoders/wavEncoder';
import { encodeAudioBufferToMp3 } from './encoders/mp3Encoder';
import { cropAudioBuffer } from './editor/audioBufferUtils';
import { getFFmpeg } from './video/videoProcessor';
import { fetchFile } from '@ffmpeg/util';

export async function exportAudio(
  buffer: AudioBuffer,
  config: ExportConfig,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  // Apply time range if selected
  let targetBuffer = buffer;
  if (config.range && config.range.end > config.range.start) {
    targetBuffer = cropAudioBuffer(buffer, config.range.start, config.range.end);
  }

  const format = config.format.toLowerCase();

  // 1. Pure TypeScript WAV (16, 24, 32-bit)
  if (format === 'wav') {
    onProgress?.(30);
    const blob = encodeAudioBufferToWav(targetBuffer, {
      bitDepth: config.bitDepth || 16,
      sampleRate: config.sampleRate,
      channels: config.channels,
      normalize: config.normalizeAudio,
    });
    onProgress?.(100);
    return blob;
  }

  // 2. Pure JS MP3 (lamejs)
  if (format === 'mp3') {
    return await encodeAudioBufferToMp3(
      targetBuffer,
      {
        sampleRate: config.sampleRate,
        channels: config.channels,
        bitrate: config.bitrate || 192,
      },
      onProgress
    );
  }

  // 3. FLAC, OGG, AAC via local offline FFmpeg WebAssembly
  if (format === 'flac' || format === 'ogg' || format === 'aac') {
    const ffmpeg = await getFFmpeg();
    if (ffmpeg) {
      onProgress?.(20);
      // Encode first to master WAV in memory
      const masterWav = encodeAudioBufferToWav(targetBuffer, {
        bitDepth: 16,
        sampleRate: config.sampleRate,
        channels: config.channels,
      });

      const inName = 'temp_master.wav';
      const outName = `output.${format}`;
      await ffmpeg.writeFile(inName, await fetchFile(masterWav));
      onProgress?.(50);

      const args = ['-i', inName];
      if (format === 'flac') {
        args.push('-c:a', 'flac');
      } else if (format === 'ogg') {
        args.push('-c:a', 'libvorbis', '-b:a', `${config.bitrate || 192}k`);
      } else if (format === 'aac') {
        args.push('-c:a', 'aac', '-b:a', `${config.bitrate || 192}k`);
      }
      args.push(outName);

      await ffmpeg.exec(args);
      onProgress?.(90);

      const data = await ffmpeg.readFile(outName);
      const mime = format === 'flac' ? 'audio/flac' : format === 'ogg' ? 'audio/ogg' : 'audio/aac';
      const blob = new Blob([data as any], { type: mime });

      await ffmpeg.deleteFile(inName);
      await ffmpeg.deleteFile(outName);
      onProgress?.(100);
      return blob;
    }
  }

  // Fallback to high-quality WAV if format unavailable
  console.warn(`Selected format ${format} unavailable offline; exporting as master WAV.`);
  return encodeAudioBufferToWav(targetBuffer, {
    bitDepth: 16,
    sampleRate: config.sampleRate,
    channels: config.channels,
  });
}

/**
 * Trigger local browser download for exported file
 */
export function triggerFileDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
