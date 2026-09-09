import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface HandData {
  landmarks: NormalizedLandmark[];
  worldLandmarks: Vector3Like[];
  handedness: 'Left' | 'Right';
  confidence: number;
}

export interface TrackingState {
  hands: HandData[];
  timestamp: number;
  frameRate: number;
}
