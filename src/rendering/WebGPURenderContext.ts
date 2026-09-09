import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { RenderContext } from './RenderContext';
import { WebGpuAfterScenePassRegistry } from './webgpu/WebGpuAfterScenePass';

export class WebGPURenderContext implements RenderContext {
  readonly backend = 'webgpu';
  readonly supportsCompute = true;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: WebGPURenderer;
  readonly webGpuAfterScenePasses = new WebGpuAfterScenePassRegistry();
  private environmentTexture?: THREE.Texture;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 20, 100);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new WebGPURenderer({
      canvas,
      antialias: true,
      alpha: false,
    } as ConstructorParameters<typeof WebGPURenderer>[0] & { canvas: HTMLCanvasElement });
  }

  async initialize(): Promise<void> {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0a0a0a);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    (this.renderer as any).shadowMap.enabled = true;
    await this.renderer.init();

    this.addProceduralEnvironment();
    this.addSharedLighting();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    this.webGpuAfterScenePasses.renderAfterScene({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: Math.min(window.devicePixelRatio, 2),
    });
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.webGpuAfterScenePasses.resize(width, height, Math.min(window.devicePixelRatio, 2));
  }

  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void {
    this.renderer.setClearColor(color, alpha);
  }

  dispose(): void {
    this.environmentTexture?.dispose();
    this.webGpuAfterScenePasses.dispose();
    this.renderer.dispose();
  }

  private addProceduralEnvironment(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) return;

    const sky = context.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#d9f1ff');
    sky.addColorStop(0.35, '#6a93b8');
    sky.addColorStop(0.52, '#f1d8b0');
    sky.addColorStop(0.58, '#253547');
    sky.addColorStop(1, '#05080d');
    context.fillStyle = sky;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const sun = context.createRadialGradient(760, 165, 8, 760, 165, 180);
    sun.addColorStop(0, 'rgba(255, 246, 205, 1)');
    sun.addColorStop(0.18, 'rgba(255, 218, 150, 0.62)');
    sun.addColorStop(1, 'rgba(255, 218, 150, 0)');
    context.fillStyle = sun;
    context.fillRect(0, 0, canvas.width, canvas.height);

    this.environmentTexture = new THREE.CanvasTexture(canvas);
    this.environmentTexture.mapping = THREE.EquirectangularReflectionMapping;
    this.environmentTexture.colorSpace = THREE.SRGBColorSpace;
    this.environmentTexture.needsUpdate = true;
    this.scene.environment = this.environmentTexture;
    this.scene.background = this.environmentTexture;
    this.scene.backgroundBlurriness = 0.62;
  }

  private addSharedLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xbfd8ff, 0.55);
    const hemiLight = new THREE.HemisphereLight(0xcfefff, 0x1a120c, 1.7);
    const keyLight = new THREE.DirectionalLight(0xfff0d6, 3.2);
    keyLight.position.set(38, 82, 44);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);

    const fillLight = new THREE.DirectionalLight(0x77b7ff, 0.85);
    fillLight.position.set(-60, 32, -48);

    this.scene.add(ambientLight, hemiLight, keyLight, fillLight);
  }
}
