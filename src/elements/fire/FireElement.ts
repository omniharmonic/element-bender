import * as THREE from 'three';
import { PointsNodeMaterial, Sprite, WebGPURenderer } from 'three/webgpu';
import { Fn, If, clamp, deltaTime, float, instancedArray, instanceIndex, vec3 } from 'three/tsl';
import { BaseElement } from '../BaseElement';
import { GestureState } from '../../gestures/GestureState';
import { ElementalIntentSmoother, createElementalIntent } from '../../gestures/ElementalIntent';
import { GpuIntentBuffer } from '../../rendering/gpu/GpuIntentBuffer';
import { createHandGravityField, sampleHandGravityField } from '../../gestures/HandGravityField';

const PARTICLE_COUNT = 40000;

// Custom shader for fire particles
const fireVertexShader = `
  attribute float size;
  attribute float temperature;
  attribute float age;
  attribute float lifetime;

  varying float vTemperature;
  varying float vAge;
  varying float vLifetime;

  void main() {
    vTemperature = temperature;
    vAge = age;
    vLifetime = lifetime;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fireFragmentShader = `
  varying float vTemperature;
  varying float vAge;
  varying float vLifetime;

  void main() {
    float normalizedAge = vAge / vLifetime;
    float fade = 1.0 - smoothstep(0.5, 1.0, normalizedAge);

    // Distance from center of point
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    if (dist > 0.5) discard;

    float softness = 1.0 - smoothstep(0.1, 0.5, dist);

    // Temperature-based color - more vibrant
    vec3 color;
    if (vTemperature < 0.25) {
      color = mix(vec3(0.15, 0.0, 0.0), vec3(0.6, 0.1, 0.0), vTemperature / 0.25);
    } else if (vTemperature < 0.6) {
      color = mix(vec3(0.6, 0.1, 0.0), vec3(1.0, 0.5, 0.0), (vTemperature - 0.25) / 0.35);
    } else {
      color = mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 0.95, 0.6), (vTemperature - 0.6) / 0.4);
    }

    float alpha = fade * softness * 0.9;
    gl_FragColor = vec4(color * alpha * 1.5, alpha);
  }
`;

interface FireParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  temperature: number;
  seed: number;
}

export class FireElement extends BaseElement {
  private particles: FireParticle[] = [];
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.ShaderMaterial;
  private points!: THREE.Points;
  private gpuGroup = new THREE.Group();
  private fireVolumeGroup = new THREE.Group();
  private smokeVolumeGroup = new THREE.Group();
  private flameVolumes: THREE.Mesh[] = [];
  private smokeVolumes: THREE.Mesh[] = [];
  private fireLight?: THREE.PointLight;
  private gpuSprite?: Sprite;
  private gpuMaterial?: PointsNodeMaterial;
  private gpuCoreMaterial?: PointsNodeMaterial;
  private gpuSmokeMaterial?: PointsNodeMaterial;
  private gpuEmberMaterial?: PointsNodeMaterial;
  private gpuPositions?: any;
  private gpuVelocities?: any;
  private gpuLife?: any;
  private gpuExtra?: any;
  private gpuCompute?: any;
  private readonly gpuIntent = new GpuIntentBuffer();
  private readonly intentSmoother = new ElementalIntentSmoother(0.38);
  private time = 0;

  // Simulation parameters - tuned for better control
  private readonly thermalRise = 15; // Reduced from 40
  private readonly pyroBuoyancy = 24;
  private readonly suppressionCooling = 0.18;
  private readonly turbulenceStrength = 8;
  private readonly coolingRate = 0.4;
  private readonly damping = 0.96;
  private readonly spawnRadius = 40;
  private readonly spawnHeight = -35;
  private readonly maxHeight = 50; // Cap height
  private readonly minHeight = -40;

  async init(): Promise<void> {
    if (this.context.backend === 'webgpu') {
      this.initGpuParticles();
      return;
    }

    // Initialize particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particles.push(this.createParticle(Math.random()));
    }

    // Create geometry
    this.geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const temperatures = new Float32Array(PARTICLE_COUNT);
    const ages = new Float32Array(PARTICLE_COUNT);
    const lifetimes = new Float32Array(PARTICLE_COUNT);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('temperature', new THREE.BufferAttribute(temperatures, 1));
    this.geometry.setAttribute('age', new THREE.BufferAttribute(ages, 1));
    this.geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));

    // Create material
    this.material = new THREE.ShaderMaterial({
      vertexShader: fireVertexShader,
      fragmentShader: fireFragmentShader,
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
    const extra = new Float32Array(PARTICLE_COUNT * 4);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const particle = this.createParticle(Math.random());
      const idx = i * 3;
      const vec4Idx = i * 4;
      positions[idx] = particle.position.x;
      positions[idx + 1] = particle.position.y;
      positions[idx + 2] = particle.position.z;
      velocities[idx] = particle.velocity.x * 0.35;
      velocities[idx + 1] = particle.velocity.y * 0.45;
      velocities[idx + 2] = particle.velocity.z * 0.35;
      life[vec4Idx] = particle.age;
      life[vec4Idx + 1] = particle.lifetime;
      life[vec4Idx + 2] = particle.temperature;
      life[vec4Idx + 3] = Math.random();
      extra[vec4Idx] = Math.random() * 2 - 1;
      extra[vec4Idx + 1] = Math.random() * 2 - 1;
      extra[vec4Idx + 2] = Math.random() * 2 - 1;
      extra[vec4Idx + 3] = Math.random();
    }

    this.gpuPositions = instancedArray(positions, 'vec3');
    this.gpuVelocities = instancedArray(velocities, 'vec3');
    this.gpuLife = instancedArray(life, 'vec4');
    this.gpuExtra = instancedArray(extra, 'vec4');

    const positionBuffer = this.gpuPositions;
    const velocityBuffer = this.gpuVelocities;
    const lifeBuffer = this.gpuLife;
    const extraBuffer = this.gpuExtra;
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
      const extraState = extraBuffer.element(instanceIndex);
      const dt = deltaTime.min(float(0.033));

      const heat = lifeState.z;
      const fuel = lifeState.w;
      const curl = vec3(
        extraState.x.mul(float(0.9)),
        extraState.y.mul(float(0.35)),
        extraState.z.mul(float(0.9))
      );

      velocity.y.addAssign(float(this.pyroBuoyancy).mul(heat).mul(dt));
      velocity.addAssign(curl.mul(float(4.5)).mul(dt));
      velocity.mulAssign(float(0.986));

      this.applyFireHandForce(position, velocity, lifeState, hand0Position, hand0Forces, hand0Extra);
      this.applyFireHandForce(position, velocity, lifeState, hand1Position, hand1Forces, hand1Extra);

      If(twoHand.w.greaterThan(float(0.5)), () => {
        const delta = position.sub(twoHand.xyz);
        const tangent = vec3(delta.z.negate(), float(0), delta.x).normalize();
        velocity.addAssign(tangent.mul(twoHandForces.w).mul(float(10)).mul(dt));
        velocity.addAssign(delta.normalize().mul(twoHandForces.y.sub(twoHandForces.z)).mul(float(4)).mul(dt));
      });

      position.addAssign(velocity.mul(dt.mul(8)));
      lifeState.x.addAssign(dt);
      lifeState.z.assign(clamp(lifeState.z.sub(dt.mul(float(this.suppressionCooling))).add(fuel.mul(float(0.01))), float(0.05), float(1.4)));

      If(position.y.greaterThan(float(this.maxHeight)), () => {
        position.y.assign(float(this.spawnHeight));
        position.x.mulAssign(float(0.35));
        position.z.mulAssign(float(0.35));
        velocity.y.assign(float(8).add(extraState.w.mul(float(8))));
        lifeState.x.assign(float(0));
        lifeState.z.assign(float(0.9));
      });
    })() as any).compute(PARTICLE_COUNT);

    this.gpuMaterial = new PointsNodeMaterial({
      color: new THREE.Color(0xff7a18),
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      size: 1.4,
    });
    this.gpuMaterial.positionNode = this.gpuPositions.toAttribute();
    this.gpuMaterial.sizeNode = float(1.4);

    this.gpuSprite = new Sprite(this.gpuMaterial);
    this.gpuSprite.count = PARTICLE_COUNT;
    this.gpuSprite.frustumCulled = false;

    this.gpuCoreMaterial = this.createFireLayer(0xfff0b5, 1.0, 0.18);
    this.gpuSmokeMaterial = this.createFireLayer(0x6f625c, 2.6, 0.035, THREE.NormalBlending);
    this.gpuEmberMaterial = this.createFireLayer(0xff4a1c, 0.72, 0.28);
    this.initFireVolumes();

    this.gpuGroup.add(this.gpuSprite);
    this.gpuGroup.add(this.createLayerSprite(this.gpuCoreMaterial));
    this.gpuGroup.add(this.createLayerSprite(this.gpuSmokeMaterial));
    this.gpuGroup.add(this.createLayerSprite(this.gpuEmberMaterial));
    this.gpuGroup.add(this.fireVolumeGroup);
    this.gpuGroup.add(this.smokeVolumeGroup);
  }

  private initFireVolumes(): void {
    const colors = [this.blackbodyEmission(1.25), this.blackbodyEmission(0.92), this.blackbodyEmission(0.62), 0x6f1606];
    const heights = [38, 48, 58, 70];

    colors.forEach((color, index) => {
      const geometry = new THREE.ConeGeometry(13 + index * 5, heights[index], 48, 10, true);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.11 - index * 0.018,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const flame = new THREE.Mesh(geometry, material);
      flame.position.y = this.spawnHeight + heights[index] * 0.43;
      flame.rotation.y = index * Math.PI * 0.31;
      flame.renderOrder = 6 + index;
      this.flameVolumes.push(flame);
      this.fireVolumeGroup.add(flame);
    });

    this.fireLight = new THREE.PointLight(0xff7a1f, 0, 115, 1.8);
    this.fireLight.position.set(0, -8, 0);
    this.fireVolumeGroup.add(this.fireLight);

    for (let i = 0; i < 5; i++) {
      const geometry = new THREE.SphereGeometry(1, 32, 16);
      const material = new THREE.MeshBasicMaterial({
        color: 0x5d514c,
        transparent: true,
        opacity: 0.035,
        blending: THREE.NormalBlending,
        depthWrite: false,
      });
      const smoke = new THREE.Mesh(geometry, material);
      smoke.position.set((i - 2) * 8, 12 + i * 8, Math.sin(i * 1.8) * 8);
      smoke.scale.set(15 + i * 3, 9 + i * 2, 15 + i * 3);
      smoke.renderOrder = 2;
      this.smokeVolumes.push(smoke);
      this.smokeVolumeGroup.add(smoke);
    }
  }

  private blackbodyEmission(temperature: number): THREE.ColorRepresentation {
    if (temperature > 1.05) return 0xfff2bd;
    if (temperature > 0.78) return 0xff982e;
    return 0xff3f16;
  }

  private createFireLayer(
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

  private applyFireHandForce(position: any, velocity: any, lifeState: any, handPosition: any, handForces: any, handExtra: any): void {
    If(handPosition.w.greaterThan(float(0.5)), () => {
      const delta = position.sub(handPosition.xyz);
      const distance = delta.length().add(float(0.001));
      const radius = float(92).add(handExtra.y.mul(float(48))).add(handExtra.w.mul(float(34)));
      const falloff = clamp(float(1).sub(distance.div(radius)), float(0), float(1));
      const radial = delta.normalize();
      const tangent = vec3(delta.z.negate(), float(0), delta.x).normalize();
      const projectMinusGather = handForces.x.sub(handForces.y);

      velocity.addAssign(radial.mul(projectMinusGather).mul(falloff).mul(float(54)).mul(deltaTime));
      velocity.addAssign(tangent.mul(handExtra.x.add(handForces.y.mul(float(0.35))).mul(falloff).mul(float(46))).mul(deltaTime));
      velocity.y.addAssign(handForces.z.sub(handForces.w).mul(falloff).mul(float(42)).mul(deltaTime));
      velocity.mulAssign(float(1).sub(handExtra.w.mul(falloff).mul(float(0.025))));
      lifeState.z.assign(clamp(lifeState.z.add(handForces.x.mul(falloff).mul(float(0.03))).sub(handForces.w.mul(falloff).mul(float(0.04))), float(0.05), float(1.7)));
    });
  }

  private createParticle(ageFraction = 0): FireParticle {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.pow(Math.random(), 0.5) * this.spawnRadius; // More particles near center

    return {
      position: new THREE.Vector3(
        Math.cos(angle) * radius,
        this.spawnHeight + Math.random() * 10,
        Math.sin(angle) * radius
      ),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        this.thermalRise * 0.3 + Math.random() * 5,
        (Math.random() - 0.5) * 3
      ),
      age: ageFraction * (1.0 + Math.random() * 1.0),
      lifetime: 1.0 + Math.random() * 1.0,
      temperature: 0.7 + Math.random() * 0.3,
      seed: Math.random() * 1000,
    };
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

    const positions = this.geometry.attributes.position.array as Float32Array;
    const sizes = this.geometry.attributes.size.array as Float32Array;
    const temperatures = this.geometry.attributes.temperature.array as Float32Array;
    const ages = this.geometry.attributes.age.array as Float32Array;
    const lifetimes = this.geometry.attributes.lifetime.array as Float32Array;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.particles[i];

      // Age particle
      p.age += deltaTime;

      // Respawn if dead or out of bounds
      if (p.age >= p.lifetime || p.position.y > this.maxHeight || p.position.y < this.minHeight) {
        this.particles[i] = this.createParticle();
        continue;
      }

      // Base thermal rise (reduced at higher altitudes)
      const heightFactor = 1 - Math.max(0, (p.position.y - this.spawnHeight) / (this.maxHeight - this.spawnHeight));
      p.velocity.y += this.thermalRise * heightFactor * deltaTime;

      // Turbulence - more at base, less at top
      const turbFactor = Math.pow(heightFactor, 0.5);
      const noiseX = this.noise3D(
        p.position.x * 0.03 + this.time * 0.4 + p.seed,
        p.position.y * 0.03,
        p.position.z * 0.03
      );
      const noiseZ = this.noise3D(
        p.position.x * 0.03,
        p.position.y * 0.03 + this.time * 0.25,
        p.position.z * 0.03 + p.seed
      );

      p.velocity.x += noiseX * this.turbulenceStrength * turbFactor * deltaTime;
      p.velocity.z += noiseZ * this.turbulenceStrength * turbFactor * deltaTime;

      // Apply hand influence - direct and responsive
      for (const point of this.influenceField.points) {
        const delta = p.position.clone().sub(point.position);
        const dist = delta.length();

        if (dist < point.radius && dist > 0.1) {
          const falloff = Math.pow(1 - dist / point.radius, 2);
          const dir = delta.normalize();

          // Push/pull - particles move away/toward hand
          p.velocity.add(dir.clone().multiplyScalar(point.radialForce * falloff * 30 * deltaTime));

          // Vertical bias - palm up lifts flames, palm down suppresses
          p.velocity.y += point.verticalBias * falloff * 20 * deltaTime;

          // Swirl effect
          const tangent = new THREE.Vector3(-delta.z, 0, delta.x).normalize();
          p.velocity.add(tangent.multiplyScalar(point.tangentialForce * falloff * 15 * deltaTime));

          // Heat up near hands
          p.temperature = Math.min(1.0, p.temperature + falloff * 0.15 * deltaTime);
        }
      }

      // Apply damping
      p.velocity.multiplyScalar(this.damping);

      // Clamp velocity
      const maxVel = 60;
      if (p.velocity.length() > maxVel) {
        p.velocity.normalize().multiplyScalar(maxVel);
      }

      // Update position
      p.position.add(p.velocity.clone().multiplyScalar(deltaTime));

      // Cool down based on height
      const coolFactor = 1 + (p.position.y - this.spawnHeight) / 50;
      p.temperature = Math.max(0.05, p.temperature - this.coolingRate * coolFactor * deltaTime);

      // Update buffers
      const idx = i * 3;
      positions[idx] = p.position.x;
      positions[idx + 1] = p.position.y;
      positions[idx + 2] = p.position.z;

      sizes[i] = 2 + p.temperature * 5;
      temperatures[i] = p.temperature;
      ages[i] = p.age;
      lifetimes[i] = p.lifetime;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
    this.geometry.attributes.temperature.needsUpdate = true;
    this.geometry.attributes.age.needsUpdate = true;
    this.geometry.attributes.lifetime.needsUpdate = true;
  }

  private updateGpuParticles(deltaTime: number, gestures: GestureState): void {
    if (!this.gpuSprite || !this.gpuCompute) return;

    const intent = this.intentSmoother.update(createElementalIntent(gestures), deltaTime);
    this.gpuIntent.update(intent);

    const renderer = this.context.renderer as WebGPURenderer;
    void renderer.computeAsync(this.gpuCompute);

    const field = createHandGravityField(intent);
    const gravitationalEnergy = sampleHandGravityField(field, new THREE.Vector3()).force.length();
    const handIntensity = intent.hands.reduce(
      (sum, hand) => sum + hand.project + hand.gather + hand.lift + Math.abs(hand.swirl),
      0
    );
    const twoHandSwirl = Math.abs(intent.twoHand.swirl);
    this.gpuGroup.rotation.y += (0.02 + twoHandSwirl * 0.32 + gravitationalEnergy * 0.025) * deltaTime;
    this.gpuGroup.scale.setScalar(1);
    this.gpuGroup.position.lerp(new THREE.Vector3(0, 0, 0), Math.min(1, deltaTime * 2));
    this.updateFireVolumes(deltaTime, handIntensity, gravitationalEnergy, twoHandSwirl);
    this.updateSmokeVolumes(deltaTime, handIntensity, gravitationalEnergy, intent.hands.reduce((sum, hand) => sum + hand.suppress + hand.hold, 0));

    if (this.gpuMaterial) {
      this.gpuMaterial.opacity = 0.08 + Math.min(0.12, handIntensity * 0.026);
      this.gpuMaterial.size = 1.15 + Math.min(1.0, handIntensity * 0.16);
    }
    if (this.gpuCoreMaterial) {
      this.gpuCoreMaterial.opacity = 0.16 + Math.min(0.14, gravitationalEnergy * 0.035);
    }
    if (this.gpuSmokeMaterial) {
      this.gpuSmokeMaterial.opacity = 0.035 + Math.min(0.08, intent.hands.reduce((sum, hand) => sum + hand.suppress + hand.hold, 0) * 0.025);
    }
    if (this.gpuEmberMaterial) {
      this.gpuEmberMaterial.opacity = 0.24 + Math.min(0.18, handIntensity * 0.025);
    }
  }

  private updateFireVolumes(
    deltaTime: number,
    handIntensity: number,
    gravitationalEnergy: number,
    twoHandSwirl: number
  ): void {
    const heat = THREE.MathUtils.clamp(0.55 + handIntensity * 0.08 + gravitationalEnergy * 0.05, 0.35, 1.8);
    this.flameVolumes.forEach((flame, index) => {
      const pulse = 1 + Math.sin(this.time * (2.5 + index * 0.35) + index) * 0.08;
      flame.rotation.y += (0.2 + twoHandSwirl * 1.4 + index * 0.08) * deltaTime;
      flame.scale.set(
        pulse * (0.72 + heat * 0.18 + index * 0.04),
        pulse * (0.72 + heat * 0.34),
        pulse * (0.72 + heat * 0.18 + index * 0.04)
      );
      const material = flame.material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(0.018, 0.13 - index * 0.022 + heat * 0.018);
    });

    if (this.fireLight) {
      this.fireLight.intensity = 2.6 + heat * 7.5;
      this.fireLight.distance = 90 + heat * 42;
      this.fireLight.position.y = -8 + Math.sin(this.time * 3.2) * 2.5 + heat * 2;
    }
  }

  private updateSmokeVolumes(
    deltaTime: number,
    handIntensity: number,
    gravitationalEnergy: number,
    suppression: number
  ): void {
    const smokeDensity = THREE.MathUtils.clamp(0.2 + suppression * 0.22 + gravitationalEnergy * 0.03 - handIntensity * 0.025, 0.08, 1.2);
    this.smokeVolumeGroup.rotation.y += deltaTime * (0.025 + gravitationalEnergy * 0.012);
    this.smokeVolumes.forEach((smoke, index) => {
      const material = smoke.material as THREE.MeshBasicMaterial;
      const pulse = 1 + Math.sin(this.time * (0.65 + index * 0.06) + index) * 0.12;
      material.opacity = 0.018 + smokeDensity * (0.035 + index * 0.004);
      smoke.position.y += deltaTime * (0.9 + smokeDensity * 1.8 + index * 0.12);
      if (smoke.position.y > 68) {
        smoke.position.y = 8 + index * 4;
      }
      smoke.scale.set(
        (15 + index * 3.5 + smokeDensity * 12) * pulse,
        (9 + index * 2.2 + smokeDensity * 6) * pulse,
        (15 + index * 3.5 + smokeDensity * 12) * pulse
      );
    });
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
    this.gpuCoreMaterial?.dispose();
    this.gpuSmokeMaterial?.dispose();
    this.gpuEmberMaterial?.dispose();
    this.flameVolumes.forEach((flame) => {
      flame.geometry.dispose();
      (flame.material as THREE.Material).dispose();
    });
    this.smokeVolumes.forEach((smoke) => {
      smoke.geometry.dispose();
      (smoke.material as THREE.Material).dispose();
    });
    if (this.points) {
      this.scene.remove(this.points);
    }
    if (this.gpuSprite) {
      this.scene.remove(this.gpuGroup);
    }
  }
}
