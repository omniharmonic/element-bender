# Element Bender
## Product Requirements Document

---

## Executive Summary

**Element Bender** is an interactive, embodied experience that allows users to manipulate the four classical elements—Fire, Water, Air, and Earth—using their hands tracked via webcam. Drawing inspiration from the elemental bending arts, this browser-based application creates a flow state through intuitive gesture-based control of physics-driven elemental simulations.

The experience prioritizes *feeling* over photorealism. When you raise your palm and flames dance away from your fingers, when water parts at your gesture, when clouds swirl around your movements—it should feel like you've touched something primal and powerful.

---

## Vision & Philosophy

### Core Experience
The user enters a digital space containing a single element. The element moves according to its own nature—fire flickers upward, water flows and settles, air drifts in currents, earth stands solid. Then the user raises their hands, and the element *responds*. Not as a tool being operated, but as a force being bent to will.

### Design Principles

1. **Flow State Induction**: The interaction should be so intuitive that conscious thought dissolves. No learning curve—your body already knows how to move fire.

2. **Elemental Authenticity**: Each element has personality. Fire is hungry and rises. Water is heavy and seeks the lowest point. Air is playful and invisible until revealed. Earth is patient and remembers.

3. **Embodied Control**: Your whole body is the controller. Palm orientation matters. The space between your hands matters. Your movement speed matters.

4. **Visual Poetry**: Semi-realistic, physics-based, but ultimately *beautiful*. Not simulation—evocation.

5. **Archetypical Aesthetics**: The UI and overall feel should evoke something ancient and elemental. Clean, minimal, but with weight and presence. Not appropriating any specific culture, but tapping into the universal human relationship with natural forces.

---

## User Experience

### Entry Flow

1. **Landing**: A minimal screen with the four element symbols arranged in a circle or cardinal directions. Background is neutral (deep charcoal or off-white, user-selectable).

2. **Element Selection**: User clicks/taps an element, or (stretch goal) gestures toward it with their hand.

3. **Calibration**: Brief moment for the camera to establish hand tracking. Visual feedback shows the system "sees" the user.

4. **Immersion**: Transition into the element space. The element appears and begins its natural behavior. User's hands become visible as subtle indicators in the space.

5. **Bending**: User explores, plays, enters flow.

6. **Exit**: Gesture or key press returns to element selection.

### Interaction Model

#### Universal Gestures (All Elements)

| Gesture | Detection | Effect |
|---------|-----------|--------|
| **Push** | Palm forward, hand moves away from body | Repel element away from hand |
| **Pull** | Palm toward self, hand moves toward body | Attract element toward hand |
| **Swirl** | Circular hand motion | Create rotational force/vortex |
| **Spread** | Two hands moving apart | Disperse/expand element |
| **Gather** | Two hands moving together | Concentrate/compress element |
| **Palm Down** | Palm facing floor | Suppress/calm effect |
| **Palm Up** | Palm facing ceiling | Lift/intensify effect |

#### Element-Specific Responses

**Fire**
- Push: Flames bend away, gutter briefly
- Pull: Flames lean toward you, intensify
- Swirl: Fire tornado forms
- Spread: Flames scatter into embers
- Gather: Concentrated inferno in the center
- Palm Down: Flames shrink, die down
- Palm Up: Flames surge upward dramatically

**Water**
- Push: Waves propagate outward
- Pull: Water gathers, rises toward hands
- Swirl: Whirlpool/vortex forms
- Spread: Water surface flattens, spreads thin
- Gather: Water collects into a hovering mass
- Palm Down: Water calms, surface stills
- Palm Up: Water rises in columns/droplets

**Air**
- Push: Wind gust, clouds scatter
- Pull: Air current draws clouds/particles inward
- Swirl: Spiral wind pattern, visible in particle trails
- Spread: Expansion, dissipation
- Gather: Concentration, density increase (visible turbulence)
- Palm Down: Downdraft, settling
- Palm Up: Updraft, lifting

**Earth**
- Push: Terrain depresses away from hand
- Pull: Terrain rises toward hand
- Swirl: Circular ridge/crater formation
- Spread: Flattening, smoothing terrain
- Gather: Mountain/peak formation
- Palm Down: Overall lowering, valley creation
- Palm Up: Overall raising, plateau creation

---

## Technical Requirements

### Platform
- **Primary**: Desktop browser (Chrome, Edge, Firefox with WebGPU support)
- **Fallback**: WebGL 2.0 for browsers without WebGPU (reduced visual quality)
- **Target Resolution**: 1920×1080 minimum, scales up to 4K
- **Frame Rate**: 60 FPS target, 30 FPS minimum acceptable

### Performance Budgets

| Element | Particle Count | Simulation Complexity |
|---------|---------------|----------------------|
| Fire | 50,000-100,000 | Medium (noise-based movement) |
| Water | 10,000-50,000 | High (fluid dynamics) |
| Air | 20,000-50,000 | Low-Medium (vector field) |
| Earth | N/A (mesh) | Medium (heightmap deformation) |

### Browser Requirements
- WebGPU support (Chrome 113+, Edge 113+, Firefox Nightly)
- Webcam access
- Modern GPU (discrete recommended, integrated acceptable)
- 8GB RAM minimum

### Tracking Requirements
- MediaPipe Hand Landmarker (same as murmurations)
- Face tracking optional (may enable head-based influence later)
- 15-30 FPS tracking sufficient
- Low latency critical (<100ms gesture-to-response)

---

## Feature Specification

### Phase 1: Foundation (MVP)

#### 1.1 Core Infrastructure
- [ ] Project setup (Vite + Three.js + WebGPU)
- [ ] WebGPU initialization with WebGL 2.0 fallback
- [ ] Hand tracking integration (port from murmurations)
- [ ] Gesture recognition system
- [ ] Element selection UI
- [ ] Basic scene management

#### 1.2 Fire Element
- [ ] GPU particle system for flames
- [ ] Noise-based flame movement
- [ ] Heat-based coloring (black → red → orange → yellow → white)
- [ ] Hand influence on particle velocities
- [ ] Ember/spark secondary particles
- [ ] Glow post-processing effect

#### 1.3 Air Element
- [ ] Cloud/mist particle system
- [ ] Vector field-based movement
- [ ] Perlin noise for natural drift
- [ ] Hand-generated wind currents
- [ ] Particle trails for airflow visualization
- [ ] Subtle fog/atmosphere shader

### Phase 2: Water & Polish

#### 2.1 Water Element
- [ ] 2D heightfield water simulation (wave equation)
- [ ] Surface rendering with reflection/refraction
- [ ] Splash/droplet particles
- [ ] Hand interaction with water surface
- [ ] Caustics effect (optional)
- [ ] Underwater camera mode (optional)

#### 2.2 Visual Polish
- [ ] Smooth element transitions
- [ ] Hand visualization in element space
- [ ] Background customization (dark/light/custom)
- [ ] Post-processing pipeline (bloom, color grading)
- [ ] Loading states and transitions

### Phase 3: Earth & Advanced

#### 3.1 Earth Element
- [ ] GPU-based heightmap terrain
- [ ] Real-time mesh deformation
- [ ] Normal recalculation for lighting
- [ ] Procedural texture blending (rock/dirt/grass)
- [ ] Dust/debris particles on deformation
- [ ] Erosion simulation (optional)

#### 3.2 Rivers (Earth Sub-feature)
- [ ] Gradient-based flow calculation
- [ ] Water accumulation in low points
- [ ] River rendering on terrain
- [ ] Interaction between terrain deformation and water flow

### Phase 4: Experience Enhancement

- [ ] Tutorial/onboarding sequence
- [ ] Gesture calibration per user
- [ ] Session recording/playback
- [ ] Screenshot/video export
- [ ] Ambient soundscapes (optional)
- [ ] Multi-user mode (stretch)

---

## Visual Design

### Aesthetic Direction

**Elemental Minimalism**: The interface should feel ancient and primal, yet clean and modern. Think standing stones, cave paintings abstracted into geometric forms, the weight of natural materials.

**Color Palettes**

*Fire*
- Background: Deep charcoal (#0a0a0a) to burnt umber (#3d2314)
- Flames: Black (#000) → Deep red (#8b0000) → Orange (#ff4500) → Gold (#ffd700) → White (#fff)
- Accent: Ember orange (#ff6b35)

*Water*
- Background: Midnight blue (#0d1b2a) to deep teal (#1b4965)
- Water: Dark blue (#0077b6) → Cyan (#00b4d8) → Foam white (#caf0f8)
- Accent: Seafoam (#90e0ef)

*Air*
- Background: Pale gray (#e5e5e5) to soft blue (#b8c5d6)
- Clouds: White (#ffffff) with soft gray shadows (#d4d4d4)
- Currents: Barely visible trails, light blue (#a2d2ff)
- Accent: Sky blue (#89c2d9)

*Earth*
- Background: Warm brown (#2d1810) to forest green (#1b3a1a)
- Terrain: Dark soil (#3d2914) → Clay (#8b6914) → Stone gray (#6b705c) → Grass green (#606c38)
- Accent: Ochre (#bc6c25)

### Typography
- Headers: A geometric sans-serif with weight (e.g., Fjalla One, Oswald)
- Body: Clean humanist sans-serif (e.g., Lato, Source Sans Pro)
- Element symbols: Custom SVG icons, simple geometric forms

### Element Symbols
Simple, bold, iconic:
- **Fire**: Stylized flame (upward triangle with flicker)
- **Water**: Stylized wave (horizontal curves)
- **Air**: Stylized wind (three curved parallel lines)
- **Earth**: Stylized mountain (layered triangles or concentric circles)

---

## Success Metrics

### Technical
- 60 FPS maintained during interaction
- <100ms latency from gesture to visual response
- <5 second cold start to interactive state
- Works on 80%+ of desktop browsers with WebGPU

### Experiential
- Users enter flow state (qualitative: "lost track of time")
- Gestures feel intuitive without instruction
- Each element feels distinctly different
- Users want to return and show others

### Practical
- Stable for extended installation use (4+ hours)
- Recovers gracefully from tracking loss
- Works in varied lighting conditions

---

## Open Questions

1. **Hand Visualization**: How prominently should users' hands appear in the element space? Options: ghost outline, particle attractor points, not at all (just the element responds).

2. **Idle Behavior**: What happens when no hands are detected? Element returns to natural state? Gentle ambient animation?

3. **Transition Effects**: When switching elements, should there be elemental transitions (fire turns to steam as water takes over) or clean fades?

4. **Background Options**: User-selectable? Per-element defaults? Pure black vs. contextual?

5. **Calibration Needs**: Should there be an explicit calibration step, or just dive in with adaptive tracking?

---

## Timeline Estimate

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1 | 3-4 weeks | Fire + Air playable |
| Phase 2 | 2-3 weeks | Water + Polish |
| Phase 3 | 3-4 weeks | Earth + Rivers |
| Phase 4 | 2+ weeks | Experience enhancement |

**Total MVP (Fire + Air)**: ~4 weeks
**Full Four Elements**: ~10-12 weeks

---

## Conclusion

Element Bender is an opportunity to create something genuinely magical—an experience that connects the digital and physical, the ancient and modern. By prioritizing the *feel* of elemental control over technical simulation accuracy, we can create something that resonates on a primal level.

The gesture vocabulary is universal. The elements are archetypal. The experience should be transcendent.

Let's bend some elements.
