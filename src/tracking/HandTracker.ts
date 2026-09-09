import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandData, TrackingState, Vector3Like } from './types';

export class HandTracker {
  private handLandmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement;
  private lastFrameTime = 0;
  private frameCount = 0;
  private fps = 0;
  private landmarkHistory: Map<string, Vector3Like[][]> = new Map();
  private readonly historyLength = 5;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async initialize(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  async startCamera(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user',
      },
    });
    this.video.srcObject = stream;
    await new Promise<void>((resolve) => {
      this.video.onloadedmetadata = () => {
        this.video.play();
        resolve();
      };
    });
  }

  processFrame(): TrackingState | null {
    if (!this.handLandmarker || this.video.readyState < 2) {
      return null;
    }

    const now = performance.now();

    // Calculate FPS
    this.frameCount++;
    if (now - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
    }

    const results = this.handLandmarker.detectForVideo(this.video, now);

    const hands: HandData[] = [];

    if (results.landmarks && results.handednesses && results.worldLandmarks) {
      for (let i = 0; i < results.landmarks.length; i++) {
        const handedness = results.handednesses[i][0];
        const handId = handedness.categoryName as 'Left' | 'Right';

        // Smooth landmarks
        const smoothedLandmarks = this.smoothLandmarks(
          handId,
          results.worldLandmarks[i]
        );

        hands.push({
          landmarks: results.landmarks[i],
          worldLandmarks: smoothedLandmarks,
          handedness: handId,
          confidence: handedness.score,
        });
      }
    }

    return {
      hands,
      timestamp: now,
      frameRate: this.fps,
    };
  }

  private smoothLandmarks(handId: string, landmarks: Vector3Like[]): Vector3Like[] {
    if (!this.landmarkHistory.has(handId)) {
      this.landmarkHistory.set(handId, []);
    }

    const history = this.landmarkHistory.get(handId)!;
    history.push(landmarks);

    if (history.length > this.historyLength) {
      history.shift();
    }

    // Average across history for each landmark
    const smoothed: Vector3Like[] = [];
    for (let i = 0; i < landmarks.length; i++) {
      let sumX = 0, sumY = 0, sumZ = 0;
      for (const frame of history) {
        sumX += frame[i].x;
        sumY += frame[i].y;
        sumZ += frame[i].z;
      }
      smoothed.push({
        x: sumX / history.length,
        y: sumY / history.length,
        z: sumZ / history.length,
      });
    }

    return smoothed;
  }

  dispose(): void {
    if (this.handLandmarker) {
      this.handLandmarker.close();
    }
    if (this.video.srcObject) {
      const stream = this.video.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
  }
}
