import * as THREE from 'three';

export interface FluidTargetSize {
  width: number;
  height: number;
}

export function resolveFluidTargetSize(
  width: number,
  height: number,
  pixelRatio: number,
  resolutionScale = 0.5
): FluidTargetSize {
  return {
    width: Math.max(16, Math.round(width * pixelRatio * resolutionScale)),
    height: Math.max(16, Math.round(height * pixelRatio * resolutionScale)),
  };
}

export class WaterFluidRenderTargets {
  readonly resolutionScale: number;
  thickness: THREE.WebGLRenderTarget;
  depth: THREE.WebGLRenderTarget;
  blurA: THREE.WebGLRenderTarget;
  blurB: THREE.WebGLRenderTarget;
  foam: THREE.WebGLRenderTarget;
  composite: THREE.WebGLRenderTarget;
  private size: FluidTargetSize;

  constructor(width: number, height: number, pixelRatio: number, resolutionScale = 0.5) {
    this.resolutionScale = resolutionScale;
    this.size = resolveFluidTargetSize(width, height, pixelRatio, resolutionScale);
    this.thickness = this.createTarget(this.size.width, this.size.height, 'water-fluid-thickness');
    this.depth = this.createTarget(this.size.width, this.size.height, 'water-fluid-depth');
    this.blurA = this.createTarget(this.size.width, this.size.height, 'water-fluid-blur-a');
    this.blurB = this.createTarget(this.size.width, this.size.height, 'water-fluid-blur-b');
    this.foam = this.createTarget(this.size.width, this.size.height, 'water-fluid-foam');
    this.composite = this.createTarget(this.size.width, this.size.height, 'water-fluid-composite');
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const next = resolveFluidTargetSize(width, height, pixelRatio, this.resolutionScale);
    if (next.width === this.size.width && next.height === this.size.height) return;
    this.size = next;
    this.thickness.setSize(next.width, next.height);
    this.depth.setSize(next.width, next.height);
    this.blurA.setSize(next.width, next.height);
    this.blurB.setSize(next.width, next.height);
    this.foam.setSize(next.width, next.height);
    this.composite.setSize(next.width, next.height);
  }

  getSize(): FluidTargetSize {
    return this.size;
  }

  dispose(): void {
    this.thickness.dispose();
    this.depth.dispose();
    this.blurA.dispose();
    this.blurB.dispose();
    this.foam.dispose();
    this.composite.dispose();
  }

  private createTarget(width: number, height: number, name: string): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: false,
      stencilBuffer: false,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    target.texture.name = name;
    return target;
  }
}
