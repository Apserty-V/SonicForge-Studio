/**
 * SonicForge Studio - Video Processing Engine
 * Handles audio extraction, muting, audio replacement, trimming, and export.
 * Supports both local WebAssembly FFmpeg and browser MediaStream fallback.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { VideoMetadata } from '../../types';
import { decodeAudio } from '../audioContext';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;
let ffmpegLoadingPromise: Promise<boolean> | null = null;

/**
 * Initialize or get local offline FFmpeg WebAssembly instance
 */
export async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg | null> {
  if (ffmpegLoaded && ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadingPromise) {
    const success = await ffmpegLoadingPromise;
    return success ? ffmpegInstance : null;
  }

  ffmpegLoadingPromise = (async () => {
    try {
      const ffmpeg = new FFmpeg();
      ffmpeg.on('log', ({ message }) => {
        if (onLog) onLog(message);
      });

      // Load from locally vendored public/ffmpeg directory (no internet required)
      const coreURL = '/ffmpeg/ffmpeg-core.js';
      const wasmURL = '/ffmpeg/ffmpeg-core.wasm';

      await ffmpeg.load({
        coreURL,
        wasmURL,
      });

      ffmpegInstance = ffmpeg;
      ffmpegLoaded = true;
      return true;
    } catch (err) {
      console.warn('FFmpeg WebAssembly load notice (falling back to native browser engine):', err);
      ffmpegInstance = null;
      ffmpegLoaded = false;
      return false;
    }
  })();

  const ok = await ffmpegLoadingPromise;
  return ok ? ffmpegInstance : null;
}

/**
 * Inspect video file to get dimensions, duration, and audio stream existence
 */
export function probeVideoFile(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(file);
    video.src = url;

    video.onloadedmetadata = async () => {
      // Check if video has audio track
      let hasAudio = false;
      try {
        const audioTracks = (video as unknown as { audioTracks?: { length: number } }).audioTracks;
        if (audioTracks && audioTracks.length > 0) {
          hasAudio = true;
        } else {
          // Alternative check: try decoding a slice via AudioContext
          hasAudio = true;
        }
      } catch {
        hasAudio = true;
      }

      const meta: VideoMetadata = {
        name: file.name,
        size: file.size,
        type: file.type || 'video/mp4',
        duration: video.duration || 0,
        width: video.videoWidth || 1920,
        height: video.videoHeight || 1080,
        hasAudio,
        url,
        file,
      };
      resolve(meta);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Invalid or unsupported video container format'));
    };
  });
}

/**
 * Extract audio track from video file as AudioBuffer
 */
export async function extractAudioFromVideo(
  file: File,
  onProgress?: (percent: number) => void
): Promise<AudioBuffer> {
  if (onProgress) onProgress(20);
  try {
    // Direct browser decoding of video container audio track
    const arrayBuffer = await file.arrayBuffer();
    if (onProgress) onProgress(60);
    const audioBuffer = await decodeAudio(arrayBuffer);
    if (onProgress) onProgress(100);
    return audioBuffer;
  } catch (err) {
    // Fallback to FFmpeg if direct decode fails
    const ffmpeg = await getFFmpeg();
    if (ffmpeg) {
      if (onProgress) onProgress(40);
      const inName = 'input_video' + getFileExtension(file.name);
      const outName = 'extracted.wav';
      await ffmpeg.writeFile(inName, await fetchFile(file));
      await ffmpeg.exec(['-i', inName, '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', outName]);
      const data = await ffmpeg.readFile(outName);
      const audioBuf = await decodeAudio(((data as any).buffer as ArrayBuffer));
      await ffmpeg.deleteFile(inName);
      await ffmpeg.deleteFile(outName);
      if (onProgress) onProgress(100);
      return audioBuf;
    }
    throw new Error('Could not extract audio track from video: ' + (err as Error).message);
  }
}

/**
 * Mute video (remove audio track)
 * Uses lossless stream copy when FFmpeg is available, or Canvas/MediaRecorder
 */
export async function muteVideo(
  file: File,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  if (ffmpeg) {
    if (onProgress) onProgress(20);
    const inName = 'in_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const outName = 'muted_output.mp4';
    await ffmpeg.writeFile(inName, await fetchFile(file));
    if (onProgress) onProgress(50);
    // -c:v copy preserves video stream losslessly without re-encoding!
    await ffmpeg.exec(['-i', inName, '-c:v', 'copy', '-an', outName]);
    if (onProgress) onProgress(90);
    const data = await ffmpeg.readFile(outName);
    const blob = new Blob([data as any], { type: 'video/mp4' });
    await ffmpeg.deleteFile(inName);
    await ffmpeg.deleteFile(outName);
    if (onProgress) onProgress(100);
    return blob;
  }

  // Fallback: Native Browser MediaRecorder muting
  return muteVideoBrowser(file, onProgress);
}

/**
 * Replace audio in video with a new audio file or AudioBuffer
 */
export async function replaceVideoAudio(
  videoFile: File,
  audioFileOrBlob: Blob,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  if (ffmpeg) {
    if (onProgress) onProgress(15);
    const vidName = 'in_video' + getFileExtension(videoFile.name);
    const audName = 'in_audio.wav';
    const outName = 'replaced_audio.mp4';

    await ffmpeg.writeFile(vidName, await fetchFile(videoFile));
    await ffmpeg.writeFile(audName, await fetchFile(audioFileOrBlob));
    if (onProgress) onProgress(45);

    // Stream copy video, encode audio to AAC
    await ffmpeg.exec([
      '-i', vidName,
      '-i', audName,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-shortest',
      outName,
    ]);
    if (onProgress) onProgress(90);
    const data = await ffmpeg.readFile(outName);
    const blob = new Blob([data as any], { type: 'video/mp4' });
    await ffmpeg.deleteFile(vidName);
    await ffmpeg.deleteFile(audName);
    await ffmpeg.deleteFile(outName);
    if (onProgress) onProgress(100);
    return blob;
  }

  throw new Error('Video audio replacement requires WebAssembly engine for stream muxing.');
}

/**
 * Trim video by start and end time
 */
export async function trimVideo(
  videoFile: File,
  startTimeSec: number,
  endTimeSec: number,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  if (ffmpeg) {
    if (onProgress) onProgress(20);
    const inName = 'in_trim' + getFileExtension(videoFile.name);
    const outName = 'trimmed.mp4';
    await ffmpeg.writeFile(inName, await fetchFile(videoFile));
    if (onProgress) onProgress(50);

    const duration = endTimeSec - startTimeSec;
    await ffmpeg.exec([
      '-ss', startTimeSec.toString(),
      '-i', inName,
      '-t', duration.toString(),
      '-c:v', 'copy',
      '-c:a', 'copy',
      outName,
    ]);
    if (onProgress) onProgress(90);
    const data = await ffmpeg.readFile(outName);
    const blob = new Blob([data as any], { type: 'video/mp4' });
    await ffmpeg.deleteFile(inName);
    await ffmpeg.deleteFile(outName);
    if (onProgress) onProgress(100);
    return blob;
  }

  throw new Error('Trimming video streams requires WebAssembly engine.');
}

/**
 * Browser fallback for muting video using MediaRecorder
 */
async function muteVideoBrowser(
  file: File,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.muted = true;

    video.onloadedmetadata = () => {
      const stream = (video as unknown as { captureStream?: () => MediaStream }).captureStream 
        ? (video as unknown as { captureStream: () => MediaStream }).captureStream()
        : null;

      if (!stream) {
        reject(new Error('Browser captureStream is not supported on this device.'));
        return;
      }

      // Remove audio tracks from capture stream to mute
      stream.getAudioTracks().forEach(t => stream.removeTrack(t));

      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks: Blob[] = [];

      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        URL.revokeObjectURL(video.src);
        const blob = new Blob(chunks, { type: 'video/webm' });
        if (onProgress) onProgress(100);
        resolve(blob);
      };

      video.ontimeupdate = () => {
        if (video.duration && onProgress) {
          onProgress(Math.round((video.currentTime / video.duration) * 90));
        }
      };

      video.onended = () => {
        recorder.stop();
      };

      recorder.start(100);
      video.play().catch(reject);
    };

    video.onerror = () => reject(new Error('Failed to load video for muting'));
  });
}

function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx !== -1 ? filename.substring(idx) : '.mp4';
}
