import * as THREE from 'three';

export enum GestureType {
  PUSH = 'push',
  PULL = 'pull',
  SWIRL_CW = 'swirl_cw',
  SWIRL_CCW = 'swirl_ccw',
  SPREAD = 'spread',
  GATHER = 'gather',
  PALM_UP = 'palm_up',
  PALM_DOWN = 'palm_down',
  IDLE = 'idle',
}

export interface HandState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  palmNormal: THREE.Vector3;
  palmOrientation: 'up' | 'down' | 'forward' | 'side';
  grabStrength: number;
  spreadStrength: number;
}

export interface TwoHandState {
  active: boolean;
  separation: number;
  separationVelocity: number;
  midpoint: THREE.Vector3;
  rotationAxis: THREE.Vector3;
  rotationSpeed: number;
}

export interface GestureState {
  hands: HandState[];
  twoHand: TwoHandState;
  activeGestures: Set<GestureType>;
}

export function createEmptyGestureState(): GestureState {
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
    activeGestures: new Set([GestureType.IDLE]),
  };
}
