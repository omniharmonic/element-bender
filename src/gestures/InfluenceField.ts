import * as THREE from 'three';
import { GestureState, GestureType } from './GestureState';

export interface InfluencePoint {
  position: THREE.Vector3;
  radius: number;
  radialForce: number;
  tangentialForce: number;
  verticalBias: number;
  intensity: number;
  falloff: 'linear' | 'quadratic' | 'cubic';
}

const PUSH_MULTIPLIER = 5;
const PULL_MULTIPLIER = 5;
const SWIRL_MULTIPLIER = 3;
const VERTICAL_MULTIPLIER = 2;

// Magnetic bending force - the core of the "bending" feel
const MAGNETIC_ATTRACT_FORCE = -4; // Closed hand attracts (negative = toward hand)
const MAGNETIC_REPEL_FORCE = 6;    // Open hand repels (positive = away from hand)

export class InfluenceField {
  points: InfluencePoint[] = [];

  updateFromGestures(gestures: GestureState): void {
    this.points = [];

    for (const hand of gestures.hands) {
      // Calculate magnetic force based on hand openness
      // grabStrength: 0 = open hand, 1 = closed fist
      // When closed (grabStrength high): attract/draw in
      // When open (grabStrength low): repel/push away
      const magneticForce =
        hand.grabStrength * MAGNETIC_ATTRACT_FORCE +
        (1 - hand.grabStrength) * hand.spreadStrength * MAGNETIC_REPEL_FORCE;

      const point: InfluencePoint = {
        position: hand.position.clone(),
        radius: 35 + hand.spreadStrength * 45, // Slightly larger radius
        radialForce: magneticForce, // Base magnetic force always active
        tangentialForce: 0,
        verticalBias: 0,
        intensity: 1,
        falloff: 'quadratic',
      };

      // Add velocity-based push/pull on top of magnetic force
      if (gestures.activeGestures.has(GestureType.PUSH)) {
        point.radialForce += hand.velocity.length() * PUSH_MULTIPLIER;
      }

      if (gestures.activeGestures.has(GestureType.PULL)) {
        point.radialForce -= hand.velocity.length() * PULL_MULTIPLIER;
      }

      if (gestures.activeGestures.has(GestureType.PALM_UP)) {
        point.verticalBias = VERTICAL_MULTIPLIER;
      }

      if (gestures.activeGestures.has(GestureType.PALM_DOWN)) {
        point.verticalBias = -VERTICAL_MULTIPLIER;
      }

      if (gestures.activeGestures.has(GestureType.SWIRL_CW)) {
        point.tangentialForce = SWIRL_MULTIPLIER;
      }

      if (gestures.activeGestures.has(GestureType.SWIRL_CCW)) {
        point.tangentialForce = -SWIRL_MULTIPLIER;
      }

      this.points.push(point);
    }

    // Two-hand effects on midpoint
    if (gestures.twoHand.active && gestures.hands.length === 2) {
      const midPoint: InfluencePoint = {
        position: gestures.twoHand.midpoint.clone(),
        radius: gestures.twoHand.separation * 0.8,
        radialForce: 0,
        tangentialForce: 0,
        verticalBias: 0,
        intensity: 0.5,
        falloff: 'quadratic',
      };

      if (gestures.activeGestures.has(GestureType.SPREAD)) {
        midPoint.radialForce = gestures.twoHand.separationVelocity * 3;
      }

      if (gestures.activeGestures.has(GestureType.GATHER)) {
        midPoint.radialForce = gestures.twoHand.separationVelocity * 3;
      }

      if (Math.abs(gestures.twoHand.rotationSpeed) > 0.1) {
        midPoint.tangentialForce = gestures.twoHand.rotationSpeed * 2;
      }

      if (midPoint.radialForce !== 0 || midPoint.tangentialForce !== 0) {
        this.points.push(midPoint);
      }
    }
  }

  sample(position: THREE.Vector3): THREE.Vector3 {
    const totalForce = new THREE.Vector3();

    for (const point of this.points) {
      const delta = position.clone().sub(point.position);
      const distance = delta.length();

      if (distance > point.radius || distance < 0.01) continue;

      const t = distance / point.radius;
      let falloff: number;

      switch (point.falloff) {
        case 'linear':
          falloff = 1 - t;
          break;
        case 'quadratic':
          falloff = (1 - t) * (1 - t);
          break;
        case 'cubic':
          falloff = (1 - t) * (1 - t) * (1 - t);
          break;
      }

      falloff *= point.intensity;

      // Radial component
      const radialDir = delta.clone().normalize();
      const radial = radialDir.multiplyScalar(point.radialForce * falloff);
      totalForce.add(radial);

      // Tangential component (for swirl)
      const tangent = new THREE.Vector3(-delta.z, 0, delta.x).normalize();
      totalForce.add(tangent.multiplyScalar(point.tangentialForce * falloff));

      // Vertical bias
      totalForce.y += point.verticalBias * falloff;
    }

    return totalForce;
  }

  getInfluenceData(): Float32Array {
    const data = new Float32Array(this.points.length * 8);

    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const offset = i * 8;
      data[offset + 0] = p.position.x;
      data[offset + 1] = p.position.y;
      data[offset + 2] = p.position.z;
      data[offset + 3] = p.radius;
      data[offset + 4] = p.radialForce;
      data[offset + 5] = p.tangentialForce;
      data[offset + 6] = p.verticalBias;
      data[offset + 7] = p.intensity;
    }

    return data;
  }

  getPaddedInfluenceData(maxPoints = 4): Float32Array {
    const floatsPerPoint = 16;
    const data = new Float32Array(maxPoints * floatsPerPoint);

    for (let i = 0; i < Math.min(this.points.length, maxPoints); i++) {
      const p = this.points[i];
      const offset = i * floatsPerPoint;
      data[offset + 0] = p.position.x;
      data[offset + 1] = p.position.y;
      data[offset + 2] = p.position.z;
      data[offset + 3] = p.radius;
      data[offset + 4] = p.radialForce;
      data[offset + 5] = p.tangentialForce;
      data[offset + 6] = p.verticalBias;
      data[offset + 7] = p.intensity;
      data[offset + 8] = p.falloff === 'linear' ? 1 : p.falloff === 'quadratic' ? 2 : 3;
    }

    return data;
  }
}
