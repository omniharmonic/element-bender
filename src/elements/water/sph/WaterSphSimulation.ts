import type { WebGPURenderer } from 'three/webgpu';
import { Fn, If, clamp, deltaTime, float, instancedArray, instanceIndex, vec3 } from 'three/tsl';
import { GpuParticleSystem, createGpuParticleSystem } from '../../../rendering/gpu/GpuParticles';
import {
  SphHashGridEstimate,
  WaterSphParameters,
  createWaterSphParameters,
  estimateSphHashGrid,
} from './WaterSphKernels';

export interface WaterSphSimulationOptions {
  particleCount: number;
  worldSize: number;
  smoothingRadius?: number;
}

export class WaterSphSimulation {
  readonly system: GpuParticleSystem;
  readonly params: WaterSphParameters;
  readonly hashGrid: SphHashGridEstimate;
  readonly densityPressure: any;
  private readonly compute: any;

  constructor(options: WaterSphSimulationOptions) {
    this.params = createWaterSphParameters({ smoothingRadius: options.smoothingRadius ?? 1.35 });
    this.hashGrid = estimateSphHashGrid({
      particleCount: options.particleCount,
      worldSize: options.worldSize,
      smoothingRadius: this.params.smoothingRadius,
      targetParticlesPerBucket: 8,
    });

    const positions = new Float32Array(options.particleCount * 3);
    const velocities = new Float32Array(options.particleCount * 3);
    const life = new Float32Array(options.particleCount * 4);
    const extra = new Float32Array(options.particleCount * 4);
    const densityPressure = new Float32Array(options.particleCount * 4);

    for (let i = 0; i < options.particleCount; i++) {
      const idx = i * 3;
      const vec4Idx = i * 4;
      const u = (i % 256) / 255;
      const v = Math.floor(i / 256) / Math.ceil(options.particleCount / 256);
      const angle = u * Math.PI * 2;
      const radius = Math.sqrt(v) * options.worldSize * 0.34;
      positions[idx] = Math.cos(angle) * radius + (Math.random() - 0.5) * 0.7;
      positions[idx + 1] = -20 + Math.sin(v * Math.PI) * 2.5 + Math.random() * 0.7;
      positions[idx + 2] = Math.sin(angle) * radius + (Math.random() - 0.5) * 0.7;
      velocities[idx] = -Math.sin(angle) * 0.45;
      velocities[idx + 1] = 0;
      velocities[idx + 2] = Math.cos(angle) * 0.45;
      life[vec4Idx] = Math.random();
      life[vec4Idx + 1] = 1;
      life[vec4Idx + 2] = u;
      life[vec4Idx + 3] = v;
      extra[vec4Idx] = Math.random() * 2 - 1;
      extra[vec4Idx + 1] = Math.random() * 2 - 1;
      extra[vec4Idx + 2] = Math.random();
      extra[vec4Idx + 3] = Math.random();
      densityPressure[vec4Idx] = this.params.restDensity;
      densityPressure[vec4Idx + 1] = 0;
    }

    this.system = createGpuParticleSystem(
      options.particleCount,
      positions,
      velocities,
      life,
      extra,
      0x9befff,
      0.62,
      0.16
    );
    this.densityPressure = instancedArray(densityPressure, 'vec4');

    const particlePositions = this.system.positions;
    const particleVelocities = this.system.velocities;
    const particleLife = this.system.life;
    const particleExtra = this.system.extra;
    const densityPressureBuffer = this.densityPressure;
    const worldRadius = options.worldSize * 0.46;
    const restY = -20;
    const restDensity = this.params.restDensity;
    const gasConstant = this.params.gasConstant;
    const viscosity = this.params.viscosity;
    const xsphViscosity = this.params.xsphViscosity;
    const surfaceTension = this.params.surfaceTension;
    const vorticityConfinement = this.params.vorticityConfinement;
    const damping = this.params.damping;

    this.compute = (Fn(() => {
      const position = particlePositions.element(instanceIndex);
      const velocity = particleVelocities.element(instanceIndex);
      const lifeState = particleLife.element(instanceIndex);
      const seed = particleExtra.element(instanceIndex);
      const densityPressureState = densityPressureBuffer.element(instanceIndex);
      const dt = deltaTime.min(float(0.033));
      const horizontal = vec3(position.x, float(0), position.z);
      const radialDistance = horizontal.length().add(float(0.001));
      const basinFalloff = clamp(float(1).sub(radialDistance.div(float(worldRadius))), float(0), float(1));
      const localCompression = basinFalloff.mul(float(24)).add(position.y.sub(float(restY)).abs().mul(float(1.7)));
      const pressure = clamp(localCompression.mul(float(gasConstant)), float(0), float(120));
      const swirl = vec3(position.z.negate(), float(0), position.x).normalize();
      const surfaceNormal = vec3(position.x, position.y.sub(float(restY)), position.z).normalize();

      densityPressureState.x.assign(float(restDensity).add(localCompression));
      densityPressureState.y.assign(pressure);
      densityPressureState.z.assign(basinFalloff);
      densityPressureState.w.assign(lifeState.x);

      velocity.y.addAssign(float(restY).sub(position.y).mul(float(surfaceTension)).mul(dt));
      velocity.addAssign(surfaceNormal.mul(pressure).mul(float(-0.012)).mul(dt));
      velocity.addAssign(swirl.mul(float(vorticityConfinement)).mul(seed.x).mul(dt.mul(float(16))));
      velocity.mulAssign(float(damping).sub(float(viscosity).mul(dt)));
      velocity.addAssign(swirl.mul(float(xsphViscosity)).mul(basinFalloff).mul(dt));

      position.addAssign(velocity.mul(dt.mul(float(12))));
      lifeState.x.assign(lifeState.x.add(dt).fract());

      If(radialDistance.greaterThan(float(worldRadius)), () => {
        position.x.mulAssign(float(0.82));
        position.z.mulAssign(float(0.82));
        velocity.x.mulAssign(float(-0.35));
        velocity.z.mulAssign(float(-0.35));
      });
      If(position.y.greaterThan(float(-9)), () => {
        position.y.assign(float(-9));
        velocity.y.mulAssign(float(-0.22));
      });
      If(position.y.lessThan(float(-31)), () => {
        position.y.assign(float(-31));
        velocity.y.mulAssign(float(-0.18));
      });
    })() as any).compute(options.particleCount);
  }

  update(renderer: WebGPURenderer): void {
    void renderer.computeAsync(this.compute);
  }

  dispose(): void {
    this.system.material.dispose();
  }
}
