import * as THREE from 'three';
import type { GpuHeightField } from '../../../rendering/gpu/GpuHeightField';
import type { GpuParticleSystem } from '../../../rendering/gpu/GpuParticles';
import type { WaterSphSimulation } from '../sph/WaterSphSimulation';

export interface WaterFluidParticleSource {
  name: string;
  count: number;
  positions: any;
  radius: number;
  opacity: number;
  color: THREE.ColorRepresentation;
}

export function createHeightFieldFluidSource(field: GpuHeightField): WaterFluidParticleSource {
  return {
    name: 'water-heightfield-fluid',
    count: field.count,
    positions: field.positions,
    radius: 2.5,
    opacity: 0.18,
    color: 0x7fe7ff,
  };
}

export function createSprayFluidSource(spray: GpuParticleSystem): WaterFluidParticleSource {
  return {
    name: 'water-spray-fluid',
    count: spray.count,
    positions: spray.positions,
    radius: 0.72,
    opacity: 0.28,
    color: 0xcaf7ff,
  };
}

export function createSphFluidSource(simulation: WaterSphSimulation): WaterFluidParticleSource {
  return {
    name: 'water-sph-fluid',
    count: simulation.system.count,
    positions: simulation.system.positions,
    radius: simulation.params.smoothingRadius * 0.72,
    opacity: 0.32,
    color: 0xa7f3ff,
  };
}
