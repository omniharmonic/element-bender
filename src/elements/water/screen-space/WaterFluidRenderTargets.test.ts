import { describe, expect, it } from 'vitest';
import { WaterFluidRenderTargets, resolveFluidTargetSize } from './WaterFluidRenderTargets';

describe('resolveFluidTargetSize', () => {
  it('uses pixel ratio and resolution scale while clamping to a sane minimum', () => {
    expect(resolveFluidTargetSize(1000, 500, 2, 0.5)).toEqual({ width: 1000, height: 500 });
    expect(resolveFluidTargetSize(20, 10, 1, 0.25)).toEqual({ width: 16, height: 16 });
  });

  it('keeps dimensions integral for render target allocation', () => {
    expect(resolveFluidTargetSize(777, 555, 1.5, 0.5)).toEqual({ width: 583, height: 416 });
  });

  it('allocates every target needed by the deferred water reconstruction path', () => {
    const targets = new WaterFluidRenderTargets(640, 360, 2, 0.5);

    expect(targets.thickness.texture.name).toBe('water-fluid-thickness');
    expect(targets.depth.texture.name).toBe('water-fluid-depth');
    expect(targets.blurA.texture.name).toBe('water-fluid-blur-a');
    expect(targets.blurB.texture.name).toBe('water-fluid-blur-b');
    expect(targets.foam.texture.name).toBe('water-fluid-foam');
    expect(targets.composite.texture.name).toBe('water-fluid-composite');

    targets.dispose();
  });
});
