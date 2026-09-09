# Element Bender

A live, procedural playground for air, water, earth, and fire. Start in a sunset sky, use a mouse or touchscreen immediately, or enable local hand and body tracking. No account or backend is required.

## Run

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Camera access requires localhost or HTTPS. The production build is a static site:

```sh
npm run build
npm run preview
```

## Bend

- **Drag** to move the selected element. Choose **Gather**, **Push**, **Swirl**, **Lift**, or **Settle** to direct the force. Right-drag or Shift-drag pushes.
- **Camera:** an open hand moves material; a pinch or fist gathers. Circular motion swirls, forward/back motion pushes/pulls, and palm orientation lifts/settles. Close two hands to condense and spread them apart to disperse. The gesture buttons override motion inference, except that a pinch always gathers. Body wrists provide a fallback when hands are too small to resolve.
- **Earth:** Flow or Lift raises land, Push cuts valleys, and Swirl makes a crater rim. Alt-drag orbits the island; scroll zooms. Terrain persists when switching elements, until Restore or a page reload.
- **Two touches** supply independent force sources.
- **1–4** switches elements; **Q/G/P/S/L/C** selects gestures; **Space** pauses; **R** restores the current element; **F** enters fullscreen; **H** hides the interface; **?** opens the guide.
- The right-hand controls offer guided practice, synthesized ambient sound, pause, restore, PNG capture, quality/force settings, and fullscreen.

## What's running

| Material | Simulation                                                                                                                                                       | Rendering                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Air      | 24 inertial cloud volumes; hand-driven translation, compression, rotation, and dispersion                                                                        | Ray-marched, GPU-cached 128³ density; tileable cellular noise at three scales; Beer–Lambert extinction, directional self-shadowing, and sunset atmosphere |
| Water    | 760 particles; spatial neighbor hashing, double-density pressure relaxation, gravity, bounded collisions, and gesture forces; a separate propagating heightfield | A continuous marching-cubes surface, smoothed independently of physics; scene refraction, Fresnel reflection, absorption, and an animated water surface   |
| Earth    | Persistent 241 × 241 heightfield; live sculpting; priority-flood basin filling and downstream flow accumulation                                                  | Procedural soil/grass/rock/snow, heightfield shadows, stream ribbons, shoreline foam, and 11,000 candidate trees selected by terrain and flooding         |
| Fire     | 192 × 288 GPU velocity/temperature/smoke field; semi-Lagrangian advection, buoyancy, vorticity confinement, and 12 pressure iterations                           | Volumetric heat emission and smoke extinction, procedural depth variation, and drifting embers                                                            |

These are interactive approximations. Fire transports a **2D field rendered volumetrically**, not a full 3D combustion solver. Cloud motion uses **inertial cloud volumes**, not a full atmospheric CFD grid. Water is **low-resolution particle fluid**, with approximate optical thickness and screen-space refraction. Rivers use **drainage routing**, not a hydraulic erosion or ecological growth model. Those choices keep the browser experience responsive while making the different materials respond coherently.

The active implementation is in `src/experience/`; `src/main.ts` starts it. Earlier rendering, gesture, and element implementations remain in their original directories for comparison and their existing tests remain intact. The original PRD and architecture are in `.claude/`.

## Camera and privacy

MediaPipe runs on-device. Camera frames are not uploaded, stored, or included in picture exports. The hand and pose models and matching WASM runtime are served from `public/tracking/`, so enabling the camera does not contact a model CDN. Camera denial and model failures leave mouse/touch control available. Turning the camera off releases its tracks and inference resources.

The bundled models come from Google's [MediaPipe hand landmark model](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) and [pose landmark model](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker). WASM and JS files are copied from the installed `@mediapipe/tasks-vision` package. If that package is upgraded, copy its `wasm/*.js` and `wasm/*.wasm` into `public/tracking/wasm/` together so the runtimes stay matched.

## Verification

```sh
npm test                 # Physics, gestures, and existing regression tests
npm run test:browser     # Isolated Chromium interaction and camera lifecycle tests
npm run build            # Strict TypeScript + production bundle
```

Install the browser once if necessary: `npx playwright install chromium`. The browser tests start a separate server on port 5188 and use synthetic camera frames; they never open a real webcam. Metal is used on macOS for hardware rendering; other platforms use their default ANGLE backend.

The suite exercises all four worlds without camera permission, liquid lifting/release, watershed editing and persistence, camera denial/retry/start/stop, keyboard controls, image download, and a narrow touch layout. Real-person tracking accuracy, room lighting, and the subjective feeling of gestures still need testing with a physical camera. Frame rate depends on the GPU and display resolution; Adaptive detail adjusts render resolution without changing the physics timestep.
