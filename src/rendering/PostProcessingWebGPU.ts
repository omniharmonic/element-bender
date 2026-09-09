import * as THREE from 'three';
import type { ElementType } from '../elements/BaseElement';
import type { RenderContext } from './RenderContext';

const EXPOSURE: Record<ElementType, number> = {
  fire: 1.35,
  water: 1.08,
  air: 1.18,
  earth: 0.95,
};

export class PostProcessingWebGPU {
  private enabled = true;

  constructor(private readonly context: RenderContext) {
    this.context.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.context.renderer.toneMappingExposure = 1.1;
  }

  setElement(type: ElementType): void {
    this.context.renderer.toneMappingExposure = EXPOSURE[type];
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setBloomStrength(_strength: number): void {
    // WebGPU bloom is intentionally represented as exposure/color grade for now.
  }

  setBloomThreshold(_threshold: number): void {
    // Kept for parity with the WebGL post-processing controls.
  }

  resize(_width: number, _height: number): void {
    // RenderContext owns WebGPU canvas sizing.
  }

  render(): void {
    if (!this.enabled) {
      this.context.render();
      return;
    }

    this.context.render();
  }

  dispose(): void {
    this.enabled = false;
  }
}
