import * as THREE from 'three';
import type { ElementalIntent } from './ElementalIntent';

export interface HandGravityWell {
  position: THREE.Vector3;
  radius: number;
  attraction: number;
  pressure: number;
  lift: number;
  settle: number;
  orbit: number;
}

export interface HandGravityField {
  wells: HandGravityWell[];
  twoHandCenter: THREE.Vector3;
  twoHandRadius: number;
  twoHandAttraction: number;
  twoHandOrbit: number;
}

export interface HandGravitySample {
  force: THREE.Vector3;
  attraction: number;
  pressure: number;
  lift: number;
  orbit: number;
}

export function createHandGravityField(intent: ElementalIntent): HandGravityField {
  return {
    wells: intent.hands.map((hand) => ({
      position: hand.position.clone(),
      radius: 62 + hand.spread * 54 + hand.hold * 24,
      attraction: clamp01(Math.max(hand.gather, hand.hold * 0.92)),
      pressure: clamp01(hand.project * (0.45 + hand.openness * 0.65)),
      lift: clampSigned(hand.lift - hand.suppress * 0.65),
      settle: clamp01(hand.suppress),
      orbit: clampSigned(hand.swirl + hand.speed * hand.gather * 0.35),
    })),
    twoHandCenter: intent.twoHand.midpoint.clone(),
    twoHandRadius: Math.max(28, intent.twoHand.ringRadius || intent.twoHand.separation * 0.5),
    twoHandAttraction: intent.twoHand.active ? clamp01(intent.twoHand.gather) : 0,
    twoHandOrbit: intent.twoHand.active ? clampSigned(intent.twoHand.swirl) : 0,
  };
}

export function sampleHandGravityField(field: HandGravityField, position: THREE.Vector3): HandGravitySample {
  const force = new THREE.Vector3();
  let attraction = 0;
  let pressure = 0;
  let lift = 0;
  let orbit = 0;

  for (const well of field.wells) {
    const delta = well.position.clone().sub(position);
    const distance = Math.max(0.001, delta.length());
    const falloff = smoothFalloff(distance, well.radius);
    const directionToHand = delta.multiplyScalar(1 / distance);
    const tangent = new THREE.Vector3(-directionToHand.z, 0, directionToHand.x).normalize();

    attraction += well.attraction * falloff;
    pressure += well.pressure * falloff;
    lift += well.lift * falloff;
    orbit += Math.abs(well.orbit) * falloff;

    force.add(directionToHand.clone().multiplyScalar(well.attraction * falloff));
    force.add(directionToHand.clone().multiplyScalar(-well.pressure * falloff));
    force.y += well.lift * falloff;
    force.add(tangent.multiplyScalar(well.orbit * falloff));
  }

  if (field.twoHandAttraction > 0 || Math.abs(field.twoHandOrbit) > 0) {
    const delta = field.twoHandCenter.clone().sub(position);
    const distance = Math.max(0.001, delta.length());
    const falloff = smoothFalloff(distance, field.twoHandRadius);
    const directionToCenter = delta.multiplyScalar(1 / distance);
    const tangent = new THREE.Vector3(-directionToCenter.z, 0, directionToCenter.x).normalize();
    force.add(directionToCenter.multiplyScalar(field.twoHandAttraction * falloff));
    force.add(tangent.multiplyScalar(field.twoHandOrbit * falloff));
  }

  return {
    force,
    attraction: clamp01(attraction),
    pressure: clamp01(pressure),
    lift: clampSigned(lift),
    orbit: clamp01(orbit),
  };
}

function smoothFalloff(distance: number, radius: number): number {
  const t = clamp01(1 - distance / Math.max(1, radius));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
