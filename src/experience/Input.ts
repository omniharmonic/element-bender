import * as THREE from "three";
import { EmbodiedGestures } from "./Gestures";
import { clamp, type Action, type Element, type Hand } from "./core";
import type {
  HandLandmarker,
  PoseLandmarker,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";

export class Input {
  action: Action = "flow";
  cameraEnabled = false;
  cameraBusy = false;
  status = "Mouse & touch";
  hands: Hand[] = [];
  private pointers = new Map<number, { x: number; y: number; alt: boolean }>();
  private previous = new Map<string, THREE.Vector3>();
  private tracked: {
    id: string;
    x: number;
    y: number;
    z: number;
    action: Action;
  }[] = [];
  private landmarker?: HandLandmarker;
  private pose?: PoseLandmarker;
  private stream?: MediaStream;
  private lastDetection = 0;
  private lastVideo = -1;
  private generation = 0;
  private posePoints: NormalizedLandmark[] = [];
  private handPoints: NormalizedLandmark[][] = [];
  private gestures = new EmbodiedGestures();
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private preview: CanvasRenderingContext2D;
  onStatus = () => {};

  constructor(
    canvas: HTMLCanvasElement,
    private video: HTMLVideoElement,
    preview: HTMLCanvasElement,
  ) {
    this.preview = preview.getContext("2d")!;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.altKey) return;
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        alt: e.button === 2 || e.shiftKey,
      });
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.pointers.has(e.pointerId))
        this.pointers.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          alt: e.buttons === 2 || e.shiftKey,
        });
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.previous.delete(`pointer${e.pointerId}`);
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("lostpointercapture", end);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("blur", () => {
      this.pointers.clear();
      this.previous.clear();
    });
  }

  async toggleCamera() {
    if (this.cameraEnabled || this.cameraBusy) {
      this.stopCamera();
      return;
    }
    const generation = ++this.generation;
    this.cameraBusy = true;
    this.status = "Opening camera…";
    this.onStatus();
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Camera requires HTTPS or localhost.");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
        audio: false,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      this.status = "Loading hand tracking…";
      this.onStatus();
      const { FilesetResolver, HandLandmarker, PoseLandmarker } =
        await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/tracking/wasm");
      const options = {
        baseOptions: {
          modelAssetPath: "/tracking/hand_landmarker.task",
          delegate: "GPU" as const,
        },
        runningMode: "VIDEO" as const,
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minTrackingConfidence: 0.5,
      };
      let hands: HandLandmarker;
      try {
        hands = await HandLandmarker.createFromOptions(vision, options);
      } catch {
        hands = await HandLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: "CPU" },
        });
      }
      if (generation !== this.generation) {
        hands.close();
        return;
      }
      this.landmarker = hands;
      this.cameraEnabled = true;
      this.cameraBusy = false;
      this.status = "Show your open palms";
      this.onStatus();
      // Body tracking supplements the hands when the user steps back. Its failure never disables hands.
      try {
        const pose = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/tracking/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        if (generation !== this.generation) pose.close();
        else this.pose = pose;
      } catch {
        /* Hand control remains available. */
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.stopCamera();
      const name = error instanceof Error ? error.name : "";
      this.status =
        name === "NotAllowedError"
          ? "Camera permission declined. Mouse control is ready."
          : name === "NotFoundError"
            ? "No camera found. Mouse control is ready."
            : "Tracking could not load. Try camera again; mouse control is ready.";
      this.onStatus();
    }
  }

  stopCamera() {
    this.generation++;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.video.srcObject = null;
    this.landmarker?.close();
    this.pose?.close();
    this.landmarker = undefined;
    this.pose = undefined;
    this.cameraEnabled = false;
    this.cameraBusy = false;
    this.tracked = [];
    this.previous.clear();
    this.lastVideo = -1;
    this.gestures.clear();
    this.status = "Mouse & touch";
    this.onStatus();
  }

  private detect(now: number) {
    if (
      !this.cameraEnabled ||
      !this.landmarker ||
      this.video.readyState < 2 ||
      now - this.lastDetection < 50 ||
      this.video.currentTime === this.lastVideo
    )
      return;
    this.lastDetection = now;
    this.lastVideo = this.video.currentTime;
    try {
      const result = this.landmarker.detectForVideo(this.video, now);
      this.tracked = [];
      this.handPoints = result.landmarks;
      for (let i = 0; i < result.landmarks.length; i++) {
        const p = result.landmarks[i],
          w = p[0];
        const dist = (a: number, b: number) =>
          Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);
        const palm = Math.max(0.025, dist(0, 9));
        const action = this.gestures.classify(
          result.handedness[i][0].categoryName,
          p,
          result.worldLandmarks[i],
          now,
          this.action,
        );
        this.tracked.push({
          id: result.handedness[i][0].categoryName,
          x: 1 - (w.x + p[9].x) * 0.5,
          y: (w.y + p[9].y) * 0.5,
          z: palm,
          action,
        });
      }
      if (this.pose && Math.floor(now / 50) % 3 === 0) {
        this.posePoints =
          this.pose.detectForVideo(this.video, now).landmarks[0] ?? [];
      }
      if (this.tracked.length === 0 && this.posePoints.length) {
        for (const k of [15, 16]) {
          const p = this.posePoints[k];
          if ((p.visibility ?? 0) > 0.65)
            this.tracked.push({
              id: `body${k}`,
              x: 1 - p.x,
              y: p.y,
              z: 0.09,
              action: this.action,
            });
        }
      }
      if (this.tracked.length === 2) {
        const a = this.tracked[0],
          b = this.tracked[1],
          d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 0.22) {
          a.action = "gather";
          b.action = "gather";
        } else if (d > 0.65 && this.action === "flow") {
          a.action = "push";
          b.action = "push";
        }
      }
      this.status = this.tracked.length
        ? `${this.tracked.length === 2 ? "Two hands" : "One hand"} connected`
        : "Show your open palms";
      this.drawPreview();
      this.onStatus();
    } catch {
      this.stopCamera();
      this.status = "Tracking interrupted. Try camera again.";
      this.onStatus();
    }
  }

  private drawPreview() {
    const ctx = this.preview,
      w = ctx.canvas.width,
      h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.globalAlpha = 0.6;
    ctx.drawImage(this.video, 0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#d5efe6";
    ctx.fillStyle = "#f9dcba";
    ctx.lineWidth = 1.2;
    const draw = (p: NormalizedLandmark[], links: number[][]) => {
      for (const [a, b] of links) {
        if (!p[a] || !p[b]) continue;
        ctx.beginPath();
        ctx.moveTo(p[a].x * w, p[a].y * h);
        ctx.lineTo(p[b].x * w, p[b].y * h);
        ctx.stroke();
      }
    };
    draw(this.posePoints, [
      [11, 12],
      [11, 13],
      [13, 15],
      [12, 14],
      [14, 16],
      [11, 23],
      [12, 24],
      [23, 24],
    ]);
    for (const p of this.handPoints) {
      draw(p, [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [0, 5],
        [5, 6],
        [6, 7],
        [7, 8],
        [5, 9],
        [9, 10],
        [10, 11],
        [11, 12],
        [9, 13],
        [13, 14],
        [14, 15],
        [15, 16],
        [13, 17],
        [17, 18],
        [18, 19],
        [19, 20],
        [0, 17],
      ]);
      for (const k of [4, 8, 12, 16, 20]) {
        ctx.beginPath();
        ctx.arc(p[k].x * w, p[k].y * h, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  update(dt: number, camera: THREE.PerspectiveCamera, element: Element) {
    this.detect(performance.now());
    this.hands = [];
    const sources = [...this.pointers.entries()].map(([id, p]) => ({
      id: `pointer${id}`,
      x: p.x / window.innerWidth,
      y: p.y / window.innerHeight,
      z: 0.1,
      action: p.alt ? ("push" as Action) : this.action,
    }));
    if (!sources.length) sources.push(...this.tracked);
    this.plane.set(
      new THREE.Vector3(
        0,
        element === "earth" ? 1 : 0,
        element === "earth" ? 0 : 1,
      ),
      0,
    );
    const live = new Set<string>();
    for (const source of sources.slice(0, 2)) {
      live.add(source.id);
      const screen = new THREE.Vector2(source.x * 2 - 1, 1 - source.y * 2);
      this.raycaster.setFromCamera(screen, camera);
      const position = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.plane, position)) continue;
      if (element === "earth") {
        position.x = clamp(position.x, -9, 9);
        position.z = clamp(position.z, -9, 9);
      } else {
        position.x = clamp(position.x, -6, 6);
        position.y = clamp(position.y, 0.2, 7);
        position.z = clamp((source.z - 0.1) * 12, -1.2, 1.2);
      }
      const prev = this.previous.get(source.id) ?? position.clone();
      const smoothed = prev.clone().lerp(position, 1 - Math.exp(-dt * 22));
      const velocity = smoothed
        .clone()
        .sub(prev)
        .divideScalar(Math.max(dt, 0.001))
        .clampLength(0, 14);
      this.previous.set(source.id, smoothed.clone());
      this.hands.push({
        position: smoothed,
        velocity,
        screen,
        strength: 1,
        action: source.action,
      });
    }
    for (const key of this.previous.keys())
      if (!live.has(key)) this.previous.delete(key);
    return this.hands;
  }
  dispose() {
    this.stopCamera();
  }
}
