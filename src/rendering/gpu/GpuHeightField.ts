import { PointsNodeMaterial, Sprite } from 'three/webgpu';
import { float, instancedArray } from 'three/tsl';
import * as THREE from 'three';

export interface GpuHeightField {
  size: number;
  count: number;
  worldSize: number;
  sprite: Sprite;
  material: PointsNodeMaterial;
  positions: any;
  velocities: any;
  state: any;
  moisture: any;
}

export function createGpuHeightField(
  size: number,
  worldSize: number,
  color: THREE.ColorRepresentation,
  pointSize: number,
  initializer: (x: number, y: number, index: number) => {
    height: number;
    velocity?: number;
    state?: THREE.Vector4;
    moisture?: THREE.Vector4;
  }
): GpuHeightField {
  const count = size * size;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const state = new Float32Array(count * 4);
  const moisture = new Float32Array(count * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      const sample = initializer(x, y, index);
      const worldX = (x / (size - 1) - 0.5) * worldSize;
      const worldZ = (y / (size - 1) - 0.5) * worldSize;
      const positionOffset = index * 3;
      const stateOffset = index * 4;

      positions[positionOffset + 0] = worldX;
      positions[positionOffset + 1] = sample.height;
      positions[positionOffset + 2] = worldZ;
      velocities[positionOffset + 1] = sample.velocity ?? 0;

      const stateValue = sample.state ?? new THREE.Vector4();
      const moistureValue = sample.moisture ?? new THREE.Vector4();
      state[stateOffset + 0] = stateValue.x;
      state[stateOffset + 1] = stateValue.y;
      state[stateOffset + 2] = stateValue.z;
      state[stateOffset + 3] = stateValue.w;
      moisture[stateOffset + 0] = moistureValue.x;
      moisture[stateOffset + 1] = moistureValue.y;
      moisture[stateOffset + 2] = moistureValue.z;
      moisture[stateOffset + 3] = moistureValue.w;
    }
  }

  const positionBuffer = instancedArray(positions, 'vec3');
  const velocityBuffer = instancedArray(velocities, 'vec3');
  const stateBuffer = instancedArray(state, 'vec4');
  const moistureBuffer = instancedArray(moisture, 'vec4');
  const material = new PointsNodeMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.92,
    depthWrite: true,
    size: pointSize,
  });
  material.positionNode = positionBuffer.toAttribute();
  material.sizeNode = float(pointSize);

  const sprite = new Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;

  return {
    size,
    count,
    worldSize,
    sprite,
    material,
    positions: positionBuffer,
    velocities: velocityBuffer,
    state: stateBuffer,
    moisture: moistureBuffer,
  };
}
