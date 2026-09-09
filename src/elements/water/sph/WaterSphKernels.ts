export interface WaterSphParameters {
  particleMass: number;
  restDensity: number;
  gasConstant: number;
  smoothingRadius: number;
  viscosity: number;
  xsphViscosity: number;
  surfaceTension: number;
  vorticityConfinement: number;
  damping: number;
}

export interface SphCell {
  x: number;
  y: number;
  z: number;
}

export interface SphHashGridEstimate {
  cellSize: number;
  cellsPerAxis: number;
  bucketCount: number;
}

export function createWaterSphParameters(
  overrides: Partial<WaterSphParameters> = {}
): WaterSphParameters {
  return {
    particleMass: 0.022,
    restDensity: 998.2,
    gasConstant: 4.2,
    smoothingRadius: 1.35,
    viscosity: 0.018,
    xsphViscosity: 0.085,
    surfaceTension: 0.0728,
    vorticityConfinement: 0.18,
    damping: 0.986,
    ...overrides,
  };
}

export function poly6Kernel(distance: number, params: WaterSphParameters): number {
  const h = params.smoothingRadius;
  if (distance >= h) return 0;
  const h2 = h * h;
  const r2 = distance * distance;
  return (315 / (64 * Math.PI * Math.pow(h, 9))) * Math.pow(h2 - r2, 3);
}

export function spikyGradientMagnitude(distance: number, params: WaterSphParameters): number {
  const h = params.smoothingRadius;
  if (distance <= 0 || distance >= h) return 0;
  return (45 / (Math.PI * Math.pow(h, 6))) * Math.pow(h - distance, 2);
}

export function viscosityLaplacian(distance: number, params: WaterSphParameters): number {
  const h = params.smoothingRadius;
  if (distance >= h) return 0;
  return (45 / (Math.PI * Math.pow(h, 6))) * (h - distance);
}

export function hashPositionToCell(
  position: { x: number; y: number; z: number },
  params: WaterSphParameters
): SphCell {
  const cellSize = params.smoothingRadius;
  return {
    x: Math.floor(position.x / cellSize),
    y: Math.floor(position.y / cellSize),
    z: Math.floor(position.z / cellSize),
  };
}

export function hashCell(cell: SphCell, bucketCount: number): number {
  const mixed = (cell.x * 73856093) ^ (cell.y * 19349663) ^ (cell.z * 83492791);
  return (mixed >>> 0) & (bucketCount - 1);
}

export function estimateSphHashGrid(options: {
  particleCount: number;
  worldSize: number;
  smoothingRadius: number;
  targetParticlesPerBucket: number;
}): SphHashGridEstimate {
  const cellsPerAxis = Math.max(1, Math.ceil(options.worldSize / options.smoothingRadius));
  const requiredBuckets = Math.max(16, Math.ceil(options.particleCount / options.targetParticlesPerBucket));
  return {
    cellSize: options.smoothingRadius,
    cellsPerAxis,
    bucketCount: nextPowerOfTwo(requiredBuckets),
  };
}

function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < value) power <<= 1;
  return power;
}
