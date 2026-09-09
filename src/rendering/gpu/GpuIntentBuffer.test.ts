import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GpuIntentBuffer } from './GpuIntentBuffer';
import { createElementalIntent } from '../../gestures/ElementalIntent';
import { GestureState, GestureType } from '../../gestures/GestureState';

function gestureState(overrides: Partial<GestureState> = {}): GestureState {
  return {
    hands: [],
    twoHand: {
      active: false,
      separation: 0,
      separationVelocity: 0,
      midpoint: new THREE.Vector3(),
      rotationAxis: new THREE.Vector3(0, 1, 0),
      rotationSpeed: 0,
    },
    activeGestures: new Set(),
    ...overrides,
  };
}

describe('GpuIntentBuffer', () => {
  it('mirrors packed intent into mutable vec4 uniforms', () => {
    const buffer = new GpuIntentBuffer();
    const intent = createElementalIntent(
      gestureState({
        hands: [
          {
            position: new THREE.Vector3(4, 5, 6),
            velocity: new THREE.Vector3(0.2, 0.3, 0.4),
            palmNormal: new THREE.Vector3(0, 1, 0),
            palmOrientation: 'up',
            grabStrength: 0.75,
            spreadStrength: 0.4,
          },
        ],
        activeGestures: new Set([GestureType.PALM_UP]),
      })
    );

    buffer.update(intent);

    expect(buffer.hand0Position.value.toArray()).toEqual([4, 5, 6, 1]);
    expect(buffer.hand0Forces.value.x).toBeGreaterThanOrEqual(0);
    expect(buffer.hand0Forces.value.y).toBeGreaterThan(0.7);
    expect(buffer.hand0Extra.value.w).toBeGreaterThan(0);
  });

  it('zeroes inactive hands while preserving two-hand payload shape', () => {
    const buffer = new GpuIntentBuffer();

    buffer.update(createElementalIntent(gestureState()));

    expect(buffer.hand0Position.value.w).toBe(0);
    expect(buffer.hand1Position.value.w).toBe(0);
    expect(buffer.twoHand.value.w).toBe(0);
  });

  it('exposes per-hand swirl, spread, openness, and hold for compute kernels', () => {
    const buffer = new GpuIntentBuffer();
    buffer.update({
      hands: [
        {
          position: new THREE.Vector3(),
          velocity: new THREE.Vector3(),
          project: 0.2,
          gather: 0.8,
          lift: 0.9,
          suppress: 0,
          swirl: -0.7,
          spread: 0.4,
          openness: 0.1,
          speed: 0.2,
          hold: 1,
        },
      ],
      twoHand: {
        active: false,
        midpoint: new THREE.Vector3(),
        separation: 0,
        gather: 0,
        spread: 0,
        swirl: 0,
        ringRadius: 0,
      },
    });

    expect(buffer.hand0Extra.value.toArray()).toEqual([
      expect.closeTo(-0.7),
      expect.closeTo(0.4),
      expect.closeTo(0.1),
      1,
    ]);
  });
});
