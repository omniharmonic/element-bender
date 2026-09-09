import * as THREE from 'three';
import { MeshBasicNodeMaterial, PointsNodeMaterial, Sprite } from 'three/webgpu';
import { float } from 'three/tsl';
import type { WebGpuAfterSceneFrame, WebGpuAfterScenePass } from '../../../rendering/webgpu/WebGpuAfterScenePass';
import { WaterFluidRenderTargets } from './WaterFluidRenderTargets';
import type { WaterFluidParticleSource } from './WaterFluidSource';
import {
  createBilateralBlurMaterial,
  createPbrCompositeMaterial,
  createTextureOverlayMaterial,
} from './WaterFluidMaterials';

export interface WaterScreenSpaceFluidRendererOptions {
  width: number;
  height: number;
  pixelRatio: number;
  sources: WaterFluidParticleSource[];
}

type WaterDebugMode = 'none' | 'thickness' | 'depth' | 'blur' | 'foam' | 'composite';

export class WaterScreenSpaceFluidRenderer implements WebGpuAfterScenePass {
  enabled = false;
  private readonly thicknessScene = new THREE.Scene();
  private readonly depthScene = new THREE.Scene();
  private readonly foamScene = new THREE.Scene();
  private readonly postScene = new THREE.Scene();
  private readonly physicalCompositeScene = new THREE.Scene();
  private readonly debugScene = new THREE.Scene();
  private readonly debugCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly targets: WaterFluidRenderTargets;
  private readonly debugMode: WaterDebugMode;
  private readonly debugMaterial: THREE.MeshBasicMaterial;
  private blurMaterialA: MeshBasicNodeMaterial;
  private blurMaterialB: MeshBasicNodeMaterial;
  private pbrCompositeMaterial: MeshBasicNodeMaterial;
  private screenCompositeMaterial: MeshBasicNodeMaterial;
  private readonly postQuad: THREE.Mesh<THREE.PlaneGeometry, MeshBasicNodeMaterial>;
  private readonly physicalCompositeQuad: THREE.Mesh<THREE.PlaneGeometry, MeshBasicNodeMaterial>;

  constructor(options: WaterScreenSpaceFluidRendererOptions) {
    this.targets = new WaterFluidRenderTargets(options.width, options.height, options.pixelRatio, 0.5);
    this.debugMode = this.resolveDebugMode();
    this.debugMaterial = new THREE.MeshBasicMaterial({
      map: this.resolveDebugTexture(),
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMaterialA = this.createBlurMaterial(new THREE.Vector2(1, 0));
    this.blurMaterialB = this.createBlurMaterial(new THREE.Vector2(0, 1));
    this.pbrCompositeMaterial = this.createCompositeMaterial();
    this.screenCompositeMaterial = createTextureOverlayMaterial(this.targets.composite.texture, 0.42);

    const debugQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.debugMaterial);
    debugQuad.frustumCulled = false;
    this.debugScene.add(debugQuad);
    this.postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterialA);
    this.postScene.add(this.postQuad);
    this.physicalCompositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.screenCompositeMaterial);
    this.physicalCompositeScene.add(this.physicalCompositeQuad);
    options.sources.forEach((source) => this.addSource(source));
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.targets.resize(width, height, pixelRatio);
    this.refreshFullscreenMaterials();
  }

  renderAfterScene(frame: WebGpuAfterSceneFrame): void {
    const { renderer, camera } = frame;
    const previousClearColor = new THREE.Color();
    (renderer as any).getClearColor(previousClearColor);
    const previousClearAlpha = (renderer as any).getClearAlpha?.() ?? 1;

    this.renderSceneToTarget(renderer, this.thicknessScene, camera, this.targets.thickness);
    this.renderSceneToTarget(renderer, this.depthScene, camera, this.targets.depth);
    this.renderBilateralBlur(renderer);
    this.renderSceneToTarget(renderer, this.foamScene, camera, this.targets.foam);
    this.renderComposite(renderer);
    (renderer as any).setClearColor(previousClearColor, previousClearAlpha);

    if (this.debugMode !== 'none') {
      this.debugMaterial.map = this.resolveDebugTexture();
      renderer.render(this.debugScene, this.debugCamera);
    } else if (this.debugMode === 'none') {
      this.renderPhysicalWaterComposite(renderer);
    }
  }

  dispose(): void {
    this.targets.dispose();
    this.debugMaterial.dispose();
    this.debugScene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
      }
    });
    this.postScene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
      }
    });
    this.physicalCompositeScene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
      }
    });
    [...this.thicknessScene.children, ...this.depthScene.children, ...this.foamScene.children].forEach((object) => {
      if (object instanceof Sprite) {
        object.material.dispose();
      }
    });
  }

  private addSource(source: WaterFluidParticleSource): void {
    this.thicknessScene.add(this.createSourceSprite(source, source.color, source.opacity, source.radius, false));
    this.depthScene.add(this.createSourceSprite(source, 0x88e6ff, 0.34, source.radius * 0.92, false));
    this.foamScene.add(this.createSourceSprite(source, 0xf4ffff, 0.12 + source.opacity * 0.35, source.radius * 0.72, true));
  }

  private createSourceSprite(
    source: WaterFluidParticleSource,
    color: THREE.ColorRepresentation,
    opacity: number,
    radius: number,
    additive: boolean
  ): Sprite {
    const material = new PointsNodeMaterial({
      color: new THREE.Color(source.color),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: !additive,
      depthTest: true,
      size: radius,
    });
    material.color = new THREE.Color(color);
    material.positionNode = source.positions.toAttribute();
    material.sizeNode = float(radius);

    const sprite = new Sprite(material);
    sprite.name = source.name;
    sprite.count = source.count;
    sprite.frustumCulled = false;
    return sprite;
  }

  private renderSceneToTarget(
    renderer: WebGpuAfterSceneFrame['renderer'],
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    target: THREE.WebGLRenderTarget
  ): void {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
  }

  private renderBilateralBlur(renderer: WebGpuAfterSceneFrame['renderer']): void {
    // bilateral blur placeholder: this pass already isolates the correct targets.
    // The next shader step replaces these texture copies with depth-aware weights.
    this.postQuad.material = this.blurMaterialA;
    renderer.setRenderTarget(this.targets.blurA);
    renderer.clear();
    renderer.render(this.postScene, this.debugCamera);

    this.postQuad.material = this.blurMaterialB;
    renderer.setRenderTarget(this.targets.blurB);
    renderer.clear();
    renderer.render(this.postScene, this.debugCamera);
    renderer.setRenderTarget(null);
  }

  private renderComposite(renderer: WebGpuAfterSceneFrame['renderer']): void {
    this.postQuad.material = this.pbrCompositeMaterial;
    renderer.setRenderTarget(this.targets.composite);
    renderer.clear();
    renderer.render(this.postScene, this.debugCamera);
    renderer.setRenderTarget(null);
  }

  private renderPhysicalWaterComposite(renderer: WebGpuAfterSceneFrame['renderer']): void {
    this.physicalCompositeQuad.material = this.screenCompositeMaterial;
    renderer.render(this.physicalCompositeScene, this.debugCamera);
  }

  private refreshFullscreenMaterials(): void {
    this.debugMaterial.map = this.resolveDebugTexture();
    this.blurMaterialA.dispose();
    this.blurMaterialB.dispose();
    this.pbrCompositeMaterial.dispose();
    this.screenCompositeMaterial.dispose();
    this.blurMaterialA = this.createBlurMaterial(new THREE.Vector2(1, 0));
    this.blurMaterialB = this.createBlurMaterial(new THREE.Vector2(0, 1));
    this.pbrCompositeMaterial = this.createCompositeMaterial();
    this.screenCompositeMaterial = createTextureOverlayMaterial(this.targets.composite.texture, 0.42);
    this.postQuad.material = this.blurMaterialA;
    this.physicalCompositeQuad.material = this.screenCompositeMaterial;
    this.debugMaterial.needsUpdate = true;
  }

  private createBlurMaterial(direction: THREE.Vector2): MeshBasicNodeMaterial {
    const size = this.targets.getSize();
    return createBilateralBlurMaterial({
      input: direction.x === 1 ? this.targets.thickness.texture : this.targets.blurA.texture,
      depth: this.targets.depth.texture,
      texelSize: new THREE.Vector2(1 / size.width, 1 / size.height),
      direction,
    });
  }

  private createCompositeMaterial(): MeshBasicNodeMaterial {
    return createPbrCompositeMaterial({
      thickness: this.targets.thickness.texture,
      depth: this.targets.depth.texture,
      foam: this.targets.foam.texture,
      blurredThickness: this.targets.blurB.texture,
    });
  }

  private resolveDebugTexture(): THREE.Texture {
    switch (this.debugMode) {
      case 'depth':
        return this.targets.depth.texture;
      case 'blur':
        return this.targets.blurB.texture;
      case 'foam':
        return this.targets.foam.texture;
      case 'composite':
        return this.targets.composite.texture;
      case 'thickness':
      case 'none':
        return this.targets.thickness.texture;
    }
  }

  private resolveDebugMode(): WaterDebugMode {
    if (typeof window === 'undefined') return 'none';
    const mode = new URLSearchParams(window.location.search).get('waterFluidDebug');
    if (mode === 'thickness' || mode === 'depth' || mode === 'blur' || mode === 'foam' || mode === 'composite') {
      return mode;
    }
    return 'none';
  }
}
