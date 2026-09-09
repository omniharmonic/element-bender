import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { clamp, noiseGLSL, type Frame } from "./core";

/** Double-density relaxation fluid. Neighbors exchange equal/opposite pressure corrections. */
export class Liquid {
  readonly count: number;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  private previous: Float32Array;
  private grid = new Map<number, number[]>();
  private neighbors: number[] = [];
  private distances: number[] = [];
  readonly h = 0.38;
  constructor(count = 760) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.previous = new Float32Array(count * 3);
    this.reset();
  }
  reset() {
    this.velocities.fill(0);
    for (let i = 0; i < this.count; i++) {
      const a = i * 2.39996,
        r = Math.sqrt((i + 0.5) / this.count) * 1.65;
      this.positions[i * 3] = Math.cos(a) * r;
      this.positions[i * 3 + 1] = 1.0 + (i % 13) * 0.15;
      this.positions[i * 3 + 2] = Math.sin(a) * r;
    }
  }
  private key(x: number, y: number, z: number) {
    return x + 64 + (y + 64) * 128 + (z + 64) * 16384;
  }
  step(dt: number, frame: Frame) {
    const p = this.positions,
      v = this.velocities,
      h = this.h;
    this.previous.set(p);
    this.grid.clear();
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      v[k + 1] -= 9.8 * dt;
      for (const hand of frame.hands) {
        const dx = p[k] - hand.position.x,
          dy = p[k + 1] - hand.position.y,
          dz = p[k + 2] - hand.position.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01,
          fall = Math.exp((-d * d) / (frame.radius * frame.radius * 2));
        const f = fall * frame.power;
        v[k] += hand.velocity.x * f * dt * 5;
        v[k + 1] += hand.velocity.y * f * dt * 5;
        if (hand.action === "gather" || hand.action === "flow") {
          v[k] -= dx * f * dt * 25;
          v[k + 1] += (9.8 - dy * 25) * f * dt;
          v[k + 2] -= dz * f * dt * 25;
        }
        if (hand.action === "push") {
          v[k] += (dx / d) * f * dt * 35;
          v[k + 1] += (dy / d) * f * dt * 35;
          v[k + 2] += (dz / d) * f * dt * 35;
        }
        if (hand.action === "swirl") {
          v[k] += (-dy * 22 - dx * 5) * f * dt;
          v[k + 1] += (dx * 22 - dy * 5 + 9.8) * f * dt;
          v[k + 2] -= dz * f * dt * 10;
        }
        if (hand.action === "lift") v[k + 1] += f * dt * 34;
        if (hand.action === "calm") {
          v[k] *= Math.exp(-f * dt * 10);
          v[k + 1] -= f * dt * 12;
          v[k + 2] *= Math.exp(-f * dt * 10);
        }
      }
      for (let a = 0; a < 3; a++) {
        v[k + a] = clamp(v[k + a] * Math.exp(-dt * 0.32), -12, 12);
        p[k + a] += v[k + a] * dt;
      }
      const key = this.key(
        Math.floor(p[k] / h),
        Math.floor(p[k + 1] / h),
        Math.floor(p[k + 2] / h),
      );
      const cell = this.grid.get(key);
      if (cell) cell.push(i);
      else this.grid.set(key, [i]);
    }
    for (let i = 0; i < this.count; i++) {
      const k = i * 3,
        cx = Math.floor(p[k] / h),
        cy = Math.floor(p[k + 1] / h),
        cz = Math.floor(p[k + 2] / h);
      this.neighbors.length = 0;
      this.distances.length = 0;
      let density = 0,
        near = 0;
      for (let z = -1; z <= 1; z++)
        for (let y = -1; y <= 1; y++)
          for (let x = -1; x <= 1; x++) {
            const cell = this.grid.get(this.key(cx + x, cy + y, cz + z));
            if (!cell) continue;
            for (const j of cell) {
              if (i === j) continue;
              const l = j * 3,
                dx = p[l] - p[k],
                dy = p[l + 1] - p[k + 1],
                dz = p[l + 2] - p[k + 2],
                d = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (d < h && d > 0.0001) {
                const q = 1 - d / h;
                density += q * q;
                near += q * q * q;
                this.neighbors.push(j);
                this.distances.push(d);
              }
            }
          }
      const pressure = 22 * (density - 3.2),
        nearPressure = 42 * near;
      let sx = 0,
        sy = 0,
        sz = 0;
      for (let n = 0; n < this.neighbors.length; n++) {
        const j = this.neighbors[n] * 3,
          d = this.distances[n],
          q = 1 - d / h;
        const correction =
          (clamp(
            dt * dt * (pressure * q + nearPressure * q * q),
            -0.008,
            0.018,
          ) *
            0.5) /
          d;
        const dx = (p[j] - p[k]) * correction,
          dy = (p[j + 1] - p[k + 1]) * correction,
          dz = (p[j + 2] - p[k + 2]) * correction;
        p[j] += dx;
        p[j + 1] += dy;
        p[j + 2] += dz;
        sx -= dx;
        sy -= dy;
        sz -= dz;
      }
      p[k] += sx;
      p[k + 1] += sy;
      p[k + 2] += sz;
    }
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      p[k] = clamp(p[k], -3.65, 3.65);
      p[k + 1] = clamp(p[k + 1], 0.18, 7.65);
      p[k + 2] = clamp(p[k + 2], -3.65, 3.65);
      for (let a = 0; a < 3; a++)
        v[k + a] = clamp((p[k + a] - this.previous[k + a]) / dt, -14, 14);
      if (p[k + 1] <= 0.181) {
        v[k] *= 0.98;
        v[k + 2] *= 0.98;
      }
    }
  }
}

export class Water {
  group = new THREE.Group();
  liquid = new Liquid();
  private surface: MarchingCubes;
  private material: THREE.ShaderMaterial;
  private pool: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private height = new Float32Array(96 * 96);
  private velocity = new Float32Array(96 * 96);
  private next = new Float32Array(96 * 96);
  private texture: THREE.DataTexture;
  private lastSurfaceTime = -1;
  private smoothField = new Float32Array(64 * 64 * 64);
  constructor() {
    this.texture = new THREE.DataTexture(
      this.height,
      96,
      96,
      THREE.RedFormat,
      THREE.FloatType,
    );
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    const fragment = `
      varying vec3 vWorld,vNormal;uniform float time;uniform bool pool;uniform sampler2D background;uniform vec2 resolution;
      ${noiseGLSL}
      vec3 environment(vec3 r){
        vec3 sky=mix(vec3(.11,.20,.27),vec3(.006,.017,.040),pow(max(r.y,0.),.45));
        float clouds=fbm(r*6.+vec3(time*.015,0.,0.));sky+=vec3(.10,.19,.26)*smoothstep(.42,.67,clouds)*smoothstep(0.,.35,r.y);
        sky+=vec3(1.6,2.1,2.3)*pow(max(dot(r,normalize(vec3(-.7,.8,.2))),0.),80.);
        sky+=vec3(.10,.25,.37)*pow(max(dot(r,normalize(vec3(1,.2,-.3))),0.),18.);
        return sky;
      }
      void main(){
        vec3 V=normalize(cameraPosition-vWorld);vec3 N=normalize(vNormal);
        float n=noise(vWorld*8.+vec3(time*.4,0.,time*.2));
        if(pool){
          float e=.02;vec3 q=vWorld*.65+vec3(time*.07,0.,time*.05);
          float dx=(noise(q+vec3(e,0,0))-noise(q-vec3(e,0,0)))/e;
          float dz=(noise(q+vec3(0,0,e))-noise(q-vec3(0,0,e)))/e;
          N=normalize(N+vec3(dx,0,dz)*.055);
        }else N=normalize(N+vec3(dFdx(n),0.,dFdy(n))*.08);
        if(dot(N,V)<0.)N=-N;
        float fresnel=.0204+.9796*pow(1.-max(dot(N,V),0.),5.);
        vec3 reflected=environment(reflect(-V,N));
        float depth=pool?2.5:clamp(vWorld.y*.6+.7,.5,3.5);
        vec3 absorption=exp(-vec3(.9,.21,.13)*depth);
        vec3 refraction=vec3(.012,.11,.15)*absorption+vec3(.003,.024,.04)*(1.-absorption);
        if(!pool){vec2 uv=gl_FragCoord.xy/resolution;vec2 offset=N.xy*.065*(1.-max(dot(N,V),0.)*.5);vec3 behind=texture2D(background,clamp(uv+offset,vec2(.002),vec2(.998))).rgb;refraction=behind*exp(-vec3(.8,.16,.07)*depth)+vec3(.005,.048,.060)*(1.-absorption);}
        
        vec3 col=mix(refraction,reflected,clamp(fresnel+.09,0.,1.));
        vec3 H=normalize(V+normalize(vec3(-.7,.8,.2)));col+=vec3(1.,1.28,1.4)*pow(max(dot(N,H),0.),160.)*1.3;
        col+=vec3(.03,.20,.23)*pow(max(dot(V,-normalize(vec3(-.7,.8,.2))),0.),3.)*max(0.,1.-N.y)*.3;
        if(pool){float mist=1.-exp(-length(vWorld.xz)*.025);col=mix(col,vec3(.028,.060,.095),mist);}
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        pool: { value: false },
        background: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: `varying vec3 vWorld,vNormal;void main(){vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;vNormal=mat3(modelMatrix)*normal;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: fragment,
      side: THREE.DoubleSide,
    });
    this.surface = new MarchingCubes(64, this.material, false, false, 70000);
    this.surface.scale.setScalar(4);
    this.surface.position.y = 4;
    this.surface.isolation = 65;
    this.surface.frustumCulled = false;
    this.group.add(this.surface);
    const poolMat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        pool: { value: true },
        height: { value: this.texture },
      },
      vertexShader: `uniform float time;uniform sampler2D height;varying vec3 vWorld,vNormal;
      float wave(vec2 p){float h=texture2D(height,p/16.+.5).r*(1.-smoothstep(6.,9.,length(p)));return h+sin(p.x*.5+time*.65)*.055+sin(p.y*.7-time*.8)*.028+sin(p.x*1.2+p.y*.8-time*.9)*.012;}
      void main(){vec3 p=position;float e=.045;float h=wave(p.xz);p.y+=h;vNormal=normalize(vec3(wave(p.xz-vec2(e,0))-wave(p.xz+vec2(e,0)),2.*e,wave(p.xz-vec2(0,e))-wave(p.xz+vec2(0,e))));vec4 w=modelMatrix*vec4(p,1);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: fragment,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(180, 180, 240, 240);
    geo.rotateX(-Math.PI / 2);
    this.pool = new THREE.Mesh(geo, poolMat);
    this.pool.position.y = 0.06;
    this.group.add(this.pool);
  }
  setBackground(texture: THREE.Texture, width: number, height: number) {
    this.material.uniforms.background.value = texture;
    this.material.uniforms.resolution.value.set(width, height);
  }
  setSurfaceVisible(visible: boolean) {
    this.surface.visible = visible;
  }
  reset() {
    this.lastSurfaceTime = -1;
    this.liquid.reset();
    this.height.fill(0);
    this.velocity.fill(0);
    this.texture.needsUpdate = true;
  }
  update(frame: Frame) {
    const dt = frame.dt;
    // Fixed substeps avoid frame-rate-dependent pressure and collision behavior.
    const steps = Math.ceil(dt / (1 / 90));
    for (let i = 0; i < steps; i++) this.liquid.step(dt / steps, frame);
    this.material.uniforms.time.value = frame.time;
    this.pool.material.uniforms.time.value = frame.time;
    for (const hand of frame.hands) {
      const cx = Math.round((hand.position.x / 16 + 0.5) * 95),
        cz = Math.round((hand.position.z / 16 + 0.5) * 95);
      for (let z = -6; z <= 6; z++)
        for (let x = -6; x <= 6; x++) {
          const a = cx + x,
            b = cz + z;
          if (a < 1 || a > 94 || b < 1 || b > 94) continue;
          this.velocity[b * 96 + a] +=
            Math.exp(-(x * x + z * z) / 15) *
            dt *
            (hand.action === "push" ? -5 : 3) *
            frame.power;
        }
    }
    for (let y = 1; y < 95; y++)
      for (let x = 1; x < 95; x++) {
        const i = y * 96 + x;
        const lap =
          this.height[i - 1] +
          this.height[i + 1] +
          this.height[i - 96] +
          this.height[i + 96] -
          4 * this.height[i];
        this.velocity[i] =
          (this.velocity[i] + lap * dt * 90) * Math.exp(-dt * 1.2);
        this.next[i] = clamp(this.height[i] + this.velocity[i] * dt, -0.5, 0.5);
      }
    this.height.set(this.next);
    this.texture.needsUpdate = true;
  }
  prepareSurface(time: number) {
    if (time - this.lastSurfaceTime < 1 / 40 && time >= this.lastSurfaceTime)
      return;
    this.lastSurfaceTime = time;
    this.surface.reset();
    const p = this.liquid.positions;
    for (let i = 0; i < this.liquid.count; i++)
      this.surface.addBall(
        p[i * 3] / 8 + 0.5,
        p[i * 3 + 1] / 8,
        p[i * 3 + 2] / 8 + 0.5,
        0.019,
        12,
      );
    // Six-neighbor diffusion smooths the reconstruction without changing particle dynamics.
    const field = this.surface.field,
      n = 64,
      n2 = n * n;
    this.smoothField.set(field);
    for (let z = 1; z < n - 1; z++)
      for (let y = 1; y < n - 1; y++)
        for (let x = 1; x < n - 1; x++) {
          const i = z * n2 + y * n + x;
          field[i] =
            this.smoothField[i] * 0.58 +
            (this.smoothField[i - 1] +
              this.smoothField[i + 1] +
              this.smoothField[i - n] +
              this.smoothField[i + n] +
              this.smoothField[i - n2] +
              this.smoothField[i + n2]) *
              0.07;
        }
    this.surface.update();
  }
  dispose() {
    this.surface.geometry.dispose();
    this.material.dispose();
    this.pool.geometry.dispose();
    this.pool.material.dispose();
    this.texture.dispose();
  }
}
