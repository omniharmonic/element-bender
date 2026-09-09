import { describe, expect, it } from 'vitest';
import {
  createWaterSphParameters,
  estimateSphHashGrid,
  hashCell,
  hashPositionToCell,
  poly6Kernel,
  spikyGradientMagnitude,
  viscosityLaplacian,
} from './WaterSphKernels';

describe('Water SPH kernels', () => {
  it('uses physically shaped smoothing kernels with compact support', () => {
    const params = createWaterSphParameters({ smoothingRadius: 1 });

    expect(poly6Kernel(0, params)).toBeGreaterThan(poly6Kernel(0.5, params));
    expect(poly6Kernel(1, params)).toBe(0);
    expect(spikyGradientMagnitude(0.25, params)).toBeGreaterThan(spikyGradientMagnitude(0.75, params));
    expect(viscosityLaplacian(0.25, params)).toBeGreaterThan(viscosityLaplacian(0.75, params));
    expect(viscosityLaplacian(1, params)).toBe(0);
  });

  it('estimates power-of-two hash grid capacity for neighbor search', () => {
    const grid = estimateSphHashGrid({
      particleCount: 100_000,
      worldSize: 150,
      smoothingRadius: 1.4,
      targetParticlesPerBucket: 8,
    });

    expect(grid.cellSize).toBe(1.4);
    expect(grid.bucketCount).toBeGreaterThanOrEqual(16_384);
    expect((grid.bucketCount & (grid.bucketCount - 1)) === 0).toBe(true);
  });

  it('hashes world positions into stable integer cells and buckets', () => {
    const params = createWaterSphParameters({ smoothingRadius: 1.5 });
    const cell = hashPositionToCell({ x: 3.2, y: -0.1, z: -4.8 }, params);

    expect(cell).toEqual({ x: 2, y: -1, z: -4 });
    expect(hashCell(cell, 4096)).toBe(hashCell(cell, 4096));
    expect(hashCell(cell, 4096)).toBeGreaterThanOrEqual(0);
    expect(hashCell(cell, 4096)).toBeLessThan(4096);
  });
});
