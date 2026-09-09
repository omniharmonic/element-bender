import * as THREE from 'three';
import { MeshStandardNodeMaterial, WebGPURenderer } from 'three/webgpu';
import { Fn, If, clamp, color, deltaTime, float, instanceIndex, mix, positionLocal, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { BaseElement } from '../BaseElement';
import { GestureState } from '../../gestures/GestureState';
import type { RenderContext } from '../../rendering/RenderContext';
import { ElementalIntentSmoother, createElementalIntent } from '../../gestures/ElementalIntent';
import { GpuIntentBuffer } from '../../rendering/gpu/GpuIntentBuffer';
import { GpuHeightField, createGpuHeightField } from '../../rendering/gpu/GpuHeightField';
import { GpuParticleSystem, createGpuParticleSystem } from '../../rendering/gpu/GpuParticles';
import { createHandGravityField, sampleHandGravityField } from '../../gestures/HandGravityField';

const GRID_SIZE = 128;
const WORLD_SIZE = 120;
const ROCK_COUNT = 3000;
const RUNOFF_PARTICLE_COUNT = 12000;

// Terrain vertex shader with improved displacement
const earthVertexShader = `
  uniform sampler2D heightMap;
  uniform float worldSize;
  uniform float time;

  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vHeight;

  void main() {
    vUv = uv;

    // Sample height from texture
    float height = texture2D(heightMap, uv).r;
    vHeight = height;

    // Calculate position with height displacement
    vec3 pos = position;
    pos.y = (height - 0.5) * 40.0;

    // Calculate normal from neighboring heights
    float texelSize = 1.0 / ${GRID_SIZE.toFixed(1)};
    float hL = texture2D(heightMap, uv - vec2(texelSize, 0.0)).r;
    float hR = texture2D(heightMap, uv + vec2(texelSize, 0.0)).r;
    float hD = texture2D(heightMap, uv - vec2(0.0, texelSize)).r;
    float hU = texture2D(heightMap, uv + vec2(0.0, texelSize)).r;

    vec3 normal = normalize(vec3(
      (hL - hR) * 20.0,
      2.0,
      (hD - hU) * 20.0
    ));
    vNormal = normalMatrix * normal;

    vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// Terrain fragment shader with richer colors
const earthFragmentShader = `
  uniform vec3 soilColor;
  uniform vec3 rockColor;
  uniform vec3 sandColor;
  uniform float time;

  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vHeight;

  // Improved noise function
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    // Calculate slope from normal
    float slope = 1.0 - vNormal.y;

    // Multi-scale noise for texture variation
    float n1 = fbm(vUv * 30.0);
    float n2 = fbm(vUv * 60.0) * 0.5;
    float variation = n1 + n2;

    // Height-based coloring with smooth transitions
    vec3 color;

    // Low areas - sandy soil
    if (vHeight < 0.35) {
      float t = vHeight / 0.35;
      color = mix(sandColor, soilColor, t + variation * 0.2);
    }
    // Mid areas - rich soil
    else if (vHeight < 0.55) {
      float t = (vHeight - 0.35) / 0.2;
      color = mix(soilColor, soilColor * 1.1, t);
      color = mix(color, rockColor * 0.8, variation * 0.3);
    }
    // High areas - rocky
    else {
      float t = (vHeight - 0.55) / 0.45;
      color = mix(soilColor * 0.9, rockColor, t);
    }

    // Steep slopes are always rocky
    color = mix(color, rockColor, smoothstep(0.3, 0.7, slope));

    // Add surface detail based on noise
    color *= 0.85 + variation * 0.3;

    // Improved lighting
    vec3 lightDir = normalize(vec3(0.4, 0.8, 0.3));
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

    // Ambient
    float ambient = 0.35;

    // Diffuse
    float diffuse = max(dot(vNormal, lightDir), 0.0) * 0.65;

    // Subtle rim lighting for depth
    float rim = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 3.0) * 0.15;

    vec3 finalColor = color * (ambient + diffuse) + rim * rockColor;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// Rock particle shader
const rockVertexShader = `
  attribute float size;
  attribute float rotation;
  attribute vec3 rockColor;

  varying vec3 vColor;
  varying float vRotation;

  void main() {
    vColor = rockColor;
    vRotation = rotation;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const rockFragmentShader = `
  varying vec3 vColor;
  varying float vRotation;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);

    // Rotate the UV coordinates
    float c = cos(vRotation);
    float s = sin(vRotation);
    vec2 rotated = vec2(
      center.x * c - center.y * s,
      center.x * s + center.y * c
    );

    // Create irregular rock shape using multiple circles
    float dist = length(rotated);
    float distortion = length(rotated * vec2(1.2, 0.8));
    float rock = max(dist, distortion * 0.9);

    if (rock > 0.45) discard;

    // Shading for 3D appearance
    float shade = 1.0 - smoothstep(0.1, 0.45, rock);
    shade = pow(shade, 0.7);

    // Add highlight
    float highlight = smoothstep(0.3, 0.1, length(rotated - vec2(-0.1, -0.1)));

    vec3 finalColor = vColor * shade + highlight * 0.2;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

interface RockParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  size: number;
  rotation: number;
  rotationSpeed: number;
  color: THREE.Color;
  grounded: boolean;
  groundHeight: number;
}

export class EarthElement extends BaseElement {
  private geometry!: THREE.PlaneGeometry;
  private material!: THREE.ShaderMaterial | THREE.MeshStandardMaterial;
  private mesh!: THREE.Mesh;
  private gpuTerrain?: GpuHeightField;
  private gpuSurface?: THREE.Mesh;
  private gpuSurfaceMaterial?: MeshStandardNodeMaterial;
  private gpuCompute?: any;
  private gpuAssets = new THREE.Group();
  private riverGroup = new THREE.Group();
  private runoffWater?: GpuParticleSystem;
  private runoffWaterCompute?: any;
  private treeMesh?: THREE.InstancedMesh;
  private treeBaseTransforms: Array<{
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: number;
    growthBias: number;
  }> = [];
  private readonly gpuIntent = new GpuIntentBuffer();
  private readonly intentSmoother = new ElementalIntentSmoother(0.34, 0.45);
  private readonly sculptAnchors = [
    new THREE.Vector4(-24, -18, 0.28, 32),
    new THREE.Vector4(22, 14, -0.18, 28),
    new THREE.Vector4(0, 26, 0.16, 34),
    new THREE.Vector4(18, -28, -0.1, 30),
  ];
  private sculptAnchorNodes: any[] = [];
  private nextSculptAnchor = 0;
  private settledTime = 0;
  private seasonPhase = 0;
  private plasticStrain = 0;
  private readonly riverBasin = new THREE.Vector4(0, 0, 0.35, 42);

  // Height buffer
  private heightData: Float32Array;
  private heightTexture!: THREE.DataTexture;
  private targetHeights: Float32Array;

  // Rock particles
  private rockGeometry!: THREE.BufferGeometry;
  private rockMaterial!: THREE.ShaderMaterial | THREE.PointsMaterial;
  private rockPoints!: THREE.Points;
  private rocks: RockParticle[] = [];

  private time = 0;

  // Colors
  private readonly soilColor = new THREE.Color(0x5c4033);
  private readonly rockColor = new THREE.Color(0x6b6b6b);
  private readonly sandColor = new THREE.Color(0xa67c52);

  constructor(context: RenderContext) {
    super(context);

    // Initialize height data with procedural terrain
    const size = GRID_SIZE * GRID_SIZE;
    this.heightData = new Float32Array(size);
    this.targetHeights = new Float32Array(size);

    // Generate initial terrain with smoother noise
    this.generateTerrain();
  }

  private generateTerrain(): void {
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const idx = y * GRID_SIZE + x;
        const nx = x / GRID_SIZE;
        const ny = y / GRID_SIZE;

        // Multi-octave noise for natural terrain
        let height = 0;
        height += this.smoothNoise(nx * 3, ny * 3) * 0.5;
        height += this.smoothNoise(nx * 6, ny * 6) * 0.25;
        height += this.smoothNoise(nx * 12, ny * 12) * 0.125;

        // Create a bowl shape - higher at edges
        const dx = nx - 0.5;
        const dy = ny - 0.5;
        const distFromCenter = Math.sqrt(dx * dx + dy * dy) * 2;
        const bowl = Math.pow(distFromCenter, 2) * 0.3;

        this.heightData[idx] = (height * 0.5 + 0.5) * 0.7 + bowl * 0.3;
        this.targetHeights[idx] = this.heightData[idx];
      }
    }
  }

  private smoothNoise(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    // Smoothstep interpolation
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const n00 = this.hash(ix, iy);
    const n10 = this.hash(ix + 1, iy);
    const n01 = this.hash(ix, iy + 1);
    const n11 = this.hash(ix + 1, iy + 1);

    const nx0 = n00 * (1 - sx) + n10 * sx;
    const nx1 = n01 * (1 - sx) + n11 * sx;

    return (nx0 * (1 - sy) + nx1 * sy) * 2 - 1;
  }

  private hash(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  async init(): Promise<void> {
    if (this.context.backend === 'webgpu') {
      this.initGpuLandscape();
      return;
    }

    // Create height texture
    this.heightTexture = new THREE.DataTexture(
      new Float32Array(GRID_SIZE * GRID_SIZE),
      GRID_SIZE,
      GRID_SIZE,
      THREE.RedFormat,
      THREE.FloatType
    );
    this.updateHeightTexture();

    // Create terrain geometry
    this.geometry = new THREE.PlaneGeometry(
      WORLD_SIZE,
      WORLD_SIZE,
      GRID_SIZE - 1,
      GRID_SIZE - 1
    );
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader: earthVertexShader,
      fragmentShader: earthFragmentShader,
      uniforms: {
        heightMap: { value: this.heightTexture },
        worldSize: { value: WORLD_SIZE },
        time: { value: 0 },
        soilColor: { value: this.soilColor },
        rockColor: { value: this.rockColor },
        sandColor: { value: this.sandColor },
      },
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = -20;

    // Initialize rock particles
    this.initRocks();
  }

  private initGpuLandscape(): void {
    const size = 150;
    this.gpuTerrain = createGpuHeightField(
      size,
      WORLD_SIZE,
      0x8d6f46,
      2.8,
      (x, y) => {
        const nx = x / (size - 1);
        const ny = y / (size - 1);
        const dx = nx - 0.5;
        const dy = ny - 0.5;
        const ridge = Math.sin(nx * Math.PI * 5.5) * Math.cos(ny * Math.PI * 4.5) * 5;
        const bowl = (dx * dx + dy * dy) * 26;
        const height = -20 + ridge + bowl - 6;
        const moisture = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2);

        return {
          height,
          velocity: 0,
          state: new THREE.Vector4(height, 0, 0, Math.random()),
          moisture: new THREE.Vector4(moisture, 0, 0, 0),
        };
      }
    );

    const positions = this.gpuTerrain.positions;
    const velocities = this.gpuTerrain.velocities;
    const state = this.gpuTerrain.state;
    const moisture = this.gpuTerrain.moisture;
    const hand0Position = this.gpuIntent.hand0Position;
    const hand0Forces = this.gpuIntent.hand0Forces;
    const hand0Extra = this.gpuIntent.hand0Extra;
    const hand1Position = this.gpuIntent.hand1Position;
    const hand1Forces = this.gpuIntent.hand1Forces;
    const hand1Extra = this.gpuIntent.hand1Extra;
    const twoHand = this.gpuIntent.twoHand;
    const twoHandForces = this.gpuIntent.twoHandForces;
    const riverBasin = uniform(this.riverBasin);

    this.gpuCompute = (Fn(() => {
      const position = positions.element(instanceIndex);
      const velocity = velocities.element(instanceIndex);
      const terrainState = state.element(instanceIndex);
      const moistureState = moisture.element(instanceIndex);
      const dt = deltaTime.min(float(0.033));
      const slopeMemory = terrainState.x.sub(position.y);

      velocity.y.addAssign(slopeMemory.mul(float(0.08)).mul(dt));
      this.applyEarthBrush(position, velocity, terrainState, moistureState, hand0Position, hand0Forces, hand0Extra);
      this.applyEarthBrush(position, velocity, terrainState, moistureState, hand1Position, hand1Forces, hand1Extra);
      this.applyHydraulicErosion(position, velocity, terrainState, moistureState, riverBasin);

      If(twoHand.w.greaterThan(float(0.5)), () => {
        const delta = position.sub(twoHand.xyz);
        const falloff = clamp(float(1).sub(delta.length().div(twoHandForces.x.max(float(28)))), float(0), float(1));
        velocity.y.addAssign(twoHandForces.y.sub(twoHandForces.z).mul(falloff).mul(float(18)).mul(dt));
        terrainState.z.assign(clamp(terrainState.z.add(twoHandForces.w.abs().mul(falloff).mul(float(0.008))), float(0), float(1)));
      });

      const waterBias = moistureState.x.mul(float(0.018));
      const snowLine = position.y.sub(float(-4)).mul(float(0.018));
      moistureState.x.assign(clamp(moistureState.x.add(waterBias).sub(position.y.abs().mul(float(0.00002))), float(0), float(1)));
      terrainState.z.assign(clamp(terrainState.z.mul(float(0.999)).add(snowLine.max(float(0)).mul(float(0.0008))), float(0), float(1)));
      velocity.y.mulAssign(float(0.95));
      position.y.addAssign(velocity.y.mul(dt.mul(float(14))));
      terrainState.y.assign(clamp(moistureState.x.mul(float(0.8)).add(terrainState.z.mul(float(0.2))), float(0), float(1)));
    })() as any).compute(size * size);

    this.gpuTerrain.sprite.position.y = 0;
    this.gpuTerrain.material.opacity = 0.16;
    this.gpuTerrain.material.size = 1.4;
    this.initGpuTerrainSurface();
    this.initGpuLandscapeAssets();
    this.initRunoffWater();
  }

  private initGpuTerrainSurface(): void {
    const geometry = new THREE.PlaneGeometry(WORLD_SIZE * 1.18, WORLD_SIZE * 1.18, 210, 210);
    geometry.rotateX(-Math.PI / 2);
    const material = new MeshStandardNodeMaterial({
      roughness: 0.92,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const hand0Position = this.gpuIntent.hand0Position;
    const hand0Forces = this.gpuIntent.hand0Forces;
    const hand0Extra = this.gpuIntent.hand0Extra;
    const hand1Position = this.gpuIntent.hand1Position;
    const hand1Forces = this.gpuIntent.hand1Forces;
    const hand1Extra = this.gpuIntent.hand1Extra;
    const twoHand = this.gpuIntent.twoHand;
    const twoHandForces = this.gpuIntent.twoHandForces;
    const riverBasin = uniform(this.riverBasin);
    this.sculptAnchorNodes = this.sculptAnchors.map((anchor) => uniform(anchor));

    material.positionNode = Fn(() => {
      const pos = positionLocal.toVar();
      const ridgeA = pos.x.mul(float(0.06)).sin().mul(pos.z.mul(float(0.045)).cos()).mul(float(9));
      const ridgeB = pos.x.add(pos.z.mul(float(0.65))).mul(float(0.032)).cos().mul(float(6));
      const basin = pos.x.mul(pos.x).add(pos.z.mul(pos.z)).mul(float(0.0025));
      const meander = pos.z.mul(float(0.065)).sin().mul(float(14));
      const riverDistance = pos.x.sub(riverBasin.x).sub(meander).abs();
      const hydraulicChannel = clamp(float(1).sub(riverDistance.div(riverBasin.w)), float(0), float(1));
      pos.y.addAssign(ridgeA.add(ridgeB).add(basin).sub(float(12)));
      pos.y.subAssign(hydraulicChannel.mul(hydraulicChannel).mul(float(5.6)));
      this.applyEarthSurfaceBrush(pos, hand0Position, hand0Forces, hand0Extra);
      this.applyEarthSurfaceBrush(pos, hand1Position, hand1Forces, hand1Extra);
      this.sculptAnchorNodes.forEach((anchor) => {
        this.applyPersistentSculptAnchor(pos, anchor);
      });

      If(twoHand.w.greaterThan(float(0.5)), () => {
        const delta = pos.sub(twoHand.xyz);
        const falloff = clamp(float(1).sub(delta.length().div(twoHandForces.x.max(float(34)))), float(0), float(1));
        pos.y.addAssign(twoHandForces.y.sub(twoHandForces.z).mul(falloff).mul(float(22)));
      });

      return pos;
    })();
    material.colorNode = Fn(() => {
      const heightTone = uv().y.mul(float(1.3)).add(positionLocal.x.mul(float(0.01)).sin().mul(float(0.18)));
      const meander = positionLocal.z.mul(float(0.065)).sin().mul(float(14));
      const riverDistance = positionLocal.x.sub(riverBasin.x).sub(meander).abs();
      const riverWetness = clamp(float(1).sub(riverDistance.div(riverBasin.w)), float(0), float(1));
      const mudSpecular = smoothstep(float(0.22), float(0.88), riverWetness);
      const low = color(0x4d3928);
      const high = color(0x9a896f);
      const wetMud = color(0x24180f);
      const snow = color(0xe8e3d4);
      const lichen = color(0x526744);
      const ground = mix(low, high, smoothstep(float(0.18), float(0.88), heightTone));
      const vegetated = mix(ground, lichen, smoothstep(float(0.22), float(0.48), heightTone).mul(float(0.38)));
      const muddy = mix(vegetated, wetMud, mudSpecular.mul(float(0.62)));
      return mix(muddy, snow, smoothstep(float(0.82), float(1.12), heightTone));
    })();

    this.gpuSurfaceMaterial = material;
    this.gpuSurface = new THREE.Mesh(geometry, material);
    this.gpuSurface.position.y = -8;
    this.gpuSurface.receiveShadow = true;
  }

  private applyEarthSurfaceBrush(pos: any, handPosition: any, handForces: any, handExtra: any): void {
    If(handPosition.w.greaterThan(float(0.5)), () => {
      const delta = pos.sub(handPosition.xyz);
      const horizontal = vec3(delta.x, float(0), delta.z);
      const falloff = clamp(float(1).sub(horizontal.length().div(float(52).add(handExtra.y.mul(float(24))))), float(0), float(1));
      const closedHandSculptEnergy = handForces.y.add(handExtra.w.mul(float(1.25)));
      const openHandCarveEnergy = handForces.x.mul(float(1).sub(handExtra.w.mul(float(0.75))));
      const sculpt = closedHandSculptEnergy.add(handForces.z).sub(openHandCarveEnergy.mul(float(0.9))).sub(handForces.w);
      pos.y.addAssign(sculpt.mul(falloff).mul(float(20)));
    });
  }

  private applyPersistentSculptAnchor(pos: any, anchor: any): void {
    const delta = vec3(pos.x.sub(anchor.x), float(0), pos.z.sub(anchor.y));
    const falloff = clamp(float(1).sub(delta.length().div(anchor.w.max(float(1)))), float(0), float(1));
    pos.y.addAssign(anchor.z.mul(falloff).mul(float(30)));
  }

  private applyEarthBrush(position: any, velocity: any, terrainState: any, moistureState: any, handPosition: any, handForces: any, handExtra: any): void {
    If(handPosition.w.greaterThan(float(0.5)), () => {
      const delta = position.sub(handPosition.xyz);
      const horizontal = vec3(delta.x, float(0), delta.z);
      const falloff = clamp(float(1).sub(horizontal.length().div(float(42))), float(0), float(1));
      const closedHandSculptEnergy = handForces.y.add(handExtra.w.mul(float(1.1)));
      const openHandCarveEnergy = handForces.x.mul(float(1).sub(handExtra.w.mul(float(0.8))));
      const lift = handForces.z.sub(handForces.w).add(closedHandSculptEnergy.sub(openHandCarveEnergy).mul(float(0.72)));

      velocity.y.addAssign(lift.mul(falloff).mul(float(20)).mul(deltaTime));
      terrainState.x.addAssign(lift.mul(falloff).mul(float(0.12)).mul(deltaTime));
      moistureState.x.assign(clamp(moistureState.x.add(openHandCarveEnergy.add(handForces.z).mul(falloff).mul(float(0.008))), float(0), float(1)));
      terrainState.z.assign(clamp(terrainState.z.add(handForces.w.mul(falloff).mul(float(0.01))), float(0), float(1)));
    });
  }

  private applyHydraulicErosion(position: any, velocity: any, terrainState: any, moistureState: any, riverBasin: any): void {
    const meander = position.z.mul(float(0.07)).sin().mul(float(12));
    const riverDistance = position.x.sub(riverBasin.x).sub(meander).abs();
    const channel = clamp(float(1).sub(riverDistance.div(riverBasin.w.max(float(1)))), float(0), float(1));
    const waterPressure = moistureState.x.add(terrainState.y).mul(channel);
    const sedimentCarry = waterPressure.mul(float(0.42)).sub(position.y.mul(float(0.004)));

    velocity.y.subAssign(sedimentCarry.mul(float(0.95)).mul(deltaTime));
    terrainState.x.subAssign(sedimentCarry.mul(float(0.06)).mul(deltaTime));
    terrainState.y.assign(clamp(terrainState.y.add(channel.mul(moistureState.x).mul(float(0.018))), float(0), float(1)));
    moistureState.x.assign(clamp(moistureState.x.add(channel.mul(float(0.004))).sub(position.y.max(float(0)).mul(float(0.00004))), float(0), float(1)));
  }

  private initRunoffWater(): void {
    const positions = new Float32Array(RUNOFF_PARTICLE_COUNT * 3);
    const velocities = new Float32Array(RUNOFF_PARTICLE_COUNT * 3);
    const life = new Float32Array(RUNOFF_PARTICLE_COUNT * 4);
    const extra = new Float32Array(RUNOFF_PARTICLE_COUNT * 4);

    for (let i = 0; i < RUNOFF_PARTICLE_COUNT; i++) {
      const idx = i * 3;
      const vec4Idx = i * 4;
      const channel = (i % 7) / 6;
      const lane = channel * 2 - 1;
      const along = Math.random();
      const meander = Math.sin(along * Math.PI * 5 + channel * 8) * 4;
      positions[idx] = lane * WORLD_SIZE * 0.28 + meander + (Math.random() - 0.5) * 3;
      positions[idx + 1] = -12 - along * 10 + Math.random() * 1.2;
      positions[idx + 2] = (along - 0.5) * WORLD_SIZE * 0.9;
      velocities[idx] = Math.sin(along * 8 + channel) * 0.5;
      velocities[idx + 1] = -0.2;
      velocities[idx + 2] = 4 + Math.random() * 6;
      life[vec4Idx] = Math.random() * 2;
      life[vec4Idx + 1] = 1.4 + Math.random() * 2.2;
      life[vec4Idx + 2] = channel;
      life[vec4Idx + 3] = along;
      extra[vec4Idx] = lane;
      extra[vec4Idx + 1] = Math.random() * 2 - 1;
      extra[vec4Idx + 2] = Math.random();
      extra[vec4Idx + 3] = Math.random();
    }

    this.runoffWater = createGpuParticleSystem(
      RUNOFF_PARTICLE_COUNT,
      positions,
      velocities,
      life,
      extra,
      0x9decff,
      0.5,
      0.24
    );

    const runoffPositions = this.runoffWater.positions;
    const runoffVelocities = this.runoffWater.velocities;
    const runoffLife = this.runoffWater.life;
    const runoffExtra = this.runoffWater.extra;
    const hand0Position = this.gpuIntent.hand0Position;
    const hand0Forces = this.gpuIntent.hand0Forces;
    const hand0Extra = this.gpuIntent.hand0Extra;
    const hand1Position = this.gpuIntent.hand1Position;
    const hand1Forces = this.gpuIntent.hand1Forces;
    const hand1Extra = this.gpuIntent.hand1Extra;

    this.runoffWaterCompute = (Fn(() => {
      const position = runoffPositions.element(instanceIndex);
      const velocity = runoffVelocities.element(instanceIndex);
      const runoffLifeState = runoffLife.element(instanceIndex);
      const runoffSeed = runoffExtra.element(instanceIndex);
      const dt = deltaTime.min(float(0.033));
      const sculptDrivenFlow = runoffLifeState.z.add(runoffSeed.z);

      runoffLifeState.x.addAssign(dt);
      velocity.z.addAssign(float(8).add(sculptDrivenFlow.mul(float(9))).mul(dt));
      velocity.x.addAssign(position.z.mul(float(0.08)).add(runoffSeed.y.mul(float(6))).sin().mul(float(2.4)).mul(dt));
      velocity.y.addAssign(float(-1.4).mul(dt));
      velocity.mulAssign(float(0.988));

      this.applyRunoffHandForce(position, velocity, hand0Position, hand0Forces, hand0Extra);
      this.applyRunoffHandForce(position, velocity, hand1Position, hand1Forces, hand1Extra);

      position.addAssign(velocity.mul(dt.mul(float(8))));
      If(position.z.greaterThan(float(WORLD_SIZE * 0.5)), () => {
        this.respawnRunoffWater(position, velocity, runoffLifeState, runoffSeed);
      });
      If(runoffLifeState.x.greaterThan(runoffLifeState.y), () => {
        this.respawnRunoffWater(position, velocity, runoffLifeState, runoffSeed);
      });
    })() as any).compute(RUNOFF_PARTICLE_COUNT);
  }

  private applyRunoffHandForce(position: any, velocity: any, handPosition: any, handForces: any, handExtra: any): void {
    If(handPosition.w.greaterThan(float(0.5)), () => {
      const delta = handPosition.xyz.sub(position);
      const falloff = clamp(float(1).sub(delta.length().div(float(48).add(handExtra.y.mul(float(24))))), float(0), float(1));
      const closedHandSculptEnergy = handForces.y.add(handExtra.w);
      const openHandCarveEnergy = handForces.x.mul(float(1).sub(handExtra.w.mul(float(0.7))));
      velocity.addAssign(delta.normalize().mul(closedHandSculptEnergy).mul(falloff).mul(float(24)).mul(deltaTime));
      velocity.z.addAssign(openHandCarveEnergy.add(handForces.z).mul(falloff).mul(float(34)).mul(deltaTime));
      velocity.y.addAssign(handForces.z.sub(handForces.w).mul(falloff).mul(float(18)).mul(deltaTime));
    });
  }

  private respawnRunoffWater(position: any, velocity: any, runoffLifeState: any, runoffSeed: any): void {
    const lane = runoffSeed.x;
    position.x.assign(lane.mul(float(WORLD_SIZE * 0.28)).add(runoffSeed.y.mul(float(5))));
    position.y.assign(float(-8).sub(runoffSeed.z.mul(float(10))));
    position.z.assign(float(WORLD_SIZE * -0.48).add(runoffSeed.w.mul(float(6))));
    velocity.x.assign(runoffSeed.y.mul(float(0.8)));
    velocity.y.assign(float(-0.3));
    velocity.z.assign(float(6).add(runoffSeed.z.mul(float(8))));
    runoffLifeState.x.assign(float(0));
    runoffLifeState.y.assign(float(1.4).add(runoffSeed.w.mul(float(2.4))));
  }

  private initGpuLandscapeAssets(): void {
    const treeGeometry = new THREE.ConeGeometry(0.8, 5, 5);
    const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x47623a, roughness: 0.9 });
    const treeCount = 420;
    const trees = new THREE.InstancedMesh(treeGeometry, treeMaterial, treeCount);
    const rockGeometry = new THREE.DodecahedronGeometry(1.1, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x7a6a5b, roughness: 0.95 });
    const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, 180);
    const matrix = new THREE.Matrix4();

    for (let i = 0; i < treeCount; i++) {
      const x = (Math.random() - 0.5) * WORLD_SIZE * 0.92;
      const z = (Math.random() - 0.5) * WORLD_SIZE * 0.92;
      const y = -16 + Math.random() * 8;
      const scale = 0.7 + Math.random() * 1.2;
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * Math.PI, 0));
      const position = new THREE.Vector3(x, y + scale * 2.2, z);
      this.treeBaseTransforms.push({
        position,
        quaternion,
        scale,
        growthBias: Math.random() * 2.5,
      });
      matrix.compose(
        position,
        quaternion,
        new THREE.Vector3(scale * 0.05, scale * 0.05, scale * 0.05)
      );
      trees.setMatrixAt(i, matrix);
    }
    this.treeMesh = trees;

    for (let i = 0; i < rocks.count; i++) {
      const x = (Math.random() - 0.5) * WORLD_SIZE * 0.95;
      const z = (Math.random() - 0.5) * WORLD_SIZE * 0.95;
      const scale = 0.4 + Math.random() * 1.8;
      matrix.compose(
        new THREE.Vector3(x, -17 + Math.random() * 10, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random(), Math.random() * Math.PI, Math.random())),
        new THREE.Vector3(scale, scale * 0.75, scale)
      );
      rocks.setMatrixAt(i, matrix);
    }

    this.gpuAssets.add(trees, rocks);
    this.initRiverGuides();
  }

  private initRiverGuides(): void {
    const riverMaterial = new THREE.LineBasicMaterial({
      color: 0x7de9ff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });

    for (let r = 0; r < 7; r++) {
      const points: THREE.Vector3[] = [];
      const startX = (Math.random() - 0.5) * WORLD_SIZE * 0.55;
      let x = startX;
      for (let i = 0; i < 36; i++) {
        const t = i / 35;
        x += Math.sin(t * Math.PI * 4 + r) * 0.8;
        const z = (t - 0.5) * WORLD_SIZE * 0.94;
        const y = -4 - t * 14 + Math.sin(t * Math.PI * 3 + r) * 1.4;
        points.push(new THREE.Vector3(x, y, z));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, riverMaterial.clone());
      this.riverGroup.add(line);
    }
  }

  private initRocks(): void {
    this.rockGeometry = new THREE.BufferGeometry();

    const positions = new Float32Array(ROCK_COUNT * 3);
    const sizes = new Float32Array(ROCK_COUNT);
    const rotations = new Float32Array(ROCK_COUNT);
    const colors = new Float32Array(ROCK_COUNT * 3);

    // Create rock particles on the terrain
    for (let i = 0; i < ROCK_COUNT; i++) {
      const rock = this.createRock();
      this.rocks.push(rock);

      positions[i * 3] = rock.position.x;
      positions[i * 3 + 1] = rock.position.y;
      positions[i * 3 + 2] = rock.position.z;
      sizes[i] = rock.size;
      rotations[i] = rock.rotation;
      colors[i * 3] = rock.color.r;
      colors[i * 3 + 1] = rock.color.g;
      colors[i * 3 + 2] = rock.color.b;
    }

    this.rockGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rockGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.rockGeometry.setAttribute('rotation', new THREE.BufferAttribute(rotations, 1));
    this.rockGeometry.setAttribute('rockColor', new THREE.BufferAttribute(colors, 3));

    if (this.context.backend === 'webgpu') {
      this.rockMaterial = new THREE.PointsMaterial({
        color: 0x8f785d,
        size: 2,
        sizeAttenuation: true,
      });
    } else {
      this.rockMaterial = new THREE.ShaderMaterial({
        vertexShader: rockVertexShader,
        fragmentShader: rockFragmentShader,
        transparent: true,
        depthWrite: true,
      });
    }

    this.rockPoints = new THREE.Points(this.rockGeometry, this.rockMaterial);
  }

  private createRock(): RockParticle {
    // Random position on terrain
    const x = (Math.random() - 0.5) * WORLD_SIZE * 0.9;
    const z = (Math.random() - 0.5) * WORLD_SIZE * 0.9;
    const groundHeight = this.sampleHeight(x, z);

    // Color variation - browns and grays
    const colorChoice = Math.random();
    let color: THREE.Color;
    if (colorChoice < 0.4) {
      color = this.rockColor.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
    } else if (colorChoice < 0.7) {
      color = this.soilColor.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
    } else {
      color = new THREE.Color().lerpColors(this.rockColor, this.soilColor, Math.random());
    }

    return {
      position: new THREE.Vector3(x, groundHeight - 20 + 1, z),
      velocity: new THREE.Vector3(),
      size: 1 + Math.random() * 3,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 2,
      color,
      grounded: true,
      groundHeight: groundHeight - 20,
    };
  }

  private sampleHeight(worldX: number, worldZ: number): number {
    // Convert world coords to grid coords
    const gridX = ((worldX / WORLD_SIZE) + 0.5) * GRID_SIZE;
    const gridZ = ((worldZ / WORLD_SIZE) + 0.5) * GRID_SIZE;

    const x = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(gridX)));
    const z = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(gridZ)));

    const idx = z * GRID_SIZE + x;
    return (this.heightData[idx] - 0.5) * 40;
  }

  update(deltaTime: number, gestures: GestureState): void {
    if (!this.active) return;

    this.time += deltaTime;
    this.updateInfluence(gestures);

    if (this.context.backend === 'webgpu') {
      this.updateGpuLandscape(deltaTime, gestures);
      return;
    }

    // Apply terrain deformation from hands
    this.applyDeformation(deltaTime);

    // Smooth terrain toward targets
    this.smoothTerrain(deltaTime);

    // Update rocks
    this.updateRocks(deltaTime);

    this.updateHeightTexture();
    (this.material as THREE.ShaderMaterial).uniforms.time.value = this.time;
  }

  private updateGpuLandscape(deltaTime: number, gestures: GestureState): void {
    if (!this.gpuTerrain || !this.gpuCompute) return;

    const intent = this.intentSmoother.update(createElementalIntent(gestures), deltaTime);
    this.gpuIntent.update(intent);
    void (this.context.renderer as WebGPURenderer).computeAsync(this.gpuCompute);

    const sculptEnergy = intent.hands.reduce((sum, hand) => sum + hand.gather + hand.lift + hand.suppress + hand.hold, 0)
      + intent.twoHand.gather
      + Math.abs(intent.twoHand.swirl);
    const field = createHandGravityField(intent);
    const fieldEnergy = sampleHandGravityField(field, new THREE.Vector3()).force.length();
    this.updatePersistentSculptAnchors(intent, deltaTime);
    this.updateSettledEcology(deltaTime, sculptEnergy, fieldEnergy);
    this.updateRunoffWater(deltaTime, intent, sculptEnergy, fieldEnergy);
    this.gpuTerrain.material.opacity = 0.1 + Math.min(0.16, sculptEnergy * 0.02);
    this.gpuTerrain.material.size = 1.2 + Math.min(1.4, sculptEnergy * 0.16);
    this.gpuAssets.rotation.y += intent.twoHand.swirl * deltaTime * 0.05;
  }

  private updateRunoffWater(
    deltaTime: number,
    intent: ReturnType<typeof createElementalIntent>,
    sculptEnergy: number,
    fieldEnergy: number
  ): void {
    if (!this.runoffWater || !this.runoffWaterCompute) return;

    const sculptDrivenFlow = intent.hands.reduce((sum, hand) => {
      const openCarve = hand.project * Math.max(0, 1 - hand.hold);
      const closedDam = hand.gather + hand.hold;
      return sum + openCarve + hand.lift * 0.6 + closedDam * 0.25;
    }, 0) + intent.twoHand.spread;

    void deltaTime;
    void (this.context.renderer as WebGPURenderer).computeAsync(this.runoffWaterCompute);
    this.runoffWater.material.opacity = 0.1 + Math.min(0.34, sculptDrivenFlow * 0.12 + fieldEnergy * 0.08);
    this.runoffWater.material.size = 0.34 + Math.min(0.38, sculptEnergy * 0.06 + sculptDrivenFlow * 0.04);
  }

  private updateSettledEcology(deltaTime: number, sculptEnergy: number, fieldEnergy: number): void {
    if (sculptEnergy > 0.18 || fieldEnergy > 0.1) {
      this.settledTime = Math.max(0, this.settledTime - deltaTime * 1.5);
      this.plasticStrain = THREE.MathUtils.lerp(this.plasticStrain, Math.min(1, sculptEnergy + fieldEnergy), deltaTime * 1.8);
    } else {
      this.settledTime = Math.min(8, this.settledTime + deltaTime);
      this.plasticStrain = THREE.MathUtils.lerp(this.plasticStrain, 0, deltaTime * 0.35);
    }
    this.seasonPhase = (this.seasonPhase + deltaTime * (0.035 + fieldEnergy * 0.01)) % 1;

    this.updateVegetationGrowth();
    this.updateRiverFlow(fieldEnergy, sculptEnergy);
  }

  private updateVegetationGrowth(): void {
    if (!this.treeMesh) return;

    const matrix = new THREE.Matrix4();
    const seasonalDormancy = 0.72 + Math.sin(this.seasonPhase * Math.PI * 2) * 0.18;
    this.treeBaseTransforms.forEach((tree, index) => {
      const growth = THREE.MathUtils.smoothstep(this.settledTime - tree.growthBias, 0, 3.5);
      const wind = 1 + Math.sin(this.time * 1.7 + index * 0.37) * 0.035 * growth;
      const scale = tree.scale * THREE.MathUtils.lerp(0.08, seasonalDormancy, growth);
      matrix.compose(
        tree.position,
        tree.quaternion,
        new THREE.Vector3(scale * wind, scale * (0.3 + growth * 0.7), scale * wind)
      );
      this.treeMesh!.setMatrixAt(index, matrix);
    });
    this.treeMesh.instanceMatrix.needsUpdate = true;
  }

  private updateRiverFlow(fieldEnergy: number, sculptEnergy: number): void {
    const settle = THREE.MathUtils.smoothstep(this.settledTime, 0.4, 4.5);
    this.riverBasin.z = THREE.MathUtils.lerp(this.riverBasin.z, Math.min(1, settle + this.plasticStrain * 0.25), 0.025);
    this.riverBasin.w = THREE.MathUtils.lerp(this.riverBasin.w, 36 + settle * 12 + this.plasticStrain * 8, 0.025);
    this.riverGroup.children.forEach((river, index) => {
      const material = (river as THREE.Line).material as THREE.LineBasicMaterial;
      material.opacity = 0.18 + settle * 0.58 + Math.min(0.32, fieldEnergy * 0.1 + sculptEnergy * 0.05 + index * 0.012);
      const anchor = this.sculptAnchors[index % this.sculptAnchors.length];
      (river as THREE.Line).position.x = THREE.MathUtils.lerp((river as THREE.Line).position.x, anchor.x * 0.08, 0.025);
      (river as THREE.Line).position.z = THREE.MathUtils.lerp((river as THREE.Line).position.z, anchor.y * 0.08, 0.025);
      (river as THREE.Line).position.y = Math.sin(this.time * 2.2 + index) * 0.25 + settle * 0.35;
      (river as THREE.Line).scale.setScalar(0.65 + settle * 0.48);
    });
  }

  private updatePersistentSculptAnchors(intent: ReturnType<typeof createElementalIntent>, deltaTime: number): void {
    for (const hand of intent.hands) {
      const sculpt = hand.gather + hand.lift - hand.project * 0.45 - hand.suppress;
      if (Math.abs(sculpt) < 0.08 && hand.hold < 0.35) continue;

      const anchor = this.sculptAnchors[this.nextSculptAnchor];
      anchor.x = THREE.MathUtils.lerp(anchor.x, hand.position.x, Math.min(1, deltaTime * 3.5));
      anchor.y = THREE.MathUtils.lerp(anchor.y, hand.position.z, Math.min(1, deltaTime * 3.5));
      anchor.z = THREE.MathUtils.clamp(anchor.z + sculpt * deltaTime * 0.55, -0.75, 0.95);
      anchor.w = THREE.MathUtils.lerp(anchor.w, 30 + hand.spread * 28 + hand.hold * 18, Math.min(1, deltaTime * 2));
      this.nextSculptAnchor = (this.nextSculptAnchor + 1) % this.sculptAnchors.length;
    }
  }

  private applyDeformation(deltaTime: number): void {
    for (const point of this.influenceField.points) {
      // Convert world position to grid coordinates
      const gridX = Math.floor((point.position.x / WORLD_SIZE + 0.5) * GRID_SIZE);
      const gridZ = Math.floor((point.position.z / WORLD_SIZE + 0.5) * GRID_SIZE);

      const radius = Math.floor((point.radius / WORLD_SIZE) * GRID_SIZE * 1.2);

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = gridX + dx;
          const z = gridZ + dy;

          if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) continue;

          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > radius) continue;

          // Smooth Gaussian falloff
          const sigma = radius * 0.4;
          const gaussian = Math.exp(-(dist * dist) / (2 * sigma * sigma));
          const idx = z * GRID_SIZE + x;

          // Palm up = raise, Palm down = lower
          if (Math.abs(point.verticalBias) > 0.01) {
            const change = point.verticalBias * gaussian * deltaTime * 0.3;
            this.targetHeights[idx] = Math.max(0.1, Math.min(0.9, this.targetHeights[idx] + change));

            // Launch rocks when raising terrain
            if (point.verticalBias > 0.1 && Math.random() < gaussian * 0.02) {
              this.launchNearbyRock(
                (x / GRID_SIZE - 0.5) * WORLD_SIZE,
                (z / GRID_SIZE - 0.5) * WORLD_SIZE,
                point.verticalBias * 20
              );
            }
          }

          // Push creates depression, Pull creates mound
          if (Math.abs(point.radialForce) > 0.01) {
            const change = -point.radialForce * gaussian * deltaTime * 0.2;
            this.targetHeights[idx] = Math.max(0.1, Math.min(0.9, this.targetHeights[idx] + change));
          }
        }
      }
    }
  }

  private launchNearbyRock(worldX: number, worldZ: number, force: number): void {
    // Find a nearby grounded rock and launch it
    for (const rock of this.rocks) {
      if (!rock.grounded) continue;

      const dx = rock.position.x - worldX;
      const dz = rock.position.z - worldZ;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 20) {
        rock.grounded = false;
        rock.velocity.set(
          (Math.random() - 0.5) * 10,
          force * (0.5 + Math.random() * 0.5),
          (Math.random() - 0.5) * 10
        );
        break;
      }
    }
  }

  private smoothTerrain(deltaTime: number): void {
    const smoothSpeed = 3;
    for (let i = 0; i < this.heightData.length; i++) {
      this.heightData[i] += (this.targetHeights[i] - this.heightData[i]) * smoothSpeed * deltaTime;
    }
  }

  private updateRocks(deltaTime: number): void {
    const positions = this.rockGeometry.attributes.position.array as Float32Array;
    const rotations = this.rockGeometry.attributes.rotation.array as Float32Array;

    for (let i = 0; i < this.rocks.length; i++) {
      const rock = this.rocks[i];

      if (!rock.grounded) {
        // Apply gravity
        rock.velocity.y -= 60 * deltaTime;

        // Apply air resistance
        rock.velocity.multiplyScalar(0.99);

        // Apply hand influence to airborne rocks
        for (const point of this.influenceField.points) {
          const delta = rock.position.clone().sub(point.position);
          const dist = delta.length();

          if (dist < point.radius && dist > 0.1) {
            const falloff = Math.pow(1 - dist / point.radius, 2);
            const dir = delta.normalize();

            rock.velocity.add(dir.clone().multiplyScalar(point.radialForce * falloff * 40 * deltaTime));
            rock.velocity.y += point.verticalBias * falloff * 30 * deltaTime;
          }
        }

        // Update position
        rock.position.add(rock.velocity.clone().multiplyScalar(deltaTime));

        // Update rotation
        rock.rotation += rock.rotationSpeed * deltaTime;

        // Check ground collision
        const groundHeight = this.sampleHeight(rock.position.x, rock.position.z) - 20;
        if (rock.position.y <= groundHeight + 1) {
          rock.position.y = groundHeight + 1;
          rock.grounded = true;
          rock.groundHeight = groundHeight;
          rock.velocity.set(0, 0, 0);
        }

        // Respawn if out of bounds
        if (rock.position.y < -50 || Math.abs(rock.position.x) > WORLD_SIZE ||
            Math.abs(rock.position.z) > WORLD_SIZE) {
          Object.assign(rock, this.createRock());
        }
      } else {
        // Update ground height for grounded rocks
        const newGroundHeight = this.sampleHeight(rock.position.x, rock.position.z) - 20;
        rock.position.y = newGroundHeight + 1;
        rock.groundHeight = newGroundHeight;
      }

      // Update buffer
      positions[i * 3] = rock.position.x;
      positions[i * 3 + 1] = rock.position.y;
      positions[i * 3 + 2] = rock.position.z;
      rotations[i] = rock.rotation;
    }

    this.rockGeometry.attributes.position.needsUpdate = true;
    this.rockGeometry.attributes.rotation.needsUpdate = true;
  }

  private updateHeightTexture(): void {
    const data = this.heightTexture.image.data as Float32Array;
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      data[i] = this.heightData[i];
    }
    this.heightTexture.needsUpdate = true;
  }

  activate(): void {
    super.activate();
    if (this.context.backend === 'webgpu' && this.gpuTerrain) {
      if (this.gpuSurface) {
        this.scene.add(this.gpuSurface);
      }
      this.scene.add(this.gpuTerrain.sprite);
      this.scene.add(this.gpuAssets);
      this.scene.add(this.riverGroup);
      if (this.runoffWater) {
        this.scene.add(this.runoffWater.sprite);
      }
    } else {
      this.scene.add(this.mesh);
      this.scene.add(this.rockPoints);
    }
  }

  deactivate(): void {
    super.deactivate();
    if (this.gpuTerrain) {
      this.scene.remove(this.gpuTerrain.sprite);
      this.scene.remove(this.gpuAssets);
      this.scene.remove(this.riverGroup);
      if (this.runoffWater) {
        this.scene.remove(this.runoffWater.sprite);
      }
    }
    if (this.gpuSurface) {
      this.scene.remove(this.gpuSurface);
    }
    if (this.mesh) {
      this.scene.remove(this.mesh);
    }
    if (this.rockPoints) {
      this.scene.remove(this.rockPoints);
    }
  }

  dispose(): void {
    this.geometry?.dispose();
    this.material?.dispose();
    this.heightTexture?.dispose();
    this.rockGeometry?.dispose();
    this.rockMaterial?.dispose();
    this.gpuTerrain?.material.dispose();
    this.gpuSurface?.geometry.dispose();
    this.gpuSurfaceMaterial?.dispose();
    this.runoffWater?.material.dispose();
    this.gpuAssets.traverse((object) => {
      if ('geometry' in object && object.geometry instanceof THREE.BufferGeometry) {
        object.geometry.dispose();
      }
      if ('material' in object) {
        const material = object.material;
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose());
        } else if (material instanceof THREE.Material) {
          material.dispose();
        }
      }
    });
    this.riverGroup.traverse((object) => {
      if ('geometry' in object && object.geometry instanceof THREE.BufferGeometry) {
        object.geometry.dispose();
      }
      if ('material' in object && object.material instanceof THREE.Material) {
        object.material.dispose();
      }
    });
    if (this.mesh) {
      this.scene.remove(this.mesh);
    }
    if (this.rockPoints) {
      this.scene.remove(this.rockPoints);
    }
    if (this.gpuTerrain) {
      this.scene.remove(this.gpuTerrain.sprite);
      this.scene.remove(this.gpuAssets);
      this.scene.remove(this.riverGroup);
      if (this.runoffWater) {
        this.scene.remove(this.runoffWater.sprite);
      }
    }
    if (this.gpuSurface) {
      this.scene.remove(this.gpuSurface);
    }
  }
}
