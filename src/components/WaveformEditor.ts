/**
 * SonicForge Studio - Waveform Canvas Editor
 * Studio-grade waveform visualization with time ruler, interactive range selection,
 * draggable handles, playhead seeking, and multi-level zoom.
 */

import { SelectionRange } from '../types';

export class WaveformEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buffer: AudioBuffer | null = null;
  private selection: SelectionRange | null = null;
  private playheadTime: number = 0;
  private zoomLevel: number = 1.0;
  private scrollOffsetSec: number = 0; // horizontal scroll in seconds

  // Interaction state
  private isDraggingSelection = false;
  private isDraggingLeftHandle = false;
  private isDraggingRightHandle = false;
  private dragStartX = 0;

  private onSeekCallback?: (timeSec: number) => void;
  private onSelectionChangeCallback?: (selection: SelectionRange | null) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get 2D canvas context');
    this.ctx = context;

    this.setupEventListeners();
    this.resizeCanvas();
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.draw();
    });
  }

  public setAudioBuffer(buffer: AudioBuffer | null) {
    this.buffer = buffer;
    this.selection = null;
    this.playheadTime = 0;
    this.zoomLevel = 1.0;
    this.scrollOffsetSec = 0;
    this.draw();
  }

  public setPlayheadTime(timeSec: number) {
    this.playheadTime = timeSec;
    this.draw();
  }

  public setSelection(range: SelectionRange | null) {
    this.selection = range;
    this.draw();
  }

  public getSelection(): SelectionRange | null {
    return this.selection;
  }

  public setZoom(zoom: number) {
    this.zoomLevel = Math.max(1.0, Math.min(32.0, zoom));
    // Clamp scroll
    if (this.buffer) {
      const visibleDuration = this.getVisibleDuration();
      const maxScroll = Math.max(0, this.buffer.duration - visibleDuration);
      this.scrollOffsetSec = Math.min(this.scrollOffsetSec, maxScroll);
    }
    this.draw();
  }

  public getZoom(): number {
    return this.zoomLevel;
  }

  public setScrollOffset(offsetSec: number) {
    this.scrollOffsetSec = Math.max(0, offsetSec);
    this.draw();
  }

  public onSeek(cb: (timeSec: number) => void) {
    this.onSeekCallback = cb;
  }

  public onSelectionChange(cb: (selection: SelectionRange | null) => void) {
    this.onSelectionChangeCallback = cb;
  }

  private resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (rect.width > 0 && rect.height > 0) {
      this.canvas.width = Math.floor(rect.width * dpr);
      this.canvas.height = Math.floor(rect.height * dpr);
      this.ctx.resetTransform?.();
      this.ctx.scale(dpr, dpr);
    }
  }

  private getVisibleDuration(): number {
    if (!this.buffer) return 1;
    return this.buffer.duration / this.zoomLevel;
  }

  private timeToX(timeSec: number, width: number): number {
    const visibleDuration = this.getVisibleDuration();
    return ((timeSec - this.scrollOffsetSec) / visibleDuration) * width;
  }

  private xToTime(x: number, width: number): number {
    const visibleDuration = this.getVisibleDuration();
    const time = this.scrollOffsetSec + (x / width) * visibleDuration;
    return Math.max(0, Math.min(this.buffer?.duration || 0, time));
  }

  private setupEventListeners() {
    const getPos = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        width: rect.width,
        height: rect.height,
      };
    };

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.buffer) return;
      const { x, width } = getPos(e);
      const clickedTime = this.xToTime(x, width);

      // Check handle proximity (within 8px of selection boundaries)
      if (this.selection) {
        const leftX = this.timeToX(this.selection.start, width);
        const rightX = this.timeToX(this.selection.end, width);

        if (Math.abs(x - leftX) <= 8) {
          this.isDraggingLeftHandle = true;
          return;
        }
        if (Math.abs(x - rightX) <= 8) {
          this.isDraggingRightHandle = true;
          return;
        }
      }

      // Check if clicking in ruler area (top 24px) for seeking
      if (getPos(e).y <= 24 || e.shiftKey) {
        this.onSeekCallback?.(clickedTime);
        return;
      }

      // Start new selection drag
      this.isDraggingSelection = true;
      this.dragStartX = x;
      this.selection = { start: clickedTime, end: clickedTime };
      this.draw();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.buffer) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const currentTime = this.xToTime(x, rect.width);

      // Cursor styling for handles
      if (!this.isDraggingSelection && !this.isDraggingLeftHandle && !this.isDraggingRightHandle) {
        if (this.selection) {
          const leftX = this.timeToX(this.selection.start, rect.width);
          const rightX = this.timeToX(this.selection.end, rect.width);
          if (Math.abs(x - leftX) <= 8 || Math.abs(x - rightX) <= 8) {
            this.canvas.style.cursor = 'ew-resize';
            return;
          }
        }
        this.canvas.style.cursor = 'crosshair';
      }

      if (this.isDraggingLeftHandle && this.selection) {
        this.selection.start = Math.min(currentTime, this.selection.end - 0.01);
        this.onSelectionChangeCallback?.(this.selection);
        this.draw();
      } else if (this.isDraggingRightHandle && this.selection) {
        this.selection.end = Math.max(currentTime, this.selection.start + 0.01);
        this.onSelectionChangeCallback?.(this.selection);
        this.draw();
      } else if (this.isDraggingSelection && this.selection) {
        const startTime = this.xToTime(this.dragStartX, rect.width);
        this.selection.start = Math.min(startTime, currentTime);
        this.selection.end = Math.max(startTime, currentTime);
        this.onSelectionChangeCallback?.(this.selection);
        this.draw();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDraggingSelection || this.isDraggingLeftHandle || this.isDraggingRightHandle) {
        if (this.selection && Math.abs(this.selection.end - this.selection.start) < 0.02) {
          // Point click, clear selection and seek
          this.onSeekCallback?.(this.selection.start);
          this.selection = null;
          this.onSelectionChangeCallback?.(null);
        }
        this.isDraggingSelection = false;
        this.isDraggingLeftHandle = false;
        this.isDraggingRightHandle = false;
        this.draw();
      }
    });

    // Mouse wheel zoom
    this.canvas.addEventListener('wheel', (e) => {
      if (!this.buffer) return;
      e.preventDefault();
      const zoomDelta = e.deltaY < 0 ? 1.25 : 0.8;
      this.setZoom(this.zoomLevel * zoomDelta);
    }, { passive: false });
  }

  public draw() {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (width === 0 || height === 0) return;

    // Dark DAW background
    this.ctx.fillStyle = '#0a0d12';
    this.ctx.fillRect(0, 0, width, height);

    if (!this.buffer) {
      this.drawEmptyState(width, height);
      return;
    }

    const rulerHeight = 24;
    const waveHeight = height - rulerHeight;

    // Draw Time Ruler
    this.drawTimeRuler(width, rulerHeight);

    // Draw Waveform Channels
    this.drawWaveformChannels(width, rulerHeight, waveHeight);

    // Draw Selection Overlay
    if (this.selection) {
      this.drawSelectionRegion(width, rulerHeight, waveHeight);
    }

    // Draw Playhead Marker
    this.drawPlayhead(width, rulerHeight, waveHeight);
  }

  private drawEmptyState(width: number, height: number) {
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, height / 2);
    this.ctx.lineTo(width, height / 2);
    this.ctx.stroke();

    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    this.ctx.font = '13px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('No audio loaded - Drag & drop an audio file or select Import', width / 2, height / 2 + 5);
  }

  private drawTimeRuler(width: number, rulerHeight: number) {
    this.ctx.fillStyle = '#111720';
    this.ctx.fillRect(0, 0, width, rulerHeight);

    this.ctx.strokeStyle = '#222f3e';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, rulerHeight);
    this.ctx.lineTo(width, rulerHeight);
    this.ctx.stroke();

    const visibleDuration = this.getVisibleDuration();
    const stepSec = this.calculateRulerStep(visibleDuration);

    const firstTick = Math.floor(this.scrollOffsetSec / stepSec) * stepSec;
    const lastTick = this.scrollOffsetSec + visibleDuration;

    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    this.ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    this.ctx.textAlign = 'left';

    for (let t = firstTick; t <= lastTick; t += stepSec) {
      const x = this.timeToX(t, width);
      if (x < 0 || x > width) continue;

      // Major tick
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      this.ctx.beginPath();
      this.ctx.moveTo(x, rulerHeight - 8);
      this.ctx.lineTo(x, rulerHeight);
      this.ctx.stroke();

      const timeLabel = this.formatTimecode(t);
      this.ctx.fillText(timeLabel, x + 3, rulerHeight - 10);
    }
  }

  private calculateRulerStep(visibleDuration: number): number {
    if (visibleDuration <= 1) return 0.1;
    if (visibleDuration <= 5) return 0.5;
    if (visibleDuration <= 15) return 1;
    if (visibleDuration <= 30) return 2;
    if (visibleDuration <= 60) return 5;
    if (visibleDuration <= 180) return 15;
    return 30;
  }

  private drawWaveformChannels(width: number, topOffset: number, totalWaveHeight: number) {
    if (!this.buffer) return;

    const numChannels = Math.min(2, this.buffer.numberOfChannels);
    const channelHeight = totalWaveHeight / numChannels;

    for (let ch = 0; ch < numChannels; ch++) {
      const channelTop = topOffset + ch * channelHeight;
      const channelCenter = channelTop + channelHeight / 2;
      const data = this.buffer.getChannelData(ch);

      // Baseline
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      this.ctx.beginPath();
      this.ctx.moveTo(0, channelCenter);
      this.ctx.lineTo(width, channelCenter);
      this.ctx.stroke();

      // Compute visible sample range
      const visibleDuration = this.getVisibleDuration();
      const startSec = this.scrollOffsetSec;
      const endSec = startSec + visibleDuration;
      const startSample = Math.max(0, Math.floor(startSec * this.buffer.sampleRate));
      const endSample = Math.min(this.buffer.length, Math.ceil(endSec * this.buffer.sampleRate));
      const sampleCount = endSample - startSample;

      const samplesPerPixel = sampleCount / width;

      // Render Peaks
      this.ctx.fillStyle = ch === 0 ? '#0ea5e9' : '#0284c7'; // Cyan/sky blue studio wave

      for (let x = 0; x < width; x++) {
        const sStart = Math.floor(startSample + x * samplesPerPixel);
        const sEnd = Math.min(data.length, Math.floor(sStart + samplesPerPixel));

        let min = 1.0;
        let max = -1.0;

        for (let i = sStart; i < sEnd; i += Math.max(1, Math.floor((sEnd - sStart) / 16))) {
          const val = data[i];
          if (val < min) min = val;
          if (val > max) max = val;
        }

        if (max < min) { min = 0; max = 0; }

        const yTop = channelCenter - (max * (channelHeight / 2) * 0.9);
        const yBottom = channelCenter - (min * (channelHeight / 2) * 0.9);
        const barH = Math.max(1, yBottom - yTop);

        this.ctx.fillRect(x, yTop, 1, barH);
      }
    }
  }

  private drawSelectionRegion(width: number, topOffset: number, waveHeight: number) {
    if (!this.selection) return;

    const x1 = Math.max(0, this.timeToX(this.selection.start, width));
    const x2 = Math.min(width, this.timeToX(this.selection.end, width));
    const selWidth = Math.max(1, x2 - x1);

    // Shaded range
    this.ctx.fillStyle = 'rgba(14, 165, 233, 0.18)';
    this.ctx.fillRect(x1, topOffset, selWidth, waveHeight);

    // Selection border lines
    this.ctx.strokeStyle = '#38bdf8';
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(x1, topOffset);
    this.ctx.lineTo(x1, topOffset + waveHeight);
    this.ctx.moveTo(x2, topOffset);
    this.ctx.lineTo(x2, topOffset + waveHeight);
    this.ctx.stroke();

    // Handles on top ruler
    this.ctx.fillStyle = '#38bdf8';
    this.ctx.fillRect(x1 - 4, 4, 8, topOffset - 8);
    this.ctx.fillRect(x2 - 4, 4, 8, topOffset - 8);

    // Range duration badge
    const duration = Math.abs(this.selection.end - this.selection.start);
    this.ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    this.ctx.fillRect(x1 + 4, topOffset + 8, 90, 20);
    this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    this.ctx.strokeRect(x1 + 4, topOffset + 8, 90, 20);
    this.ctx.fillStyle = '#38bdf8';
    this.ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`Δ ${duration.toFixed(3)}s`, x1 + 10, topOffset + 22);
  }

  private drawPlayhead(width: number, topOffset: number, waveHeight: number) {
    const playheadX = this.timeToX(this.playheadTime, width);
    if (playheadX < 0 || playheadX > width) return;

    // Playhead needle
    this.ctx.strokeStyle = '#f43f5e'; // High visibility rose red playhead
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(playheadX, 0);
    this.ctx.lineTo(playheadX, topOffset + waveHeight);
    this.ctx.stroke();

    // Playhead head cap
    this.ctx.fillStyle = '#f43f5e';
    this.ctx.beginPath();
    this.ctx.moveTo(playheadX - 5, 0);
    this.ctx.lineTo(playheadX + 5, 0);
    this.ctx.lineTo(playheadX, 8);
    this.ctx.closePath();
    this.ctx.fill();
  }

  private formatTimecode(sec: number): string {
    const mins = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${mins}:${s.toString().padStart(2, '0')}.${ms}`;
  }
}
