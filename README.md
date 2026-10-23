# SonicForge Studio — Offline Audio & Video Workstation

**SonicForge Studio** is a professional, local-first digital audio workstation (DAW) and video processing suite built to run 100% offline on your Windows laptop.

No AI. No cloud processing. No paid APIs. No telemetry. No user accounts. Your media never leaves your device.

---

## Key Features

### 1. Voice Lab (Non-AI Digital Signal Processing)
- **Mathematical Formant & Pitch Processing**: Uses Synchronous Waveform Similarity Overlap-Add (WSOLA) time-scale modification and acoustic biquad resonance filter banks.
- **Pitch Shift without Tempo Alteration**: Independent adjustment from -24 to +24 semitones.
- **Formant Scaling**: Vocal tract acoustic scaling from 0.60x to 1.60x.
- **Studio Presets**:
  - Male-to-Female voice transformation
  - Female-to-Male voice transformation
  - Deep Voice / Sub-Bass
  - Chipmunk / High Resonance
  - Cybernetic Robot (Ring modulation + metallic comb filter)
  - Vintage Radio / Telephone (Bandpass 350Hz–3.4kHz with analog warmth)
  - Fully customizable DSP settings
- **A/B Comparison**: Instant toggle between original and processed audio buffers during playback.

### 2. Audio Editor
- **Studio Waveform View**: Time ruler with sub-millisecond precision, zoom levels (1x–32x), horizontal scrubbing, and playhead seeking.
- **Interactive Dual-Handle Range Selection**: Drag across the waveform to select, adjust boundary handles, or click to seek.
- **Non-Destructive & Destructive Operations**:
  - Trim / Crop Selection
  - Cut / Splice (deletes selection and rejoins remaining sections)
  - Reverse audio (selection or full track)
  - Fade In & Fade Out (linear, exponential, logarithmic curves)
  - Playback Speed scaling (0.5x, 0.75x, 1x, 1.25x, 1.5x, 2.0x)
  - Volume Gain boost / cut (+/- dB)
  - Multi-track Merge (sequentially append or overlay secondary audio files)
  - Full Undo & Redo history stack (`Ctrl+Z`, `Ctrl+Shift+Z`)
  - Reset to original source file

### 3. Audio Effects Studio
- **10-Band Graphic Equalizer**: Standard ISO center frequencies (31Hz, 62Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz).
- **3-Band Master Equalizer**: Low shelf (100Hz), Peaking mid (1kHz), High shelf (4kHz).
- **Resonant Filters**: Low-pass (20Hz–20kHz) and High-pass (20Hz–20kHz) with adjustable resonance (Q).
- **Algorithmic Stereo Reverb**: Schroeder-Moorer impulse generator with decay and pre-delay controls.
- **Echo & Stereo Delay**: Time, feedback loop, and wet/dry mix.
- **Dynamics Compressor & Peak Limiter**: Studio threshold, ratio, attack, release, knee, and brickwall lookahead peak limiting to prevent clipping.
- **Master Bypass**: Instant toggle for A/B testing effect chains.
- **Bake Effects**: Renders the complete node graph offline into the master buffer.

### 4. Video Tools
- **Audio Extraction**: Extracts audio tracks from video containers (MP4, WebM, MOV, MKV) directly into the Audio Editor or as WAV/MP3 files.
- **Lossless Video Muting**: Strips audio streams while preserving video frames losslessly (`-c:v copy -an`).
- **Audio Replacement**: Replaces the video's original audio track with your edited, processed, or generated audio while preserving synchronization.
- **Video Trimming**: Trim start and end points directly from your laptop.
- **Video Player**: Live synchronized video preview.

### 5. Sound Lab & Acoustic Synthesizer
- **Tone Synthesizer**: Sine, Square, Triangle, and Sawtooth waveforms with frequency (20Hz–20,000Hz) and amplitude controls.
- **Noise Generators**: Pure White Noise and Paul Kellet's Pink Noise (-3dB/octave filtered algorithm).
- **Live Acoustic Visualizers**:
  - Real-time FFT Frequency Spectrum Analyzer (logarithmic frequency scale from 20Hz to 20kHz, dB scale, peak frequency detection)
  - Real-time Oscilloscope (time-domain waveform visualization)
- **Interactive 9-Pad Soundboard**: Triggerable via keyboard keys `1` through `9`.
- **Direct Export**: Download generated audio immediately as WAV.

### 6. Multi-Format Exporter
- **Zero-Dependency Master WAV**: 16-bit PCM, 24-bit PCM, and 32-bit Float PCM.
- **Offline MP3**: LAME pure JavaScript MP3 encoder (128k to 320k bitrate).
- **FLAC, OGG, AAC, MP4, WebM**: Supported through local WebAssembly engine.
- **Configurable Settings**: Sample rate (22.05kHz, 44.1kHz, 48kHz, 96kHz), channels (Mono/Stereo), time range (Entire File or Current Selection).
- **Progress Reporting & Cancellation**: Accurate percentage display during rendering.

---

## Getting Started on Windows

### Quick Launch
Simply double-click:
```bat
start.bat
```
This batch script checks the local environment, builds the production bundle if necessary, and starts the local server on `http://localhost:5173`, automatically opening your default web browser.

### Manual Terminal Commands

1. **Install dependencies** (first-time only):
   ```bash
   npm install
   ```

2. **Run tests**:
   ```bash
   npm test
   ```

3. **Start local offline server**:
   ```bash
   npm start
   ```
   *(Or for live development hot-reloading: `npm run dev`)*

> **Note on "localhost":**
> Opening `http://localhost:5173` runs completely on your laptop's loopback interface. No data or files are sent over the internet or uploaded to any server.

---

## System Architecture

```
SonicForge Studio/
├── public/
│   ├── ffmpeg/             # Locally vendored FFmpeg WebAssembly (offline)
│   │   ├── ffmpeg-core.js
│   │   └── ffmpeg-core.wasm
│   └── vendor/             # Offline LAME MP3 encoder
│       └── lame.min.js
├── src/
│   ├── components/         # UI Components
│   │   ├── Visualizer.ts   # Logarithmic spectrum & oscilloscope canvas
│   │   └── WaveformEditor.ts # Interactive DAW waveform editor canvas
│   ├── core/
│   │   ├── audioContext.ts # Singleton Web Audio API manager
│   │   ├── dsp/            # Pure DSP implementations
│   │   │   ├── effectsChain.ts # 10-band EQ, reverb, delay, compressor
│   │   │   └── voiceLabDsp.ts  # WSOLA pitch shift & formant filters
│   │   ├── editor/         # AudioBuffer manipulation
│   │   │   └── audioBufferUtils.ts # Crop, cut, reverse, speed, fade, merge
│   │   ├── encoders/       # Local audio encoders
│   │   │   ├── mp3Encoder.ts   # Pure JS MP3 encoder
│   │   │   └── wavEncoder.ts   # 16/24/32-bit float WAV encoder
│   │   ├── soundLab/       # Synthesizer & noise generation
│   │   │   └── soundLab.ts
│   │   ├── storage/        # IndexedDB local settings & history
│   │   │   └── db.ts
│   │   ├── video/          # Video audio extract, mute, replace, trim
│   │   │   └── videoProcessor.ts
│   │   └── exportManager.ts# Multi-format export routing
│   ├── types/              # TypeScript definitions
│   │   └── index.ts
│   ├── main.ts             # Application controller & state machine
│   └── style.css           # Professional DAW dark theme styling
├── test/
│   └── runTests.js         # Automated DSP & audio engine test suite
├── server.js               # Zero-dependency local COOP/COEP HTTP server
├── start.bat               # Windows one-click batch launcher
├── vite.config.ts          # Vite configuration with isolation headers
└── package.json            # Pinned dependencies
```

---

## Supported Formats

| Media Type | Formats Supported | Processing Method |
|---|---|---|
| **Audio Input** | WAV, MP3, M4A, AAC, FLAC, OGG, WebM | Native Web Audio API decoding |
| **Video Input** | MP4, WebM, MOV, MKV | HTML5 Video & local FFmpeg wasm |
| **Audio Output** | WAV (16, 24, 32-bit), MP3 (128–320 kbps), FLAC, OGG, AAC | Pure JS WAV & LAME + local FFmpeg |
| **Video Output** | MP4, WebM | Stream copy & remux |

---

## Troubleshooting Guide

### 1. Browser audio is silent
- Web browsers require user interaction before playing audio. Click anywhere on the screen or press the Play button to activate the `AudioContext`.

### 2. Large video files
- For video files larger than 500MB, audio extraction is processed in memory. If memory is constrained, extracting only the audio track before editing is recommended.

### 3. Cross-Origin Isolation notice
- SharedArrayBuffer acceleration requires the local server (`node server.js` or `npm run dev`) which provides `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
- The application automatically falls back to native browser decoding if run without cross-origin isolation.

---

## Dependencies & Licenses

- **TypeScript**: Apache 2.0
- **Vite**: MIT License
- **@ffmpeg/ffmpeg & @ffmpeg/core**: LGPL 2.1 / GPL (compiled to local wasm)
- **lamejs**: LGPL 2.0 (pure JavaScript MP3 encoder)
- **Lucide**: ISC License (DAW workstation icons)
