# Verification — September 9, 2026

- Strict TypeScript compilation: passed.
- Production build: passed. Vite reports one size advisory for the 506 kB Three.js chunk (128 kB gzip); the application chunk is approximately 82 kB (27 kB gzip).
- Unit/regression suite: **42 tests across 10 files passed**.
- Isolated Chromium user flows: **6 passed** — camera-free element entry; liquid gather and release; watershed deformation, rerouting, switching, and reset; camera denial and recovery with real MediaPipe inference on synthetic video; keyboard/pause/help/PNG export; narrow touch layout.
- Production shader and console check: **no errors** across all four modes.
- Warmed production measurements at 1440 × 900 on the test machine: air, earth, and water approximately **60 fps**; fire approximately **36–42 fps**. These are local measurements, not a hardware-independent guarantee. Rendering is capped at 60 fps to leave headroom for tracking.

Final scene captures are in `docs/previews/`. The automated camera test uses a canvas video stream and confirms local model loading and camera-track teardown. It does not validate recognition accuracy on a real person, palm orientation under every camera arrangement, or responsiveness under varied room lighting.

The browser suite runs independently on port 5188. The production preview for this session is on port 5190; the development server is on 5173.
