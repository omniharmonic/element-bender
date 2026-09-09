import { describe, expect, it } from 'vitest';
import { createWaterSphParameters } from './WaterSphKernels';
import { WaterSphNeighborGrid } from './WaterSphNeighborGrid';

describe('WaterSphNeighborGrid', () => {
  it('finds compact-support neighbors and excludes distant particles', () => {
    const params = createWaterSphParameters({ smoothingRadius: 1 });
    const grid = new WaterSphNeighborGrid(params, 32);
    grid.rebuild([
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      { x: 0.95, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ]);

    expect(grid.queryNeighbors({ x: 0, y: 0, z: 0 })).toEqual([0, 1, 2]);
    expect(grid.queryNeighbors({ x: 3, y: 0, z: 0 })).toEqual([3]);
  });

  it('keeps deterministic bucket ordering for parity with GPU hash buffers', () => {
    const params = createWaterSphParameters({ smoothingRadius: 1.25 });
    const grid = new WaterSphNeighborGrid(params, 64);
    grid.rebuild([
      { x: 2.3, y: 0, z: -1.2 },
      { x: -0.2, y: 0, z: 0.4 },
      { x: 2.1, y: 0.1, z: -1.1 },
    ]);

    expect(grid.getSortedParticleIndices()).toEqual([0, 2, 1]);
  });
});
