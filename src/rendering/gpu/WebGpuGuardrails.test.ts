import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('WebGPU physics guardrails', () => {
  it('does not retain CPU geometry height uploads for water or earth', () => {
    const water = source('src/elements/water/WaterElement.ts');
    const earth = source('src/elements/earth/EarthElement.ts');

    expect(water).not.toContain('updateVertexHeightfield');
    expect(earth).not.toContain('updateVertexHeightfield');
    expect(water).not.toContain('computeVertexNormals');
    expect(earth).not.toContain('computeVertexNormals');
  });

  it('returns from WebGPU water and earth updates before fallback CPU grid work', () => {
    const waterUpdate = source('src/elements/water/WaterElement.ts').match(/update\(deltaTime[\s\S]*?private updateGpuWater/)?.[0] ?? '';
    const earthUpdate = source('src/elements/earth/EarthElement.ts').match(/update\(deltaTime[\s\S]*?private updateGpuLandscape/)?.[0] ?? '';

    expect(waterUpdate.indexOf('return;')).toBeLessThan(waterUpdate.indexOf('simulateWaves'));
    expect(earthUpdate.indexOf('return;')).toBeLessThan(earthUpdate.indexOf('applyDeformation'));
  });

  it('keeps fire and water point sprites in a physically small detail range', () => {
    const fire = source('src/elements/fire/FireElement.ts');
    const water = source('src/elements/water/WaterElement.ts');

    expect(fire).not.toMatch(/sizeNode = float\(([3-9]|\d{2,})/);
    expect(fire).not.toMatch(/createFireLayer\([^)]*,\s*([3-9]|\d{2,})/);
    expect(fire).not.toMatch(/gpuMaterial\.size = [^;]*Math\.min\(([3-9]|\d{2,})/);
    expect(water).not.toMatch(/gpuField\.material\.size = [^;]*Math\.min\(([1-9]\.\d|[2-9]|\d{2,})/);
  });

  it('uses native water particles and distinct open versus closed hand modes', () => {
    const water = source('src/elements/water/WaterElement.ts');

    expect(water).toContain('WaterMesh');
    expect(water).not.toContain('MeshPhysicalNodeMaterial');
    expect(water).toContain('createProceduralWaterNormalMap');
    expect(water).toContain('createGpuParticleSystem');
    expect(water).toContain('waterSpray');
    expect(water).toContain('openHandWaveEnergy');
    expect(water).toContain('closedHandGatherEnergy');
    expect(water).toContain('updateGpuWaterSpray');
    expect(water).toContain('waterColumn');
    expect(water).toContain('updateWaterColumn');
    expect(water).toContain('WaterScreenSpaceFluidRenderer');
    expect(water).toContain('createHeightFieldFluidSource');
    expect(water).toContain('createSprayFluidSource');
    expect(water).toContain('WaterSphSimulation');
    expect(water).toContain('createSphFluidSource');
  });

  it('has explicit SPH kernels and hash-grid neighbor-search primitives for research-grade water', () => {
    const kernels = source('src/elements/water/sph/WaterSphKernels.ts');
    const simulation = source('src/elements/water/sph/WaterSphSimulation.ts');

    expect(kernels).toContain('poly6Kernel');
    expect(kernels).toContain('spikyGradientMagnitude');
    expect(kernels).toContain('viscosityLaplacian');
    expect(kernels).toContain('xsphViscosity');
    expect(kernels).toContain('vorticityConfinement');
    expect(kernels).toContain('surfaceTension');
    expect(kernels).toContain('estimateSphHashGrid');
    expect(simulation).toContain('hashGrid');
    expect(simulation).toContain('densityPressure');
  });

  it('has a screen-space water reconstruction pipeline scaffold', () => {
    const renderer = source('src/elements/water/screen-space/WaterScreenSpaceFluidRenderer.ts');
    const targets = source('src/elements/water/screen-space/WaterFluidRenderTargets.ts');
    const context = source('src/rendering/WebGPURenderContext.ts');

    expect(renderer).toContain('thickness');
    expect(renderer).toContain('depth');
    expect(renderer).toContain('bilateral');
    expect(renderer).toContain('composite');
    expect(renderer).toContain('renderPhysicalWaterComposite');
    expect(renderer).toContain("debugMode === 'none'");
    expect(renderer).toContain('foam');
    expect(renderer).toContain('renderAfterScene');
    expect(renderer).toContain('createBilateralBlurMaterial');
    expect(renderer).toContain('createPbrCompositeMaterial');
    expect(targets).toContain('resolveFluidTargetSize');
    expect(targets).toContain('blurA');
    expect(targets).toContain('blurB');
    expect(context).toContain('webGpuAfterScenePasses');
  });

  it('configures WebGPU with environment lighting for physical water', () => {
    const context = source('src/rendering/WebGPURenderContext.ts');

    expect(context).toContain('scene.environment');
    expect(context).toContain('EquirectangularReflectionMapping');
    expect(context).toContain('ACESFilmicToneMapping');
  });

  it('renders earth rivers as simulated water flow instead of decorative line guides', () => {
    const earth = source('src/elements/earth/EarthElement.ts');

    expect(earth).toContain('runoffWater');
    expect(earth).toContain('createGpuParticleSystem');
    expect(earth).toContain('updateRunoffWater');
    expect(earth).toContain('sculptDrivenFlow');
    expect(earth).toContain('applyHydraulicErosion');
    expect(earth).toContain('riverBasin');
    expect(earth).toContain('plasticStrain');
    expect(earth).toContain('mudSpecular');
    expect(earth).toContain('seasonPhase');
  });

  it('adds real scene structures around fire and air particles', () => {
    const fire = source('src/elements/fire/FireElement.ts');
    const air = source('src/elements/air/AirElement.ts');

    expect(fire).toContain('fireVolumeGroup');
    expect(fire).toContain('updateFireVolumes');
    expect(fire).toContain('PointLight');
    expect(fire).toContain('smokeVolumeGroup');
    expect(fire).toContain('blackbodyEmission');
    expect(fire).toContain('pyroBuoyancy');
    expect(fire).toContain('suppressionCooling');
    expect(fire).toContain('updateSmokeVolumes');
    expect(air).toContain('flowRibbonGroup');
    expect(air).toContain('updateFlowRibbons');
    expect(air).toContain('LineBasicMaterial');
    expect(air).toContain('atmosphereVolumeGroup');
    expect(air).toContain('initAtmosphereVolumes');
    expect(air).toContain('updateAtmosphereVolumes');
    expect(air).toContain('humidityCoupling');
  });
});
