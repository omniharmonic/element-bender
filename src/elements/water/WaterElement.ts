import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { WaterMesh } from 'three/addons/objects/Water2Mesh.js';
import { Fn, If, clamp, deltaTime, float, instanceIndex, vec3 } from 'three/tsl';
import { BaseElement } from '../BaseElement';
import { GestureState } from '../../gestures/GestureState';
import type { RenderContext } from '../../rendering/RenderContext';
import { ElementalIntentSmoother, createElementalIntent } from '../../gestures/ElementalIntent';
import { GpuIntentBuffer } from '../../rendering/gpu/GpuIntentBuffer';
import { GpuHeightField, createGpuHeightField } from '../../rendering/gpu/GpuHeightField';
import { GpuParticleSystem, createGpuParticleSystem } from '../../rendering/gpu/GpuParticles';
import { createHandGravityField, sampleHandGravityField } from '../../gestures/HandGravityField';
import { WaterScreenSpaceFluidRenderer } from './screen-space/WaterScreenSpaceFluidRenderer';
import { createHeightFieldFluidSource, createSphFluidSource, createSprayFluidSource } from './screen-space/WaterFluidSource';
import { WaterSphSimulation } from './sph/WaterSphSimulation';

const GRID_SIZE = 256;
const WORLD_SIZE = 150;
const WATER_SPRAY_COUNT = 18000;

// Water surface vertex shader
const waterVertexShader = `
  uniform sampler2D heightMap;
  uniform float worldSize;
  uniform float time;

  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vHeight;

  void main() {
    vUv = uv;

    // Sample height from texture - reduced multiplier for calmer water
    float height = texture2D(heightMap, uv).r * 12.0;
    vHeight = height;

    // Calculate position
    vec3 pos = position;
    pos.y = height;

    // Calculate normal from neighboring heights
    float texelSize = 1.0 / ${GRID_SIZE.toFixed(1)};
    float hL = texture2D(heightMap, uv - vec2(texelSize, 0.0)).r * 12.0;
    float hR = texture2D(heightMap, uv + vec2(texelSize, 0.0)).r * 12.0;
    float hD = texture2D(heightMap, uv - vec2(0.0, texelSize)).r * 12.0;
    float hU = texture2D(heightMap, uv + vec2(0.0, texelSize)).r * 12.0;

    vec3 normal = normalize(vec3(hL - hR, 2.0, hD - hU));
    vNormal = normalMatrix * normal;

    vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// Water surface fragment shader
const waterFragmentShader = `
  uniform vec3 deepColor;
  uniform vec3 shallowColor;
  uniform vec3 foamColor;
  uniform float time;

  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vHeight;

  void main() {
    // Fresnel effect
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 3.0);

    // Depth-based color
    float depthFactor = clamp((vHeight + 5.0) / 15.0, 0.0, 1.0);
    vec3 waterColor = mix(deepColor, shallowColor, depthFactor);

    // Add foam at wave peaks - adjusted for lower heights
    float foam = smoothstep(4.0, 8.0, vHeight);
    waterColor = mix(waterColor, foamColor, foam * 0.6);

    // Specular highlight
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
    vec3 halfDir = normalize(lightDir + viewDir);
    float specular = pow(max(dot(vNormal, halfDir), 0.0), 64.0);

    // Combine
    vec3 finalColor = waterColor + fresnel * 0.3 + specular * 0.5;

    // Transparency based on depth
    float alpha = 0.85 + fresnel * 0.15;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export class WaterElement extends BaseElement {
  private geometry!: THREE.PlaneGeometry;
  private material!: THREE.ShaderMaterial | THREE.MeshPhysicalMaterial;
  private mesh!: THREE.Mesh;
  private gpuField?: GpuHeightField;
  private gpuSurface?: WaterMesh;
  private waterNormalMap0?: THREE.CanvasTexture;
  private waterNormalMap1?: THREE.CanvasTexture;
  private waterVolume?: THREE.Mesh;
  private waterColumn?: THREE.Mesh;
  private waterSpray?: GpuParticleSystem;
  private sphWater?: WaterSphSimulation;
  private screenSpaceFluid?: WaterScreenSpaceFluidRenderer;
  private unregisterScreenSpaceFluid?: () => void;
  private foamGroup = new THREE.Group();
  private foamRings: THREE.Line[] = [];
  private foamRingState: { age: number; life: number; active: boolean }[] = [];
  private gpuCompute?: any;
  private waterSprayCompute?: any;
  private waterFlowDirection = new THREE.Vector2(1, 0);
  private readonly gpuIntent = new GpuIntentBuffer();
  private readonly intentSmoother = new ElementalIntentSmoother(0.36);

  // Wave simulation buffers (ping-pong)
  private heightCurrent: Float32Array;
  private heightPrevious: Float32Array;
  private heightNext: Float32Array;
  private heightTexture!: THREE.DataTexture;

  private time = 0;

  // Simulation parameters
  private readonly waveSpeed = 1.5;
  private readonly damping = 0.992;
  private readonly maxHeight = 1.5;
  private readonly minHeight = -1.5;

  constructor(context: RenderContext) {
    super(context);

    // Initialize height buffers
    const size = GRID_SIZE * GRID_SIZE;
    this.heightCurrent = new Float32Array(size);
    this.heightPrevious = new Float32Array(size);
    this.heightNext = new Float32Array(size);

    // Initialize with slight waves
    for (let i = 0; i < size; i++) {
      const x = (i % GRID_SIZE) / GRID_SIZE;
      const y = Math.floor(i / GRID_SIZE) / GRID_SIZE;
      const wave = Math.sin(x * Math.PI * 4) * Math.sin(y * Math.PI * 4) * 0.1;
      this.heightCurrent[i] = wave;
      this.heightPrevious[i] = wave;
    }
  }

  async init(): Promise<void> {
    if (this.context.backend === 'webgpu') {
      this.initGpuWater();
      return;
    }

    // Create height texture for the WebGL fallback shader path.
    this.heightTexture = new THREE.DataTexture(
      new Float32Array(GRID_SIZE * GRID_SIZE),
      GRID_SIZE,
      GRID_SIZE,
      THREE.RedFormat,
      THREE.FloatType
    );
    this.heightTexture.needsUpdate = true;

    // Create water plane geometry
    this.geometry = new THREE.PlaneGeometry(
      WORLD_SIZE,
      WORLD_SIZE,
      GRID_SIZE - 1,
      GRID_SIZE - 1
    );
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
      uniforms: {
        heightMap: { value: this.heightTexture },
        worldSize: { value: WORLD_SIZE },
        time: { value: 0 },
        deepColor: { value: new THREE.Color(0x0077b6) },
        shallowColor: { value: new THREE.Color(0x00b4d8) },
        foamColor: { value: new THREE.Color(0xcaf0f8) },
      },
      transparent: true,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = -20;
  }

  private initGpuWater(): void {
    const size = 180;
    this.gpuField = createGpuHeightField(
      size,
      WORLD_SIZE,
      0x64d8ff,
      2.3,
      (x, y) => {
        const nx = x / size;
        const ny = y / size;
        const ripple = Math.sin(nx * Math.PI * 8) * Math.sin(ny * Math.PI * 8) * 0.7;
        return {
          height: -20 + ripple,
          velocity: 0,
          state: new THREE.Vector4(ripple, 0, 0, Math.random()),
          moisture: new THREE.Vector4(0, 0, 0, 0),
        };
      }
    );

    const positions = this.gpuField.positions;
    const velocities = this.gpuField.velocities;
    const state = this.gpuField.state;
    const hand0Position = this.gpuIntent.hand0Position;
    const hand0Forces = this.gpuIntent.hand0Forces;
    const hand0Extra = this.gpuIntent.hand0Extra;
    const hand1Position = this.gpuIntent.hand1Position;
    const hand1Forces = this.gpuIntent.hand1Forces;
    const hand1Extra = this.gpuIntent.hand1Extra;
    const twoHand = this.gpuIntent.twoHand;
    const twoHandForces = this.gpuIntent.twoHandForces;

    this.gpuCompute = (Fn(() => {
      const position = positions.element(instanceIndex);
      const velocity = velocities.element(instanceIndex);
      const cellState = state.element(instanceIndex);
      const dt = deltaTime.min(float(0.033));
      const restHeight = float(-20);
      const spring = restHeight.sub(position.y).mul(float(0.72));
      const travellingWave = position.x.mul(float(0.07)).add(position.z.mul(float(0.05))).sin().mul(float(0.28));

      velocity.y.addAssign(spring.add(travellingWave).mul(dt));
      this.applyWaterHandImpulse(position, velocity, cellState, hand0Position, hand0Forces, hand0Extra);
      this.applyWaterHandImpulse(position, velocity, cellState, hand1Position, hand1Forces, hand1Extra);

      If(twoHand.w.greaterThan(float(0.5)), () => {
        const delta = position.sub(twoHand.xyz);
        const falloff = clamp(float(1).sub(delta.length().div(twoHandForces.x.max(float(26)))), float(0), float(1));
        velocity.y.addAssign(twoHandForces.y.sub(twoHandForces.z).mul(falloff).mul(float(18)).mul(dt));
        cellState.z.assign(clamp(cellState.z.add(falloff.mul(float(0.02))), float(0), float(1)));
      });

      velocity.y.mulAssign(float(0.985));
      position.y.addAssign(velocity.y.mul(dt.mul(float(18))));
      cellState.z.assign(clamp(cellState.z.mul(float(0.992)).add(velocity.y.abs().mul(float(0.002))), float(0), float(1)));
    })() as any).compute(size * size);

    this.gpuField.sprite.position.y = 0;
    this.gpuField.material.opacity = 0.09;
    this.gpuField.material.size = 0.42;
    this.initGpuSurface();
    this.initWaterVolume();
    this.initWaterColumn();
    this.initGpuWaterSpray();
    this.initSphWater();
    this.initScreenSpaceFluidRenderer();
    this.initFoamRings();
  }

  private initSphWater(): void {
    this.sphWater = new WaterSphSimulation({
      particleCount: 32768,
      worldSize: WORLD_SIZE,
      smoothingRadius: 1.35,
    });
    this.sphWater.system.sprite.visible = false;
  }

  private initScreenSpaceFluidRenderer(): void {
    if (!this.gpuField || !this.waterSpray || !this.sphWater || !this.context.webGpuAfterScenePasses) return;

    this.screenSpaceFluid = new WaterScreenSpaceFluidRenderer({
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: Math.min(window.devicePixelRatio, 2),
      sources: [
        createSphFluidSource(this.sphWater),
        createHeightFieldFluidSource(this.gpuField),
        createSprayFluidSource(this.waterSpray),
      ],
    });
    this.unregisterScreenSpaceFluid = this.context.webGpuAfterScenePasses.add(this.screenSpaceFluid);
  }

  private initGpuSurface(): void {
    const surfaceGeometry = new THREE.PlaneGeometry(WORLD_SIZE * 1.35, WORLD_SIZE * 1.35, 160, 160);
    surfaceGeometry.rotateX(-Math.PI / 2);
    this.waterNormalMap0 = this.createProceduralWaterNormalMap(0);
    this.waterNormalMap1 = this.createProceduralWaterNormalMap(19.7);
    this.gpuSurface = new WaterMesh(surfaceGeometry, {
      color: 0x8bdfff,
      flowDirection: this.waterFlowDirection,
      flowSpeed: 0.055,
      reflectivity: 0.18,
      scale: 4.6,
      normalMap0: this.waterNormalMap0,
      normalMap1: this.waterNormalMap1,
    });
    this.gpuSurface.position.y = -20;
    this.gpuSurface.receiveShadow = true;
    this.gpuSurface.renderOrder = 4;
  }

  private createProceduralWaterNormalMap(seed: number): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create water normal map');
    }

    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const waveA = Math.sin((u * 18 + seed) * Math.PI * 2 + Math.sin(v * 10 + seed) * 0.7);
        const waveB = Math.cos((v * 22 - seed * 0.31) * Math.PI * 2 + Math.sin(u * 7) * 0.9);
        const capillary = Math.sin((u + v) * 96 + seed) * 0.24;
        const nx = THREE.MathUtils.clamp(0.5 + (waveA * 0.23 + capillary * 0.08), 0, 1);
        const ny = THREE.MathUtils.clamp(0.5 + (waveB * 0.23 - capillary * 0.08), 0, 1);
        const index = (y * size + x) * 4;
        image.data[index + 0] = nx * 255;
        image.data[index + 1] = ny * 255;
        image.data[index + 2] = 238;
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  private initWaterVolume(): void {
    const geometry = new THREE.CylinderGeometry(WORLD_SIZE * 0.72, WORLD_SIZE * 0.84, 16, 128, 1, true);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0x06364a,
      transparent: true,
      opacity: 0.24,
      roughness: 0.12,
      metalness: 0,
      transmission: 0.2,
      thickness: 2,
      side: THREE.DoubleSide,
    });
    this.waterVolume = new THREE.Mesh(geometry, material);
    this.waterVolume.position.y = -28;
  }

  private initWaterColumn(): void {
    const geometry = new THREE.CylinderGeometry(1, 5, 32, 48, 8, true);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xa9f0ff,
      transparent: true,
      opacity: 0,
      roughness: 0.02,
      metalness: 0,
      transmission: 0.72,
      thickness: 3.5,
      ior: 1.333,
      specularIntensity: 1,
      envMapIntensity: 1.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.waterColumn = new THREE.Mesh(geometry, material);
    this.waterColumn.visible = false;
    this.waterColumn.position.set(0, -9, 0);
    this.waterColumn.renderOrder = 5;
  }

  private initFoamRings(): void {
    const points: THREE.Vector3[] = [];
    const segments = 96;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
    }

    for (let i = 0; i < 14; i++) {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: 0xdffcff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Line(geometry, material);
      ring.visible = false;
      this.foamRings.push(ring);
      this.foamRingState.push({ age: 0, life: 1, active: false });
      this.foamGroup.add(ring);
    }
  }

  private initGpuWaterSpray(): void {
    const positions = new Float32Array(WATER_SPRAY_COUNT * 3);
    const velocities = new Float32Array(WATER_SPRAY_COUNT * 3);
    const life = new Float32Array(WATER_SPRAY_COUNT * 4);
    const extra = new Float32Array(WATER_SPRAY_COUNT * 4);

    for (let i = 0; i < WATER_SPRAY_COUNT; i++) {
      const idx = i * 3;
      const vec4Idx = i * 4;
      const xSeed = Math.random() * 2 - 1;
      const zSeed = Math.random() * 2 - 1;
      positions[idx] = xSeed * WORLD_SIZE * 0.46;
      positions[idx + 1] = -20 + Math.random() * 2.5;
      positions[idx + 2] = zSeed * WORLD_SIZE * 0.46;
      velocities[idx] = zSeed * 0.7;
      velocities[idx + 1] = Math.random() * 2;
      velocities[idx + 2] = -xSeed * 0.7;
      life[vec4Idx] = Math.random() * 1.4;
      life[vec4Idx + 1] = 0.8 + Math.random() * 1.2;
      life[vec4Idx + 2] = 0;
      life[vec4Idx + 3] = Math.random();
      extra[vec4Idx] = xSeed;
      extra[vec4Idx + 1] = zSeed;
      extra[vec4Idx + 2] = Math.random();
      extra[vec4Idx + 3] = Math.random();
    }

    this.waterSpray = createGpuParticleSystem(
      WATER_SPRAY_COUNT,
      positions,
      velocities,
      life,
      extra,
      0xdffcff,
      0.58,
      0.18
    );

    const sprayPositions = this.waterSpray.positions;
    const sprayVelocities = this.waterSpray.velocities;
    const sprayLife = this.waterSpray.life;
    const sprayExtra = this.waterSpray.extra;
    const hand0Position = this.gpuIntent.hand0Position;
    const hand0Forces = this.gpuIntent.hand0Forces;
    const hand0Velocity = this.gpuIntent.hand0Velocity;
    const hand0Extra = this.gpuIntent.hand0Extra;
    const hand1Position = this.gpuIntent.hand1Position;
    const hand1Forces = this.gpuIntent.hand1Forces;
    const hand1Velocity = this.gpuIntent.hand1Velocity;
    const hand1Extra = this.gpuIntent.hand1Extra;

    this.waterSprayCompute = (Fn(() => {
      const position = sprayPositions.element(instanceIndex);
      const velocity = sprayVelocities.element(instanceIndex);
      const dropletLife = sprayLife.element(instanceIndex);
      const dropletSeed = sprayExtra.element(instanceIndex);
      const dt = deltaTime.min(float(0.033));

      dropletLife.x.addAssign(dt);
      velocity.y.subAssign(float(9.8).mul(dt));
      velocity.mulAssign(float(0.992));
      position.addAssign(velocity.mul(dt.mul(float(13))));

      this.applyWaterDropletHandForce(position, velocity, hand0Position, hand0Forces, hand0Velocity, hand0Extra);
      this.applyWaterDropletHandForce(position, velocity, hand1Position, hand1Forces, hand1Velocity, hand1Extra);

      If(dropletLife.x.greaterThan(dropletLife.y), () => {
        this.respawnWaterDroplet(position, velocity, dropletLife, dropletSeed, hand0Position, hand0Forces, hand0Velocity, hand0Extra);
      });
      If(position.y.lessThan(float(-31)), () => {
        this.respawnWaterDroplet(position, velocity, dropletLife, dropletSeed, hand1Position, hand1Forces, hand1Velocity, hand1Extra);
      });
    })() as any).compute(WATER_SPRAY_COUNT);
  }

  private applyWaterDropletHandForce(position: any, velocity: any, handPosition: any, handForces: any, handVelocity: any, handExtra: any): void {
    If(handPosition.w.greaterThan(float(0.5)), () => {
      const delta = handPosition.xyz.sub(position);
      const distance = delta.length().add(float(0.001));
      const falloff = clamp(float(1).sub(distance.div(float(62).add(handExtra.y.mul(float(46))))), float(0), float(1));
      const closedHandGatherEnergy = handForces.y.add(handExtra.w.mul(float(1.2)));
      const openHandWaveEnergy = handForces.x.mul(float(1).sub(handExtra.w.mul(float(0.8))));
      velocity.addAssign(delta.normalize().mul(closedHandGatherEnergy).mul(falloff).mul(float(42)).mul(deltaTime));
      velocity.addAssign(handVelocity.xyz.mul(openHandWaveEnergy).mul(falloff).mul(float(18)).mul(deltaTime));
      velocity.y.addAssign(handForces.z.sub(handForces.w).mul(falloff).mul(float(34)).mul(deltaTime));
    });
  }

  private respawnWaterDroplet(position: any, velocity: any, dropletLife: any, dropletSeed: any, handPosition: any, handForces: any, handVelocity: any, handExtra: any): void {
    const closedHandGatherEnergy = handForces.y.add(handExtra.w.mul(float(1.2)));
    const openHandWaveEnergy = handForces.x.mul(float(1).sub(handExtra.w.mul(float(0.8))));
    const active = handPosition.w.greaterThan(float(0.5));
    const seedX = dropletSeed.x;
    const seedZ = dropletSeed.y;

    position.x.assign(seedX.mul(float(WORLD_SIZE * 0.45)));
    position.y.assign(float(-19.8).add(dropletSeed.z.mul(float(2))));
    position.z.assign(seedZ.mul(float(WORLD_SIZE * 0.45)));
    velocity.x.assign(seedZ.mul(float(0.8)));
    velocity.y.assign(float(1.8).add(dropletSeed.w.mul(float(4))));
    velocity.z.assign(seedX.negate().mul(float(0.8)));

    If(active, () => {
      position.assign(handPosition.xyz.add(vec3(seedX.mul(float(10)), float(-5).add(dropletSeed.z.mul(float(8))), seedZ.mul(float(10)))));
      velocity.assign(handVelocity.xyz.mul(float(10).add(openHandWaveEnergy.mul(float(18)))));
      velocity.addAssign(vec3(seedX, float(0.45).add(handForces.z), seedZ).normalize().mul(openHandWaveEnergy.add(closedHandGatherEnergy).mul(float(18))));
      velocity.y.addAssign(float(5).add(handForces.z.mul(float(18))));
    });

    dropletLife.x.assign(float(0));
    dropletLife.y.assign(float(0.55).add(dropletSeed.w.mul(float(1.45))).add(openHandWaveEnergy.mul(float(0.4))));
  }

  private applyWaterHandImpulse(position: any, velocity: any, cellState: any, handPosition: any, handForces: any, handExtra: any): void {
    If(handPosition.w.greaterThan(float(0.5)), () => {
      const delta = position.sub(handPosition.xyz);
      const horizontal = vec3(delta.x, float(0), delta.z);
      const radius = float(76).add(handExtra.y.mul(float(42))).add(handExtra.w.mul(float(32)));
      const falloff = clamp(float(1).sub(horizontal.length().div(radius)), float(0), float(1));
      const impulse = handForces.z.sub(handForces.w).add(handForces.y.sub(handForces.x).mul(float(0.4)));

      velocity.y.addAssign(impulse.mul(falloff).mul(float(34)).mul(deltaTime));
      cellState.z.assign(clamp(cellState.z.add(falloff.mul(handForces.x.add(handForces.y).add(handExtra.w)).mul(float(0.07))), float(0), float(1)));
    });
  }

  update(deltaTime: number, gestures: GestureState): void {
    if (!this.active) return;

    this.time += deltaTime;
    this.updateInfluence(gestures);

    if (this.context.backend === 'webgpu') {
      this.updateGpuWater(deltaTime, gestures);
      return;
    }

    // Wave equation simulation
    this.simulateWaves(deltaTime);

    // Apply hand influences
    this.applyInfluences();

    this.updateHeightTexture();
    (this.material as THREE.ShaderMaterial).uniforms.time.value = this.time;
  }

  private updateGpuWater(deltaTime: number, gestures: GestureState): void {
    if (!this.gpuField || !this.gpuCompute) return;

    const intent = this.intentSmoother.update(createElementalIntent(gestures), deltaTime);
    this.gpuIntent.update(intent);
    const renderer = this.context.renderer as WebGPURenderer;
    void renderer.computeAsync(this.gpuCompute);
    this.sphWater?.update(renderer);

    const field = createHandGravityField(intent);
    const originForce = sampleHandGravityField(field, new THREE.Vector3()).force.length();
    const energy = intent.hands.reduce((sum, hand) => sum + hand.project + hand.gather + hand.lift, 0)
      + intent.twoHand.gather
      + intent.twoHand.spread;
    this.gpuField.material.opacity = 0.045 + Math.min(0.095, energy * 0.014);
    this.gpuField.material.size = 0.32 + Math.min(0.58, energy * 0.065);
    this.updateOpticalWater(intent, originForce);
    this.updateWaterColumn(deltaTime, intent);
    this.updateGpuWaterSpray(deltaTime, intent);
    this.updateFoamRings(deltaTime, intent, energy);
    if (this.waterVolume?.material instanceof THREE.MeshPhysicalMaterial) {
      this.waterVolume.material.opacity = 0.2 + Math.min(0.12, originForce * 0.035);
    }
  }

  private updateWaterColumn(deltaTime: number, intent: ReturnType<typeof createElementalIntent>): void {
    if (!this.waterColumn) return;

    const strongestHand = intent.hands.reduce<typeof intent.hands[number] | null>((current, hand) => {
      if (!current) return hand;
      return hand.gather + hand.hold > current.gather + current.hold ? hand : current;
    }, null);
    const closedHandGatherEnergy = strongestHand ? strongestHand.gather + strongestHand.hold + strongestHand.lift * 0.45 : 0;
    const openHandWaveEnergy = strongestHand ? strongestHand.project * Math.max(0, 1 - strongestHand.hold) : 0;
    const targetOpacity = Math.max(0, closedHandGatherEnergy - openHandWaveEnergy * 0.4) * 0.42;

    if (strongestHand && targetOpacity > 0.04) {
      this.waterColumn.visible = true;
      this.waterColumn.position.lerp(
        new THREE.Vector3(strongestHand.position.x, -10 + strongestHand.lift * 12, strongestHand.position.z),
        Math.min(1, deltaTime * 7)
      );
      const radius = 4 + strongestHand.spread * 7 + strongestHand.hold * 5;
      const height = 10 + strongestHand.lift * 26 + closedHandGatherEnergy * 12;
      this.waterColumn.scale.lerp(new THREE.Vector3(radius, height / 32, radius), Math.min(1, deltaTime * 6));
      this.waterColumn.rotation.y += (strongestHand.swirl * 2.4 + closedHandGatherEnergy * 0.8) * deltaTime;
    }

    const material = this.waterColumn.material as THREE.MeshPhysicalMaterial;
    material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, Math.min(1, deltaTime * 5));
    if (material.opacity < 0.02) {
      this.waterColumn.visible = false;
    }
  }

  private updateOpticalWater(intent: ReturnType<typeof createElementalIntent>, originForce: number): void {
    if (!this.gpuSurface) return;

    const node = (this.gpuSurface.material as any).colorNode;
    if (!node) return;

    const openHandWaveEnergy = intent.hands.reduce((sum, hand) => sum + hand.project * Math.max(0, 1 - hand.hold), 0);
    const closedHandGatherEnergy = intent.hands.reduce((sum, hand) => sum + hand.gather + hand.hold, 0);
    const swirl = intent.hands.reduce((sum, hand) => sum + hand.swirl, 0) + intent.twoHand.swirl;
    const strongestHand = intent.hands[0];

    if (strongestHand) {
      this.waterFlowDirection
        .set(strongestHand.velocity.x + swirl * 0.7, strongestHand.velocity.z + openHandWaveEnergy * 0.35 + 0.001)
        .normalize();
      node.flowDirection.value.copy(this.waterFlowDirection);
    }

    node.flowSpeed.value = 0.035 + openHandWaveEnergy * 0.045 + closedHandGatherEnergy * 0.018 + Math.abs(swirl) * 0.02;
    node.scale.value = 3.8 + openHandWaveEnergy * 2.4 + Math.min(2.6, originForce * 0.5);
    node.reflectivity.value = 0.12 + Math.min(0.2, closedHandGatherEnergy * 0.04 + openHandWaveEnergy * 0.035);
  }

  private updateGpuWaterSpray(deltaTime: number, intent: ReturnType<typeof createElementalIntent>): void {
    if (!this.waterSpray || !this.waterSprayCompute) return;

    const closedHandGatherEnergy = intent.hands.reduce((sum, hand) => sum + hand.gather + hand.hold, 0);
    const openHandWaveEnergy = intent.hands.reduce((sum, hand) => sum + hand.project * Math.max(0, 1 - hand.hold), 0)
      + intent.twoHand.spread;
    void deltaTime;
    void (this.context.renderer as WebGPURenderer).computeAsync(this.waterSprayCompute);
    this.waterSpray.material.opacity = 0.08 + Math.min(0.28, openHandWaveEnergy * 0.13 + closedHandGatherEnergy * 0.08);
    this.waterSpray.material.size = 0.36 + Math.min(0.42, openHandWaveEnergy * 0.08);
  }

  private updateFoamRings(deltaTime: number, intent: ReturnType<typeof createElementalIntent>, energy: number): void {
    for (const hand of intent.hands) {
      const trigger = hand.gather + hand.lift + hand.project + hand.hold;
      if (trigger > 0.72) {
        this.spawnFoamRing(hand.position, 0.8 + trigger * 0.35);
      }
    }

    this.foamRings.forEach((ring, index) => {
      const state = this.foamRingState[index];
      if (!state.active) return;

      state.age += deltaTime;
      const t = state.age / state.life;
      if (t >= 1) {
        state.active = false;
        ring.visible = false;
        return;
      }

      const scale = THREE.MathUtils.lerp(4, 34 + energy * 8, t);
      ring.scale.set(scale, scale, scale);
      ring.position.y = -18.6 + Math.sin(this.time * 3 + index) * 0.18;
      const material = ring.material as THREE.LineBasicMaterial;
      material.opacity = Math.sin(t * Math.PI) * 0.72;
    });
  }

  private spawnFoamRing(position: THREE.Vector3, life: number): void {
    const available = this.foamRingState.findIndex((state) => !state.active);
    if (available === -1) return;

    const ring = this.foamRings[available];
    const state = this.foamRingState[available];
    state.age = 0;
    state.life = life;
    state.active = true;
    ring.position.set(position.x, -18.7, position.z);
    ring.scale.setScalar(4);
    ring.visible = true;
  }

  private simulateWaves(deltaTime: number): void {
    const c2 = this.waveSpeed * this.waveSpeed;
    const dt2 = deltaTime * deltaTime;

    for (let y = 1; y < GRID_SIZE - 1; y++) {
      for (let x = 1; x < GRID_SIZE - 1; x++) {
        const idx = y * GRID_SIZE + x;

        // Get neighboring heights
        const left = this.heightCurrent[idx - 1];
        const right = this.heightCurrent[idx + 1];
        const up = this.heightCurrent[idx - GRID_SIZE];
        const down = this.heightCurrent[idx + GRID_SIZE];
        const center = this.heightCurrent[idx];
        const prev = this.heightPrevious[idx];

        // Discrete Laplacian
        const laplacian = left + right + up + down - 4 * center;

        // Wave equation: new = 2*current - previous + c²*∇²h*dt²
        // Reduced amplification from 100 to 40 for calmer waves
        let newHeight = 2 * center - prev + c2 * laplacian * dt2 * 40;

        // Apply damping
        newHeight *= this.damping;

        // Clamp height to prevent extreme values
        newHeight = Math.max(this.minHeight, Math.min(this.maxHeight, newHeight));

        this.heightNext[idx] = newHeight;
      }
    }

    // Swap buffers
    const temp = this.heightPrevious;
    this.heightPrevious = this.heightCurrent;
    this.heightCurrent = this.heightNext;
    this.heightNext = temp;
  }

  private applyInfluences(): void {
    for (const point of this.influenceField.points) {
      // Convert world position to grid coordinates
      const gridX = Math.floor((point.position.x / WORLD_SIZE + 0.5) * GRID_SIZE);
      const gridZ = Math.floor((point.position.z / WORLD_SIZE + 0.5) * GRID_SIZE);

      const radius = Math.floor((point.radius / WORLD_SIZE) * GRID_SIZE);

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = gridX + dx;
          const z = gridZ + dy;

          if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) continue;

          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > radius) continue;

          const falloff = Math.pow(1 - dist / radius, 2);
          const idx = z * GRID_SIZE + x;

          // Radial force creates ripples - reduced for calmer interaction
          if (Math.abs(point.radialForce) > 0.01) {
            this.heightCurrent[idx] += point.radialForce * falloff * 0.15;
          }

          // Vertical bias raises/lowers water - reduced for subtler control
          if (Math.abs(point.verticalBias) > 0.01) {
            this.heightCurrent[idx] += point.verticalBias * falloff * 0.1;
          }

          // Tangential force creates swirl (offset pattern)
          if (Math.abs(point.tangentialForce) > 0.01) {
            const angle = Math.atan2(dy, dx);
            const swirl = Math.sin(angle * 3 + this.time * 5) * point.tangentialForce * falloff * 0.08;
            this.heightCurrent[idx] += swirl;
          }
        }
      }
    }
  }

  private updateHeightTexture(): void {
    // Copy current heights to texture data
    const data = this.heightTexture.image.data as Float32Array;
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      data[i] = this.heightCurrent[i];
    }
    this.heightTexture.needsUpdate = true;
  }

  activate(): void {
    super.activate();
    if (this.context.backend === 'webgpu' && this.gpuField) {
      if (this.screenSpaceFluid) {
        this.screenSpaceFluid.enabled = true;
      }
      if (this.waterVolume) {
        this.scene.add(this.waterVolume);
      }
      if (this.waterColumn) {
        this.scene.add(this.waterColumn);
      }
      if (this.gpuSurface) {
        this.scene.add(this.gpuSurface);
      }
      if (this.waterSpray) {
        this.scene.add(this.waterSpray.sprite);
      }
      if (this.sphWater) {
        this.scene.add(this.sphWater.system.sprite);
      }
      this.scene.add(this.gpuField.sprite);
      this.scene.add(this.foamGroup);
    } else {
      this.scene.add(this.mesh);
    }
  }

  deactivate(): void {
    super.deactivate();
    if (this.screenSpaceFluid) {
      this.screenSpaceFluid.enabled = false;
    }
    if (this.gpuField) {
      this.scene.remove(this.gpuField.sprite);
    }
    if (this.gpuSurface) {
      this.scene.remove(this.gpuSurface);
    }
    if (this.waterVolume) {
      this.scene.remove(this.waterVolume);
    }
    if (this.waterColumn) {
      this.scene.remove(this.waterColumn);
    }
    if (this.waterSpray) {
      this.scene.remove(this.waterSpray.sprite);
    }
    if (this.sphWater) {
      this.scene.remove(this.sphWater.system.sprite);
    }
    this.scene.remove(this.foamGroup);
    if (this.mesh) {
      this.scene.remove(this.mesh);
    }
  }

  dispose(): void {
    this.unregisterScreenSpaceFluid?.();
    this.screenSpaceFluid?.dispose();
    this.geometry?.dispose();
    this.material?.dispose();
    this.heightTexture?.dispose();
    this.gpuField?.material.dispose();
    this.gpuSurface?.geometry.dispose();
    this.waterNormalMap0?.dispose();
    this.waterNormalMap1?.dispose();
    this.waterVolume?.geometry.dispose();
    if (this.waterVolume?.material instanceof THREE.Material) {
      this.waterVolume.material.dispose();
    }
    this.waterColumn?.geometry.dispose();
    if (this.waterColumn?.material instanceof THREE.Material) {
      this.waterColumn.material.dispose();
    }
    this.waterSpray?.material.dispose();
    this.sphWater?.dispose();
    this.foamRings.forEach((ring) => {
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    });
    if (this.mesh) {
      this.scene.remove(this.mesh);
    }
    if (this.gpuField) {
      this.scene.remove(this.gpuField.sprite);
    }
    if (this.gpuSurface) {
      this.scene.remove(this.gpuSurface);
    }
    if (this.waterVolume) {
      this.scene.remove(this.waterVolume);
    }
    if (this.waterColumn) {
      this.scene.remove(this.waterColumn);
    }
    if (this.waterSpray) {
      this.scene.remove(this.waterSpray.sprite);
    }
    if (this.sphWater) {
      this.scene.remove(this.sphWater.system.sprite);
    }
    this.scene.remove(this.foamGroup);
  }
}
