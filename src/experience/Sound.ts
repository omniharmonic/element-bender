import type { Element, Frame } from "./core";
export class Sound {
  private context?: AudioContext;
  private gain?: GainNode;
  private filter?: BiquadFilterNode;
  private source?: AudioBufferSourceNode;
  enabled = false;
  async toggle() {
    if (!this.context) {
      this.context = new AudioContext();
      const ctx = this.context,
        buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate),
        data = buffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < data.length; i++) {
        brown = (brown + Math.random() * 0.035 - 0.0175) / 1.015;
        data[i] = brown * 3.5;
      }
      this.source = ctx.createBufferSource();
      this.source.buffer = buffer;
      this.source.loop = true;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = "lowpass";
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      this.source
        .connect(this.filter)
        .connect(this.gain)
        .connect(ctx.destination);
      this.source.start();
    }
    this.enabled = !this.enabled;
    if (this.enabled) await this.context.resume();
    else this.gain!.gain.setTargetAtTime(0, this.context.currentTime, 0.15);
    return this.enabled;
  }
  update(element: Element, frame: Frame) {
    if (!this.enabled || !this.context) return;
    const energy = frame.hands.reduce((s, h) => s + h.velocity.length(), 0);
    const freq = { air: 680, water: 1100, earth: 160, fire: 1800 }[element];
    this.filter!.frequency.setTargetAtTime(
      freq + energy * 45 + Math.sin(frame.time * 0.6) * 80,
      this.context.currentTime,
      0.2,
    );
    this.gain!.gain.setTargetAtTime(
      0.13 + Math.min(energy * 0.006, 0.1),
      this.context.currentTime,
      0.2,
    );
  }
  quiet() {
    if (this.context)
      this.gain?.gain.setTargetAtTime(0, this.context.currentTime, 0.1);
  }
  dispose() {
    this.source?.stop();
    void this.context?.close();
  }
}
