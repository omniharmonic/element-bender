import { PointsNodeMaterial, Sprite } from 'three/webgpu';
import { float, instancedArray } from 'three/tsl';
import * as THREE from 'three';

export interface GpuParticleSystem {
  count: number;
  sprite: Sprite;
  material: PointsNodeMaterial;
  positions: any;
  velocities: any;
  life: any;
  extra: any;
}

export function createGpuParticleSystem(
  count: number,
  positions: Float32Array,
  velocities: Float32Array,
  life: Float32Array,
  extra: Float32Array,
  color: THREE.ColorRepresentation,
  pointSize: number,
  opacity: number
): GpuParticleSystem {
  const positionBuffer = instancedArray(positions, 'vec3');
  const velocityBuffer = instancedArray(velocities, 'vec3');
  const lifeBuffer = instancedArray(life, 'vec4');
  const extraBuffer = instancedArray(extra, 'vec4');

  const material = new PointsNodeMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    size: pointSize,
  });
  material.positionNode = positionBuffer.toAttribute();
  material.sizeNode = float(pointSize);

  const sprite = new Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;

  return {
    count,
    sprite,
    material,
    positions: positionBuffer,
    velocities: velocityBuffer,
    life: lifeBuffer,
    extra: extraBuffer,
  };
}
