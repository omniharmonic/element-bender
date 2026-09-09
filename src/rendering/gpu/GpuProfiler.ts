export class GpuProfiler {
  private frameSamples: number[] = [];
  private lastFrameTime = 0;

  constructor(private readonly sampleCount = 90) {}

  markFrame(now = performance.now()): void {
    if (this.lastFrameTime !== 0) {
      this.frameSamples.push(now - this.lastFrameTime);
      if (this.frameSamples.length > this.sampleCount) {
        this.frameSamples.shift();
      }
    }
    this.lastFrameTime = now;
  }

  get averageFrameMs(): number {
    if (this.frameSamples.length === 0) return 0;
    return this.frameSamples.reduce((sum, value) => sum + value, 0) / this.frameSamples.length;
  }

  get averageFps(): number {
    const frameMs = this.averageFrameMs;
    return frameMs > 0 ? 1000 / frameMs : 0;
  }

  format(backend: string, activeElement: string | null): string {
    const fps = this.averageFps > 0 ? Math.round(this.averageFps) : 0;
    return `${backend.toUpperCase()} | ${activeElement ?? 'select'} | ${fps} FPS`;
  }
}
