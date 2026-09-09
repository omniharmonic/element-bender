import * as THREE from 'three';
import type { TrackingState, HandData, Vector3Like } from '../tracking/types';
import {
  GestureType,
  GestureState,
  HandState,
  createEmptyGestureState,
} from './GestureState';

const VELOCITY_THRESHOLD = 0.02;
const SWIRL_THRESHOLD = 0.5;
const PALM_THRESHOLD = 0.6;
const SPREAD_GATHER_THRESHOLD = 0.1;

export class GestureRecognizer {
  private handHistories: Map<string, HandState[]> = new Map();
  private readonly historyLength = 15;
  private previousSeparation = 0;

  update(tracking: TrackingState | null): GestureState {
    const state = createEmptyGestureState();

    if (!tracking || tracking.hands.length === 0) {
      return state;
    }

    state.activeGestures.clear();

    // Process each hand
    for (const hand of tracking.hands) {
      const handState = this.processHand(hand);
      state.hands.push(handState);
    }

    // Two-hand gestures
    if (state.hands.length === 2) {
      this.processTwoHands(state);
    }

    // Detect gestures from hand states
    this.detectGestures(state);

    if (state.activeGestures.size === 0) {
      state.activeGestures.add(GestureType.IDLE);
    }

    return state;
  }

  private processHand(hand: HandData): HandState {
    const worldLandmarks = hand.worldLandmarks;
    const screenLandmarks = hand.landmarks; // Normalized screen coordinates (0-1)

    // Use screen landmarks for X/Y position (these track where the hand is on screen)
    const screenWrist = screenLandmarks[0];
    const screenMiddleBase = screenLandmarks[9];

    // Convert from normalized screen coords (0-1) to scene coords
    // Screen X: 0 = left, 1 = right -> Scene X: -75 to 75 (mirrored for selfie camera)
    // Screen Y: 0 = top, 1 = bottom -> Scene Y: 50 to -50
    const screenX = (screenWrist.x + screenMiddleBase.x) / 2;
    const screenY = (screenWrist.y + screenMiddleBase.y) / 2;

    // Use world landmarks for depth (Z)
    const worldWrist = worldLandmarks[0];
    const worldMiddleBase = worldLandmarks[9];
    const worldZ = (worldWrist.z + worldMiddleBase.z) / 2;

    const position = new THREE.Vector3(
      -(screenX - 0.5) * 150, // Mirror X, map 0-1 to -75 to 75
      -(screenY - 0.5) * 100, // Map 0-1 to 50 to -50
      worldZ * 200 // Scale depth
    );

    // Get history for velocity calculation
    const historyKey = hand.handedness;
    if (!this.handHistories.has(historyKey)) {
      this.handHistories.set(historyKey, []);
    }
    const history = this.handHistories.get(historyKey)!;

    // Calculate velocity from history
    let velocity = new THREE.Vector3();
    if (history.length > 0) {
      const prev = history[history.length - 1].position;
      velocity = position.clone().sub(prev);
    }

    // Palm normal (cross product of finger directions) - use world landmarks for orientation
    const wrist = worldLandmarks[0];
    const middleBase = worldLandmarks[9];
    const indexBase = worldLandmarks[5];
    const pinkyBase = worldLandmarks[17];

    const toMiddle = new THREE.Vector3(
      middleBase.x - wrist.x,
      -(middleBase.y - wrist.y),
      middleBase.z - wrist.z
    ).normalize();

    const toSide = new THREE.Vector3(
      pinkyBase.x - indexBase.x,
      -(pinkyBase.y - indexBase.y),
      pinkyBase.z - indexBase.z
    ).normalize();

    const palmNormal = new THREE.Vector3().crossVectors(toMiddle, toSide);
    if (hand.handedness === 'Left') {
      palmNormal.negate();
    }
    palmNormal.normalize();

    // Palm orientation
    let palmOrientation: 'up' | 'down' | 'forward' | 'side' = 'forward';
    if (palmNormal.y > PALM_THRESHOLD) {
      palmOrientation = 'up';
    } else if (palmNormal.y < -PALM_THRESHOLD) {
      palmOrientation = 'down';
    } else if (Math.abs(palmNormal.z) > PALM_THRESHOLD) {
      palmOrientation = 'forward';
    } else {
      palmOrientation = 'side';
    }

    // Grab strength (how curled are fingers)
    const grabStrength = this.calculateGrabStrength(worldLandmarks);

    // Spread strength (how spread are fingers)
    const spreadStrength = this.calculateSpreadStrength(worldLandmarks);

    const handState: HandState = {
      position,
      velocity,
      palmNormal,
      palmOrientation,
      grabStrength,
      spreadStrength,
    };

    // Update history
    history.push(handState);
    if (history.length > this.historyLength) {
      history.shift();
    }

    return handState;
  }

  private calculateGrabStrength(landmarks: Vector3Like[]): number {
    // Measure distance from fingertips to palm center
    const palmCenter = new THREE.Vector3(
      (landmarks[0].x + landmarks[9].x) / 2,
      (landmarks[0].y + landmarks[9].y) / 2,
      (landmarks[0].z + landmarks[9].z) / 2
    );

    const fingerTips = [4, 8, 12, 16, 20]; // Thumb, index, middle, ring, pinky tips
    let totalDist = 0;

    for (const tipIdx of fingerTips) {
      const tip = landmarks[tipIdx];
      totalDist += palmCenter.distanceTo(new THREE.Vector3(tip.x, tip.y, tip.z));
    }

    // Normalize: ~0.3 when fully spread, ~0.1 when grabbed
    const avgDist = totalDist / fingerTips.length;
    return 1 - Math.min(1, Math.max(0, (avgDist - 0.08) / 0.25));
  }

  private calculateSpreadStrength(landmarks: Vector3Like[]): number {
    // Measure angles between fingers
    const fingerBases = [5, 9, 13, 17]; // Index, middle, ring, pinky bases
    let totalAngle = 0;

    for (let i = 0; i < fingerBases.length - 1; i++) {
      const base1 = landmarks[fingerBases[i]];
      const base2 = landmarks[fingerBases[i + 1]];
      const wrist = landmarks[0];

      const v1 = new THREE.Vector3(
        base1.x - wrist.x,
        base1.y - wrist.y,
        base1.z - wrist.z
      );
      const v2 = new THREE.Vector3(
        base2.x - wrist.x,
        base2.y - wrist.y,
        base2.z - wrist.z
      );

      totalAngle += v1.angleTo(v2);
    }

    return Math.min(1, totalAngle / 0.8);
  }

  private processTwoHands(state: GestureState): void {
    const hand1 = state.hands[0];
    const hand2 = state.hands[1];

    state.twoHand.active = true;
    state.twoHand.separation = hand1.position.distanceTo(hand2.position);
    state.twoHand.separationVelocity = state.twoHand.separation - this.previousSeparation;
    this.previousSeparation = state.twoHand.separation;

    state.twoHand.midpoint = hand1.position.clone().add(hand2.position).multiplyScalar(0.5);

    // Rotation detection
    const historyKey1 = 'Left';
    const historyKey2 = 'Right';
    const history1 = this.handHistories.get(historyKey1) || [];
    const history2 = this.handHistories.get(historyKey2) || [];

    if (history1.length > 5 && history2.length > 5) {
      const rotationSpeed = this.detectRotation(history1, history2);
      state.twoHand.rotationSpeed = rotationSpeed;
    }
  }

  private detectRotation(history1: HandState[], history2: HandState[]): number {
    const recent = 5;
    if (history1.length < recent || history2.length < recent) return 0;

    let totalAngle = 0;
    for (let i = 1; i < recent; i++) {
      const prev1 = history1[history1.length - recent + i - 1].position;
      const curr1 = history1[history1.length - recent + i].position;
      const prev2 = history2[history2.length - recent + i - 1].position;
      const curr2 = history2[history2.length - recent + i].position;

      const prevMid = prev1.clone().add(prev2).multiplyScalar(0.5);
      const currMid = curr1.clone().add(curr2).multiplyScalar(0.5);

      const prevVec = prev1.clone().sub(prevMid);
      const currVec = curr1.clone().sub(currMid);

      // 2D angle change (XZ plane)
      const prevAngle = Math.atan2(prevVec.z, prevVec.x);
      const currAngle = Math.atan2(currVec.z, currVec.x);
      totalAngle += currAngle - prevAngle;
    }

    return totalAngle;
  }

  private detectGestures(state: GestureState): void {
    for (const hand of state.hands) {
      // Push/Pull detection
      if (hand.palmOrientation === 'forward') {
        if (hand.velocity.z < -VELOCITY_THRESHOLD) {
          state.activeGestures.add(GestureType.PUSH);
        } else if (hand.velocity.z > VELOCITY_THRESHOLD) {
          state.activeGestures.add(GestureType.PULL);
        }
      }

      // Palm up/down
      if (hand.palmOrientation === 'up') {
        state.activeGestures.add(GestureType.PALM_UP);
      } else if (hand.palmOrientation === 'down') {
        state.activeGestures.add(GestureType.PALM_DOWN);
      }
    }

    // Two-hand gestures
    if (state.twoHand.active) {
      if (state.twoHand.separationVelocity > SPREAD_GATHER_THRESHOLD) {
        state.activeGestures.add(GestureType.SPREAD);
      } else if (state.twoHand.separationVelocity < -SPREAD_GATHER_THRESHOLD) {
        state.activeGestures.add(GestureType.GATHER);
      }

      if (state.twoHand.rotationSpeed > SWIRL_THRESHOLD) {
        state.activeGestures.add(GestureType.SWIRL_CW);
      } else if (state.twoHand.rotationSpeed < -SWIRL_THRESHOLD) {
        state.activeGestures.add(GestureType.SWIRL_CCW);
      }
    }

    // Single hand swirl
    for (const hand of state.hands) {
      const historyKey = state.hands.indexOf(hand) === 0 ? 'Left' : 'Right';
      const history = this.handHistories.get(historyKey) || [];

      if (history.length >= 10) {
        const swirlResult = this.detectSingleHandSwirl(history);
        if (swirlResult.active) {
          if (swirlResult.direction === 'cw') {
            state.activeGestures.add(GestureType.SWIRL_CW);
          } else {
            state.activeGestures.add(GestureType.SWIRL_CCW);
          }
        }
      }
    }
  }

  private detectSingleHandSwirl(history: HandState[]): { active: boolean; direction: 'cw' | 'ccw' } {
    const positions = history.slice(-10).map((h) => h.position);

    // Calculate centroid
    const centroid = new THREE.Vector3();
    for (const pos of positions) {
      centroid.add(pos);
    }
    centroid.divideScalar(positions.length);

    // Calculate angular velocity
    let totalAngle = 0;
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1].clone().sub(centroid);
      const curr = positions[i].clone().sub(centroid);

      const prevAngle = Math.atan2(prev.z, prev.x);
      const currAngle = Math.atan2(curr.z, curr.x);
      let delta = currAngle - prevAngle;

      // Handle angle wrapping
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;

      totalAngle += delta;
    }

    return {
      active: Math.abs(totalAngle) > SWIRL_THRESHOLD,
      direction: totalAngle > 0 ? 'cw' : 'ccw',
    };
  }
}
