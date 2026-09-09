import * as THREE from "three";
import { Atmosphere } from "./Atmosphere";
import { FireField } from "./FireField";
import { Water } from "./Water";
import { Earth } from "./Earth";
import { Input } from "./Input";
import { Sound } from "./Sound";
import { type Element, type Action, type Frame, clamp } from "./core";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const elements: Element[] = ["air", "water", "earth", "fire"];
const descriptions: Record<
  Element,
  { location: string; poem: string; caption: string; hint: string }
> = {
  air: {
    location: "The upper atmosphere",
    poem: "Give the sky<br>a little of your movement.",
    caption: "A living sky. Nothing is prerecorded.",
    hint: "Hold & drag to move the clouds",
  },
  water: {
    location: "The tidal sanctuary",
    poem: "Find the current.<br>Become its direction.",
    caption: "A body of water. A thousand small agreements.",
    hint: "Hold & drag to draw water upward",
  },
  earth: {
    location: "The living watershed",
    poem: "Raise a mountain.<br>Change everything downstream.",
    caption: "The land remembers every movement.",
    hint: "Drag to raise land. Shift-drag to carve",
  },
  fire: {
    location: "The heart of the ember",
    poem: "A little movement.<br>An untamed answer.",
    caption: "Heat rises. Your hands change its path.",
    hint: "Hold & drag to bend the flame",
  },
};
const practiceSteps: Record<
  Element,
  { action: Action; title: string; description: string }[]
> = {
  air: [
    {
      action: "gather",
      title: "Gather a cloud",
      description: "Choose Gather. Hold within a cloud and draw it toward you.",
    },
    {
      action: "swirl",
      title: "Give it a new orbit",
      description:
        "Choose Swirl. Hold near the center and watch the cloud turn.",
    },
    {
      action: "push",
      title: "Open the sky",
      description:
        "Choose Push and hold to disperse the cloud. Release and let it drift.",
    },
  ],
  water: [
    {
      action: "lift",
      title: "Lift the tide",
      description: "Choose Lift. Hold just above the water to raise it.",
    },
    {
      action: "gather",
      title: "Hold a body of water",
      description:
        "Choose Gather. Draw the liquid slowly into a suspended mass.",
    },
    {
      action: "swirl",
      title: "Turn the current",
      description: "Choose Swirl. Hold beside the water and feel its momentum.",
    },
  ],
  earth: [
    {
      action: "lift",
      title: "Make a mountain",
      description: "Choose Lift. Hold on the island and watch a summit form.",
    },
    {
      action: "push",
      title: "Carve a valley",
      description: "Choose Push. Drag a channel across the land.",
    },
    {
      action: "swirl",
      title: "Leave a crater",
      description: "Choose Swirl. Hold on land to shape a circular ridge.",
    },
  ],
  fire: [
    {
      action: "lift",
      title: "Feed the flame",
      description: "Choose Lift. Hold near the base to send heat upward.",
    },
    {
      action: "swirl",
      title: "Twist the heat",
      description: "Choose Swirl. Hold beside the rising flame.",
    },
    {
      action: "calm",
      title: "Quiet the ember",
      description: "Choose Settle. Hold over the flame and let it diminish.",
    },
  ],
};

export class Experience {
  renderer: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera(
    47,
    window.innerWidth / window.innerHeight,
    0.1,
    250,
  );
  scene = new THREE.Scene();
  atmosphere = new Atmosphere();
  fire: FireField;
  water: Water;
  earth: Earth;
  input: Input;
  sound = new Sound();
  element: Element = "air";
  paused = false;
  private last = 0;
  private nextRenderTime = 0;
  private time = 0;
  private accumulator = 0;
  private power = 1;
  private radius = 1.8;
  private frameCount = 0;
  private frameTime = 0;
  private lastMeasure = 0;
  private pixelRatio = 1;
  private quality = "auto";
  private raf = 0;
  private toastTimer = 0;
  private interactionTimer = 0;
  private practiceIndex = 0;
  private practiceTime = 0;
  private cursorEls = Array.from(
    document.querySelectorAll<HTMLElement>(".hand-cursor"),
  );
  private disposed = false;
  private terrainRay = new THREE.Raycaster();
  private sparks: THREE.Points;
  private waterBackground = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
  });
  private startedAt = performance.now();
  private orbitStart: {
    x: number;
    y: number;
    azimuth: number;
    elevation: number;
    distance: number;
  } | null = null;

  constructor() {
    const canvas = $<HTMLCanvasElement>("canvas");
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x000000);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.pixelRatio = Math.min(window.devicePixelRatio, 1.25);
    this.resize();
    this.fire = new FireField(this.renderer);
    this.water = new Water();
    this.earth = new Earth();
    this.scene.add(this.water.group, this.earth.group);
    this.water.group.visible = false;
    this.earth.group.visible = false;
    this.input = new Input(
      canvas,
      $<HTMLVideoElement>("video"),
      $<HTMLCanvasElement>("tracking-preview"),
    );
    this.input.onStatus = () => this.updateCameraUI();
    this.sparks = this.createSparks();
    this.scene.add(this.sparks);
    this.sparks.visible = false;
    this.bind();
    const requested = location.hash.replace("#", "") as Element;
    this.select(elements.includes(requested) ? requested : "air");
    this.renderer.compile(this.atmosphere.scene, this.atmosphere.camera);
    this.last = performance.now();
    this.animate(this.last);
    $("loading").classList.add("done");
    // A read-only diagnostic surface supports verification without bypassing the actual input path.
    Object.defineProperty(window, "elementBender", {
      configurable: true,
      value: {
        snapshot: () => ({
          element: this.element,
          paused: this.paused,
          time: this.time,
          waterMeanHeight:
            this.water.liquid.positions.reduce(
              (s, v, i) => s + (i % 3 === 1 ? v : 0),
              0,
            ) / this.water.liquid.count,
          terrainChecksum: this.earth.terrain.heights.reduce(
            (s, v) => s + v,
            0,
          ),
          hands: this.input.hands.length,
          action: this.input.action,
          quality: this.quality,
          pixelRatio: this.pixelRatio,
          terrainRevision: this.earth.revision,
          terrainRange: [
            Math.min(...this.earth.terrain.heights),
            Math.max(...this.earth.terrain.heights),
          ],
          waterParticles: this.water.liquid.count,
          camera: this.input.cameraEnabled,
          renderCalls: this.renderer.info.render.calls,
        }),
      },
    });
  }
  private createSparks() {
    const count = 900,
      positions = new Float32Array(count * 3),
      seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      seeds[i * 3] = Math.random();
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("seed", new THREE.BufferAttribute(seeds, 3));
    const m = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `attribute vec3 seed;uniform float time;varying float vLife;void main(){float age=fract(seed.x+time*(.08+seed.y*.13));float a=seed.z*6.283+age*4.;vec3 p=vec3(sin(a)*(.15+age*1.2),.2+age*(3.+seed.y*4.),cos(a)*.35);p.x+=sin(age*8.+seed.y*19.)*age*.5;vec4 mv=modelViewMatrix*vec4(p,1);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((1.-age)*22./-mv.z,1.,4.);vLife=pow(1.-age,1.5);}`,
      fragmentShader: `varying float vLife;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(1.,.29+vLife*.4,.08,vLife*smoothstep(.5,.1,d)*.75);}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(g, m);
    points.frustumCulled = false;
    return points;
  }
  private bind() {
    document
      .querySelectorAll<HTMLButtonElement>("button[data-element]")
      .forEach((b) =>
        b.addEventListener("click", () =>
          this.select(b.dataset.element as Element),
        ),
      );
    document
      .querySelectorAll<HTMLButtonElement>("[data-action]")
      .forEach((b) =>
        b.addEventListener("click", () =>
          this.setAction(b.dataset.action as Action),
        ),
      );
    $("camera-button").addEventListener(
      "click",
      () => void this.input.toggleCamera(),
    );
    $("stop-camera").addEventListener("click", () => this.input.stopCamera());
    $("pause-button").addEventListener("click", () => this.togglePause());
    $("reset-button").addEventListener("click", () => this.reset());
    $("sound-button").addEventListener("click", async () => {
      try {
        const on = await this.sound.toggle();
        $("sound-button").setAttribute("aria-pressed", String(on));
        $("sound-button").setAttribute(
          "aria-label",
          on ? "Mute ambient sound" : "Enable ambient sound",
        );
        this.toast(
          on ? "Sound is on. Move slowly and listen." : "Sound is off.",
        );
      } catch {
        this.toast("Sound is unavailable in this browser.");
      }
    });
    $("settings-button").addEventListener("click", () => {
      const hidden = !$("settings").hidden;
      $("settings").hidden = hidden;
      $("settings-button").setAttribute("aria-expanded", String(!hidden));
    });
    $("help-button").addEventListener("click", () => this.openHelp());
    for (const id of ["close-help", "begin-button"])
      $(id).addEventListener("click", () =>
        $<HTMLDialogElement>("help-dialog").close(),
      );
    $("practice-button").addEventListener("click", () => {
      $("practice").hidden = !$("practice").hidden;
      this.practiceIndex = 0;
      this.practiceTime = 0;
      this.updatePracticeUI();
    });
    $("close-practice").addEventListener(
      "click",
      () => ($("practice").hidden = true),
    );
    $("capture-button").addEventListener("click", () => this.capture());
    $("fullscreen-button").addEventListener(
      "click",
      () => void this.fullscreen(),
    );
    $<HTMLInputElement>("power").addEventListener("input", (e) => {
      this.power = Number((e.target as HTMLInputElement).value);
      $("power-value").textContent = `${this.power.toFixed(1)}×`;
    });
    $<HTMLInputElement>("radius").addEventListener("input", (e) => {
      this.radius = Number((e.target as HTMLInputElement).value);
      $("radius-value").textContent = this.radius.toFixed(1);
    });
    $<HTMLSelectElement>("quality").addEventListener("change", (e) => {
      this.quality = (e.target as HTMLSelectElement).value;
      this.pixelRatio =
        this.quality === "high"
          ? Math.min(devicePixelRatio, 1.75)
          : this.quality === "low"
            ? 0.65
            : Math.min(devicePixelRatio, 1.25);
      this.resize();
    });
    window.addEventListener("resize", this.resize);
    window.addEventListener("hashchange", () => {
      const e = location.hash.slice(1) as Element;
      if (elements.includes(e) && e !== this.element) this.select(e);
    });
    window.addEventListener("keydown", this.onKey);
    document.addEventListener("visibilitychange", () => {
      this.last = performance.now();
      this.accumulator = 0;
      if (document.hidden) this.sound.quiet();
    });
    $("canvas").addEventListener(
      "wheel",
      (e) => {
        if (this.element !== "earth") return;
        e.preventDefault();
        const target = new THREE.Vector3(0, 0.7, 0),
          offset = this.camera.position.clone().sub(target);
        offset.setLength(
          clamp(
            offset.length() * Math.exp((e as WheelEvent).deltaY * 0.001),
            12,
            40,
          ),
        );
        this.camera.position.copy(target).add(offset);
        this.camera.lookAt(target);
        this.camera.updateMatrixWorld();
      },
      { passive: false },
    );
    $("canvas").addEventListener("pointerdown", (e) => {
      if (this.element !== "earth" || !e.altKey) return;
      const v = this.camera.position.clone().sub(new THREE.Vector3(0, 0.7, 0));
      this.orbitStart = {
        x: e.clientX,
        y: e.clientY,
        azimuth: Math.atan2(v.x, v.z),
        elevation: Math.asin(v.y / v.length()),
        distance: v.length(),
      };
      $("canvas").setPointerCapture(e.pointerId);
    });
    $("canvas").addEventListener("pointermove", (e) => {
      if (!this.orbitStart) return;
      const s = this.orbitStart,
        a = s.azimuth - (e.clientX - s.x) * 0.006,
        b = clamp(s.elevation + (e.clientY - s.y) * 0.005, 0.25, 1.35);
      this.camera.position.set(
        Math.sin(a) * Math.cos(b) * s.distance,
        0.7 + Math.sin(b) * s.distance,
        Math.cos(a) * Math.cos(b) * s.distance,
      );
      this.camera.lookAt(0, 0.7, 0);
      this.camera.updateMatrixWorld();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      $("canvas").addEventListener(type, () => (this.orbitStart = null));
    $("canvas").addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.raf);
      this.toast(
        "The graphics device paused. Reload this page to restore the world.",
        20000,
      );
    });
    window.addEventListener("pagehide", (e) => {
      if (e.persisted) {
        this.input.stopCamera();
        this.sound.quiet();
      } else this.dispose();
    });
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) {
        this.last = performance.now();
        this.accumulator = 0;
      }
    });
  }
  private onKey = (e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    )
      return;
    if (e.key === "Escape") {
      $("settings").hidden = true;
      $("settings-button").setAttribute("aria-expanded", "false");
      $("practice").hidden = true;
      return;
    }
    if ($<HTMLDialogElement>("help-dialog").open) return;
    if (e.code === "Space" && e.target instanceof HTMLButtonElement) return;
    if (e.key >= "1" && e.key <= "4") this.select(elements[Number(e.key) - 1]);
    const key = e.key.toLowerCase();
    const map: Record<string, Action> = {
      q: "flow",
      g: "gather",
      p: "push",
      s: "swirl",
      l: "lift",
      c: "calm",
    };
    if (map[key]) this.setAction(map[key]);
    if (e.code === "Space") {
      e.preventDefault();
      this.togglePause();
    }
    if (key === "r") this.reset();
    if (key === "f") void this.fullscreen();
    if (key === "?") this.openHelp();
    if (key === "h") {
      document.body.classList.toggle("immersed");
      this.toast(
        document.body.classList.contains("immersed")
          ? "Press H to bring the controls back."
          : "",
      );
    }
  };
  private setAction(action: Action) {
    this.input.action = action;
    document
      .querySelectorAll<HTMLButtonElement>("[data-action]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.action === action)),
      );
  }
  select(element: Element) {
    this.element = element;
    history.replaceState(null, "", `#${element}`);
    document.body.dataset.world = element;
    this.water.group.visible = element === "water";
    this.earth.group.visible = element === "earth";
    this.sparks.visible = element === "fire";
    if (element === "earth") {
      this.camera.position.set(12.4, 12.2, 15.6);
      this.camera.lookAt(0, 0.7, 0);
      this.camera.fov = 43;
    } else {
      this.camera.position.set(
        0,
        element === "water" ? 4.4 : 3.45,
        element === "water" ? 11.5 : 12,
      );
      this.camera.lookAt(
        0,
        element === "water" ? 1.15 : element === "fire" ? 2.5 : 3.1,
        0,
      );
      this.camera.fov = 47;
    }
    if (innerWidth < 650) {
      this.camera.fov = element === "earth" ? 59 : 64;
      if (element !== "earth") this.camera.position.z = 14;
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.setAction("flow");
    this.practiceIndex = 0;
    this.practiceTime = 0;
    this.updatePracticeUI();
    const d = descriptions[element];
    $("element-location").textContent = d.location;
    $("element-title").textContent =
      element[0].toUpperCase() + element.slice(1);
    $("element-poem").innerHTML = d.poem;
    $("world-caption").textContent = d.caption;
    $("interaction-hint").innerHTML =
      `<span class="mouse-icon" aria-hidden="true"></span>${d.hint}<span class="hint-separator">/</span><span>Choose a gesture to change the force</span>`;
    document
      .querySelectorAll<HTMLButtonElement>("button[data-element]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.element === element)),
      );
    // Populate the combustion field before the first visible fire frame.
    if (element === "fire" && this.time < 0.1) this.time = 1;
  }
  private updateCameraUI() {
    const busy = this.input.cameraBusy,
      on = this.input.cameraEnabled;
    $("camera-button").classList.toggle("active", on);
    $("camera-button").querySelector("span")!.textContent = busy
      ? "Cancel loading"
      : on
        ? "Camera connected"
        : "Use your hands";
    $("camera-preview").hidden = !on;
    $("tracking-status").textContent = this.input.status;
    $("input-mode").textContent = on ? "Camera control" : "Mouse & touch";
    if (!on && !busy && this.input.status !== "Mouse & touch")
      this.toast(this.input.status, 6500);
  }
  private togglePause() {
    this.paused = !this.paused;
    $("pause-button").setAttribute("aria-pressed", String(this.paused));
    $("pause-button").setAttribute(
      "aria-label",
      this.paused ? "Resume simulation" : "Pause simulation",
    );
    $("pause-status").textContent = this.paused ? "Time is still" : "";
    if (this.paused) this.sound.quiet();
    this.toast(
      this.paused
        ? "Paused. Take in the moment."
        : "The world is moving again.",
    );
  }
  private reset() {
    if (this.element === "air") this.atmosphere.reset();
    if (this.element === "water") this.water.reset();
    if (this.element === "earth") this.earth.reset();
    if (this.element === "fire") this.fire.reset();
    this.toast("Restored. Begin again.");
  }
  private openHelp() {
    $<HTMLDialogElement>("help-dialog").showModal();
  }
  private async fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      this.toast("Fullscreen is unavailable. You can still bend here.");
    }
  }
  private capture() {
    this.render();
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) {
        this.toast("The picture could not be saved. Please try again.");
        return;
      }
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `element-bender-${this.element}-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      this.toast("A moment, saved.");
    }, "image/png");
  }
  private updatePracticeUI() {
    const step = practiceSteps[this.element][this.practiceIndex];
    $("practice-title").textContent = step?.title ?? "You have the feeling.";
    $("practice-description").textContent =
      step?.description ??
      "Keep exploring. There is no correct shape for a force of nature.";
    $("practice-count").textContent = step
      ? `${this.practiceIndex + 1} of 3`
      : "Practice complete";
    document.querySelector<HTMLElement>(".practice-progress i")!.style.width =
      step ? "0%" : "100%";
  }
  private toast(message: string, duration = 2800) {
    clearTimeout(this.toastTimer);
    $("toast").textContent = message;
    $("toast").classList.add("visible");
    this.toastTimer = window.setTimeout(
      () => $("toast").classList.remove("visible"),
      duration,
    );
  }
  private resize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.fov =
      innerWidth < 650
        ? this.element === "earth"
          ? 59
          : 64
        : this.element === "earth"
          ? 43
          : 47;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.waterBackground.setSize(
      Math.floor(innerWidth * this.pixelRatio),
      Math.floor(innerHeight * this.pixelRatio),
    );
  };
  private animate = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    if (now < this.nextRenderTime) return;
    this.nextRenderTime = Math.max(this.nextRenderTime + 1000 / 60, now + 1);
    const rawElapsed = (now - this.last) / 1000;
    const elapsed = Math.min(rawElapsed, 0.1);
    this.last = now;
    if (document.hidden) return;
    const dt = Math.min(elapsed, 1 / 30);
    const hands = this.input.update(dt, this.camera, this.element);
    if ($<HTMLDialogElement>("help-dialog").open) hands.length = 0;
    if (this.element === "earth")
      for (const h of hands) {
        this.terrainRay.setFromCamera(h.screen, this.camera);
        const hit = this.terrainRay.intersectObject(this.earth.mesh, false)[0];
        if (hit) h.position.copy(hit.point);
      }
    for (let i = 0; i < 2; i++) {
      const el = this.cursorEls[i],
        h = hands[i];
      el.style.display = h ? "block" : "none";
      if (h) {
        el.style.left = `${(h.screen.x * 0.5 + 0.5) * innerWidth}px`;
        el.style.top = `${(0.5 - h.screen.y * 0.5) * innerHeight}px`;
        el.querySelector("span")!.textContent =
          h.action === "calm"
            ? "Settle"
            : h.action[0].toUpperCase() + h.action.slice(1);
      }
    }
    if (hands.length) this.interactionTimer = 1.8;
    else this.interactionTimer = Math.max(0, this.interactionTimer - dt);
    document.body.classList.toggle("interacting", this.interactionTimer > 0);
    if (!this.paused) {
      this.accumulator += Math.min(elapsed, 0.05);
      const fixed = 1 / 60;
      let steps = 0;
      while (this.accumulator >= fixed && steps < 3) {
        this.time += fixed;
        const frame: Frame = {
          dt: fixed,
          time: this.time,
          hands,
          power: this.power,
          radius: this.radius,
        };
        if (this.element === "fire") this.fire.update(frame);
        if (this.element === "water") this.water.update(frame);
        if (this.element === "earth") this.earth.update(frame);
        this.atmosphere.update(
          frame,
          this.camera,
          this.element,
          this.fire.texture,
        );
        this.sound.update(this.element, frame);
        this.accumulator -= fixed;
        steps++;
      }
      if (!$("practice").hidden && this.practiceIndex < 3) {
        const step = practiceSteps[this.element][this.practiceIndex];
        if (hands.some((h) => h.action === step.action)) {
          this.practiceTime += dt;
          document.querySelector<HTMLElement>(
            ".practice-progress i",
          )!.style.width = `${Math.min(100, (this.practiceTime / 3) * 100)}%`;
          if (this.practiceTime >= 3) {
            this.practiceIndex++;
            this.practiceTime = 0;
            this.updatePracticeUI();
          }
        }
      }
    }
    this.atmosphere.update(
      { dt: 0, time: this.time, hands: [], power: 0, radius: this.radius },
      this.camera,
      this.element,
      this.fire.texture,
    );
    (this.sparks.material as THREE.ShaderMaterial).uniforms.time.value =
      this.time;
    this.render();
    this.frameCount++;
    this.frameTime += rawElapsed;
    if (now - this.lastMeasure > 2000) {
      const fps = this.frameCount / Math.max(0.01, this.frameTime);
      $("performance").textContent =
        `${Math.round(fps)} fps · ${Math.round(innerWidth * this.pixelRatio)} × ${Math.round(innerHeight * this.pixelRatio)} · WebGL 2`;
      if (this.quality === "auto" && now - this.startedAt > 4000) {
        const prev = this.pixelRatio;
        if (fps < 29)
          this.pixelRatio = clamp(this.pixelRatio * 0.84, 0.55, 1.25);
        else if (fps > 53)
          this.pixelRatio = clamp(
            this.pixelRatio * 1.06,
            0.55,
            Math.min(devicePixelRatio, 1.25),
          );
        if (Math.abs(prev - this.pixelRatio) > 0.01) this.resize();
      }
      this.frameCount = 0;
      this.frameTime = 0;
      this.lastMeasure = now;
    }
  };
  private render() {
    if (this.element === "air")
      this.atmosphere.prepare(this.renderer, this.time);
    if (this.element === "water") {
      this.water.prepareSurface(this.time);
      this.water.setSurfaceVisible(false);
      this.renderer.setRenderTarget(this.waterBackground);
      this.renderer.clear();
      this.renderer.render(this.atmosphere.scene, this.atmosphere.camera);
      this.renderer.clearDepth();
      this.renderer.render(this.scene, this.camera);
      this.water.setSurfaceVisible(true);
      this.water.setBackground(
        this.waterBackground.texture,
        this.waterBackground.width,
        this.waterBackground.height,
      );
    }
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.atmosphere.scene, this.atmosphere.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.toastTimer);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKey);
    this.input.dispose();
    this.sound.dispose();
    this.atmosphere.dispose();
    this.fire.dispose();
    this.water.dispose();
    this.waterBackground.dispose();
    this.earth.dispose();
    this.sparks.geometry.dispose();
    (this.sparks.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
