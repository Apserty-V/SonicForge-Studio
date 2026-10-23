/**
 * SonicForge Studio - Real-Time Audio Visualizer
 * High-performance Canvas rendering of FFT Frequency Spectrum (Log scale)
 * and Oscilloscope Time-Domain Waveform with peak level metering.
 */

export class AudioVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private analyser: AnalyserNode;
  private animFrameId: number | null = null;
  private mode: 'spectrum' | 'oscilloscope' = 'spectrum';
  private dataArray: Uint8Array<ArrayBuffer>;
  private timeDataArray: Uint8Array<ArrayBuffer>;

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get 2D canvas context');
    this.ctx = context;
    this.analyser = analyser;
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.85;

    const bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);
    this.timeDataArray = new Uint8Array(this.analyser.fftSize);

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  public setMode(mode: 'spectrum' | 'oscilloscope') {
    this.mode = mode;
  }

  public getMode(): 'spectrum' | 'oscilloscope' {
    return this.mode;
  }

  public resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (rect.width > 0 && rect.height > 0) {
      this.canvas.width = Math.floor(rect.width * dpr);
      this.canvas.height = Math.floor(rect.height * dpr);
      this.ctx.resetTransform?.();
      this.ctx.scale(dpr, dpr);
    }
  }

  public start() {
    if (this.animFrameId) return;
    const render = () => {
      this.draw();
      this.animFrameId = requestAnimationFrame(render);
    };
    render();
  }

  public stop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.clear();
  }

  private clear() {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.fillStyle = '#10141a';
    this.ctx.fillRect(0, 0, rect.width, rect.height);
  }

  public draw() {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (width === 0 || height === 0) return;

    // Dark DAW background
    this.ctx.fillStyle = '#0d1117';
    this.ctx.fillRect(0, 0, width, height);

    if (this.mode === 'spectrum') {
      this.drawSpectrum(width, height);
    } else {
      this.drawOscilloscope(width, height);
    }
  }

  private drawSpectrum(width: number, height: number) {
    this.analyser.getByteFrequencyData(this.dataArray);

    // Draw background grid lines (frequencies: 100Hz, 1kHz, 10kHz)
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    const gridFreqs = [50, 100, 250, 500, 1000, 2000, 5000, 10000, 15000];
    const nyquist = 22050;

    for (const f of gridFreqs) {
      // Logarithmic X coordinate
      const x = Math.log10(f / 20) / Math.log10(nyquist / 20) * width;
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
    }
    this.ctx.stroke();

    // Draw spectrum gradient bars/curve
    const numBars = 128;
    const barWidth = width / numBars;

    // Gradient styling for DAW aesthetic
    const gradient = this.ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#10b981');   // emerald green at bottom
    gradient.addColorStop(0.65, '#f59e0b'); // amber mid
    gradient.addColorStop(0.95, '#ef4444'); // red top (headroom warning)

    this.ctx.fillStyle = gradient;

    let maxBinVal = 0;
    let peakFreq = 0;

    for (let i = 0; i < numBars; i++) {
      // Map bar index to log frequency index
      const fNorm = Math.pow(i / numBars, 2.2);
      const binIdx = Math.min(this.dataArray.length - 1, Math.floor(fNorm * this.dataArray.length));
      const val = this.dataArray[binIdx];
      const barHeight = (val / 255) * (height - 20);

      if (val > maxBinVal) {
        maxBinVal = val;
        peakFreq = Math.round(binIdx * (nyquist / this.dataArray.length));
      }

      this.ctx.fillRect(
        i * barWidth,
        height - barHeight,
        Math.max(1, barWidth - 1),
        barHeight
      );
    }

    // Peak readout
    if (maxBinVal > 20) {
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      this.ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      this.ctx.fillText(`Peak: ${peakFreq} Hz`, 10, 18);
    }
  }

  private drawOscilloscope(width: number, height: number) {
    this.analyser.getByteTimeDomainData(this.timeDataArray);

    // Center baseline
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, height / 2);
    this.ctx.lineTo(width, height / 2);
    this.ctx.stroke();

    // Waveform line
    this.ctx.strokeStyle = '#38bdf8'; // Sky blue DAW trace
    this.ctx.lineWidth = 1.8;
    this.ctx.beginPath();

    const sliceWidth = width / this.timeDataArray.length;
    let x = 0;

    for (let i = 0; i < this.timeDataArray.length; i++) {
      const v = this.timeDataArray[i] / 128.0;
      const y = (v * height) / 2;

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    this.ctx.stroke();
  }
}
