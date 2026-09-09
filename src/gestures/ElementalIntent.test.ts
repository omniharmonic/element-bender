import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ElementalIntentSmoother, createElementalIntent, packIntentForGpu } from './ElementalIntent';
import { GestureState, GestureType } from './GestureState';
import { InfluenceField } from './InfluenceField';

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

describe('ElementalIntent', () => {
  it('maps an open palm push into projective force', () => {
    const intent = createElementalIntent(
      gestureState({
        hands: [
          {
            position: new THREE.Vector3(10, 20, 30),
            velocity: new THREE.Vector3(0, 0, -0.5),
            palmNormal: new THREE.Vector3(0, 0, -1),
            palmOrientation: 'forward',
            grabStrength: 0,
            spreadStrength: 1,
          },
        ],
        activeGestures: new Set([GestureType.PUSH]),
      })
    );

    expect(intent.hands).toHaveLength(1);
    expect(intent.hands[0].project).toBeGreaterThan(0.85);
    expect(intent.hands[0].gather).toBeLessThan(0.1);
    expect(intent.hands[0].position.toArray()).toEqual([10, 20, 30]);
  });

  it('maps a closed hand and palm-up gesture into gather and lift', () => {
    const intent = createElementalIntent(
      gestureState({
        hands: [
          {
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(0, 0.3, 0),
            palmNormal: new THREE.Vector3(0, 1, 0),
            palmOrientation: 'up',
            grabStrength: 1,
            spreadStrength: 0,
          },
        ],
        activeGestures: new Set([GestureType.PALM_UP]),
      })
    );

    expect(intent.hands[0].gather).toBeGreaterThan(0.9);
    expect(intent.hands[0].lift).toBeGreaterThan(0.8);
    expect(intent.hands[0].suppress).toBe(0);
  });

  it('captures two-hand gather/spread geometry', () => {
    const intent = createElementalIntent(
      gestureState({
        hands: [
          {
            position: new THREE.Vector3(-10, 0, 0),
            velocity: new THREE.Vector3(),
            palmNormal: new THREE.Vector3(0, 0, -1),
            palmOrientation: 'forward',
            grabStrength: 0.3,
            spreadStrength: 0.7,
          },
          {
            position: new THREE.Vector3(10, 0, 0),
            velocity: new THREE.Vector3(),
            palmNormal: new THREE.Vector3(0, 0, -1),
            palmOrientation: 'forward',
            grabStrength: 0.3,
            spreadStrength: 0.7,
          },
        ],
        twoHand: {
          active: true,
          separation: 20,
          separationVelocity: -0.4,
          midpoint: new THREE.Vector3(0, 2, 0),
          rotationAxis: new THREE.Vector3(0, 1, 0),
          rotationSpeed: 0.8,
        },
        activeGestures: new Set([GestureType.GATHER, GestureType.SWIRL_CW]),
      })
    );

    expect(intent.twoHand.active).toBe(true);
    expect(intent.twoHand.gather).toBeGreaterThan(0.7);
    expect(intent.twoHand.spread).toBe(0);
    expect(intent.twoHand.swirl).toBeGreaterThan(0.7);
    expect(intent.twoHand.midpoint.toArray()).toEqual([0, 2, 0]);
  });

  it('packs fixed-size vec4 records for GPU upload', () => {
    const intent = createElementalIntent(
      gestureState({
        hands: [
          {
            position: new THREE.Vector3(1, 2, 3),
            velocity: new THREE.Vector3(0.1, 0.2, 0.3),
            palmNormal: new THREE.Vector3(0, 1, 0),
            palmOrientation: 'up',
            grabStrength: 0.5,
            spreadStrength: 0.25,
          },
        ],
        activeGestures: new Set([GestureType.PALM_UP]),
      })
    );

    const packed = packIntentForGpu(intent);

    expect(packed.length).toBe(64);
    expect(Array.from(packed.slice(0, 4))).toEqual([1, 2, 3, 1]);
    expect(packed[4]).toBeGreaterThanOrEqual(0);
    expect(packed[5]).toBeGreaterThanOrEqual(0);
    expect(packed[10]).toBeCloseTo(intent.hands[0].openness);
  });

  it('pads influence points to vec4-aligned GPU records', () => {
    const field = new InfluenceField();
    field.points.push({
      position: new THREE.Vector3(1, 2, 3),
      radius: 44,
      radialForce: 5,
      tangentialForce: -2,
      verticalBias: 1,
      intensity: 0.5,
      falloff: 'quadratic',
    });

    const packed = field.getPaddedInfluenceData(4);

    expect(packed.length).toBe(64);
    expect(Array.from(packed.slice(0, 8))).toEqual([1, 2, 3, 44, 5, -2, 1, 0.5]);
    expect(Array.from(packed.slice(16, 20))).toEqual([0, 0, 0, 0]);
  });

  it('smooths noisy intent without losing hand identity', () => {
    const smoother = new ElementalIntentSmoother(0.25);
    const first = createElementalIntent(
      gestureState({
        hands: [
          {
            position: new THREE.Vector3(0, 0, 0),
            velocity: new THREE.Vector3(),
            palmNormal: new THREE.Vector3(0, 0, -1),
            palmOrientation: 'forward',
            grabStrength: 0,
            spreadStrength: 0.2,
          },
        ],
      })
    );
    const second = createElementalIntent(
      gestureState({
        hands: [
          {
            position: new THREE.Vector3(40, 0, 0),
            velocity: new THREE.Vector3(1, 0, 0),
            palmNormal: new THREE.Vector3(0, 0, -1),
            palmOrientation: 'forward',
            grabStrength: 0,
            spreadStrength: 1,
          },
        ],
        activeGestures: new Set([GestureType.PUSH]),
      })
    );

    smoother.update(first);
    const smoothed = smoother.update(second);

    expect(smoothed.hands[0].position.x).toBeGreaterThan(0);
    expect(smoothed.hands[0].position.x).toBeLessThan(40);
    expect(smoothed.hands[0].project).toBeGreaterThan(first.hands[0].project);
    expect(smoothed.hands[0].project).toBeLessThanOrEqual(second.hands[0].project);
  });

  it('keeps a short hold signal after a fist releases', () => {
    const smoother = new ElementalIntentSmoother(1, 0.35);
    const held = smoother.update(
      createElementalIntent(
        gestureState({
          hands: [
            {
              position: new THREE.Vector3(),
              velocity: new THREE.Vector3(),
              palmNormal: new THREE.Vector3(0, 0, -1),
              palmOrientation: 'forward',
              grabStrength: 1,
              spreadStrength: 0,
            },
          ],
        })
      ),
      0.016
    );
    const released = smoother.update(
      createElementalIntent(
        gestureState({
          hands: [
            {
              position: new THREE.Vector3(),
              velocity: new THREE.Vector3(),
              palmNormal: new THREE.Vector3(0, 0, -1),
              palmOrientation: 'forward',
              grabStrength: 0,
              spreadStrength: 1,
            },
          ],
        })
      ),
      0.1
    );

    expect(held.hands[0].hold).toBeGreaterThan(0.9);
    expect(released.hands[0].hold).toBeGreaterThan(0);
  });
});
