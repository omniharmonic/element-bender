import * as THREE from 'three';
import { HandTracker } from '../tracking/HandTracker';
import { GestureRecognizer } from '../gestures/GestureRecognizer';
import { BaseElement, ElementType } from '../elements/BaseElement';
import { FireElement } from '../elements/fire/FireElement';
import { AirElement } from '../elements/air/AirElement';
import { WaterElement } from '../elements/water/WaterElement';
import { EarthElement } from '../elements/earth/EarthElement';
import { createEmptyGestureState, GestureState } from '../gestures/GestureState';
import { PostProcessing } from '../rendering/PostProcessing';
import { PostProcessingWebGPU } from '../rendering/PostProcessingWebGPU';
import type { RenderContext } from '../rendering/RenderContext';
import { WebGPURenderContext } from '../rendering/WebGPURenderContext';
import { WebGLFallbackContext } from '../rendering/WebGLFallbackContext';
import { GpuProfiler } from '../rendering/gpu/GpuProfiler';

export enum AppState {
  LOADING = 'loading',
  SELECTING = 'selecting',
  TRANSITIONING = 'transitioning',
  BENDING = 'bending',
}

export class ElementBender {
  private canvas: HTMLCanvasElement;
  private video: HTMLVideoElement;
  private context!: RenderContext;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private handTracker!: HandTracker;
  private gestureRecognizer!: GestureRecognizer;
  private elements: Map<ElementType, BaseElement> = new Map();
  private currentElement: BaseElement | null = null;
  private state: AppState = AppState.LOADING;
  private lastTime = 0;
  private frameCount = 0;
  private fpsTime = 0;
  private fpsDisplay: HTMLElement;
  private loadingEl: HTMLElement;
  private selectorEl: HTMLElement;
  private backButton: HTMLElement;
  private loadingStatus: HTMLElement;
  private gestureState: GestureState = createEmptyGestureState();
  private postProcessing: PostProcessing | PostProcessingWebGPU | null = null;
  private currentElementType: ElementType | null = null;
  private rendererStatus: HTMLElement;
  private gestureHints: HTMLElement;
  private readonly profiler = new GpuProfiler();

  // Hand visualization
  private handIndicators: THREE.Mesh[] = [];
  private handLights: THREE.PointLight[] = [];

  // Element background colors
  private readonly backgrounds: Record<ElementType, { color: THREE.Color; fogColor: THREE.Color }> = {
    fire: {
      color: new THREE.Color(0x0a0a0a),
      fogColor: new THREE.Color(0x1a0800),
    },
    water: {
      color: new THREE.Color(0x0d1b2a),
      fogColor: new THREE.Color(0x0d1b2a),
    },
    air: {
      color: new THREE.Color(0x1a1a2e),
      fogColor: new THREE.Color(0x2a2a4e),
    },
    earth: {
      color: new THREE.Color(0x1a1008),
      fogColor: new THREE.Color(0x2a2018),
    },
  };

  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.video = document.getElementById('video') as HTMLVideoElement;
    this.fpsDisplay = document.getElementById('fps-counter')!;
    this.loadingEl = document.getElementById('loading')!;
    this.selectorEl = document.getElementById('element-selector')!;
    this.backButton = document.getElementById('back-button')!;
    this.loadingStatus = document.getElementById('loading-status')!;
    this.rendererStatus = document.getElementById('renderer-status')!;
    this.gestureHints = document.getElementById('gesture-hints')!;
  }

  async init(): Promise<void> {
    console.log('ElementBender.init() starting...');

    try {
      this.updateLoadingStatus('Setting up renderer...');
      console.log('Initializing renderer...');
      await this.initRenderer();
      console.log('Renderer initialized');

      this.updateLoadingStatus('Initializing hand tracking...');
      console.log('Initializing hand tracking...');
      await this.initTracking();
      console.log('Hand tracking initialized');

      this.updateLoadingStatus('Loading elements...');
      console.log('Loading elements...');
      await this.initElements();
      console.log('Elements loaded');

      this.setupEventListeners();
      console.log('Event listeners set up');

      this.setState(AppState.SELECTING);
      console.log('State set to SELECTING');

      this.animate();
      console.log('Animation started');
    } catch (error) {
      console.error('Error in init():', error);
      throw error;
    }
  }

  private async initRenderer(): Promise<void> {
    this.context = await this.createRenderContext();
    this.scene = this.context.scene;
    this.camera = this.context.camera;

    // WebGPU post-processing is rebuilt later in the v2 sequence. The fallback
    // retains the previous bloom path so old WebGL visuals still have polish.
    if (this.context.backend === 'webgl') {
      this.postProcessing = new PostProcessing(
        this.context.renderer as THREE.WebGLRenderer,
        this.scene,
        this.camera
      );
      this.rendererStatus.textContent = 'WEBGL FALLBACK | CPU HEIGHTFIELDS ACTIVE';
    } else {
      this.postProcessing = new PostProcessingWebGPU(this.context);
      this.rendererStatus.textContent = 'WEBGPU | GPU SIM READY';
    }

    // Create hand indicators
    this.createHandIndicators();

    window.addEventListener('resize', this.onResize.bind(this));
  }

  private async createRenderContext(): Promise<RenderContext> {
    if ('gpu' in navigator) {
      try {
        const context = new WebGPURenderContext(this.canvas);
        await context.initialize();
        return context;
      } catch (error) {
        console.warn('WebGPU initialization failed, falling back to WebGL:', error);
      }
    }

    const fallback = new WebGLFallbackContext(this.canvas);
    await fallback.initialize();
    return fallback;
  }

  private createHandIndicators(): void {
    const geometry = new THREE.SphereGeometry(3, 32, 32);

    for (let i = 0; i < 2; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.scene.add(mesh);
      this.handIndicators.push(mesh);

      const light = new THREE.PointLight(0xffffff, 0, 55);
      light.visible = false;
      this.scene.add(light);
      this.handLights.push(light);
    }
  }

  private async initTracking(): Promise<void> {
    this.handTracker = new HandTracker(this.video);
    await this.handTracker.initialize();
    await this.handTracker.startCamera();

    this.gestureRecognizer = new GestureRecognizer();
  }

  private async initElements(): Promise<void> {
    const fire = new FireElement(this.context);
    await fire.init();
    this.elements.set('fire', fire);

    const water = new WaterElement(this.context);
    await water.init();
    this.elements.set('water', water);

    const air = new AirElement(this.context);
    await air.init();
    this.elements.set('air', air);

    const earth = new EarthElement(this.context);
    await earth.init();
    this.elements.set('earth', earth);
  }

  private setupEventListeners(): void {
    // Element selection buttons
    const buttons = this.selectorEl.querySelectorAll('.element-button');
    buttons.forEach((button) => {
      button.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const elementType = target.dataset.element as ElementType;
        if (elementType && !target.hasAttribute('disabled')) {
          this.selectElement(elementType);
        }
      });
    });

    // Back button
    this.backButton.addEventListener('click', () => {
      this.returnToSelection();
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state === AppState.BENDING) {
        this.returnToSelection();
      }
      if (e.key === '1') this.selectElement('fire');
      if (e.key === '2') this.selectElement('water');
      if (e.key === '3') this.selectElement('air');
      if (e.key === '4') this.selectElement('earth');
    });
  }

  private updateLoadingStatus(status: string): void {
    this.loadingStatus.textContent = status;
  }

  private setState(newState: AppState): void {
    this.state = newState;

    switch (newState) {
      case AppState.LOADING:
        this.loadingEl.classList.remove('hidden');
        this.selectorEl.classList.add('hidden');
        this.backButton.classList.add('hidden');
        break;

      case AppState.SELECTING:
        this.loadingEl.classList.add('hidden');
        this.selectorEl.classList.remove('hidden');
        this.backButton.classList.add('hidden');
        this.context.setClearColor(0x0a0a0a);
        break;

      case AppState.BENDING:
        this.selectorEl.classList.add('hidden');
        this.backButton.classList.remove('hidden');
        break;
    }
  }

  private async selectElement(type: ElementType): Promise<void> {
    if (this.state !== AppState.SELECTING) return;

    const element = this.elements.get(type);
    if (!element) return;

    this.setState(AppState.TRANSITIONING);

    // Set background for element
    const bg = this.backgrounds[type];
    this.context.setClearColor(bg.color);

    // Activate the element
    this.currentElement = element;
    this.currentElementType = type;
    element.activate();

    // Configure post-processing per element
    this.configurePostProcessing(type);
    this.updateGestureHints(type);

    this.setState(AppState.BENDING);
  }

  private configurePostProcessing(type: ElementType): void {
    if (!this.postProcessing) return;

    if (this.postProcessing instanceof PostProcessingWebGPU) {
      this.postProcessing.setElement(type);
    }

    switch (type) {
      case 'fire':
        this.postProcessing.setEnabled(true);
        this.postProcessing.setBloomStrength(1.5);
        this.postProcessing.setBloomThreshold(0.4);
        break;
      case 'water':
        this.postProcessing.setEnabled(true);
        this.postProcessing.setBloomStrength(0.5);
        this.postProcessing.setBloomThreshold(0.7);
        break;
      case 'air':
        this.postProcessing.setEnabled(true);
        this.postProcessing.setBloomStrength(0.3);
        this.postProcessing.setBloomThreshold(0.8);
        break;
      case 'earth':
        this.postProcessing.setEnabled(false);
        break;
    }
  }

  private updateGestureHints(type: ElementType): void {
    const hints: Record<ElementType, string> = {
      fire: 'Fire listens for breath: open palm feeds oxygen, fist compresses heat, circles twist embers into a vortex.',
      water: 'Water reads pressure: palm up lifts the surface, push sends a swell, two hands gather the tide into foam.',
      air: 'Air reveals invisible mass: sweep to cast gusts, spread to open the field, rotate to form a cyclone.',
      earth: 'Earth is a landscape editor: lift mountains, press valleys, push water sources, hold a fist to carve rivers and snowlines.',
    };

    this.gestureHints.textContent = hints[type];
  }

  private returnToSelection(): void {
    if (this.currentElement) {
      this.currentElement.deactivate();
      this.currentElement = null;
      this.currentElementType = null;
    }

    // Disable post-processing for selector
    this.postProcessing?.setEnabled(false);

    // Hide hand indicators
    this.handIndicators.forEach(h => h.visible = false);
    this.handLights.forEach(h => h.visible = false);
    this.gestureHints.textContent = 'Choose an element. Your hands are the controller.';

    this.setState(AppState.SELECTING);
  }

  private onResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.context.resize(width, height);
    this.postProcessing?.resize(width, height);
  }

  private animate(): void {
    requestAnimationFrame(this.animate.bind(this));

    const now = performance.now();
    const deltaTime = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // FPS counter
    this.profiler.markFrame(now);
    this.frameCount++;
    if (now - this.fpsTime >= 1000) {
      this.fpsDisplay.textContent = this.profiler.format(this.context.backend, this.currentElementType);
      this.updateRendererStatus();
      this.frameCount = 0;
      this.fpsTime = now;
    }

    // Process hand tracking
    const tracking = this.handTracker.processFrame();
    this.gestureState = this.gestureRecognizer.update(tracking);

    // Update current element
    if (this.state === AppState.BENDING && this.currentElement) {
      this.currentElement.update(deltaTime, this.gestureState);
      this.updateHandIndicators();
    }

    // Render with or without post-processing
    if (this.state === AppState.BENDING && this.currentElementType) {
      this.postProcessing?.render();
      if (!this.postProcessing) {
        this.context.render();
      }
    } else {
      this.context.render();
    }

  }

  private updateRendererStatus(): void {
    const computeStatus = this.context.supportsCompute ? 'GPU compute' : 'CPU fallback';
    const cpuStatus = this.context.backend === 'webgpu' ? 'CPU grid off' : 'CPU grid on';
    const element = this.currentElementType ?? 'selector';
    this.rendererStatus.textContent = `${computeStatus} | ${cpuStatus} | ${element}`;
  }

  private updateHandIndicators(): void {
    // Update hand indicator positions
    for (let i = 0; i < this.handIndicators.length; i++) {
      if (i < this.gestureState.hands.length) {
        const hand = this.gestureState.hands[i];
        this.handIndicators[i].position.copy(hand.position);
        this.handIndicators[i].visible = true;

        // Pulse based on activity
        const scale = 1 + hand.spreadStrength * 0.5;
        this.handIndicators[i].scale.setScalar(scale);
        this.handLights[i].position.copy(hand.position);
        this.handLights[i].visible = true;
        this.handLights[i].intensity = 0.8 + hand.velocity.length() * 5;

        // Color based on element
        const material = this.handIndicators[i].material as THREE.MeshBasicMaterial;
        switch (this.currentElementType) {
          case 'fire':
            material.color.setHex(0xff6b35);
            this.handLights[i].color.setHex(0xff6b35);
            break;
          case 'water':
            material.color.setHex(0x00b4d8);
            this.handLights[i].color.setHex(0x00b4d8);
            break;
          case 'air':
            material.color.setHex(0x89c2d9);
            this.handLights[i].color.setHex(0x89c2d9);
            break;
          case 'earth':
            material.color.setHex(0xbc6c25);
            this.handLights[i].color.setHex(0xbc6c25);
            break;
        }
      } else {
        this.handIndicators[i].visible = false;
        this.handLights[i].visible = false;
      }
    }
  }

  dispose(): void {
    this.handTracker.dispose();
    this.elements.forEach((element) => element.dispose());
    this.postProcessing?.dispose();
    this.context.dispose();
  }
}
