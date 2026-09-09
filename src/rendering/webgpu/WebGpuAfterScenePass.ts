import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';

export interface WebGpuAfterSceneFrame {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  pixelRatio: number;
}

export interface WebGpuAfterScenePass {
  enabled: boolean;
  resize(width: number, height: number, pixelRatio: number): void;
  renderAfterScene(frame: WebGpuAfterSceneFrame): void;
  dispose?(): void;
}

export class WebGpuAfterScenePassRegistry {
  private readonly passes = new Set<WebGpuAfterScenePass>();

  add(pass: WebGpuAfterScenePass): () => void {
    this.passes.add(pass);
    return () => {
      this.passes.delete(pass);
    };
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.passes.forEach((pass) => {
      if (pass.enabled) {
        pass.resize(width, height, pixelRatio);
      }
    });
  }

  renderAfterScene(frame: WebGpuAfterSceneFrame): void {
    this.passes.forEach((pass) => {
      if (pass.enabled) {
        pass.renderAfterScene(frame);
      }
    });
  }

  dispose(): void {
    this.passes.forEach((pass) => pass.dispose?.());
    this.passes.clear();
  }
}
