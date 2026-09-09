import * as THREE from 'three';
import { GestureState, GestureType, HandState } from './GestureState';

export interface ElementalHandIntent {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  project: number;
  gather: number;
  lift: number;
  suppress: number;
  swirl: number;
  spread: number;
  openness: number;
  speed: number;
  hold: number;
}

export interface ElementalTwoHandIntent {
  active: boolean;
  midpoint: THREE.Vector3;
  separation: number;
  gather: number;
  spread: number;
  swirl: number;
  ringRadius: number;
}

export interface ElementalIntent {
  hands: ElementalHandIntent[];
  twoHand: ElementalTwoHandIntent;
}

const GPU_FLOAT_COUNT = 64;
const FLOATS_PER_HAND = 16;
const TWO_HAND_OFFSET = 48;

export function createElementalIntent(gestures: GestureState): ElementalIntent {
  const hands = gestures.hands.slice(0, 2).map((hand) => createHandIntent(hand, gestures));

  return {
    hands,
    twoHand: createTwoHandIntent(gestures),
  };
}

export function packIntentForGpu(intent: ElementalIntent): Float32Array {
  const data = new Float32Array(GPU_FLOAT_COUNT);

  for (let i = 0; i < Math.min(2, intent.hands.length); i++) {
    const hand = intent.hands[i];
    const offset = i * FLOATS_PER_HAND;

    data[offset + 0] = hand.position.x;
    data[offset + 1] = hand.position.y;
    data[offset + 2] = hand.position.z;
    data[offset + 3] = 1;

    data[offset + 4] = hand.project;
    data[offset + 5] = hand.gather;
    data[offset + 6] = hand.lift;
    data[offset + 7] = hand.suppress;

    data[offset + 8] = hand.swirl;
    data[offset + 9] = hand.spread;
    data[offset + 10] = hand.openness;
    data[offset + 11] = hand.speed;

    data[offset + 12] = hand.velocity.x;
    data[offset + 13] = hand.velocity.y;
    data[offset + 14] = hand.velocity.z;
    data[offset + 15] = hand.hold;
  }

  const twoHand = intent.twoHand;
  data[TWO_HAND_OFFSET + 0] = twoHand.midpoint.x;
  data[TWO_HAND_OFFSET + 1] = twoHand.midpoint.y;
  data[TWO_HAND_OFFSET + 2] = twoHand.midpoint.z;
  data[TWO_HAND_OFFSET + 3] = twoHand.active ? 1 : 0;
  data[TWO_HAND_OFFSET + 4] = twoHand.separation;
  data[TWO_HAND_OFFSET + 5] = twoHand.gather;
  data[TWO_HAND_OFFSET + 6] = twoHand.spread;
  data[TWO_HAND_OFFSET + 7] = twoHand.swirl;
  data[TWO_HAND_OFFSET + 8] = twoHand.ringRadius;

  return data;
}

function createHandIntent(hand: HandState, gestures: GestureState): ElementalHandIntent {
  const openness = clamp01((1 - hand.grabStrength) * hand.spreadStrength);
  const speed = clamp01(hand.velocity.length() / 0.55);
  const pushing = gestures.activeGestures.has(GestureType.PUSH) ? 1 : 0;
  const pulling = gestures.activeGestures.has(GestureType.PULL) ? 1 : 0;
  const palmUp = gestures.activeGestures.has(GestureType.PALM_UP) ? 1 : 0;
  const palmDown = gestures.activeGestures.has(GestureType.PALM_DOWN) ? 1 : 0;

  return {
    position: hand.position.clone(),
    velocity: hand.velocity.clone(),
    project: clamp01(Math.max(openness, pushing * (0.75 + speed * 0.35))),
    gather: clamp01(Math.max(hand.grabStrength, pulling * (0.5 + speed * 0.5))),
    lift: clamp01(Math.max(palmUp, Math.max(0, hand.velocity.y) * 2)),
    suppress: clamp01(palmDown),
    swirl: getSwirlSign(gestures),
    spread: clamp01(hand.spreadStrength),
    openness,
    speed,
    hold: clamp01(hand.grabStrength),
  };
}

export class ElementalIntentSmoother {
  private previous: ElementalIntent | null = null;
  private holdMemory = [0, 0];

  constructor(
    private readonly alpha = 0.32,
    private readonly holdDecaySeconds = 0.22
  ) {}

  update(next: ElementalIntent, deltaTime = 1 / 60): ElementalIntent {
    const smoothed: ElementalIntent = {
      hands: next.hands.map((hand, index) => {
        const previousHand = this.previous?.hands[index];
        const hold = Math.max(
          hand.hold,
          Math.max(0, this.holdMemory[index] - deltaTime / this.holdDecaySeconds)
        );
        this.holdMemory[index] = hold;

        if (!previousHand) {
          return {
            ...hand,
            position: hand.position.clone(),
            velocity: hand.velocity.clone(),
            hold,
          };
        }

        return {
          position: previousHand.position.clone().lerp(hand.position, this.alpha),
          velocity: previousHand.velocity.clone().lerp(hand.velocity, this.alpha),
          project: lerp(previousHand.project, hand.project, this.alpha),
          gather: lerp(previousHand.gather, hand.gather, this.alpha),
          lift: lerp(previousHand.lift, hand.lift, this.alpha),
          suppress: lerp(previousHand.suppress, hand.suppress, this.alpha),
          swirl: lerp(previousHand.swirl, hand.swirl, this.alpha),
          spread: lerp(previousHand.spread, hand.spread, this.alpha),
          openness: lerp(previousHand.openness, hand.openness, this.alpha),
          speed: lerp(previousHand.speed, hand.speed, this.alpha),
          hold,
        };
      }),
      twoHand: {
        active: next.twoHand.active,
        midpoint: this.previous?.twoHand.midpoint.clone().lerp(next.twoHand.midpoint, this.alpha)
          ?? next.twoHand.midpoint.clone(),
        separation: lerp(this.previous?.twoHand.separation ?? next.twoHand.separation, next.twoHand.separation, this.alpha),
        gather: lerp(this.previous?.twoHand.gather ?? next.twoHand.gather, next.twoHand.gather, this.alpha),
        spread: lerp(this.previous?.twoHand.spread ?? next.twoHand.spread, next.twoHand.spread, this.alpha),
        swirl: lerp(this.previous?.twoHand.swirl ?? next.twoHand.swirl, next.twoHand.swirl, this.alpha),
        ringRadius: lerp(this.previous?.twoHand.ringRadius ?? next.twoHand.ringRadius, next.twoHand.ringRadius, this.alpha),
      },
    };

    this.previous = cloneIntent(smoothed);
    return smoothed;
  }
}

function createTwoHandIntent(gestures: GestureState): ElementalTwoHandIntent {
  const active = gestures.twoHand.active && gestures.hands.length >= 2;
  const separationVelocity = gestures.twoHand.separationVelocity;

  return {
    active,
    midpoint: gestures.twoHand.midpoint.clone(),
    separation: gestures.twoHand.separation,
    gather: active ? clamp01(Math.max(0, -separationVelocity) * 2.5) : 0,
    spread: active ? clamp01(Math.max(0, separationVelocity) * 2.5) : 0,
    swirl: active ? clampSigned(gestures.twoHand.rotationSpeed) : 0,
    ringRadius: active ? Math.max(8, gestures.twoHand.separation * 0.5) : 0,
  };
}

function getSwirlSign(gestures: GestureState): number {
  if (gestures.activeGestures.has(GestureType.SWIRL_CW)) return 1;
  if (gestures.activeGestures.has(GestureType.SWIRL_CCW)) return -1;
  return 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function cloneIntent(intent: ElementalIntent): ElementalIntent {
  return {
    hands: intent.hands.map((hand) => ({
      ...hand,
      position: hand.position.clone(),
      velocity: hand.velocity.clone(),
    })),
    twoHand: {
      ...intent.twoHand,
      midpoint: intent.twoHand.midpoint.clone(),
    },
  };
}
