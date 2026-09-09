import * as THREE from 'three';
import { PointsNodeMaterial, Sprite, WebGPURenderer } from 'three/webgpu';
import { Fn, If, clamp, deltaTime, float, instancedArray, instanceIndex, vec3 } from 'three/tsl';
import { BaseElement } from '../BaseElement';
import { GestureState } from '../../gestures/GestureState';
import { ElementalIntentSmoother, createElementalIntent } from '../../gestures/ElementalIntent';
import { GpuIntentBuffer } from '../../rendering/gpu/GpuIntentBuffer';
import { createHandGravityField, sampleHandGravityField } from '../../gestures/HandGravityField';

const PARTICLE_COUNT = 20000; // Reduced for sparser clouds

// Custom shader for air/cloud particles - optimized for visible, distinct clouds
const airVertexShader = `
  attribute float size;
  attribute float opacity;
  attribute float speed;
  attribute float layer;

  varying float vOpacity;
  varying float vSpeed;
  varying float vLayer;

  void main() {
    vOpacity = opacity;
    vSpeed = speed;
    vLayer = layer;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Moderate size for distinct cloud puffs
    gl_PointSize = size * (450.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const airFragmentShader = `
  varying float vOpacity;
  varying float vSpeed;
  varying float vLayer;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);

    // Soft Gaussian falloff for cloud appearance
    float softness = exp(-dist * dist * 6.0);

    // Subtle color variation based on layer depth
    vec3 coreColor = vec3(0.92, 0.94, 1.0);
    vec3 edgeColor = vec3(0.8, 0.85, 0.95);
    vec3 color = mix(edgeColor, coreColor, softness);

    // Add slight blue tint when moving faster
    float speedFactor = clamp(vSpeed * 1.5, 0.0, 1.0);
    color = mix(color, vec3(0.75, 0.85, 1.0), speedFactor * 0.3);

    // Lower alpha for sparser, more see-through clouds
    float alpha = vOpacity * softness * 0.06;

    // Boost alpha slightly for faster moving particles (visible wisps)
    alpha += speedFactor * softness * 0.03;

    gl_FragColor = vec4(color, alpha);
  }
`;

interface AirParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  basePosition: THREE.Vector3;
  age: number;
  lifetime: number;
  seed: number;
  noiseOffset: THREE.Vector3;
  layer: number; // Depth layer for visual variation
  baseSize: number; // Varied size per particle
}

export class AirElement extends BaseElement {
  private particles: AirParticle[] = [];
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.ShaderMaterial;
  private points!: THREE.Points;
  private gpuGroup = new THREE.Group();
  private flowRibbonGroup = new THREE.Group();
  private atmosphereVolumeGroup = new THREE.Group();
  private flowRibbons: THREE.Line[] = [];
  private atmosphereVolumes: THREE.Mesh[] = [];
  private humidityCoupling = 0;
  private gpuSprite?: Sprite;
  private gpuMaterial?: PointsNodeMaterial;
  private gpuMistMaterial?: PointsNodeMaterial;
  private gpuShearMaterial?: PointsNodeMaterial;
  private gpuPositions?: any;
  private gpuVelocities?: any;
  private gpuLife?: any;
  private gpuCompute?: any;
  private readonly gpuIntent = new GpuIntentBuffer();
  private readonly intentSmoother = new ElementalIntentSmoother(0.42);
  private time = 0;

  // Vector field for wind
  private readonly fieldSize = 16;
  private vectorField: THREE.Vector3[][][] = [];

  // Simulation parameters - slower and more serene for cloud feel
  private readonly driftSpeed = 2.5;
  private readonly fieldInfluence = 18;
  private readonly spawnRadius = 120; // Larger area for more spread out clouds

  async init(): Promise<void> {
    if (this.context.backend === 'webgpu') {
      this.initGpuParticles();
      return;
    }

    // Initialize vector field
    this.initVectorField();

    // Initialize particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particles.push(this.createParticle(Math.random()));
    }

    // Create geometry
    this.geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const opacities = new Float32Array(PARTICLE_COUNT);
    const speeds = new Float32Array(PARTICLE_COUNT);
    const layers = new Float32Array(PARTICLE_COUNT);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
    this.geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));
    this.geometry.setAttribute('layer', new THREE.BufferAttribute(layers, 1));

    // Create material - AdditiveBlending for ethereal cloud layering
    this.material = new THREE.ShaderMaterial({
      vertexShader: airVertexShader,
      fragmentShader: airFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Create points
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  private initGpuParticles(): void {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const life = new Float32Array(PARTICLE_COUNT * 4);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const particle = this.createParticle(Math.random());
      const idx = i * 3;
      const lifeIdx = i * 4;
      positions[idx] = particle.position.x;
      positions[idx + 1] = particle.position.y;
      positions[idx + 2] = particle.position.z;
      velocities[idx] = (Math.random() - 0.5) * 2.5;
      velocities[idx + 1] = (Math.random() - 0.5) * 0.6;
      velocities[idx + 2] = 1.5 + Math.random() * 2.5;
      life[lifeIdx] = particle.age;
      life[lifeIdx + 1] = particle.lifetime;
      life[lifeIdx + 2] = particle.layer;
      life[lifeIdx + 3] = Math.random();
    }

    this.gpuPositions = instancedArray(positions, 'vec3');
    this.gpuVelocities = instancedArray(velocities, 'vec3');
    this.gpuLife = instancedArray(life, 'vec4');

    const positionBuffer = this.gpuPositions;
    const velocityBuffer = this.gpuVelocities;
    const lifeBuffer = this.gpuLife;
    const hand0Position = this.gpuIntent.hand0Position;
    const hand0Forces = this.gpuIntent.hand0Forces;
    const hand0Extra = this.gpuIntent.hand0Extra;
    const hand1Position = this.gpuIntent.hand1Position;
    const hand1Forces = this.gpuIntent.hand1Forces;
    const hand1Extra = this.gpuIntent.hand1Extra;
    const twoHand = this.gpuIntent.twoHand;
    const twoHandForces = this.gpuIntent.twoHandForces;
    this.gpuCompute = (Fn(() => {
      const position = positionBuffer.element(instanceIndex);
      const velocity = velocityBuffer.element(instanceIndex);
      const lifeState = lifeBuffer.element(instanceIndex);
      const dt = deltaTime.min(float(0.033));
      const heightFlow = vec3(
        position.z.mul(float(0.015)).sin(),
        position.x.mul(float(0.012)).cos().mul(float(0.18)),
        position.x.mul(float(0.01)).sin()
      );

      velocity.addAssign(heightFlow.mul(float(1.6)).mul(dt));
      velocity.mulAssign(float(0.992));

      this.applyAirHandForce(position, velocity, hand0Position, hand0Forces, hand0Extra);
      this.applyAirHandForce(position, velocity, hand1Position, hand1Forces, hand1Extra);

      If(twoHand.w.greaterThan(float(0.5)), () => {
        const delta = position.sub(twoHand.xyz);
        const distance = delta.length().add(float(0.001));
        const falloff = clamp(float(1).sub(distance.div(twoHandForces.x.max(float(24)))), float(0), float(1));
        const tangent = vec3(delta.z.negate(), float(0), delta.x).normalize();
        velocity.addAssign(tangent.mul(twoHandForces.w).mul(falloff).mul(float(18)).mul(dt));
        velocity.addAssign(delta.normalize().mul(twoHandForces.z.sub(twoHandForces.y)).mul(falloff).mul(float(10)).mul(dt));
      });

      position.addAssign(velocity.mul(dt.mul(8)));
      lifeState.x.addAssign(dt);

      If(position.z.greaterThan(float(this.spawnRadius)), () => {
        position.z.assign(float(-this.spawnRadius));
        position.x.mulAssign(float(0.75));
        position.y.mulAssign(float(0.8));
        lifeState.x.assign(float(0));
      });
    })() as any).compute(PARTICLE_COUNT);

    this.gpuMaterial = new PointsNodeMaterial({
      color: new THREE.Color(0xdfefff),
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      size: 0.95,
    });
    this.gpuMaterial.positionNode = this.gpuPositions.toAttribute();
    this.gpuMaterial.sizeNode = float(0.95);

    this.gpuSprite = new Sprite(this.gpuMaterial);
    this.gpuSprite.count = PARTICLE_COUNT;
    this.gpuSprite.frustumCulled = false;

    this.gpuMistMaterial = this.createAirLayer(0xf4f6ee, 2.2, 0.025, THREE.NormalBlending);
    this.gpuShearMaterial = this.createAirLayer(0x8ad7ff, 0.75, 0.14);
    this.initFlowRibbons();
    this.initAtmosphereVolumes();
    this.gpuGroup.add(this.gpuSprite);
    this.gpuGroup.add(this.createLayerSprite(this.gpuMistMaterial));
    this.gpuGroup.add(this.createLayerSprite(this.gpuShearMaterial));
    this.gpuGroup.add(this.flowRibbonGroup);
    this.gpuGroup.add(this.atmosphereVolumeGroup);
  }

  private initFlowRibbons(): void {
    for (let ribbonIndex = 0; ribbonIndex < 18; ribbonIndex++) {
      const points: THREE.Vector3[] = [];
      const radius = 20 + ribbonIndex * 3.4;
      const height = -22 + (ribbonIndex % 6) * 8;
      for (let i = 0; i < 72; i++) {
        const t = i / 71;
        const angle = t * Math.PI * 2.6 + ribbonIndex * 0.37;
        points.push(new THREE.Vector3(
          Math.cos(angle) * (radius + Math.sin(t * Math.PI * 5 + ribbonIndex) * 5),
          height + Math.sin(t * Math.PI * 3 + ribbonIndex) * 6,
          (t - 0.5) * this.spawnRadius * 1.65 + Math.sin(angle) * radius * 0.25
        ));
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: ribbonIndex % 3 === 0 ? 0xf7fbff : 0x9edcff,
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ribbon = new THREE.Line(geometry, material);
      ribbon.rotation.y = ribbonIndex * 0.12;
      ribbon.renderOrder = 3;
      this.flowRibbons.push(ribbon);
      this.flowRibbonGroup.add(ribbon);
    }
  }

  private initAtmosphereVolumes(): void {
    const geometry = new THREE.SphereGeometry(1, 32, 16);
    for (let i = 0; i < 9; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xddefff : 0xffffff,
        transparent: true,
        opacity: 0.035,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      });
      const volume = new THREE.Mesh(geometry.clone(), material);
      volume.position.set(
        (i - 4) * 13,
        -8 + (i % 3) * 12,
        -35 + Math.sin(i * 1.7) * 32
      );
      volume.scale.set(34 + i * 2.4, 16 + (i % 4) * 3, 42 + (i % 5) * 4);
      volume.renderOrder = 1;
      this.atmosphereVolumes.push(volume);
      this.atmosphereVolumeGroup.add(volume);
    }
  }

  private createAirLayer(
    color: THREE.ColorRepresentation,
    size: number,
    opacity: number,
    blending: THREE.Blending = THREE.AdditiveBlending
  ): PointsNodeMaterial {
    const material = new PointsNodeMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      blending,
      depthWrite: false,
      size,
    });
    material.positionNode = this.gpuPositions.toAttribute();
    material.sizeNode = float(size);
    return material;
  }

  private createLayerSprite(material: PointsNodeMaterial): Sprite {
    const sprite = new Sprite(material);
    sprite.count = PARTICLE_COUNT;
    sprite.frustumCulled = false;
    return sprite;
  }

  private applyAirHandForce(position: any, velocity: any, handPosition: any, handForces: any, handExtra: any): void {
    If(handPosition.w.greaterThan(float(0.5)), () => {
      const delta = position.sub(handPosition.xyz);
      const distance = delta.length().add(float(0.001));
      const radius = float(118).add(handExtra.y.mul(float(56))).add(handExtra.w.mul(float(36)));
      const falloff = clamp(float(1).sub(distance.div(radius)), float(0), float(1));
      const radial = delta.normalize();
      const tangent = vec3(delta.z.negate(), float(0), delta.x).normalize();
      const divergence = handForces.x.sub(handForces.y);

      velocity.addAssign(radial.mul(divergence).mul(falloff).mul(float(44)).mul(deltaTime));
      velocity.addAssign(tangent.mul(handExtra.x.add(handForces.x.mul(float(0.2))).mul(falloff).mul(float(58)).mul(deltaTime)));
      velocity.y.addAssign(handForces.z.sub(handForces.w).mul(falloff).mul(float(34)).mul(deltaTime));
      velocity.mulAssign(float(1).sub(handExtra.w.mul(falloff).mul(float(0.018))));
    });
  }

  private initVectorField(): void {
    for (let x = 0; x < this.fieldSize; x++) {
      this.vectorField[x] = [];
      for (let y = 0; y < this.fieldSize; y++) {
        this.vectorField[x][y] = [];
        for (let z = 0; z < this.fieldSize; z++) {
          // Initial ambient wind pattern
          this.vectorField[x][y][z] = new THREE.Vector3(
            Math.sin(y * 0.5) * 0.5,
            0,
            Math.cos(x * 0.5) * 0.5
          );
        }
      }
    }
  }

  private createParticle(ageFraction = 0): AirParticle {
    // Create particles more spread out with distinct cloud clusters
    const clusterCenter = new THREE.Vector3(
      (Math.random() - 0.5) * this.spawnRadius * 2.2,
      (Math.random() - 0.5) * this.spawnRadius * 0.6, // Less vertical spread
      (Math.random() - 0.5) * this.spawnRadius * 2.2
    );

    // Add local offset within cluster - tighter clusters
    const position = clusterCenter.clone().add(
      new THREE.Vector3(
        (Math.random() - 0.5) * 25,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 25
      )
    );

    return {
      position: position.clone(),
      velocity: new THREE.Vector3(),
      basePosition: position.clone(),
      age: ageFraction * (15 + Math.random() * 12),
      lifetime: 15 + Math.random() * 12, // Longer lifetime for smoother movement
      seed: Math.random() * 1000,
      noiseOffset: new THREE.Vector3(
        Math.random() * 100,
        Math.random() * 100,
        Math.random() * 100
      ),
      layer: Math.random(), // Random depth layer
      baseSize: 4 + Math.random() * 10, // Slightly larger for visibility
    };
  }

  private sampleVectorField(position: THREE.Vector3): THREE.Vector3 {
    // Map position to field coordinates
    const halfSize = this.spawnRadius;
    const x = Math.floor(((position.x + halfSize) / (halfSize * 2)) * this.fieldSize);
    const y = Math.floor(((position.y + halfSize / 2) / halfSize) * this.fieldSize);
    const z = Math.floor(((position.z + halfSize) / (halfSize * 2)) * this.fieldSize);

    // Clamp to field bounds
    const cx = Math.max(0, Math.min(this.fieldSize - 1, x));
    const cy = Math.max(0, Math.min(this.fieldSize - 1, y));
    const cz = Math.max(0, Math.min(this.fieldSize - 1, z));

    return this.vectorField[cx][cy][cz].clone();
  }

  private noise3D(x: number, y: number, z: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  }

  update(deltaTime: number, gestures: GestureState): void {
    if (!this.active) return;

    this.time += deltaTime;
    this.updateInfluence(gestures);

    if (this.context.backend === 'webgpu') {
      this.updateGpuParticles(deltaTime, gestures);
      return;
    }

    this.updateVectorField(deltaTime);

    const positions = this.geometry.attributes.position.array as Float32Array;
    const sizes = this.geometry.attributes.size.array as Float32Array;
    const opacities = this.geometry.attributes.opacity.array as Float32Array;
    const speeds = this.geometry.attributes.speed.array as Float32Array;
    const layers = this.geometry.attributes.layer.array as Float32Array;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.particles[i];

      // Age particle
      p.age += deltaTime;

      // Respawn if dead or out of bounds
      if (p.age >= p.lifetime || p.position.length() > this.spawnRadius * 2.5) {
        this.particles[i] = this.createParticle();
        continue;
      }

      // Sample vector field for base movement
      const fieldVelocity = this.sampleVectorField(p.position);
      fieldVelocity.multiplyScalar(this.fieldInfluence);

      // Add natural drift with noise - slower and smoother
      const nx = p.noiseOffset.x + this.time * 0.15;
      const ny = p.noiseOffset.y + this.time * 0.1;
      const nz = p.noiseOffset.z + this.time * 0.15;

      const drift = new THREE.Vector3(
        this.noise3D(p.position.x * 0.015 + nx, p.position.y * 0.015, p.position.z * 0.015),
        this.noise3D(p.position.x * 0.015, p.position.y * 0.015 + ny, p.position.z * 0.015) * 0.2,
        this.noise3D(p.position.x * 0.015, p.position.y * 0.015, p.position.z * 0.015 + nz)
      ).multiplyScalar(this.driftSpeed);

      // Combine velocities - smoother interpolation
      p.velocity.lerp(fieldVelocity.add(drift), deltaTime * 1.5);

      // Apply hand influence - slightly reduced for smoother feel
      const influence = this.influenceField.sample(p.position);
      p.velocity.add(influence.multiplyScalar(deltaTime * 50));

      // Update position
      p.position.add(p.velocity.clone().multiplyScalar(deltaTime));

      // Update buffers
      const idx = i * 3;
      positions[idx] = p.position.x;
      positions[idx + 1] = p.position.y;
      positions[idx + 2] = p.position.z;

      // Size based on age - smooth grow/shrink with varied base sizes
      const ageFactor = p.age / p.lifetime;
      const sizeCurve = Math.sin(ageFactor * Math.PI);
      sizes[i] = p.baseSize * (0.5 + sizeCurve * 0.8);

      // Opacity - smooth fade in and out for seamless blending
      const fadeIn = Math.min(1, ageFactor * 4);
      const fadeOut = 1 - Math.pow(Math.max(0, (ageFactor - 0.6) / 0.4), 2);
      opacities[i] = fadeIn * fadeOut;

      // Speed for visual effect
      speeds[i] = p.velocity.length() / 30;

      // Layer depth
      layers[i] = p.layer;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
    this.geometry.attributes.opacity.needsUpdate = true;
    this.geometry.attributes.speed.needsUpdate = true;
    this.geometry.attributes.layer.needsUpdate = true;
  }

  private updateGpuParticles(deltaTime: number, gestures: GestureState): void {
    if (!this.gpuSprite || !this.gpuCompute) return;

    const intent = this.intentSmoother.update(createElementalIntent(gestures), deltaTime);
    this.gpuIntent.update(intent);

    const renderer = this.context.renderer as WebGPURenderer;
    void renderer.computeAsync(this.gpuCompute);

    const field = createHandGravityField(intent);
    const pullEnergy = sampleHandGravityField(field, new THREE.Vector3()).force.length();
    const gust = intent.hands.reduce((sum, hand) => sum + hand.project + hand.spread, 0);
    const gather = intent.hands.reduce((sum, hand) => sum + hand.gather, 0) + intent.twoHand.gather;
    const swirl = intent.hands.reduce((sum, hand) => sum + Math.abs(hand.swirl), 0) + Math.abs(intent.twoHand.swirl);
    this.humidityCoupling = THREE.MathUtils.lerp(this.humidityCoupling, Math.min(1, gather * 0.25 + pullEnergy * 0.04), deltaTime * 0.8);

    this.gpuGroup.rotation.y += (0.015 + swirl * 0.24 + pullEnergy * 0.025) * deltaTime;
    this.gpuGroup.rotation.z = Math.sin(this.time * 0.35) * 0.08 + intent.twoHand.swirl * 0.25;
    this.gpuGroup.scale.set(1, 1, 1);
    this.gpuGroup.position.lerp(new THREE.Vector3(0, 0, 0), Math.min(1, deltaTime * 2));
    this.updateFlowRibbons(deltaTime, gust, gather, swirl, pullEnergy);
    this.updateAtmosphereVolumes(deltaTime, gust, gather, swirl, pullEnergy);

    if (this.gpuMaterial) {
      this.gpuMaterial.opacity = 0.045 + Math.min(0.12, (gust + gather + swirl) * 0.018);
      this.gpuMaterial.size = 0.85 + Math.min(1.4, (gust + swirl) * 0.22);
    }
    if (this.gpuMistMaterial) {
      this.gpuMistMaterial.opacity = 0.025 + Math.min(0.075, pullEnergy * 0.02 + gather * 0.02);
    }
    if (this.gpuShearMaterial) {
      this.gpuShearMaterial.opacity = 0.12 + Math.min(0.18, gust * 0.025 + swirl * 0.07);
    }
  }

  private updateFlowRibbons(
    deltaTime: number,
    gust: number,
    gather: number,
    swirl: number,
    pullEnergy: number
  ): void {
    const flowEnergy = THREE.MathUtils.clamp(gust * 0.28 + gather * 0.18 + swirl * 0.55 + pullEnergy * 0.12, 0, 1.8);
    this.flowRibbonGroup.rotation.y += (0.08 + swirl * 0.5 + gust * 0.07) * deltaTime;
    this.flowRibbonGroup.rotation.x = Math.sin(this.time * 0.22) * 0.1;
    this.flowRibbons.forEach((ribbon, index) => {
      const material = ribbon.material as THREE.LineBasicMaterial;
      material.opacity = 0.035 + Math.min(0.22, flowEnergy * 0.07 + (index % 4) * 0.006);
      const breathe = 1 + Math.sin(this.time * (0.9 + index * 0.03) + index) * 0.08;
      ribbon.scale.set(
        breathe * (0.86 + gust * 0.12),
        breathe * (0.78 + gather * 0.16 + pullEnergy * 0.04),
        breathe * (0.92 + flowEnergy * 0.18)
      );
      ribbon.rotation.z += (0.06 + swirl * 0.18 + index * 0.002) * deltaTime;
    });
  }

  private updateAtmosphereVolumes(
    deltaTime: number,
    gust: number,
    gather: number,
    swirl: number,
    pullEnergy: number
  ): void {
    const density = THREE.MathUtils.clamp(0.22 + gather * 0.08 + this.humidityCoupling * 0.55, 0.12, 0.95);
    const shear = THREE.MathUtils.clamp(gust * 0.2 + swirl * 0.35 + pullEnergy * 0.05, 0, 1.6);
    this.atmosphereVolumeGroup.rotation.y += (0.01 + swirl * 0.08) * deltaTime;
    this.atmosphereVolumes.forEach((volume, index) => {
      const material = volume.material as THREE.MeshBasicMaterial;
      const phase = this.time * (0.18 + index * 0.008) + index * 1.73;
      material.opacity = 0.018 + density * 0.035 + Math.sin(phase) * 0.006;
      volume.position.x += Math.sin(phase) * deltaTime * (0.9 + shear);
      volume.position.z += Math.cos(phase * 0.7) * deltaTime * (0.6 + gust * 0.4);
      volume.rotation.y += (0.015 + swirl * 0.07 + index * 0.001) * deltaTime;
      volume.scale.x = 30 + index * 2.7 + shear * 10 + Math.sin(phase) * 2;
      volume.scale.y = 13 + (index % 4) * 3 + this.humidityCoupling * 8;
      volume.scale.z = 38 + (index % 5) * 4 + gather * 5;
    });
  }

  private updateVectorField(deltaTime: number): void {
    // Decay field toward ambient
    const decayRate = 0.5;

    for (let x = 0; x < this.fieldSize; x++) {
      for (let y = 0; y < this.fieldSize; y++) {
        for (let z = 0; z < this.fieldSize; z++) {
          const ambient = new THREE.Vector3(
            Math.sin(y * 0.5 + this.time * 0.3) * 0.5,
            Math.sin(this.time * 0.2 + x * 0.3) * 0.2,
            Math.cos(x * 0.5 + this.time * 0.2) * 0.5
          );

          this.vectorField[x][y][z].lerp(ambient, decayRate * deltaTime);
        }
      }
    }

    // Apply hand influences to field
    for (const point of this.influenceField.points) {
      this.applyInfluenceToField(point.position, point.radialForce, point.tangentialForce);
    }
  }

  private applyInfluenceToField(
    position: THREE.Vector3,
    radialForce: number,
    tangentialForce: number
  ): void {
    const halfSize = this.spawnRadius;

    for (let x = 0; x < this.fieldSize; x++) {
      for (let y = 0; y < this.fieldSize; y++) {
        for (let z = 0; z < this.fieldSize; z++) {
          // Convert field coords to world position
          const worldPos = new THREE.Vector3(
            (x / this.fieldSize) * halfSize * 2 - halfSize,
            (y / this.fieldSize) * halfSize - halfSize / 2,
            (z / this.fieldSize) * halfSize * 2 - halfSize
          );

          const delta = worldPos.clone().sub(position);
          const dist = delta.length();
          const radius = 40;

          if (dist < radius && dist > 0.01) {
            const falloff = Math.pow(1 - dist / radius, 2);

            // Radial
            const radialDir = delta.normalize();
            this.vectorField[x][y][z].add(
              radialDir.multiplyScalar(radialForce * falloff * 0.5)
            );

            // Tangential
            const tangent = new THREE.Vector3(-delta.z, 0, delta.x).normalize();
            this.vectorField[x][y][z].add(
              tangent.multiplyScalar(tangentialForce * falloff * 0.5)
            );
          }
        }
      }
    }
  }

  activate(): void {
    super.activate();
    if (this.context.backend === 'webgpu' && this.gpuSprite) {
      this.scene.add(this.gpuGroup);
    } else {
      this.scene.add(this.points);
    }
  }

  deactivate(): void {
    super.deactivate();
    if (this.gpuSprite) {
      this.scene.remove(this.gpuGroup);
    }
    if (this.points) {
      this.scene.remove(this.points);
    }
  }

  dispose(): void {
    this.geometry?.dispose();
    this.material?.dispose();
    this.gpuMaterial?.dispose();
    this.gpuMistMaterial?.dispose();
    this.gpuShearMaterial?.dispose();
    this.flowRibbons.forEach((ribbon) => {
      ribbon.geometry.dispose();
      (ribbon.material as THREE.Material).dispose();
    });
    this.atmosphereVolumes.forEach((volume) => {
      volume.geometry.dispose();
      (volume.material as THREE.Material).dispose();
    });
    if (this.points) {
      this.scene.remove(this.points);
    }
    if (this.gpuSprite) {
      this.scene.remove(this.gpuGroup);
    }
  }
}
