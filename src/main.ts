/**
 * SonicForge Studio - Main Application Controller
 * Complete local-first professional audio & video workstation.
 */

import './style.css';
import {
  NavigationTab,
  AudioMetadata,
  VideoMetadata,
  SelectionRange,
  VoicePreset,
  EffectsConfig,
  ExportConfig,
} from './types';
import {
  getAudioContext,
  decodeAudio,
  cloneAudioBuffer,
  createEmptyAudioBuffer,
} from './core/audioContext';
import {
  cropAudioBuffer,
  cutAudioBufferRange,
  reverseAudioBuffer,
  applyFadeIn,
  applyFadeOut,
  applyGain,
  applySpeedChange,
  mergeAudioBuffers,
} from './core/editor/audioBufferUtils';
import {
  VOICE_PRESETS,
  processVoiceLabBuffer,
} from './core/dsp/voiceLabDsp';
import {
  DEFAULT_EFFECTS_CONFIG,
  EQ10_FREQUENCIES,
  RealtimeEffectsGraph,
  renderEffectsOffline,
} from './core/dsp/effectsChain';
import {
  probeVideoFile,
  extractAudioFromVideo,
  muteVideo,
  replaceVideoAudio,
  trimVideo,
  getFFmpeg,
} from './core/video/videoProcessor';
import {
  generateToneBuffer,
  generateWhiteNoiseBuffer,
  generatePinkNoiseBuffer,
  LiveSynthesizer,
  exportSoundLabAudio,
} from './core/soundLab/soundLab';
import { WaveformEditor } from './components/WaveformEditor';
import { AudioVisualizer } from './components/Visualizer';
import { exportAudio, triggerFileDownload } from './core/exportManager';
import {
  getStoredSettings,
  saveStoredSettings,
  addRecentItem,
  getRecentItems,
  RecentItem,
} from './core/storage/db';

class SonicForgeApp {
  // Navigation
  private currentTab: NavigationTab = 'home';

  // Audio State
  private originalBuffer: AudioBuffer | null = null;
  private currentBuffer: AudioBuffer | null = null;
  private audioMeta: AudioMetadata | null = null;
  private undoStack: AudioBuffer[] = [];
  private redoStack: AudioBuffer[] = [];

  // Video State
  private currentVideoMeta: VideoMetadata | null = null;

  // Playback & DSP
  private isPlaying = false;
  private isLooping = false;
  private playbackStartTime = 0;
  private playbackPauseOffset = 0;
  private activeSourceNode: AudioBufferSourceNode | null = null;
  private masterGainNode!: GainNode;
  private analyserNode!: AnalyserNode;
  private effectsGraph!: RealtimeEffectsGraph;
  private effectsConfig: EffectsConfig = JSON.parse(JSON.stringify(DEFAULT_EFFECTS_CONFIG));

  // Voice Lab
  private selectedVoicePreset: VoicePreset = VOICE_PRESETS[0];
  private isVoiceAbOriginal = false; // A/B comparison toggle
  private voiceProcessedBuffer: AudioBuffer | null = null;

  // Sound Lab
  private liveSynth = new LiveSynthesizer();
  private soundLabLastBuffer: AudioBuffer | null = null;

  // Components
  private waveformEditor: WaveformEditor | null = null;
  private visualizer: AudioVisualizer | null = null;

  // UI Elements cache
  private rootEl!: HTMLElement;

  constructor() {
    this.initAudioNodes();
    this.renderShell();
    this.bindGlobalKeyboardShortcuts();
    this.startPlaybackMeterLoop();
    this.testOfflineEngines();
  }

  private initAudioNodes() {
    const ctx = getAudioContext();
    this.masterGainNode = ctx.createGain();
    this.masterGainNode.gain.value = 0.85;

    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = 2048;

    this.effectsGraph = new RealtimeEffectsGraph(ctx, this.effectsConfig);

    // Audio node routing: Source -> EffectsGraph -> MasterGain -> Analyser -> Destination
    this.effectsGraph.outputNode.connect(this.masterGainNode);
    this.masterGainNode.connect(this.analyserNode);
    this.analyserNode.connect(ctx.destination);
  }

  private async testOfflineEngines() {
    // Proactively initiate FFmpeg wasm check without blocking
    try {
      await getFFmpeg();
    } catch {
      // Ignored
    }
  }

  private renderShell() {
    this.rootEl = document.getElementById('app') || document.body;
    this.rootEl.innerHTML = `
      <!-- Top Header -->
      <header class="top-header">
        <div class="brand-section">
          <svg class="brand-logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
          <div>
            <div class="brand-title">SonicForge Studio</div>
            <div class="brand-subtitle">Offline Audio & Video Workstation</div>
          </div>
        </div>

        <div class="header-actions">
          <div class="offline-badge">
            <span class="offline-dot"></span>
            100% Offline & Local
          </div>
          <button class="btn btn-sm" id="btn-quick-import">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Import File
          </button>
          <button class="btn btn-primary btn-sm" id="btn-quick-export">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Export
          </button>
        </div>
      </header>

      <!-- Main Layout -->
      <div class="main-layout">
        <!-- Sidebar Navigation -->
        <aside class="sidebar">
          <div class="nav-group-label">Workstation</div>
          <div class="nav-item ${this.currentTab === 'home' ? 'active' : ''}" data-tab="home">
            <svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            Home / Overview
          </div>
          <div class="nav-item ${this.currentTab === 'audio-editor' ? 'active' : ''}" data-tab="audio-editor">
            <svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 10v3"></path><path d="M6 6v11"></path><path d="M10 3v18"></path><path d="M14 8v7"></path><path d="M18 5v13"></path><path d="M22 10v3"></path></svg>
            Audio Editor
          </div>
          <div class="nav-item ${this.currentTab === 'voice-lab' ? 'active' : ''}" data-tab="voice-lab">
            <svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
            Voice Lab (DSP)
          </div>
          <div class="nav-item ${this.currentTab === 'audio-effects' ? 'active' : ''}" data-tab="audio-effects">
            <svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
            Audio Effects
          </div>
          <div class="nav-item ${this.currentTab === 'video-tools' ? 'active' : ''}" data-tab="video-tools">
            <svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="6"></line><line x1="17" y1="2" x2="17" y2="6"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>
            Video Tools
          </div>
          <div class="nav-item ${this.currentTab === 'sound-lab' ? 'active' : ''}" data-tab="sound-lab">
            <svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
            Sound Lab & Synth
          </div>

          <div class="nav-group-label" style="margin-top: auto;">System</div>
          <div class="nav-item ${this.currentTab === 'settings' ? 'active' : ''}" data-tab="settings">
            <svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            Diagnostics & Settings
          </div>
        </aside>

        <!-- Dynamic Workspace Content -->
        <main class="workspace" id="workspace-content">
          <!-- Rendered dynamically -->
        </main>
      </div>

      <!-- Bottom Playback Transport Bar -->
      <footer class="bottom-player-bar">
        <div class="player-left-info">
          <div class="track-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18V5l12-2v13"></path>
              <circle cx="6" cy="18" r="3"></circle>
              <circle cx="18" cy="16" r="3"></circle>
            </svg>
          </div>
          <div class="track-details">
            <div class="track-title" id="player-track-name">No Audio Loaded</div>
            <div class="track-meta" id="player-track-meta">00:00 / 0.0 MB</div>
          </div>
        </div>

        <div class="player-center-controls">
          <div class="transport-buttons">
            <button class="transport-btn" id="btn-transport-stop" title="Stop (S)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"></rect></svg>
            </button>
            <button class="transport-btn btn-play" id="btn-transport-play" title="Play / Pause (Space)">
              <svg id="play-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>
            </button>
            <button class="transport-btn" id="btn-transport-loop" title="Toggle Loop (L)">
              <svg id="loop-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
            </button>
          </div>
          <div class="timecode-display">
            <span class="timecode-current" id="timecode-current">00:00.000</span>
            <span>/</span>
            <span id="timecode-total">00:00.000</span>
          </div>
        </div>

        <div class="player-right-controls">
          <!-- Stereo Peak Level Meter -->
          <div class="peak-meter-container" title="Stereo Peak Meter">
            <div class="peak-meter-track"><div class="peak-meter-fill" id="meter-left"></div></div>
            <div class="peak-meter-track"><div class="peak-meter-fill" id="meter-right"></div></div>
          </div>

          <div class="volume-control-box">
            <button class="transport-btn" id="btn-transport-mute" style="width:24px;height:24px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
            </button>
            <input type="range" class="slider-input" id="master-volume-slider" min="0" max="1" step="0.01" value="0.85" title="Master Volume">
          </div>
        </div>
      </footer>

      <!-- Hidden File Inputs -->
      <input type="file" id="file-input-media" accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.mp4,.mov,.mkv,.webm" style="display:none;" />
      <input type="file" id="file-input-secondary" accept="audio/*,.wav,.mp3,.flac,.ogg" style="display:none;" />

      <!-- Modal Container -->
      <div id="modal-container"></div>
    `;

    this.bindHeaderAndNav();
    this.bindTransportControls();
    this.renderCurrentView();
  }

  private bindHeaderAndNav() {
    // Navigation tabs
    const navItems = this.rootEl.querySelectorAll<HTMLElement>('.nav-item');
    navItems.forEach((item) => {
      item.addEventListener('click', () => {
        const tab = item.dataset.tab as NavigationTab;
        if (tab && tab !== this.currentTab) {
          this.switchTab(tab);
        }
      });
    });

    // Quick Import
    const quickImportBtn = this.rootEl.querySelector('#btn-quick-import');
    const fileInput = this.rootEl.querySelector<HTMLInputElement>('#file-input-media')!;
    quickImportBtn?.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files[0]) {
        this.handleFileImport(files[0]);
      }
    });

    // Quick Export
    const quickExportBtn = this.rootEl.querySelector('#btn-quick-export');
    quickExportBtn?.addEventListener('click', () => this.openExportModal());
  }

  private switchTab(tab: NavigationTab) {
    this.currentTab = tab;
    const navItems = this.rootEl.querySelectorAll<HTMLElement>('.nav-item');
    navItems.forEach((item) => {
      if (item.dataset.tab === tab) item.classList.add('active');
      else item.classList.remove('active');
    });
    this.renderCurrentView();
  }

  private bindTransportControls() {
    const playBtn = this.rootEl.querySelector('#btn-transport-play')!;
    const stopBtn = this.rootEl.querySelector('#btn-transport-stop')!;
    const loopBtn = this.rootEl.querySelector<HTMLElement>('#btn-transport-loop')!;
    const volSlider = this.rootEl.querySelector<HTMLInputElement>('#master-volume-slider')!;

    playBtn.addEventListener('click', () => {
      if (this.isPlaying) this.pausePlayback();
      else this.startPlayback();
    });

    stopBtn.addEventListener('click', () => this.stopPlayback());

    loopBtn.addEventListener('click', () => {
      this.isLooping = !this.isLooping;
      loopBtn.classList.toggle('active', this.isLooping);
      loopBtn.style.color = this.isLooping ? 'var(--accent-cyan)' : 'var(--text-secondary)';
    });

    volSlider.addEventListener('input', () => {
      const val = parseFloat(volSlider.value);
      this.masterGainNode.gain.setValueAtTime(val, getAudioContext().currentTime);
    });
  }

  private bindGlobalKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ignore if inside an input or textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.isPlaying) this.pausePlayback();
        else this.startPlayback();
      } else if (e.code === 'KeyS') {
        this.stopPlayback();
      } else if (e.code === 'KeyL') {
        const loopBtn = this.rootEl.querySelector<HTMLElement>('#btn-transport-loop');
        loopBtn?.click();
      } else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
        if (e.shiftKey) this.handleRedo();
        else this.handleUndo();
      }
    });
  }

  // File Import Logic
  private async handleFileImport(file: File) {
    try {
      const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm)$/i.test(file.name);

      if (isVideo) {
        // Probe video
        this.currentVideoMeta = await probeVideoFile(file);
        // Switch to video tab or extract audio
        this.switchTab('video-tools');
      }

      // Try decoding audio track
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await decodeAudio(arrayBuffer);

      this.originalBuffer = cloneAudioBuffer(audioBuffer);
      this.currentBuffer = audioBuffer;
      this.undoStack = [];
      this.redoStack = [];

      this.audioMeta = {
        name: file.name,
        size: file.size,
        type: file.type || 'audio/wav',
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
      };

      // Add to recent items in IndexedDB
      await addRecentItem({
        name: file.name,
        size: file.size,
        type: file.type || 'audio/wav',
        duration: audioBuffer.duration,
      });

      this.updateBottomBarTrackInfo();
      this.renderCurrentView();

      if (!isVideo && this.currentTab === 'home') {
        this.switchTab('audio-editor');
      }
    } catch (err) {
      alert(`Error loading media file: ${(err as Error).message || err}`);
    }
  }

  private updateBottomBarTrackInfo() {
    const nameEl = this.rootEl.querySelector('#player-track-name');
    const metaEl = this.rootEl.querySelector('#player-track-meta');
    const totalEl = this.rootEl.querySelector('#timecode-total');

    if (this.audioMeta && this.currentBuffer) {
      if (nameEl) nameEl.textContent = this.audioMeta.name;
      const sizeMb = (this.audioMeta.size / (1024 * 1024)).toFixed(1);
      const chStr = this.audioMeta.channels === 1 ? 'Mono' : 'Stereo';
      if (metaEl) metaEl.textContent = `${this.formatTimecode(this.currentBuffer.duration)} | ${this.audioMeta.sampleRate}Hz ${chStr} | ${sizeMb}MB`;
      if (totalEl) totalEl.textContent = this.formatTimecode(this.currentBuffer.duration);
    }
  }

  // Playback Engine
  private startPlayback(seekTime?: number) {
    const buffer = this.isVoiceAbOriginal ? this.originalBuffer : (this.voiceProcessedBuffer || this.currentBuffer);
    if (!buffer) return;

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    this.stopActiveSource();

    const startTime = seekTime !== undefined ? seekTime : this.playbackPauseOffset;
    if (startTime >= buffer.duration) {
      this.playbackPauseOffset = 0;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = this.isLooping;

    // Connect to effects graph
    source.connect(this.effectsGraph.inputNode);

    const actualOffset = seekTime !== undefined ? seekTime : this.playbackPauseOffset;
    source.start(0, actualOffset);

    this.activeSourceNode = source;
    this.playbackStartTime = ctx.currentTime - actualOffset;
    this.isPlaying = true;

    source.onended = () => {
      if (!this.isLooping && this.isPlaying) {
        this.stopPlayback();
      }
    };

    // Update UI Icon
    const playIcon = this.rootEl.querySelector('#play-icon');
    if (playIcon) {
      playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
    }

    this.visualizer?.start();
  }

  private pausePlayback() {
    if (!this.isPlaying) return;
    const ctx = getAudioContext();
    this.playbackPauseOffset = (ctx.currentTime - this.playbackStartTime) % (this.currentBuffer?.duration || 1);
    this.stopActiveSource();
    this.isPlaying = false;

    const playIcon = this.rootEl.querySelector('#play-icon');
    if (playIcon) {
      playIcon.innerHTML = '<polygon points="6 3 20 12 6 21 6 3"></polygon>';
    }
  }

  private stopPlayback() {
    this.stopActiveSource();
    this.playbackPauseOffset = 0;
    this.isPlaying = false;

    const playIcon = this.rootEl.querySelector('#play-icon');
    if (playIcon) {
      playIcon.innerHTML = '<polygon points="6 3 20 12 6 21 6 3"></polygon>';
    }

    const currentEl = this.rootEl.querySelector('#timecode-current');
    if (currentEl) currentEl.textContent = '00:00.000';
    this.waveformEditor?.setPlayheadTime(0);
    this.visualizer?.stop();
  }

  private stopActiveSource() {
    if (this.activeSourceNode) {
      try {
        this.activeSourceNode.stop();
        this.activeSourceNode.disconnect();
      } catch {
        // Ignored
      }
      this.activeSourceNode = null;
    }
  }

  private startPlaybackMeterLoop() {
    const leftMeter = this.rootEl.querySelector<HTMLElement>('#meter-left');
    const rightMeter = this.rootEl.querySelector<HTMLElement>('#meter-right');
    const timecodeCurrent = this.rootEl.querySelector<HTMLElement>('#timecode-current');
    const timeData = new Uint8Array(64);

    const update = () => {
      if (this.isPlaying && this.currentBuffer) {
        const ctx = getAudioContext();
        const curTime = (ctx.currentTime - this.playbackStartTime) % this.currentBuffer.duration;
        if (timecodeCurrent) {
          timecodeCurrent.textContent = this.formatTimecode(curTime);
        }
        this.waveformEditor?.setPlayheadTime(curTime);

        // Calculate peak level from analyser
        this.analyserNode.getByteTimeDomainData(timeData);
        let peak = 0;
        for (let i = 0; i < timeData.length; i++) {
          const val = Math.abs(timeData[i] - 128) / 128;
          if (val > peak) peak = val;
        }

        const pct = Math.min(100, Math.round(peak * 115));
        if (leftMeter) leftMeter.style.width = `${pct}%`;
        if (rightMeter) rightMeter.style.width = `${Math.min(100, Math.round(pct * 0.95))}%`;
      } else {
        if (leftMeter && leftMeter.style.width !== '0%') leftMeter.style.width = '0%';
        if (rightMeter && rightMeter.style.width !== '0%') rightMeter.style.width = '0%';
      }
      requestAnimationFrame(update);
    };
    update();
  }

  // History stack
  private pushUndoState() {
    if (this.currentBuffer) {
      this.undoStack.push(cloneAudioBuffer(this.currentBuffer));
      if (this.undoStack.length > 20) this.undoStack.shift();
      this.redoStack = [];
    }
  }

  private handleUndo() {
    if (this.undoStack.length > 0 && this.currentBuffer) {
      this.redoStack.push(cloneAudioBuffer(this.currentBuffer));
      this.currentBuffer = this.undoStack.pop()!;
      this.waveformEditor?.setAudioBuffer(this.currentBuffer);
      this.updateBottomBarTrackInfo();
    }
  }

  private handleRedo() {
    if (this.redoStack.length > 0 && this.currentBuffer) {
      this.undoStack.push(cloneAudioBuffer(this.currentBuffer));
      this.currentBuffer = this.redoStack.pop()!;
      this.waveformEditor?.setAudioBuffer(this.currentBuffer);
      this.updateBottomBarTrackInfo();
    }
  }

  // RENDER DYNAMIC VIEWS
  private renderCurrentView() {
    const container = this.rootEl.querySelector<HTMLElement>('#workspace-content')!;
    if (!container) return;
    container.innerHTML = '';

    switch (this.currentTab) {
      case 'home':
        this.renderHomeView(container);
        break;
      case 'audio-editor':
        this.renderAudioEditorView(container);
        break;
      case 'voice-lab':
        this.renderVoiceLabView(container);
        break;
      case 'audio-effects':
        this.renderAudioEffectsView(container);
        break;
      case 'video-tools':
        this.renderVideoToolsView(container);
        break;
      case 'sound-lab':
        this.renderSoundLabView(container);
        break;
      case 'settings':
        this.renderSettingsView(container);
        break;
    }
  }

  // 1. Home View
  private async renderHomeView(container: HTMLElement) {
    const recents = await getRecentItems();

    container.innerHTML = `
      <div class="panel-card">
        <div class="panel-header">
          <div>
            <div class="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
              Welcome to SonicForge Studio
            </div>
            <div class="panel-description">High-performance offline digital audio workstation and video toolbox.</div>
          </div>
        </div>

        <div class="dropzone" id="home-dropzone">
          <svg class="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <div style="font-size:14px;font-weight:600;">Drag and drop audio or video files here</div>
          <div style="font-size:12px;color:var(--text-muted);">Supports WAV, MP3, M4A, FLAC, OGG, MP4, MOV, MKV, WebM</div>
          <button class="btn btn-primary btn-sm" id="btn-browse-home">Browse Laptop Files</button>
        </div>
      </div>

      <!-- Quick Launch Modules -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
        <div class="panel-card" style="cursor:pointer;" id="card-voice-lab">
          <div style="color:var(--accent-cyan);font-weight:600;display:flex;align-items:center;gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
            Voice Lab
          </div>
          <div style="font-size:12px;color:var(--text-muted);">Non-AI vocal transformation: Male-Female, Deep, Robot, Formant scaling.</div>
        </div>

        <div class="panel-card" style="cursor:pointer;" id="card-audio-editor">
          <div style="color:var(--accent-emerald);font-weight:600;display:flex;align-items:center;gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 10v3"></path><path d="M6 6v11"></path><path d="M10 3v18"></path><path d="M14 8v7"></path><path d="M18 5v13"></path><path d="M22 10v3"></path></svg>
            Audio Editor
          </div>
          <div style="font-size:12px;color:var(--text-muted);">Trim, cut, split, reverse, speed adjust, fade curves, and multi-track merge.</div>
        </div>

        <div class="panel-card" style="cursor:pointer;" id="card-video-tools">
          <div style="color:var(--accent-amber);font-weight:600;display:flex;align-items:center;gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="6"></line><line x1="17" y1="2" x2="17" y2="6"></line></svg>
            Video Tools
          </div>
          <div style="font-size:12px;color:var(--text-muted);">Extract audio tracks, lossless video muting, audio replacement, and trimming.</div>
        </div>

        <div class="panel-card" style="cursor:pointer;" id="card-sound-lab">
          <div style="color:var(--accent-rose);font-weight:600;display:flex;align-items:center;gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
            Sound Lab & Synth
          </div>
          <div style="font-size:12px;color:var(--text-muted);">Oscillator tones, white/pink noise synthesis, live spectrum analyzer, and soundboard.</div>
        </div>
      </div>

      <!-- Recent Sessions -->
      <div class="panel-card">
        <div class="panel-header">
          <div class="panel-title">Recent Local Files</div>
        </div>
        <div id="recent-files-list">
          ${recents.length === 0 ? '<div style="color:var(--text-muted);font-size:12px;">No recent files processed yet.</div>' : `
            <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
              <thead>
                <tr style="color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
                  <th style="padding:6px 8px;">Filename</th>
                  <th style="padding:6px 8px;">Duration</th>
                  <th style="padding:6px 8px;">Size</th>
                  <th style="padding:6px 8px;">Processed Date</th>
                </tr>
              </thead>
              <tbody>
                ${recents.map((r: RecentItem) => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                    <td style="padding:8px;font-weight:500;">${r.name}</td>
                    <td style="padding:8px;font-family:var(--font-mono);">${this.formatTimecode(r.duration)}</td>
                    <td style="padding:8px;color:var(--text-muted);">${(r.size / (1024 * 1024)).toFixed(2)} MB</td>
                    <td style="padding:8px;color:var(--text-muted);">${new Date(r.timestamp).toLocaleDateString()}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>
    `;

    // Dropzone setup
    const dz = container.querySelector('#home-dropzone')!;
    const browseBtn = container.querySelector('#btn-browse-home')!;
    const fileInput = this.rootEl.querySelector<HTMLInputElement>('#file-input-media')!;

    browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
    dz.addEventListener('click', () => fileInput.click());
    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('drag-active');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-active'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-active');
      const files = (e as DragEvent).dataTransfer?.files;
      if (files && files[0]) this.handleFileImport(files[0]);
    });

    // Quick launch handlers
    container.querySelector('#card-voice-lab')?.addEventListener('click', () => this.switchTab('voice-lab'));
    container.querySelector('#card-audio-editor')?.addEventListener('click', () => this.switchTab('audio-editor'));
    container.querySelector('#card-video-tools')?.addEventListener('click', () => this.switchTab('video-tools'));
    container.querySelector('#card-sound-lab')?.addEventListener('click', () => this.switchTab('sound-lab'));
  }

  // 2. Audio Editor View
  private renderAudioEditorView(container: HTMLElement) {
    container.innerHTML = `
      <div class="panel-card">
        <div class="panel-header">
          <div class="panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 10v3"></path><path d="M6 6v11"></path><path d="M10 3v18"></path><path d="M14 8v7"></path><path d="M18 5v13"></path><path d="M22 10v3"></path></svg>
            Waveform Audio Editor
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm" id="btn-undo" title="Undo (Ctrl+Z)">Undo</button>
            <button class="btn btn-sm" id="btn-redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
            <button class="btn btn-sm btn-danger" id="btn-reset-edits">Reset All Edits</button>
          </div>
        </div>

        <!-- Waveform Canvas Box -->
        <div class="waveform-container">
          <div class="waveform-toolbar">
            <div class="waveform-actions">
              <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);" id="selection-info-text">
                No selection (drag across waveform to select)
              </span>
            </div>
            <div class="waveform-actions">
              <button class="btn btn-sm" id="btn-zoom-out" style="padding:2px 8px;">−</button>
              <span style="font-size:11px;font-family:var(--font-mono);" id="zoom-level-text">1.0x</span>
              <button class="btn btn-sm" id="btn-zoom-in" style="padding:2px 8px;">+</button>
            </div>
          </div>
          <canvas class="waveform-canvas" id="editor-waveform-canvas"></canvas>
        </div>

        <!-- Editing Operation Toolstrip -->
        <div style="display:flex;flex-wrap:wrap;gap:8px;padding-top:4px;">
          <button class="btn btn-sm" id="btn-op-trim" title="Keep only selected range">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>
            Trim / Crop Selection
          </button>
          <button class="btn btn-sm" id="btn-op-cut" title="Delete selected range and join">
            Cut Selection
          </button>
          <button class="btn btn-sm" id="btn-op-reverse" title="Reverse audio">
            Reverse
          </button>
          <button class="btn btn-sm" id="btn-op-fade-in" title="Apply 1.5s Fade In">
            Fade In (1.5s)
          </button>
          <button class="btn btn-sm" id="btn-op-fade-out" title="Apply 1.5s Fade Out">
            Fade Out (1.5s)
          </button>
          <button class="btn btn-sm" id="btn-op-gain-boost" title="+3 dB Gain">
            Boost Gain (+3dB)
          </button>
          <button class="btn btn-sm" id="btn-op-gain-cut" title="-3 dB Gain">
            Reduce Gain (-3dB)
          </button>
          <button class="btn btn-sm" id="btn-op-merge-file" title="Append or mix another audio file">
            Merge Track...
          </button>
        </div>
      </div>

      <!-- Playback Speed & Envelope Controls -->
      <div class="panel-card">
        <div class="panel-title">Playback Rate & Time Scaling</div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:12px;color:var(--text-secondary);">Speed Factor:</span>
          <button class="btn btn-sm" data-speed="0.5">0.5x</button>
          <button class="btn btn-sm" data-speed="0.75">0.75x</button>
          <button class="btn btn-sm btn-primary" data-speed="1.0">1.0x (Normal)</button>
          <button class="btn btn-sm" data-speed="1.25">1.25x</button>
          <button class="btn btn-sm" data-speed="1.5">1.5x</button>
          <button class="btn btn-sm" data-speed="2.0">2.0x</button>
        </div>
      </div>
    `;

    const canvas = container.querySelector<HTMLCanvasElement>('#editor-waveform-canvas')!;
    this.waveformEditor = new WaveformEditor(canvas);
    this.waveformEditor.setAudioBuffer(this.currentBuffer);

    // Waveform seek
    this.waveformEditor.onSeek((timeSec) => {
      this.playbackPauseOffset = timeSec;
      if (this.isPlaying) {
        this.startPlayback(timeSec);
      } else {
        const curEl = this.rootEl.querySelector('#timecode-current');
        if (curEl) curEl.textContent = this.formatTimecode(timeSec);
      }
    });

    // Selection change update
    const selInfo = container.querySelector('#selection-info-text');
    this.waveformEditor.onSelectionChange((sel) => {
      if (sel && selInfo) {
        const len = Math.abs(sel.end - sel.start);
        selInfo.textContent = `Selection: ${this.formatTimecode(sel.start)} → ${this.formatTimecode(sel.end)} (Δ ${len.toFixed(3)}s)`;
      } else if (selInfo) {
        selInfo.textContent = 'No selection (drag across waveform to select)';
      }
    });

    // Zoom buttons
    const zoomText = container.querySelector('#zoom-level-text')!;
    container.querySelector('#btn-zoom-in')?.addEventListener('click', () => {
      if (this.waveformEditor) {
        const nextZoom = this.waveformEditor.getZoom() * 1.5;
        this.waveformEditor.setZoom(nextZoom);
        zoomText.textContent = `${this.waveformEditor.getZoom().toFixed(1)}x`;
      }
    });
    container.querySelector('#btn-zoom-out')?.addEventListener('click', () => {
      if (this.waveformEditor) {
        const nextZoom = this.waveformEditor.getZoom() / 1.5;
        this.waveformEditor.setZoom(nextZoom);
        zoomText.textContent = `${this.waveformEditor.getZoom().toFixed(1)}x`;
      }
    });

    // Undo / Redo / Reset
    container.querySelector('#btn-undo')?.addEventListener('click', () => this.handleUndo());
    container.querySelector('#btn-redo')?.addEventListener('click', () => this.handleRedo());
    container.querySelector('#btn-reset-edits')?.addEventListener('click', () => {
      if (this.originalBuffer) {
        this.pushUndoState();
        this.currentBuffer = cloneAudioBuffer(this.originalBuffer);
        this.waveformEditor?.setAudioBuffer(this.currentBuffer);
        this.updateBottomBarTrackInfo();
      }
    });

    // Audio Editing Operations
    container.querySelector('#btn-op-trim')?.addEventListener('click', () => {
      const sel = this.waveformEditor?.getSelection();
      if (!this.currentBuffer || !sel) {
        alert('Please select a time region on the waveform first.');
        return;
      }
      this.pushUndoState();
      this.currentBuffer = cropAudioBuffer(this.currentBuffer, sel.start, sel.end);
      this.waveformEditor?.setAudioBuffer(this.currentBuffer);
      this.updateBottomBarTrackInfo();
    });

    container.querySelector('#btn-op-cut')?.addEventListener('click', () => {
      const sel = this.waveformEditor?.getSelection();
      if (!this.currentBuffer || !sel) {
        alert('Please select a time region on the waveform to cut.');
        return;
      }
      this.pushUndoState();
      this.currentBuffer = cutAudioBufferRange(this.currentBuffer, sel.start, sel.end);
      this.waveformEditor?.setAudioBuffer(this.currentBuffer);
      this.updateBottomBarTrackInfo();
    });

    container.querySelector('#btn-op-reverse')?.addEventListener('click', () => {
      if (!this.currentBuffer) return;
      const sel = this.waveformEditor?.getSelection();
      this.pushUndoState();
      this.currentBuffer = reverseAudioBuffer(
        this.currentBuffer,
        sel ? sel.start : undefined,
        sel ? sel.end : undefined
      );
      this.waveformEditor?.setAudioBuffer(this.currentBuffer);
    });

    container.querySelector('#btn-op-fade-in')?.addEventListener('click', () => {
      if (!this.currentBuffer) return;
      this.pushUndoState();
      this.currentBuffer = applyFadeIn(this.currentBuffer, 1.5);
      this.waveformEditor?.setAudioBuffer(this.currentBuffer);
    });

    container.querySelector('#btn-op-fade-out')?.addEventListener('click', () => {
      if (!this.currentBuffer) return;
      this.pushUndoState();
      this.currentBuffer = applyFadeOut(this.currentBuffer, 1.5);
      this.waveformEditor?.setAudioBuffer(this.currentBuffer);
    });

    container.querySelector('#btn-op-gain-boost')?.addEventListener('click', () => {
      if (!this.currentBuffer) return;
      this.pushUndoState();
      this.currentBuffer = applyGain(this.currentBuffer, 3);
      this.waveformEditor?.setAudioBuffer(this.currentBuffer);
    });

    container.querySelector('#btn-op-gain-cut')?.addEventListener('click', () => {
      if (!this.currentBuffer) return;
      this.pushUndoState();
      this.currentBuffer = applyGain(this.currentBuffer, -3);
      this.waveformEditor?.setAudioBuffer(this.currentBuffer);
    });

    // Merge Secondary Track
    const secInput = this.rootEl.querySelector<HTMLInputElement>('#file-input-secondary')!;
    container.querySelector('#btn-op-merge-file')?.addEventListener('click', () => {
      secInput.click();
    });
    secInput.onchange = async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f && this.currentBuffer) {
        try {
          const ab = await f.arrayBuffer();
          const secondBuf = await decodeAudio(ab);
          this.pushUndoState();
          this.currentBuffer = mergeAudioBuffers([this.currentBuffer, secondBuf], 'sequential');
          this.waveformEditor?.setAudioBuffer(this.currentBuffer);
          this.updateBottomBarTrackInfo();
          alert(`Successfully merged "${f.name}" to audio buffer!`);
        } catch (err) {
          alert(`Failed to merge audio: ${(err as Error).message}`);
        }
      }
    };

    // Speed factors
    container.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        const factor = parseFloat(btn.dataset.speed || '1.0');
        if (!this.currentBuffer) return;
        this.pushUndoState();
        this.currentBuffer = applySpeedChange(this.currentBuffer, factor);
        this.waveformEditor?.setAudioBuffer(this.currentBuffer);
        this.updateBottomBarTrackInfo();
      });
    });
  }

  // 3. Voice Lab View
  private renderVoiceLabView(container: HTMLElement) {
    container.innerHTML = `
      <div class="panel-card">
        <div class="panel-header">
          <div>
            <div class="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
              Voice Lab — Non-AI Digital Signal Processing
            </div>
            <div class="panel-description">
              High-accuracy WSOLA pitch-shifting and vocal tract formant filtering without neural networks or cloud services.
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-sm ${this.isVoiceAbOriginal ? 'btn-primary' : ''}" id="btn-voice-ab">
              A/B Comparison: ${this.isVoiceAbOriginal ? 'ORIGINAL' : 'PROCESSED'}
            </button>
            <button class="btn btn-sm btn-danger" id="btn-voice-reset">Reset</button>
          </div>
        </div>

        <!-- Presets Selection Grid -->
        <div class="preset-grid">
          ${VOICE_PRESETS.map((p) => `
            <div class="preset-card ${this.selectedVoicePreset.id === p.id ? 'active' : ''}" data-preset-id="${p.id}">
              <div class="preset-name">${p.name}</div>
              <div class="preset-desc">${p.description}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Configurable DSP Controls -->
      <div class="panel-card">
        <div class="panel-title">Acoustic Parameters & Formant Adjustments</div>
        <div class="controls-grid">
          <!-- Pitch Shift Semitones -->
          <div class="control-item">
            <div class="control-label-row">
              <span class="control-label">Pitch Shift</span>
              <span class="control-value" id="val-pitch">${this.selectedVoicePreset.pitchSemitones > 0 ? '+' : ''}${this.selectedVoicePreset.pitchSemitones} st</span>
            </div>
            <input type="range" class="slider-input" id="slider-pitch" min="-24" max="24" step="0.5" value="${this.selectedVoicePreset.pitchSemitones}">
          </div>

          <!-- Formant Shift Factor -->
          <div class="control-item">
            <div class="control-label-row">
              <span class="control-label">Formant Scale Factor</span>
              <span class="control-value" id="val-formant">${this.selectedVoicePreset.formantShift.toFixed(2)}x</span>
            </div>
            <input type="range" class="slider-input" id="slider-formant" min="0.6" max="1.6" step="0.02" value="${this.selectedVoicePreset.formantShift}">
          </div>

          <!-- Resonance Frequency -->
          <div class="control-item">
            <div class="control-label-row">
              <span class="control-label">Resonance Peak Center</span>
              <span class="control-value" id="val-res-freq">${this.selectedVoicePreset.resonanceFreq} Hz</span>
            </div>
            <input type="range" class="slider-input" id="slider-res-freq" min="80" max="6000" step="20" value="${this.selectedVoicePreset.resonanceFreq}">
          </div>

          <!-- Resonance Gain -->
          <div class="control-item">
            <div class="control-label-row">
              <span class="control-label">Resonance Boost/Cut</span>
              <span class="control-value" id="val-res-gain">${this.selectedVoicePreset.resonanceGain} dB</span>
            </div>
            <input type="range" class="slider-input" id="slider-res-gain" min="-12" max="12" step="0.5" value="${this.selectedVoicePreset.resonanceGain}">
          </div>

          <!-- Wet/Dry Mix -->
          <div class="control-item">
            <div class="control-label-row">
              <span class="control-label">Dry / Wet Mix</span>
              <span class="control-value" id="val-mix">${Math.round(this.selectedVoicePreset.mix * 100)}%</span>
            </div>
            <input type="range" class="slider-input" id="slider-mix" min="0" max="1" step="0.05" value="${this.selectedVoicePreset.mix}">
          </div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;padding-top:12px;border-top:1px solid var(--border-subtle);">
          <div style="font-size:11px;color:var(--text-muted);max-width:550px;">
            Traditional DSP modifies vocal characteristics (formants, fundamentals, harmonics) without neural networks. Results depend on voice input characteristics.
          </div>
          <button class="btn btn-primary" id="btn-apply-voice-dsp">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Apply & Render Voice Effect
          </button>
        </div>

        <!-- Render Progress -->
        <div id="voice-progress-box" style="display:none;margin-top:10px;">
          <div class="progress-container">
            <div class="progress-bar-fill" id="voice-progress-bar"></div>
          </div>
          <div style="font-size:11px;color:var(--accent-cyan);margin-top:4px;" id="voice-progress-text">Processing DSP...</div>
        </div>
      </div>
    `;

    // Presets Click
    container.querySelectorAll<HTMLElement>('.preset-card').forEach((card) => {
      card.addEventListener('click', () => {
        const pId = card.dataset.presetId;
        const preset = VOICE_PRESETS.find(p => p.id === pId);
        if (preset) {
          this.selectedVoicePreset = JSON.parse(JSON.stringify(preset));
          this.renderVoiceLabView(container);
        }
      });
    });

    // Sliders
    const pitchSlider = container.querySelector<HTMLInputElement>('#slider-pitch')!;
    const pitchVal = container.querySelector('#val-pitch')!;
    pitchSlider.addEventListener('input', () => {
      this.selectedVoicePreset.pitchSemitones = parseFloat(pitchSlider.value);
      pitchVal.textContent = `${this.selectedVoicePreset.pitchSemitones > 0 ? '+' : ''}${this.selectedVoicePreset.pitchSemitones} st`;
    });

    const formantSlider = container.querySelector<HTMLInputElement>('#slider-formant')!;
    const formantVal = container.querySelector('#val-formant')!;
    formantSlider.addEventListener('input', () => {
      this.selectedVoicePreset.formantShift = parseFloat(formantSlider.value);
      formantVal.textContent = `${this.selectedVoicePreset.formantShift.toFixed(2)}x`;
    });

    const resFreqSlider = container.querySelector<HTMLInputElement>('#slider-res-freq')!;
    const resFreqVal = container.querySelector('#val-res-freq')!;
    resFreqSlider.addEventListener('input', () => {
      this.selectedVoicePreset.resonanceFreq = parseFloat(resFreqSlider.value);
      resFreqVal.textContent = `${this.selectedVoicePreset.resonanceFreq} Hz`;
    });

    const resGainSlider = container.querySelector<HTMLInputElement>('#slider-res-gain')!;
    const resGainVal = container.querySelector('#val-res-gain')!;
    resGainSlider.addEventListener('input', () => {
      this.selectedVoicePreset.resonanceGain = parseFloat(resGainSlider.value);
      resGainVal.textContent = `${this.selectedVoicePreset.resonanceGain} dB`;
    });

    const mixSlider = container.querySelector<HTMLInputElement>('#slider-mix')!;
    const mixVal = container.querySelector('#val-mix')!;
    mixSlider.addEventListener('input', () => {
      this.selectedVoicePreset.mix = parseFloat(mixSlider.value);
      mixVal.textContent = `${Math.round(this.selectedVoicePreset.mix * 100)}%`;
    });

    // A/B Comparison Toggle
    container.querySelector('#btn-voice-ab')?.addEventListener('click', () => {
      this.isVoiceAbOriginal = !this.isVoiceAbOriginal;
      const abBtn = container.querySelector<HTMLButtonElement>('#btn-voice-ab');
      if (abBtn) {
        abBtn.textContent = `A/B Comparison: ${this.isVoiceAbOriginal ? 'ORIGINAL' : 'PROCESSED'}`;
        abBtn.classList.toggle('btn-primary', this.isVoiceAbOriginal);
      }
      if (this.isPlaying) {
        this.startPlayback(this.playbackPauseOffset);
      }
    });

    // Reset
    container.querySelector('#btn-voice-reset')?.addEventListener('click', () => {
      this.selectedVoicePreset = JSON.parse(JSON.stringify(VOICE_PRESETS[0]));
      this.voiceProcessedBuffer = null;
      this.isVoiceAbOriginal = false;
      this.renderVoiceLabView(container);
    });

    // Apply & Render Voice DSP
    container.querySelector('#btn-apply-voice-dsp')?.addEventListener('click', async () => {
      if (!this.currentBuffer) {
        alert('Please import an audio file first.');
        return;
      }
      const pBox = container.querySelector<HTMLElement>('#voice-progress-box')!;
      const pBar = container.querySelector<HTMLElement>('#voice-progress-bar')!;
      const pText = container.querySelector<HTMLElement>('#voice-progress-text')!;
      pBox.style.display = 'block';

      try {
        const processed = await processVoiceLabBuffer(
          this.currentBuffer,
          this.selectedVoicePreset,
          (pct) => {
            pBar.style.width = `${pct}%`;
            pText.textContent = `Processing DSP: ${pct}%`;
          }
        );

        this.pushUndoState();
        this.voiceProcessedBuffer = processed;
        this.currentBuffer = processed;
        this.isVoiceAbOriginal = false;

        pText.textContent = 'Voice processing completed successfully!';
        setTimeout(() => { pBox.style.display = 'none'; }, 2000);
      } catch (err) {
        alert(`DSP Processing error: ${(err as Error).message}`);
        pBox.style.display = 'none';
      }
    });
  }

  // 4. Audio Effects View
  private renderAudioEffectsView(container: HTMLElement) {
    container.innerHTML = `
      <div class="panel-card">
        <div class="panel-header">
          <div>
            <div class="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line></svg>
              Audio Effects Studio
            </div>
            <div class="panel-description">Studio-grade real-time node graph with master bypass and offline rendering.</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-sm ${this.effectsConfig.bypassAll ? 'btn-danger' : ''}" id="btn-bypass-effects">
              ${this.effectsConfig.bypassAll ? 'BYPASS ACTIVE' : 'Bypass All Effects'}
            </button>
            <button class="btn btn-sm btn-primary" id="btn-bake-effects">
              Bake Effects into Audio
            </button>
          </div>
        </div>

        <!-- 3-Band Master Equalizer -->
        <div class="panel-card" style="margin-top:4px;">
          <div class="panel-title">3-Band Master Equalizer</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
            <div class="control-item">
              <div class="control-label-row"><span class="control-label">Low (100Hz)</span><span class="control-value" id="val-eq-low">${this.effectsConfig.eq3.low} dB</span></div>
              <input type="range" class="slider-input" id="eq3-low" min="-18" max="18" step="0.5" value="${this.effectsConfig.eq3.low}">
            </div>
            <div class="control-item">
              <div class="control-label-row"><span class="control-label">Mid (1000Hz)</span><span class="control-value" id="val-eq-mid">${this.effectsConfig.eq3.mid} dB</span></div>
              <input type="range" class="slider-input" id="eq3-mid" min="-18" max="18" step="0.5" value="${this.effectsConfig.eq3.mid}">
            </div>
            <div class="control-item">
              <div class="control-label-row"><span class="control-label">High (4000Hz)</span><span class="control-value" id="val-eq-high">${this.effectsConfig.eq3.high} dB</span></div>
              <input type="range" class="slider-input" id="eq3-high" min="-18" max="18" step="0.5" value="${this.effectsConfig.eq3.high}">
            </div>
          </div>
        </div>

        <!-- 10-Band Graphic Equalizer -->
        <div class="panel-card">
          <div class="panel-title">10-Band Graphic Equalizer (ISO Standard)</div>
          <div style="display:grid;grid-template-columns:repeat(10,1fr);gap:6px;">
            ${EQ10_FREQUENCIES.map((freq, idx) => `
              <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
                <span style="font-size:10px;font-family:var(--font-mono);color:var(--text-muted);">${freq >= 1000 ? `${freq/1000}k` : freq}</span>
                <input type="range" class="slider-input" style="height:100px;writing-mode:vertical-lr;direction:rtl;" data-eq10-idx="${idx}" min="-15" max="15" step="0.5" value="${this.effectsConfig.eq10.bands[idx] || 0}">
                <span style="font-size:10px;font-family:var(--font-mono);color:var(--accent-cyan);" id="eq10-val-${idx}">${this.effectsConfig.eq10.bands[idx] || 0}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Filters, Reverb, Delay & Dynamics -->
        <div class="controls-grid">
          <!-- Lowpass Filter -->
          <div class="control-item">
            <div class="control-label-row">
              <span class="control-label">Lowpass Filter</span>
              <span class="control-value" id="val-lp-freq">${this.effectsConfig.filter.lowpassFreq} Hz</span>
            </div>
            <input type="range" class="slider-input" id="lp-freq" min="500" max="20000" step="100" value="${this.effectsConfig.filter.lowpassFreq}">
          </div>

          <!-- Highpass Filter -->
          <div class="control-item">
            <div class="control-label-row">
              <span class="control-label">Highpass Filter</span>
              <span class="control-value" id="val-hp-freq">${this.effectsConfig.filter.highpassFreq} Hz</span>
            </div>
            <input type="range" class="slider-input" id="hp-freq" min="20" max="2000" step="10" value="${this.effectsConfig.filter.highpassFreq}">
          </div>

          <!-- Algorithmic Reverb -->
          <div class="control-item">
            <div class="control-label-row">
              <span class="control-label">Reverb Wet Mix</span>
              <span class="control-value" id="val-reverb-wet">${Math.round(this.effectsConfig.reverb.wet * 100)}%</span>
            </div>
            <input type="range" class="slider-input" id="reverb-wet" min="0" max="1" step="0.02" value="${this.effectsConfig.reverb.wet}">
          </div>

          <!-- Echo & Delay -->
          <div class="control-item">
            <div class="control-label-row">
              <span class="control-label">Delay Wet Mix</span>
              <span class="control-value" id="val-delay-wet">${Math.round(this.effectsConfig.delay.wet * 100)}%</span>
            </div>
            <input type="range" class="slider-input" id="delay-wet" min="0" max="1" step="0.02" value="${this.effectsConfig.delay.wet}">
          </div>

          <!-- Dynamics Compressor Threshold -->
          <div class="control-item">
            <div class="control-label-row">
              <span class="control-label">Compressor Threshold</span>
              <span class="control-value" id="val-comp-thresh">${this.effectsConfig.compressor.threshold} dB</span>
            </div>
            <input type="range" class="slider-input" id="comp-thresh" min="-60" max="0" step="1" value="${this.effectsConfig.compressor.threshold}">
          </div>

          <!-- Limiter Ceiling -->
          <div class="control-item">
            <div class="control-label-row">
              <span class="control-label">Peak Limiter Ceiling</span>
              <span class="control-value" id="val-limiter">${this.effectsConfig.limiter.threshold} dB</span>
            </div>
            <input type="range" class="slider-input" id="limiter-thresh" min="-6" max="0" step="0.1" value="${this.effectsConfig.limiter.threshold}">
          </div>
        </div>
      </div>
    `;

    // 3-Band EQ Sliders
    const bindSlider = (id: string, valId: string, unit: string, cb: (v: number) => void) => {
      const s = container.querySelector<HTMLInputElement>(`#${id}`)!;
      const v = container.querySelector(`#${valId}`)!;
      s.addEventListener('input', () => {
        const num = parseFloat(s.value);
        v.textContent = `${num} ${unit}`;
        cb(num);
        this.effectsGraph.updateConfig(this.effectsConfig);
      });
    };

    bindSlider('eq3-low', 'val-eq-low', 'dB', (val) => { this.effectsConfig.eq3.low = val; });
    bindSlider('eq3-mid', 'val-eq-mid', 'dB', (val) => { this.effectsConfig.eq3.mid = val; });
    bindSlider('eq3-high', 'val-eq-high', 'dB', (val) => { this.effectsConfig.eq3.high = val; });

    // 10-Band EQ Sliders
    container.querySelectorAll<HTMLInputElement>('[data-eq10-idx]').forEach(slider => {
      slider.addEventListener('input', () => {
        const idx = parseInt(slider.dataset.eq10Idx || '0', 10);
        const val = parseFloat(slider.value);
        this.effectsConfig.eq10.bands[idx] = val;
        const vEl = container.querySelector(`#eq10-val-${idx}`);
        if (vEl) vEl.textContent = val.toString();
        this.effectsGraph.updateConfig(this.effectsConfig);
      });
    });

    // Other controls
    bindSlider('lp-freq', 'val-lp-freq', 'Hz', (val) => {
      this.effectsConfig.filter.lowpassEnabled = val < 19000;
      this.effectsConfig.filter.lowpassFreq = val;
    });
    bindSlider('hp-freq', 'val-hp-freq', 'Hz', (val) => {
      this.effectsConfig.filter.highpassEnabled = val > 25;
      this.effectsConfig.filter.highpassFreq = val;
    });
    bindSlider('reverb-wet', 'val-reverb-wet', '%', (val) => {
      this.effectsConfig.reverb.enabled = val > 0.01;
      this.effectsConfig.reverb.wet = val;
    });
    bindSlider('delay-wet', 'val-delay-wet', '%', (val) => {
      this.effectsConfig.delay.enabled = val > 0.01;
      this.effectsConfig.delay.wet = val;
    });
    bindSlider('comp-thresh', 'val-comp-thresh', 'dB', (val) => {
      this.effectsConfig.compressor.enabled = val < -1;
      this.effectsConfig.compressor.threshold = val;
    });
    bindSlider('limiter-thresh', 'val-limiter', 'dB', (val) => {
      this.effectsConfig.limiter.threshold = val;
    });

    // Bypass
    container.querySelector('#btn-bypass-effects')?.addEventListener('click', () => {
      this.effectsConfig.bypassAll = !this.effectsConfig.bypassAll;
      this.effectsGraph.updateConfig(this.effectsConfig);
      const bBtn = container.querySelector<HTMLButtonElement>('#btn-bypass-effects');
      if (bBtn) {
        bBtn.textContent = this.effectsConfig.bypassAll ? 'BYPASS ACTIVE' : 'Bypass All Effects';
        bBtn.classList.toggle('btn-danger', this.effectsConfig.bypassAll);
      }
    });

    // Bake Effects into Audio
    container.querySelector('#btn-bake-effects')?.addEventListener('click', async () => {
      if (!this.currentBuffer) {
        alert('Please import audio first.');
        return;
      }
      try {
        const baked = await renderEffectsOffline(this.currentBuffer, this.effectsConfig);
        this.pushUndoState();
        this.currentBuffer = baked;
        alert('All effects successfully rendered and baked into the active audio buffer!');
      } catch (err) {
        alert(`Failed to render effects: ${(err as Error).message}`);
      }
    });
  }

  // 5. Video Tools View
  private renderVideoToolsView(container: HTMLElement) {
    const video = this.currentVideoMeta;

    container.innerHTML = `
      <div class="panel-card">
        <div class="panel-header">
          <div>
            <div class="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="6"></line><line x1="17" y1="2" x2="17" y2="6"></line></svg>
              Video Processing Tools
            </div>
            <div class="panel-description">Extract audio, lossless video muting, audio replacement, and video trimming.</div>
          </div>
          <button class="btn btn-sm btn-primary" id="btn-import-video">Import Video</button>
        </div>

        ${!video ? `
          <div class="dropzone" id="video-dropzone">
            <svg class="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"></rect><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
            <div style="font-weight:600;">Import a video to process</div>
            <div style="font-size:12px;color:var(--text-muted);">Supports MP4, WebM, MOV, MKV</div>
          </div>
        ` : `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div>
              <video id="video-preview-player" src="${video.url}" controls style="width:100%;border-radius:var(--radius-md);background:#000;max-height:240px;"></video>
              <div style="font-size:11px;color:var(--text-muted);margin-top:6px;font-family:var(--font-mono);">
                ${video.name} | ${video.width}x${video.height} | ${this.formatTimecode(video.duration)} | ${(video.size / (1024*1024)).toFixed(1)} MB
              </div>
            </div>

            <!-- Video Actions -->
            <div style="display:flex;flex-direction:column;gap:10px;">
              <button class="btn btn-primary" id="btn-extract-audio">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                Extract Audio Track (to Editor)
              </button>

              <button class="btn" id="btn-mute-video">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                Mute Video (Lossless Stream Copy)
              </button>

              <button class="btn" id="btn-replace-audio">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                Replace Audio with Active Audio Track
              </button>

              <!-- Video Trim -->
              <div class="panel-card" style="padding:10px;margin-top:4px;">
                <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Trim Video Range</div>
                <div style="display:flex;gap:8px;align-items:center;">
                  <span style="font-size:11px;color:var(--text-muted);">Start:</span>
                  <input type="number" id="trim-start-sec" class="form-input" style="width:70px;padding:4px 6px;" value="0" min="0" step="0.5">
                  <span style="font-size:11px;color:var(--text-muted);">End:</span>
                  <input type="number" id="trim-end-sec" class="form-input" style="width:70px;padding:4px 6px;" value="${Math.min(30, Math.round(video.duration))}" min="1" step="0.5">
                  <button class="btn btn-sm" id="btn-trim-video">Trim Video</button>
                </div>
              </div>
            </div>
          </div>

          <div id="video-progress-box" style="display:none;margin-top:12px;">
            <div class="progress-container">
              <div class="progress-bar-fill" id="video-progress-bar"></div>
            </div>
            <div style="font-size:11px;color:var(--accent-cyan);margin-top:4px;" id="video-progress-text">Processing video...</div>
          </div>
        `}
      </div>
    `;

    const fileInput = this.rootEl.querySelector<HTMLInputElement>('#file-input-media')!;
    container.querySelector('#btn-import-video')?.addEventListener('click', () => fileInput.click());
    container.querySelector('#video-dropzone')?.addEventListener('click', () => fileInput.click());

    if (video && video.file) {
      const vFile = video.file;
      const pBox = container.querySelector<HTMLElement>('#video-progress-box')!;
      const pBar = container.querySelector<HTMLElement>('#video-progress-bar')!;
      const pText = container.querySelector<HTMLElement>('#video-progress-text')!;

      // Extract Audio
      container.querySelector('#btn-extract-audio')?.addEventListener('click', async () => {
        pBox.style.display = 'block';
        pText.textContent = 'Extracting audio track from video container...';
        try {
          const audioBuf = await extractAudioFromVideo(vFile, (pct) => {
            pBar.style.width = `${pct}%`;
          });
          this.originalBuffer = cloneAudioBuffer(audioBuf);
          this.currentBuffer = audioBuf;
          this.undoStack = [];
          this.redoStack = [];
          this.audioMeta = {
            name: `${video.name}_audio.wav`,
            size: audioBuf.length * 4,
            type: 'audio/wav',
            duration: audioBuf.duration,
            sampleRate: audioBuf.sampleRate,
            channels: audioBuf.numberOfChannels,
          };
          this.updateBottomBarTrackInfo();
          pText.textContent = 'Audio extracted successfully! Switching to Audio Editor...';
          setTimeout(() => this.switchTab('audio-editor'), 1000);
        } catch (err) {
          alert(`Extraction error: ${(err as Error).message}`);
          pBox.style.display = 'none';
        }
      });

      // Mute Video
      container.querySelector('#btn-mute-video')?.addEventListener('click', async () => {
        pBox.style.display = 'block';
        pText.textContent = 'Muting video via stream copy...';
        try {
          const mutedBlob = await muteVideo(vFile, (pct) => {
            pBar.style.width = `${pct}%`;
          });
          triggerFileDownload(mutedBlob, `muted_${video.name}`);
          pText.textContent = 'Muted video downloaded!';
          setTimeout(() => { pBox.style.display = 'none'; }, 2000);
        } catch (err) {
          alert(`Mute error: ${(err as Error).message}`);
          pBox.style.display = 'none';
        }
      });

      // Replace Audio
      container.querySelector('#btn-replace-audio')?.addEventListener('click', async () => {
        if (!this.currentBuffer) {
          alert('No active audio buffer to replace into video. Please load or generate audio first.');
          return;
        }
        pBox.style.display = 'block';
        pText.textContent = 'Muxing video with current audio buffer...';
        try {
          const audioWavBlob = await exportAudio(this.currentBuffer, {
            filename: 'temp.wav',
            format: 'wav',
            sampleRate: 44100,
            channels: 2,
            normalizeAudio: false,
          });
          const resultBlob = await replaceVideoAudio(vFile, audioWavBlob, (pct) => {
            pBar.style.width = `${pct}%`;
          });
          triggerFileDownload(resultBlob, `remuxed_${video.name}`);
          pText.textContent = 'Audio replaced video downloaded!';
          setTimeout(() => { pBox.style.display = 'none'; }, 2000);
        } catch (err) {
          alert(`Replace audio error: ${(err as Error).message}`);
          pBox.style.display = 'none';
        }
      });

      // Trim Video
      container.querySelector('#btn-trim-video')?.addEventListener('click', async () => {
        const s = parseFloat((container.querySelector('#trim-start-sec') as HTMLInputElement).value) || 0;
        const e = parseFloat((container.querySelector('#trim-end-sec') as HTMLInputElement).value) || video.duration;
        if (e <= s) {
          alert('End time must be greater than start time.');
          return;
        }
        pBox.style.display = 'block';
        pText.textContent = `Trimming video from ${s}s to ${e}s...`;
        try {
          const trimmedBlob = await trimVideo(vFile, s, e, (pct) => {
            pBar.style.width = `${pct}%`;
          });
          triggerFileDownload(trimmedBlob, `trimmed_${video.name}`);
          pText.textContent = 'Trimmed video downloaded!';
          setTimeout(() => { pBox.style.display = 'none'; }, 2000);
        } catch (err) {
          alert(`Trim video error: ${(err as Error).message}`);
          pBox.style.display = 'none';
        }
      });
    }
  }

  // 6. Sound Lab View
  private renderSoundLabView(container: HTMLElement) {
    container.innerHTML = `
      <div class="panel-card">
        <div class="panel-header">
          <div>
            <div class="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
              Sound Lab — Synthesizer & Acoustic Analyzer
            </div>
            <div class="panel-description">Oscillator generator, Paul Kellet pink noise, live spectrum analyzer, and soundboard.</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm btn-primary" id="btn-toggle-viz-mode">
              Switch Mode (Spectrum / Waveform)
            </button>
          </div>
        </div>

        <!-- Realtime Spectrum Analyzer & Oscilloscope Canvas -->
        <div style="height:150px;background:#0d1117;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--border-subtle);position:relative;">
          <canvas id="sound-lab-canvas" style="width:100%;height:100%;display:block;"></canvas>
        </div>
      </div>

      <!-- Tone & Noise Generators -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <!-- Oscillator Generator -->
        <div class="panel-card">
          <div class="panel-title">Precision Tone Generator</div>
          <div class="controls-grid" style="grid-template-columns:1fr 1fr;">
            <div class="control-item">
              <span class="control-label">Waveform</span>
              <select class="form-select" id="synth-waveform">
                <option value="sine">Sine Wave (Pure)</option>
                <option value="square">Square Wave</option>
                <option value="triangle">Triangle Wave</option>
                <option value="sawtooth">Sawtooth Wave</option>
              </select>
            </div>

            <div class="control-item">
              <div class="control-label-row"><span class="control-label">Frequency</span><span class="control-value" id="val-synth-freq">440 Hz (A4)</span></div>
              <input type="range" class="slider-input" id="synth-freq" min="20" max="8000" step="5" value="440">
            </div>

            <div class="control-item">
              <div class="control-label-row"><span class="control-label">Amplitude</span><span class="control-value" id="val-synth-amp">50%</span></div>
              <input type="range" class="slider-input" id="synth-amp" min="0" max="1" step="0.05" value="0.5">
            </div>

            <div class="control-item">
              <div class="control-label-row"><span class="control-label">Duration</span><span class="control-value" id="val-synth-dur">3.0 s</span></div>
              <input type="range" class="slider-input" id="synth-dur" min="0.5" max="30" step="0.5" value="3">
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="btn btn-sm" id="btn-live-synth-preview">Start Live Tone</button>
            <button class="btn btn-sm btn-primary" id="btn-generate-tone-file">Generate & Load</button>
            <button class="btn btn-sm" id="btn-download-tone-wav">Download WAV</button>
          </div>
        </div>

        <!-- Noise Generator -->
        <div class="panel-card">
          <div class="panel-title">Noise Synthesis</div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div style="display:flex;gap:10px;">
              <button class="btn btn-sm" id="btn-gen-white-noise">White Noise (Flat)</button>
              <button class="btn btn-sm" id="btn-gen-pink-noise">Pink Noise (-3dB/Oct)</button>
            </div>
            <div class="control-item">
              <div class="control-label-row"><span class="control-label">Noise Duration</span><span class="control-value" id="val-noise-dur">5.0 s</span></div>
              <input type="range" class="slider-input" id="noise-dur" min="1" max="30" step="1" value="5">
            </div>
            <div style="font-size:11px;color:var(--text-muted);">
              Pink noise generates natural acoustic energy distribution (-3 dB per octave) via Paul Kellet's multi-pole filtering.
            </div>
          </div>
        </div>
      </div>

      <!-- Customizable 9-Pad Soundboard -->
      <div class="panel-card">
        <div class="panel-title">Interactive Soundboard (Keys 1 - 9)</div>
        <div class="soundboard-grid" id="soundboard-pad-grid">
          ${[
            { id: 1, label: 'Kick 60Hz', key: '1', freq: 60, wave: 'sine' },
            { id: 2, label: 'Bass 110Hz', key: '2', freq: 110, wave: 'triangle' },
            { id: 3, label: 'Lead 220Hz', key: '3', freq: 220, wave: 'sawtooth' },
            { id: 4, label: 'Chime 330Hz', key: '4', freq: 330, wave: 'sine' },
            { id: 5, label: 'Concert A 440Hz', key: '5', freq: 440, wave: 'sine' },
            { id: 6, label: 'Square 550Hz', key: '6', freq: 550, wave: 'square' },
            { id: 7, label: 'High C 660Hz', key: '7', freq: 660, wave: 'triangle' },
            { id: 8, label: 'Brite 880Hz', key: '8', freq: 880, wave: 'sine' },
            { id: 9, label: 'Sine 1200Hz', key: '9', freq: 1200, wave: 'sine' },
          ].map(pad => `
            <div class="soundboard-pad" data-key="${pad.key}" data-freq="${pad.freq}" data-wave="${pad.wave}">
              <span class="pad-key">[ ${pad.key} ]</span>
              <span class="pad-label">${pad.label}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Visualizer Setup
    const canvas = container.querySelector<HTMLCanvasElement>('#sound-lab-canvas')!;
    this.visualizer = new AudioVisualizer(canvas, this.analyserNode);
    this.visualizer.start();

    // Mode Toggle
    container.querySelector('#btn-toggle-viz-mode')?.addEventListener('click', () => {
      if (this.visualizer) {
        const nextMode = this.visualizer.getMode() === 'spectrum' ? 'oscilloscope' : 'spectrum';
        this.visualizer.setMode(nextMode);
      }
    });

    // Tone Synth Sliders
    const freqSlider = container.querySelector<HTMLInputElement>('#synth-freq')!;
    const freqVal = container.querySelector('#val-synth-freq')!;
    freqSlider.addEventListener('input', () => {
      const f = parseFloat(freqSlider.value);
      freqVal.textContent = `${f} Hz`;
      this.liveSynth.update(f, parseFloat((container.querySelector('#synth-amp') as HTMLInputElement).value));
    });

    const ampSlider = container.querySelector<HTMLInputElement>('#synth-amp')!;
    const ampVal = container.querySelector('#val-synth-amp')!;
    ampSlider.addEventListener('input', () => {
      ampVal.textContent = `${Math.round(parseFloat(ampSlider.value) * 100)}%`;
      this.liveSynth.update(parseFloat(freqSlider.value), parseFloat(ampSlider.value));
    });

    const durSlider = container.querySelector<HTMLInputElement>('#synth-dur')!;
    const durVal = container.querySelector('#val-synth-dur')!;
    durSlider.addEventListener('input', () => {
      durVal.textContent = `${parseFloat(durSlider.value).toFixed(1)} s`;
    });

    // Live Tone Toggle
    const liveToneBtn = container.querySelector<HTMLButtonElement>('#btn-live-synth-preview')!;
    liveToneBtn.addEventListener('click', () => {
      if (this.liveSynth.isRunning) {
        this.liveSynth.stop();
        liveToneBtn.textContent = 'Start Live Tone';
      } else {
        const wave = (container.querySelector('#synth-waveform') as HTMLSelectElement).value as OscillatorType;
        const f = parseFloat(freqSlider.value);
        const a = parseFloat(ampSlider.value);
        this.liveSynth.start(wave, f, a);
        liveToneBtn.textContent = 'Stop Live Tone';
      }
    });

    // Generate & Load
    container.querySelector('#btn-generate-tone-file')?.addEventListener('click', () => {
      const wave = (container.querySelector('#synth-waveform') as HTMLSelectElement).value as OscillatorType;
      const f = parseFloat(freqSlider.value);
      const a = parseFloat(ampSlider.value);
      const d = parseFloat(durSlider.value);
      const buf = generateToneBuffer({ waveform: wave, frequency: f, amplitude: a, durationSec: d });

      this.soundLabLastBuffer = buf;
      this.originalBuffer = cloneAudioBuffer(buf);
      this.currentBuffer = buf;
      this.audioMeta = {
        name: `Tone_${wave}_${f}Hz.wav`,
        size: buf.length * 2,
        type: 'audio/wav',
        duration: buf.duration,
        sampleRate: buf.sampleRate,
        channels: 1,
      };
      this.updateBottomBarTrackInfo();
      alert(`Generated ${d}s ${wave} tone at ${f}Hz into workspace!`);
    });

    // Download WAV
    container.querySelector('#btn-download-tone-wav')?.addEventListener('click', () => {
      const wave = (container.querySelector('#synth-waveform') as HTMLSelectElement).value as OscillatorType;
      const f = parseFloat(freqSlider.value);
      const a = parseFloat(ampSlider.value);
      const d = parseFloat(durSlider.value);
      const buf = generateToneBuffer({ waveform: wave, frequency: f, amplitude: a, durationSec: d });
      exportSoundLabAudio(buf, `SynthTone_${wave}_${f}Hz.wav`);
    });

    // White Noise
    container.querySelector('#btn-gen-white-noise')?.addEventListener('click', () => {
      const d = parseFloat((container.querySelector('#noise-dur') as HTMLInputElement).value) || 5;
      const buf = generateWhiteNoiseBuffer(d, 0.4);
      this.soundLabLastBuffer = buf;
      this.currentBuffer = buf;
      this.originalBuffer = cloneAudioBuffer(buf);
      this.audioMeta = {
        name: `White_Noise_${d}s.wav`,
        size: buf.length * 2,
        type: 'audio/wav',
        duration: buf.duration,
        sampleRate: buf.sampleRate,
        channels: 1,
      };
      this.updateBottomBarTrackInfo();
      alert(`Generated ${d}s White Noise into workspace!`);
    });

    // Pink Noise
    container.querySelector('#btn-gen-pink-noise')?.addEventListener('click', () => {
      const d = parseFloat((container.querySelector('#noise-dur') as HTMLInputElement).value) || 5;
      const buf = generatePinkNoiseBuffer(d, 0.4);
      this.soundLabLastBuffer = buf;
      this.currentBuffer = buf;
      this.originalBuffer = cloneAudioBuffer(buf);
      this.audioMeta = {
        name: `Pink_Noise_${d}s.wav`,
        size: buf.length * 2,
        type: 'audio/wav',
        duration: buf.duration,
        sampleRate: buf.sampleRate,
        channels: 1,
      };
      this.updateBottomBarTrackInfo();
      alert(`Generated ${d}s Pink Noise into workspace!`);
    });

    // Soundboard pads
    const triggerPad = (padEl: HTMLElement) => {
      padEl.classList.add('triggered');
      setTimeout(() => padEl.classList.remove('triggered'), 150);

      const freq = parseFloat(padEl.dataset.freq || '440');
      const wave = (padEl.dataset.wave || 'sine') as OscillatorType;

      const ctx = getAudioContext();
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(this.masterGainNode);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    };

    container.querySelectorAll<HTMLElement>('.soundboard-pad').forEach(pad => {
      pad.addEventListener('click', () => triggerPad(pad));
    });

    // Key shortcut triggers 1 - 9
    const keyHandler = (e: KeyboardEvent) => {
      const pad = container.querySelector<HTMLElement>(`.soundboard-pad[data-key="${e.key}"]`);
      if (pad) triggerPad(pad);
    };
    window.addEventListener('keydown', keyHandler);
  }

  // 7. Settings View
  private async renderSettingsView(container: HTMLElement) {
    const settings = await getStoredSettings();

    container.innerHTML = `
      <div class="panel-card">
        <div class="panel-header">
          <div class="panel-title">System Diagnostics & Offline Verification</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="background:var(--bg-input);padding:14px;border-radius:var(--radius-md);border:1px solid var(--border-subtle);font-family:var(--font-mono);font-size:12px;display:flex;flex-direction:column;gap:6px;">
            <div>[✓] Web Audio Context: <span style="color:var(--accent-emerald);">Active (${getAudioContext().sampleRate} Hz)</span></div>
            <div>[✓] Local Storage / IndexedDB: <span style="color:var(--accent-emerald);">Connected</span></div>
            <div>[✓] Cross-Origin Isolation (COOP/COEP): <span style="color:${window.crossOriginIsolated ? 'var(--accent-emerald)' : 'var(--accent-amber)'};">${window.crossOriginIsolated ? 'Enabled' : 'Notice: Running without COOP/COEP (Standard Fallback Active)'}</span></div>
            <div>[✓] Network Activity: <span style="color:var(--accent-emerald);">0 external calls (100% Offline Local-First)</span></div>
          </div>
        </div>
      </div>

      <div class="panel-card">
        <div class="panel-title">Default Export Preferences</div>
        <div class="controls-grid">
          <div class="control-item">
            <span class="control-label">Default Audio Format</span>
            <select class="form-select" id="setting-default-format">
              <option value="wav" ${settings.defaultFormat === 'wav' ? 'selected' : ''}>WAV (PCM Master)</option>
              <option value="mp3" ${settings.defaultFormat === 'mp3' ? 'selected' : ''}>MP3 (MPEG Layer 3)</option>
              <option value="flac" ${settings.defaultFormat === 'flac' ? 'selected' : ''}>FLAC (Lossless)</option>
              <option value="ogg" ${settings.defaultFormat === 'ogg' ? 'selected' : ''}>OGG Vorbis</option>
            </select>
          </div>

          <div class="control-item">
            <span class="control-label">Default Sample Rate</span>
            <select class="form-select" id="setting-sample-rate">
              <option value="44100" ${settings.defaultSampleRate === 44100 ? 'selected' : ''}>44,100 Hz (CD Audio)</option>
              <option value="48000" ${settings.defaultSampleRate === 48000 ? 'selected' : ''}>48,000 Hz (Studio / Video)</option>
              <option value="96000" ${settings.defaultSampleRate === 96000 ? 'selected' : ''}>96,000 Hz (Hi-Res)</option>
            </select>
          </div>
        </div>

        <div style="display:flex;gap:10px;margin-top:14px;">
          <button class="btn btn-primary" id="btn-save-settings">Save Preferences</button>
        </div>
      </div>
    `;

    container.querySelector('#btn-save-settings')?.addEventListener('click', async () => {
      const format = (container.querySelector('#setting-default-format') as HTMLSelectElement).value;
      const sr = parseInt((container.querySelector('#setting-sample-rate') as HTMLSelectElement).value, 10);
      await saveStoredSettings({
        ...settings,
        defaultFormat: format,
        defaultSampleRate: sr,
      });
      alert('Preferences saved locally into IndexedDB!');
    });
  }

  // Unified Export Modal
  private openExportModal() {
    if (!this.currentBuffer) {
      alert('No active audio buffer to export. Please import or generate audio first.');
      return;
    }

    const modalBox = this.rootEl.querySelector('#modal-container')!;
    const defaultName = (this.audioMeta?.name || 'exported_master').replace(/\.[^.]+$/, '');
    const sel = this.waveformEditor?.getSelection();

    modalBox.innerHTML = `
      <div class="modal-overlay" id="export-modal-overlay">
        <div class="modal-dialog">
          <div class="modal-title-row">
            <div class="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              Export Local Audio
            </div>
            <button class="transport-btn" id="btn-close-modal">✕</button>
          </div>

          <div class="form-group">
            <label class="form-label">Output Filename</label>
            <input type="text" class="form-input" id="export-filename" value="${defaultName}">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label class="form-label">Export Format</label>
              <select class="form-select" id="export-format">
                <option value="wav">WAV (Lossless PCM)</option>
                <option value="mp3">MP3 (Universal 192k)</option>
                <option value="flac">FLAC (Compressed Lossless)</option>
                <option value="ogg">OGG Vorbis</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Sample Rate</label>
              <select class="form-select" id="export-sample-rate">
                <option value="44100">44.1 kHz (CD Standard)</option>
                <option value="48000">48.0 kHz (Studio Video)</option>
                <option value="96000">96.0 kHz (High-Res)</option>
                <option value="22050">22.05 kHz (Compact)</option>
              </select>
            </div>

            <div class="form-group" id="group-bit-depth">
              <label class="form-label">Bit Depth (WAV)</label>
              <select class="form-select" id="export-bit-depth">
                <option value="16">16-bit PCM (Standard)</option>
                <option value="24">24-bit PCM (High Dynamic Range)</option>
                <option value="32">32-bit Float (Mastering)</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Channels</label>
              <select class="form-select" id="export-channels">
                <option value="2">Stereo (2 Channels)</option>
                <option value="1">Mono (1 Channel)</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Export Time Range</label>
            <select class="form-select" id="export-range-type">
              <option value="all">Full Audio (${this.formatTimecode(this.currentBuffer.duration)})</option>
              ${sel ? `<option value="selection" selected>Selected Range (${this.formatTimecode(sel.start)} to ${this.formatTimecode(sel.end)})</option>` : ''}
            </select>
          </div>

          <div id="modal-export-progress" style="display:none;">
            <div class="progress-container">
              <div class="progress-bar-fill" id="export-progress-bar"></div>
            </div>
            <div style="font-size:11px;color:var(--accent-cyan);margin-top:4px;" id="export-progress-text">Exporting...</div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:6px;">
            <button class="btn" id="btn-cancel-export">Cancel</button>
            <button class="btn btn-primary" id="btn-start-export">
              Save File to Laptop
            </button>
          </div>
        </div>
      </div>
    `;

    // Modal Close
    const closeModal = () => { modalBox.innerHTML = ''; };
    modalBox.querySelector('#btn-close-modal')?.addEventListener('click', closeModal);
    modalBox.querySelector('#btn-cancel-export')?.addEventListener('click', closeModal);

    // Format Change visibility
    const fmtSelect = modalBox.querySelector<HTMLSelectElement>('#export-format')!;
    const bitDepthGroup = modalBox.querySelector<HTMLElement>('#group-bit-depth')!;
    fmtSelect.addEventListener('change', () => {
      bitDepthGroup.style.display = fmtSelect.value === 'wav' ? 'flex' : 'none';
    });

    // Start Export
    modalBox.querySelector('#btn-start-export')?.addEventListener('click', async () => {
      const filename = (modalBox.querySelector('#export-filename') as HTMLInputElement).value || 'export';
      const format = fmtSelect.value;
      const sr = parseInt((modalBox.querySelector('#export-sample-rate') as HTMLSelectElement).value, 10);
      const ch = parseInt((modalBox.querySelector('#export-channels') as HTMLSelectElement).value, 10) as 1 | 2;
      const bitDepth = parseInt((modalBox.querySelector('#export-bit-depth') as HTMLSelectElement).value, 10) as 16 | 24 | 32;
      const rangeType = (modalBox.querySelector('#export-range-type') as HTMLSelectElement).value;

      const pBox = modalBox.querySelector<HTMLElement>('#modal-export-progress')!;
      const pBar = modalBox.querySelector<HTMLElement>('#export-progress-bar')!;
      const pText = modalBox.querySelector<HTMLElement>('#export-progress-text')!;
      pBox.style.display = 'block';

      const config: ExportConfig = {
        filename: `${filename}.${format}`,
        format: format as any,
        sampleRate: sr,
        channels: ch,
        bitDepth: bitDepth,
        normalizeAudio: false,
        range: (rangeType === 'selection' && sel) ? sel : undefined,
      };

      try {
        const blob = await exportAudio(this.currentBuffer!, config, (pct) => {
          pBar.style.width = `${pct}%`;
          pText.textContent = `Exporting ${format.toUpperCase()}: ${pct}%`;
        });

        triggerFileDownload(blob, config.filename);
        pText.textContent = 'Export completed!';
        setTimeout(closeModal, 800);
      } catch (err) {
        alert(`Export failed: ${(err as Error).message}`);
        pBox.style.display = 'none';
      }
    });
  }

  private formatTimecode(sec: number): string {
    const mins = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new SonicForgeApp();
});
