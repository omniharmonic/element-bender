# Element Bender
## Technical Architecture Document

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Browser Window                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────────────────────────────────────────┐  │
│  │   Element UI    │  │              WebGPU/Three.js Viewport            │  │
│  │                 │  │                                                  │  │
│  │  🔥 Fire        │  │  ┌──────────────────────────────────────────┐   │  │
│  │  💧 Water       │  │  │         Active Element Renderer          │   │  │
│  │  💨 Air         │  │  │                                          │   │  │
│  │  🌍 Earth       │  │  │   Particles / Fluid / Terrain Mesh       │   │  │
│  │                 │  │  │                                          │   │  │
│  │  [Settings]     │  │  │         + Hand Influence Overlay         │   │  │
│  └─────────────────┘  │  └──────────────────────────────────────────┘   │  │
│                       │                                                  │  │
│                       │  ┌──────────────────────────────────────────┐   │  │
│                       │  │      Post-Processing (Bloom, etc.)       │   │  │
│                       │  └──────────────────────────────────────────┘   │  │
│                       └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
              ▼                         ▼                         ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│   Tracking System    │  │   Gesture Engine     │  │  Element Simulator   │
│                      │  │                      │  │                      │
│  MediaPipe Hands     │  │  Raw Landmarks       │  │  Fire / Water /      │
│  Webcam Feed         │──│  → Gesture State     │──│  Air / Earth         │
│  Hand Landmarks      │  │  → Influence Vectors │  │  Simulation Engines  │
│                      │  │                      │  │                      │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
                                        │
                                        ▼
                          ┌──────────────────────┐
                          │   WebGPU Compute     │
                          │                      │
                          │  Particle Updates    │
                          │  Fluid Simulation    │
                          │  Terrain Deformation │
                          └──────────────────────┘
```

---

## Technology Stack

### Core Technologies

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Runtime** | Browser (Chrome/Edge 113+) | Wide reach, WebGPU support |
| **Build** | Vite | Fast HMR, native ES modules |
| **3D Engine** | Three.js r160+ | Mature, WebGPU renderer available |
| **GPU Compute** | WebGPU | Compute shaders for physics |
| **Fallback** | WebGL 2.0 | Broader compatibility |
| **Hand Tracking** | MediaPipe Tasks Vision | Best-in-class hand detection |
| **Language** | TypeScript | Type safety for complex systems |

### Dependencies

```json
{
  "dependencies": {
    "three": "^0.160.0",
    "@mediapipe/tasks-vision": "^0.10.14"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.3.0",
    "vite-plugin-glsl": "^1.2.1"
  }
}
```

---

## Project Structure

```
element-bender/
├── src/
│   ├── main.ts                      # Entry point
│   ├── app/
│   │   ├── ElementBender.ts         # Main application class
│   │   ├── ElementManager.ts        # Element state machine
│   │   └── SceneManager.ts          # Three.js scene setup
│   │
│   ├── tracking/
│   │   ├── HandTracker.ts           # MediaPipe integration
│   │   ├── GestureRecognizer.ts     # Landmark → Gesture interpretation
│   │   └── types.ts                 # Tracking type definitions
│   │
│   ├── gestures/
│   │   ├── GestureState.ts          # Current gesture state container
│   │   ├── GestureDetectors.ts      # Individual gesture detection
│   │   └── InfluenceField.ts        # Convert gestures to influence vectors
│   │
│   ├── elements/
│   │   ├── BaseElement.ts           # Abstract element interface
│   │   ├── fire/
│   │   │   ├── FireElement.ts       # Fire simulation controller
│   │   │   ├── FireParticles.ts     # GPU particle system
│   │   │   ├── fire.compute.wgsl    # WebGPU compute shader
│   │   │   └── fire.render.wgsl     # Render shaders
│   │   ├── water/
│   │   │   ├── WaterElement.ts
│   │   │   ├── WaterSurface.ts      # Heightfield simulation
│   │   │   ├── water.compute.wgsl
│   │   │   └── water.render.wgsl
│   │   ├── air/
│   │   │   ├── AirElement.ts
│   │   │   ├── CloudParticles.ts
│   │   │   ├── VectorField.ts       # Wind field
│   │   │   ├── air.compute.wgsl
│   │   │   └── air.render.wgsl
│   │   └── earth/
│   │       ├── EarthElement.ts
│   │       ├── TerrainMesh.ts       # Deformable heightmap
│   │       ├── earth.compute.wgsl
│   │       └── earth.render.wgsl
│   │
│   ├── rendering/
│   │   ├── WebGPURenderer.ts        # WebGPU setup and management
│   │   ├── PostProcessing.ts        # Bloom, color grading
│   │   └── shaders/
│   │       ├── common.wgsl          # Shared shader utilities
│   │       ├── noise.wgsl           # Noise functions
│   │       └── post.wgsl            # Post-processing shaders
│   │
│   ├── ui/
│   │   ├── ElementSelector.ts       # Element selection UI
│   │   ├── HandOverlay.ts           # Hand visualization in scene
│   │   └── SettingsPanel.ts         # Configuration UI
│   │
│   ├── config/
│   │   ├── defaults.ts              # Default parameters
│   │   └── elements.ts              # Per-element configuration
│   │
│   └── utils/
│       ├── math.ts                  # Vector math utilities
│       ├── gpu.ts                   # WebGPU helpers
│       └── performance.ts           # FPS monitoring, budgeting
│
├── public/
│   ├── index.html
│   └── assets/
│       ├── icons/                   # Element symbols
│       └── fonts/
│
├── types/
│   └── wgsl.d.ts                    # WGSL shader type declarations
│
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## Core Systems

### 1. Hand Tracking System

Reuses the proven approach from murmurations with optimizations:

```typescript
interface HandData {
  landmarks: NormalizedLandmark[];  // 21 hand landmarks
  worldLandmarks: Landmark[];       // 3D world coordinates
  handedness: 'Left' | 'Right';
  confidence: number;
}

interface TrackingState {
  hands: HandData[];                // 0-2 hands
  timestamp: number;
  frameRate: number;
}

class HandTracker {
  private handLandmarker: HandLandmarker;
  private video: HTMLVideoElement;
  
  // Runs at 15-30 FPS (decoupled from render loop)
  async processFrame(): Promise<TrackingState>;
  
  // Smoothing to reduce jitter
  private smoothLandmarks(raw: Landmark[], history: Landmark[][]): Landmark[];
}
```

### 2. Gesture Recognition System

Converts raw hand landmarks into semantic gestures:

```typescript
interface GestureState {
  // Per-hand state
  hands: {
    position: Vector3;           // Palm center in simulation space
    velocity: Vector3;           // Movement velocity
    palmNormal: Vector3;         // Palm facing direction
    palmOrientation: 'up' | 'down' | 'forward' | 'side';
    grabStrength: number;        // 0-1, how closed the hand is
    spreadStrength: number;      // 0-1, how spread the fingers are
  }[];
  
  // Two-hand gestures
  twoHand: {
    active: boolean;
    separation: number;          // Distance between hands
    separationVelocity: number;  // Spreading or gathering
    midpoint: Vector3;           // Center between hands
    rotationAxis: Vector3;       // For swirl detection
    rotationSpeed: number;
  };
  
  // Detected gestures (can be multiple active)
  activeGestures: Set<GestureType>;
}

enum GestureType {
  PUSH = 'push',
  PULL = 'pull',
  SWIRL_CW = 'swirl_cw',
  SWIRL_CCW = 'swirl_ccw',
  SPREAD = 'spread',
  GATHER = 'gather',
  PALM_UP = 'palm_up',
  PALM_DOWN = 'palm_down',
  IDLE = 'idle'
}
```

#### Gesture Detection Logic

```typescript
class GestureDetectors {
  // Push: Palm forward + hand moving away
  static detectPush(hand: HandState, history: HandState[]): number {
    const palmForward = hand.palmNormal.z < -0.5;  // Facing into screen
    const movingAway = hand.velocity.z < -VELOCITY_THRESHOLD;
    return palmForward && movingAway ? 
      Math.abs(hand.velocity.z) / MAX_VELOCITY : 0;
  }
  
  // Swirl: Circular motion detection
  static detectSwirl(history: HandState[], windowSize: number): {
    active: boolean;
    direction: 'cw' | 'ccw';
    strength: number;
  } {
    // Calculate angular velocity around centroid
    const positions = history.slice(-windowSize).map(h => h.position);
    const centroid = averagePosition(positions);
    const angularVelocity = calculateAngularVelocity(positions, centroid);
    
    return {
      active: Math.abs(angularVelocity) > SWIRL_THRESHOLD,
      direction: angularVelocity > 0 ? 'cw' : 'ccw',
      strength: Math.min(Math.abs(angularVelocity) / MAX_ANGULAR_VEL, 1)
    };
  }
}
```

### 3. Influence Field

Converts gestures into forces that affect elements:

```typescript
interface InfluencePoint {
  position: Vector3;
  radius: number;           // Area of effect
  
  // Force components
  radialForce: number;      // Positive = repel, negative = attract
  tangentialForce: number;  // For swirl effects
  verticalBias: number;     // Push up or down
  
  // Modifiers
  intensity: number;        // 0-1 overall strength
  falloff: 'linear' | 'quadratic' | 'cubic';
}

class InfluenceField {
  points: InfluencePoint[] = [];
  
  // Update from gesture state
  updateFromGestures(gestures: GestureState): void {
    this.points = [];
    
    for (const hand of gestures.hands) {
      const point: InfluencePoint = {
        position: hand.position,
        radius: 50 + hand.spreadStrength * 50,  // Bigger when fingers spread
        radialForce: 0,
        tangentialForce: 0,
        verticalBias: 0,
        intensity: 1,
        falloff: 'quadratic'
      };
      
      // Apply gesture effects
      if (gestures.activeGestures.has(GestureType.PUSH)) {
        point.radialForce = hand.velocity.length() * PUSH_MULTIPLIER;
      }
      if (gestures.activeGestures.has(GestureType.PALM_UP)) {
        point.verticalBias = 0.5;
      }
      // ... etc
      
      this.points.push(point);
    }
  }
  
  // Sample the field at a position (used in compute shaders)
  sample(position: Vector3): Vector3 {
    let totalForce = new Vector3();
    
    for (const point of this.points) {
      const delta = position.clone().sub(point.position);
      const distance = delta.length();
      
      if (distance > point.radius) continue;
      
      const falloff = this.calculateFalloff(distance, point.radius, point.falloff);
      
      // Radial component
      const radial = delta.normalize().multiplyScalar(point.radialForce * falloff);
      
      // Tangential component (for swirl)
      const tangent = new Vector3(-delta.y, delta.x, 0)
        .normalize()
        .multiplyScalar(point.tangentialForce * falloff);
      
      // Vertical bias
      const vertical = new Vector3(0, point.verticalBias * falloff, 0);
      
      totalForce.add(radial).add(tangent).add(vertical);
    }
    
    return totalForce.multiplyScalar(this.points.length > 0 ? 1 / this.points.length : 0);
  }
}
```

---

## Element Implementations

### Base Element Interface

```typescript
abstract class BaseElement {
  protected scene: THREE.Scene;
  protected gpuDevice: GPUDevice;
  protected influenceField: InfluenceField;
  
  abstract init(): Promise<void>;
  abstract update(deltaTime: number, gestures: GestureState): void;
  abstract render(): void;
  abstract dispose(): void;
  
  // Common utilities
  protected uploadInfluenceToGPU(buffer: GPUBuffer): void;
}
```

### Fire Element

**Approach**: GPU particle system with noise-based turbulence, influenced by hand forces.

```
Particle Lifecycle:
1. Spawn at base (ground level or emission points)
2. Rise with thermal velocity + turbulence
3. Color shifts based on "temperature" (age/height)
4. Fade out and respawn

Hand Influence:
- Push: Particles bend away from hand, turbulence increases
- Pull: Particles drawn toward hand, gather and intensify
- Swirl: Rotational velocity added, fire tornado effect
- Palm up: Increased upward velocity, flames surge
- Palm down: Suppressed upward velocity, flames shrink
```

**Compute Shader (fire.compute.wgsl)**:

```wgsl
struct Particle {
  position: vec3f,
  velocity: vec3f,
  age: f32,
  lifetime: f32,
  temperature: f32,
  seed: f32,  // For noise
}

struct InfluencePoint {
  position: vec3f,
  radius: f32,
  radialForce: f32,
  tangentialForce: f32,
  verticalBias: f32,
  intensity: f32,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: SimParams;
@group(0) @binding(2) var<storage, read> influences: array<InfluencePoint>;
@group(0) @binding(3) var<uniform> numInfluences: u32;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let idx = id.x;
  if (idx >= arrayLength(&particles)) { return; }
  
  var p = particles[idx];
  
  // Age particle
  p.age += params.deltaTime;
  
  // Respawn if dead
  if (p.age >= p.lifetime) {
    p = respawnParticle(idx, params.time);
    particles[idx] = p;
    return;
  }
  
  // Base thermal rise
  var velocity = p.velocity;
  velocity.y += params.thermalRise * params.deltaTime;
  
  // Turbulence (Perlin noise based on position and time)
  let noisePos = p.position * params.noiseScale + vec3f(params.time * 0.5);
  let turbulence = snoise3(noisePos + p.seed) * params.turbulenceStrength;
  velocity += vec3f(turbulence, turbulence * 0.3, turbulence) * params.deltaTime;
  
  // Apply hand influence
  for (var i = 0u; i < numInfluences; i++) {
    let inf = influences[i];
    let delta = p.position - inf.position;
    let dist = length(delta);
    
    if (dist < inf.radius && dist > 0.01) {
      let falloff = 1.0 - (dist / inf.radius);
      let falloffSq = falloff * falloff;
      
      // Radial push/pull
      let radialDir = normalize(delta);
      velocity += radialDir * inf.radialForce * falloffSq * params.deltaTime * 50.0;
      
      // Tangential swirl
      let tangent = vec3f(-delta.y, delta.x, 0.0);
      velocity += normalize(tangent) * inf.tangentialForce * falloffSq * params.deltaTime * 30.0;
      
      // Vertical bias
      velocity.y += inf.verticalBias * falloffSq * params.deltaTime * 20.0;
      
      // Temperature affected by proximity to hands
      p.temperature = mix(p.temperature, 1.2, falloffSq * 0.1);
    }
  }
  
  // Apply velocity with damping
  velocity *= params.damping;
  p.velocity = velocity;
  p.position += velocity * params.deltaTime;
  
  // Cool down over time
  p.temperature = max(0.1, p.temperature - params.coolingRate * params.deltaTime);
  
  particles[idx] = p;
}
```

**Render Shader (fire.render.wgsl)**:

```wgsl
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) uv: vec2f,
}

// Temperature to fire color
fn fireColor(temp: f32, age: f32, lifetime: f32) -> vec4f {
  let normalizedAge = age / lifetime;
  let fade = 1.0 - smoothstep(0.7, 1.0, normalizedAge);
  
  // Color based on temperature
  // Cool: dark red -> Hot: orange -> Very hot: yellow/white
  var color: vec3f;
  if (temp < 0.3) {
    color = mix(vec3f(0.1, 0.0, 0.0), vec3f(0.5, 0.1, 0.0), temp / 0.3);
  } else if (temp < 0.7) {
    color = mix(vec3f(0.5, 0.1, 0.0), vec3f(1.0, 0.4, 0.0), (temp - 0.3) / 0.4);
  } else {
    color = mix(vec3f(1.0, 0.4, 0.0), vec3f(1.0, 0.9, 0.5), (temp - 0.7) / 0.3);
  }
  
  return vec4f(color, fade);
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4f {
  // Soft circular particle
  let dist = length(in.uv - vec2f(0.5));
  if (dist > 0.5) { discard; }
  
  let softness = 1.0 - smoothstep(0.3, 0.5, dist);
  var color = in.color;
  color.a *= softness;
  
  // Additive blending friendly output
  return vec4f(color.rgb * color.a, color.a);
}
```

### Water Element

**Approach**: 2D heightfield water simulation using the wave equation, rendered as a reflective surface.

```
Simulation:
- Grid of height values (256x256 or 512x512)
- Wave equation: ∂²h/∂t² = c² * ∇²h - damping
- Discrete Laplacian for neighbor sampling

Hand Influence:
- Push: Create outward-propagating wave
- Pull: Create inward-pulling wave (suction)
- Swirl: Rotational wave pattern
- Palm down: Dampen local waves
- Palm up: Lift water at point (blob/pillar effect)
```

**Compute Shader (water.compute.wgsl)**:

```wgsl
struct WaterParams {
  gridSize: u32,
  cellSize: f32,
  waveSpeed: f32,
  damping: f32,
  deltaTime: f32,
}

@group(0) @binding(0) var<storage, read> heightPrev: array<f32>;
@group(0) @binding(1) var<storage, read> heightCurr: array<f32>;
@group(0) @binding(2) var<storage, read_write> heightNext: array<f32>;
@group(0) @binding(3) var<uniform> params: WaterParams;
@group(0) @binding(4) var<storage, read> influences: array<InfluencePoint>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let x = id.x;
  let y = id.y;
  let size = params.gridSize;
  
  if (x >= size || y >= size) { return; }
  
  let idx = y * size + x;
  
  // Get neighbor heights (with boundary clamping)
  let left  = heightCurr[y * size + max(x, 1u) - 1u];
  let right = heightCurr[y * size + min(x + 1u, size - 1u)];
  let up    = heightCurr[max(y, 1u) * size - size + x];
  let down  = heightCurr[min(y + 1u, size - 1u) * size + x];
  let center = heightCurr[idx];
  let prev = heightPrev[idx];
  
  // Discrete Laplacian
  let laplacian = (left + right + up + down - 4.0 * center) / (params.cellSize * params.cellSize);
  
  // Wave equation with damping
  let c2 = params.waveSpeed * params.waveSpeed;
  var newHeight = 2.0 * center - prev + c2 * laplacian * params.deltaTime * params.deltaTime;
  newHeight = mix(newHeight, center, params.damping * params.deltaTime);
  
  // Apply hand influences
  let worldX = (f32(x) / f32(size) - 0.5) * 200.0;  // Map to world space
  let worldY = (f32(y) / f32(size) - 0.5) * 200.0;
  let worldPos = vec2f(worldX, worldY);
  
  for (var i = 0u; i < arrayLength(&influences); i++) {
    let inf = influences[i];
    let infPos2D = vec2f(inf.position.x, inf.position.z);
    let dist = length(worldPos - infPos2D);
    
    if (dist < inf.radius) {
      let falloff = 1.0 - (dist / inf.radius);
      let falloffSq = falloff * falloff;
      
      // Push creates ripple outward
      newHeight += inf.radialForce * falloffSq * 5.0;
      
      // Vertical bias raises/lowers water
      newHeight += inf.verticalBias * falloffSq * 10.0;
    }
  }
  
  heightNext[idx] = newHeight;
}
```

### Air Element

**Approach**: Particle system following a dynamic vector field, with visible trails for airflow.

```
Simulation:
- Vector field (3D grid of wind directions)
- Field influenced by hand gestures
- Particles advected through field
- Trail rendering for visibility

Hand Influence:
- Movement creates local wind
- Push: Strong gust in hand direction
- Swirl: Rotational field modification
- Spread: Divergent field (expansion)
- Gather: Convergent field (compression)
```

**Vector Field Update**:

```wgsl
struct VectorFieldParams {
  gridSize: vec3u,
  cellSize: f32,
  decay: f32,  // Field returns to ambient over time
  deltaTime: f32,
}

@group(0) @binding(0) var<storage, read_write> field: array<vec3f>;
@group(0) @binding(1) var<uniform> params: VectorFieldParams;
@group(0) @binding(2) var<storage, read> influences: array<InfluencePoint>;

@compute @workgroup_size(8, 8, 8)
fn updateField(@builtin(global_invocation_id) id: vec3u) {
  // ... map id to world position
  
  var wind = field[idx];
  
  // Apply ambient wind pattern (gentle drift)
  let ambient = vec3f(
    sin(worldPos.y * 0.1 + params.time) * 0.5,
    0.0,
    cos(worldPos.x * 0.1 + params.time * 0.7) * 0.5
  );
  
  // Decay toward ambient
  wind = mix(wind, ambient, params.decay * params.deltaTime);
  
  // Apply hand influences
  for (var i = 0u; i < arrayLength(&influences); i++) {
    // ... similar influence application
    // Adds velocity to field based on gestures
  }
  
  field[idx] = wind;
}
```

### Earth Element

**Approach**: GPU-deformable heightmap terrain with normal recalculation.

```
Simulation:
- Heightmap texture (512x512 or 1024x1024)
- Deformation applied directly based on hand position
- Normals recalculated for proper lighting
- Optional: smoothing pass for natural shapes

Hand Influence:
- Position over terrain raises/lowers based on palm orientation
- Push: Depression/crater
- Pull: Rise/mountain
- Swirl: Circular ridge
- Spread: Flatten area
- Gather: Sharp peak
```

**Terrain Deformation**:

```wgsl
@compute @workgroup_size(16, 16)
fn deformTerrain(@builtin(global_invocation_id) id: vec3u) {
  let x = id.x;
  let y = id.y;
  // ... bounds check
  
  var height = terrain[idx];
  let worldPos = gridToWorld(x, y);
  
  for (var i = 0u; i < numInfluences; i++) {
    let inf = influences[i];
    let infPos2D = vec2f(inf.position.x, inf.position.z);
    let dist = length(worldPos - infPos2D);
    
    if (dist < inf.radius) {
      let falloff = 1.0 - (dist / inf.radius);
      // Gaussian falloff for natural shapes
      let gaussian = exp(-dist * dist / (inf.radius * 0.5 * inf.radius * 0.5));
      
      // Vertical bias directly modifies height
      // Positive = palm up = raise terrain
      // Negative = palm down = lower terrain
      height += inf.verticalBias * gaussian * params.deformSpeed * params.deltaTime;
      
      // Radial force creates crater (push) or peak (pull)
      height -= inf.radialForce * gaussian * params.deformSpeed * params.deltaTime;
    }
  }
  
  // Clamp to valid range
  height = clamp(height, params.minHeight, params.maxHeight);
  terrain[idx] = height;
}
```

---

## Rendering Pipeline

### WebGPU Setup

```typescript
class WebGPURenderer {
  device: GPUDevice;
  context: GPUCanvasContext;
  presentationFormat: GPUTextureFormat;
  
  // Shared resources
  depthTexture: GPUTexture;
  uniformBuffer: GPUBuffer;
  
  async initialize(canvas: HTMLCanvasElement): Promise<boolean> {
    // Check WebGPU support
    if (!navigator.gpu) {
      console.warn('WebGPU not supported, falling back to WebGL');
      return false;
    }
    
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });
    
    if (!adapter) {
      return false;
    }
    
    this.device = await adapter.requestDevice({
      requiredFeatures: [],
      requiredLimits: {
        maxStorageBufferBindingSize: 256 * 1024 * 1024,  // 256MB for particles
      }
    });
    
    // Setup canvas context
    this.context = canvas.getContext('webgpu');
    this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    
    this.context.configure({
      device: this.device,
      format: this.presentationFormat,
      alphaMode: 'premultiplied',
    });
    
    return true;
  }
}
```

### Post-Processing

```typescript
class PostProcessing {
  // Ping-pong buffers for multi-pass effects
  private renderTargets: GPUTexture[];
  
  // Effect passes
  private bloomPass: BloomPass;
  private colorGradePass: ColorGradePass;
  
  render(input: GPUTexture, output: GPUTexture): void {
    // Bloom for fire glow, water highlights
    this.bloomPass.render(input, this.renderTargets[0]);
    
    // Color grading per-element
    this.colorGradePass.render(this.renderTargets[0], output);
  }
}

class BloomPass {
  // Threshold → Downsample → Blur → Upsample → Composite
  private thresholdPipeline: GPURenderPipeline;
  private blurPipelines: GPURenderPipeline[];  // Multiple mip levels
  private compositePipeline: GPURenderPipeline;
}
```

---

## Performance Considerations

### Frame Budget (60 FPS = 16.67ms)

| Stage | Budget |
|-------|--------|
| Hand tracking | ~5ms (async, separate thread) |
| Gesture processing | ~0.5ms |
| Simulation compute | ~4ms |
| Render | ~6ms |
| Post-processing | ~2ms |
| Buffer/presentation | ~1ms |
| **Total** | **~14ms** (2.67ms headroom) |

### Optimization Strategies

1. **Async Hand Tracking**: Run MediaPipe in a Web Worker
2. **Double Buffering**: Compute and render in parallel
3. **LOD for Particles**: Reduce count when camera is far
4. **Adaptive Quality**: Monitor frame time, reduce particle count dynamically
5. **Frustum Culling**: Don't simulate off-screen particles

```typescript
class PerformanceManager {
  private frameTimeHistory: number[] = [];
  private targetFrameTime = 16.67;
  
  update(frameTime: number): QualityLevel {
    this.frameTimeHistory.push(frameTime);
    if (this.frameTimeHistory.length > 60) {
      this.frameTimeHistory.shift();
    }
    
    const avgFrameTime = average(this.frameTimeHistory);
    
    if (avgFrameTime > this.targetFrameTime * 1.2) {
      return QualityLevel.REDUCE;
    } else if (avgFrameTime < this.targetFrameTime * 0.8) {
      return QualityLevel.INCREASE;
    }
    return QualityLevel.MAINTAIN;
  }
}
```

---

## State Management

### Element State Machine

```typescript
enum AppState {
  LOADING = 'loading',
  SELECTING = 'selecting',
  TRANSITIONING = 'transitioning',
  BENDING = 'bending',
}

class ElementManager {
  private state: AppState = AppState.LOADING;
  private currentElement: BaseElement | null = null;
  private elements: Map<ElementType, BaseElement> = new Map();
  
  async selectElement(type: ElementType): Promise<void> {
    if (this.state !== AppState.SELECTING) return;
    
    this.state = AppState.TRANSITIONING;
    
    // Fade out current
    if (this.currentElement) {
      await this.fadeOut(this.currentElement);
      this.currentElement.dispose();
    }
    
    // Initialize new element if needed
    if (!this.elements.has(type)) {
      const element = this.createElement(type);
      await element.init();
      this.elements.set(type, element);
    }
    
    // Fade in new element
    this.currentElement = this.elements.get(type)!;
    await this.fadeIn(this.currentElement);
    
    this.state = AppState.BENDING;
  }
}
```

---

## WebGL 2.0 Fallback

For browsers without WebGPU, we provide a reduced-quality WebGL 2.0 mode:

```typescript
class FallbackRenderer {
  private renderer: THREE.WebGLRenderer;
  
  // Simplified simulations using transform feedback or CPU
  private fireSystem: THREE.Points;  // Reduced particle count
  private waterMesh: THREE.Mesh;     // Simplified wave (sin-based, not full sim)
  
  // Feature detection
  static isWebGPUAvailable(): boolean {
    return !!navigator.gpu;
  }
}
```

| Feature | WebGPU | WebGL 2.0 Fallback |
|---------|--------|-------------------|
| Fire particles | 100,000 | 20,000 |
| Water resolution | 512×512 | 128×128 |
| Air particles | 50,000 | 10,000 |
| Earth resolution | 1024×1024 | 256×256 |
| Post-processing | Full | Simplified bloom |

---

## File Size & Loading

### Estimated Bundle Size

| Component | Size (gzipped) |
|-----------|----------------|
| Three.js | ~150KB |
| MediaPipe WASM | ~4MB (loaded async) |
| Application code | ~50KB |
| Shaders | ~20KB |
| **Total initial** | **~250KB** |
| **Total with MediaPipe** | **~4.3MB** |

### Loading Strategy

```typescript
// Progressive loading
async function initialize() {
  // 1. Show minimal loading UI immediately
  showLoadingScreen();
  
  // 2. Load Three.js and setup basic scene (fast)
  await initializeRenderer();
  
  // 3. Start MediaPipe loading in background
  const mediaPromise = loadMediaPipe();
  
  // 4. Load first element while MediaPipe loads
  await loadElement('fire');
  
  // 5. Wait for MediaPipe
  await mediaPromise;
  
  // 6. Ready!
  hideLoadingScreen();
}
```

---

## Testing Strategy

### Unit Tests
- Gesture detection accuracy
- Influence field calculations
- State machine transitions

### Performance Tests
- Frame rate under load
- Memory usage over time (leak detection)
- GPU memory usage

### Integration Tests
- Full flow: select → track → bend → switch
- Fallback mode activation
- Error recovery (camera permission denied, etc.)

### Manual Testing
- Various lighting conditions
- Different hand sizes/skin tones
- Edge cases (one hand, two hands, hand leaving frame)

---

## Deployment

### Build Configuration

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [glsl()],
  build: {
    target: 'esnext',  // Required for WebGPU
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          // MediaPipe loaded dynamically, not bundled
        }
      }
    }
  }
});
```

### Hosting Requirements
- HTTPS required (webcam access)
- CORS headers for MediaPipe CDN
- Good CDN for low latency (important for IRL use)

### Recommended Hosts
- Vercel (you have it connected)
- Cloudflare Pages
- GitHub Pages (with custom domain for HTTPS)

---

## Summary

Element Bender is architecturally similar to murmurations but significantly more complex due to:

1. **Multiple simulation types**: Particles (fire, air), fluid (water), mesh deformation (earth)
2. **WebGPU compute**: Heavy use of compute shaders for physics
3. **Gesture recognition**: More sophisticated interpretation of hand data
4. **Per-element rendering**: Different render approaches per element

The core insight from murmurations—that hand positions create influence fields that affect simulation—carries over beautifully. We're just expanding the vocabulary of what can be influenced and how.

The phased approach (Fire → Air → Water → Earth) lets us build complexity incrementally while having a working, delightful experience at each milestone.

Let's bend some elements.
