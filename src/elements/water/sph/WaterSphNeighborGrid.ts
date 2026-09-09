import { WaterSphParameters, hashCell, hashPositionToCell } from './WaterSphKernels';

export interface SphPoint {
  x: number;
  y: number;
  z: number;
}

interface IndexedParticle {
  index: number;
  point: SphPoint;
  bucket: number;
}

export class WaterSphNeighborGrid {
  private readonly buckets = new Map<number, IndexedParticle[]>();
  private sortedParticles: IndexedParticle[] = [];

  constructor(
    private readonly params: WaterSphParameters,
    private readonly bucketCount: number
  ) {}

  rebuild(points: SphPoint[]): void {
    this.buckets.clear();
    this.sortedParticles = points
      .map((point, index) => ({
        index,
        point,
        bucket: hashCell(hashPositionToCell(point, this.params), this.bucketCount),
      }))
      .sort((a, b) => a.bucket - b.bucket || a.index - b.index);

    for (const particle of this.sortedParticles) {
      const bucket = this.buckets.get(particle.bucket);
      if (bucket) {
        bucket.push(particle);
      } else {
        this.buckets.set(particle.bucket, [particle]);
      }
    }
  }

  queryNeighbors(point: SphPoint): number[] {
    const center = hashPositionToCell(point, this.params);
    const neighbors: number[] = [];

    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bucket = hashCell(
            { x: center.x + dx, y: center.y + dy, z: center.z + dz },
            this.bucketCount
          );
          for (const candidate of this.buckets.get(bucket) ?? []) {
            if (distance(point, candidate.point) <= this.params.smoothingRadius) {
              neighbors.push(candidate.index);
            }
          }
        }
      }
    }

    return [...new Set(neighbors)].sort((a, b) => a - b);
  }

  getSortedParticleIndices(): number[] {
    return this.sortedParticles.map((particle) => particle.index);
  }
}

function distance(a: SphPoint, b: SphPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
