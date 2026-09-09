import * as THREE from 'three';
import { uniform } from 'three/tsl';
import { ElementalIntent, packIntentForGpu } from '../../gestures/ElementalIntent';

export class GpuIntentBuffer {
  readonly hand0Position = uniform(new THREE.Vector4());
  readonly hand0Forces = uniform(new THREE.Vector4());
  readonly hand0Velocity = uniform(new THREE.Vector4());
  readonly hand0Extra = uniform(new THREE.Vector4());
  readonly hand1Position = uniform(new THREE.Vector4());
  readonly hand1Forces = uniform(new THREE.Vector4());
  readonly hand1Velocity = uniform(new THREE.Vector4());
  readonly hand1Extra = uniform(new THREE.Vector4());
  readonly twoHand = uniform(new THREE.Vector4());
  readonly twoHandForces = uniform(new THREE.Vector4());
  readonly packed = new Float32Array(64);

  update(intent: ElementalIntent): void {
    this.packed.set(packIntentForGpu(intent));

    this.writeHand(0, this.hand0Position.value, this.hand0Forces.value, this.hand0Velocity.value, this.hand0Extra.value);
    this.writeHand(16, this.hand1Position.value, this.hand1Forces.value, this.hand1Velocity.value, this.hand1Extra.value);

    this.twoHand.value.set(
      this.packed[48],
      this.packed[49],
      this.packed[50],
      this.packed[51]
    );
    this.twoHandForces.value.set(
      this.packed[52],
      this.packed[53],
      this.packed[54],
      this.packed[55]
    );
  }

  private writeHand(
    offset: number,
    position: THREE.Vector4,
    forces: THREE.Vector4,
    velocity: THREE.Vector4,
    extra: THREE.Vector4
  ): void {
    position.set(
      this.packed[offset + 0],
      this.packed[offset + 1],
      this.packed[offset + 2],
      this.packed[offset + 3]
    );
    forces.set(
      this.packed[offset + 4],
      this.packed[offset + 5],
      this.packed[offset + 6],
      this.packed[offset + 7]
    );
    velocity.set(
      this.packed[offset + 12],
      this.packed[offset + 13],
      this.packed[offset + 14],
      this.packed[offset + 15]
    );
    extra.set(
      this.packed[offset + 8],
      this.packed[offset + 9],
      this.packed[offset + 10],
      this.packed[offset + 15]
    );
  }
}
