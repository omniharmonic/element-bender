import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createHandGravityField, sampleHandGravityField } from './HandGravityField';
import { ElementalIntent } from './ElementalIntent';

function intent(partial: Partial<ElementalIntent['hands'][number]> = {}): ElementalIntent {
  return {
    hands: [
      {
        position: new THREE.Vector3(0, 0, 0),
        velocity: new THREE.Vector3(),
        project: 0,
        gather: 0,
        lift: 0,
        suppress: 0,
        swirl: 0,
        spread: 0,
        openness: 0,
        speed: 0,
        hold: 0,
        ...partial,
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
  };
}

describe('HandGravityField', () => {
  it('turns a fist or gather gesture into attraction toward the hand', () => {
    const field = createHandGravityField(intent({ gather: 1, hold: 1 }));
    const sample = sampleHandGravityField(field, new THREE.Vector3(20, 0, 0));

    expect(sample.force.x).toBeLessThan(0);
    expect(sample.attraction).toBeGreaterThan(0.75);
  });

  it('turns open-palm project into pressure away from the hand', () => {
    const field = createHandGravityField(intent({ project: 1, openness: 1 }));
    const sample = sampleHandGravityField(field, new THREE.Vector3(20, 0, 0));

    expect(sample.force.x).toBeGreaterThan(0);
    expect(sample.pressure).toBeGreaterThan(0.75);
  });

  it('adds orbital force for swirl without destroying lift', () => {
    const field = createHandGravityField(intent({ swirl: 1, lift: 1 }));
    const sample = sampleHandGravityField(field, new THREE.Vector3(20, 0, 0));

    expect(Math.abs(sample.force.z)).toBeGreaterThan(0.2);
    expect(sample.force.y).toBeGreaterThan(0);
  });
});
