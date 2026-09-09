import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { WebGpuAfterScenePassRegistry } from './webgpu/WebGpuAfterScenePass';

export type RenderBackend = 'webgpu' | 'webgl';
export type AppRenderer = WebGPURenderer | THREE.WebGLRenderer;

export interface RenderContext {
  backend: RenderBackend;
  supportsCompute: boolean;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: AppRenderer;
  webGpuAfterScenePasses?: WebGpuAfterScenePassRegistry;
  initialize(): Promise<void>;
  render(): void;
  resize(width: number, height: number): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  dispose(): void;
}
