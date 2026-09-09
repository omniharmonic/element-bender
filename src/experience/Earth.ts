import * as THREE from "three";
import { clamp, fbm, hash, noiseGLSL, type Frame } from "./core";

/** Priority-flood drainage: downstream links always reach the boundary, including through basins. */
export function drainage(height: Float32Array, n: number) {
  const count = n * n,
    filled = new Float32Array(count),
    parent = new Int32Array(count).fill(-1),
    seen = new Uint8Array(count),
    order: number[] = [];
  const heap: number[] = [],
    cost: number[] = [];
  const push = (id: number, h: number) => {
    let i = heap.length;
    heap.push(id);
    cost.push(h);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cost[p] <= h) break;
      heap[i] = heap[p];
      cost[i] = cost[p];
      i = p;
    }
    heap[i] = id;
    cost[i] = h;
  };
  const pop = () => {
    const out = heap[0],
      id = heap.pop()!,
      h = cost.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1;
        if (c + 1 < heap.length && cost[c + 1] < cost[c]) c++;
        if (cost[c] >= h) break;
        heap[i] = heap[c];
        cost[i] = cost[c];
        i = c;
      }
      heap[i] = id;
      cost[i] = h;
    }
    return out;
  };
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++)
      if (x === 0 || z === 0 || x === n - 1 || z === n - 1) {
        const i = z * n + x;
        seen[i] = 1;
        filled[i] = height[i];
        push(i, height[i]);
      }
  while (heap.length) {
    const i = pop();
    order.push(i);
    const x = i % n,
      z = Math.floor(i / n);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx,
          nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const j = nz * n + nx;
        if (seen[j]) continue;
        seen[j] = 1;
        parent[j] = i;
        filled[j] = Math.max(height[j], filled[i] + 0.00001);
        push(j, filled[j]);
      }
  }
  const flow = new Float32Array(count).fill(1);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    if (parent[i] >= 0) flow[parent[i]] += flow[i];
  }
  return { parent, flow, filled };
}

export class Terrain {
  readonly n: number;
  heights: Float32Array;
  original: Float32Array;
  constructor(n = 241) {
    this.n = n;
    this.heights = new Float32Array(n * n);
    for (let z = 0; z < n; z++)
      for (let x = 0; x < n; x++) {
        const wx = (x / (n - 1) - 0.5) * 20,
          wz = (z / (n - 1) - 0.5) * 20;
        const r = Math.sqrt(wx * wx * 0.82 + wz * wz * 1.08);
        const ridge = 1 - Math.abs(fbm(wx * 0.26 + 8, wz * 0.26 + 4) * 2 - 1);
        const mountain =
          Math.exp(-((wx + 1.3) ** 2 / 22 + (wz + 0.9) ** 2 / 15)) * 3.8;
        const shore = clamp((9 - r) / 2, 0, 1);
        const small = fbm(wx * 0.72, wz * 0.72);
        this.heights[z * n + x] =
          (mountain + Math.pow(ridge, 3) * 1.35 + small * 0.22) * shore -
          0.85 +
          Math.sin(wx * 0.5 + wz * 0.4) * 0.2;
      }
    this.original = this.heights.slice();
  }
  sample(x: number, z: number) {
    const fx = clamp((x / 20 + 0.5) * (this.n - 1), 0, this.n - 1),
      fz = clamp((z / 20 + 0.5) * (this.n - 1), 0, this.n - 1),
      ix = Math.floor(fx),
      iz = Math.floor(fz);
    return this.heights[iz * this.n + ix];
  }
  deform(frame: Frame) {
    let changed = false;
    const n = this.n;
    for (const hand of frame.hands) {
      const cx = (hand.position.x / 20 + 0.5) * (n - 1),
        cz = (hand.position.z / 20 + 0.5) * (n - 1),
        r = (frame.radius * (n - 1)) / 20;
      for (
        let z = Math.max(1, Math.floor(cz - r * 2));
        z < Math.min(n - 1, cz + r * 2);
        z++
      )
        for (
          let x = Math.max(1, Math.floor(cx - r * 2));
          x < Math.min(n - 1, cx + r * 2);
          x++
        ) {
          const i = z * n + x,
            d = ((x - cx) ** 2 + (z - cz) ** 2) / (r * r);
          const fall = Math.exp(-d * 1.5);
          let delta = frame.dt * frame.power * fall * 1.45;
          if (hand.action === "push" || hand.action === "calm") delta *= -1;
          if (hand.action === "swirl")
            delta *= Math.exp(-((Math.sqrt(d) - 0.9) ** 2) * 12) * 2 - 0.45;
          if (hand.action === "gather") delta *= 1.7;
          this.heights[i] = clamp(this.heights[i] + delta, -1.8, 7.8);
          changed = true;
        }
    }
    return changed;
  }
  reset() {
    this.heights.set(this.original);
  }
}

export class Earth {
  group = new THREE.Group();
  terrain = new Terrain();
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private forest: THREE.InstancedMesh;
  private river: THREE.Mesh;
  private ocean: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private trees: { x: number; z: number; size: number }[] = [];
  private matrix = new THREE.Object3D();
  private hydroTimer = 0;
  private changed = true;
  private heightTexture: THREE.DataTexture;
  private flow: Float32Array;
  private filled: Float32Array;
  revision = 0;
  constructor() {
    const n = this.terrain.n,
      geo = new THREE.PlaneGeometry(20, 20, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);
    this.heightTexture = new THREE.DataTexture(
      this.terrain.heights,
      n,
      n,
      THREE.RedFormat,
      THREE.FloatType,
    );
    this.heightTexture.minFilter = THREE.LinearFilter;
    this.heightTexture.magFilter = THREE.LinearFilter;
    this.heightTexture.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, terrain: { value: this.heightTexture } },
      vertexShader: `varying vec3 vWorld,vNormal;void main(){vec4 w=modelMatrix*vec4(position,1);vWorld=w.xyz;vNormal=mat3(modelMatrix)*normal;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: `
      varying vec3 vWorld,vNormal;uniform float time;uniform sampler2D terrain;
      ${noiseGLSL}
      void main(){vec3 n=normalize(vNormal);float detail=fbm(vWorld*4.);float grit=noise(vWorld*30.);
      vec3 grass=mix(vec3(.028,.068,.022),vec3(.11,.16,.045),detail);
      vec3 rock=mix(vec3(.085,.087,.071),vec3(.23,.20,.15),detail);
      float slope=1.-n.y;vec3 col=mix(grass,rock,smoothstep(.32,.72,slope));
      col=mix(vec3(.25,.20,.10),col,smoothstep(.0,.36,vWorld.y));
      float snow=smoothstep(3.8,4.55,vWorld.y+detail*.6)*smoothstep(.4,.8,n.y);col=mix(col,vec3(.80,.85,.82),snow);
      float strata=sin(vWorld.y*37.+detail*5.)*.5+.5;col*=.83+detail*.2+grit*.09+strata*.055;
      vec3 sun=normalize(vec3(-.65,.9,.35));float diffuse=max(dot(n,sun),0.);
      float visibility=1.;
      for(int i=1;i<=16;i++){float t=float(i)*.22;vec3 q=vWorld+sun*t;vec2 uv=q.xz/20.+.5;float h=texture2D(terrain,uv).r;visibility=min(visibility,smoothstep(-.06,.10,q.y-h));}
      diffuse*=mix(.12,1.,visibility);
      col*=vec3(.20,.26,.32)+vec3(1.1,.94,.65)*diffuse;
      float mist=1.-exp(-length(cameraPosition-vWorld)*.007);col=mix(col,vec3(.12,.20,.22),mist);
      gl_FragColor=vec4(col,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.group.add(this.mesh);
    const treeGeo = new THREE.BufferGeometry();
    const verts: number[] = [],
      normals: number[] = [];
    for (let tier = 0; tier < 3; tier++) {
      const cone = new THREE.ConeGeometry(0.22 * (1 - tier * 0.18), 0.64, 7, 1);
      cone.translate(0, 0.35 + tier * 0.23, 0);
      const g = cone.toNonIndexed();
      const p = g.getAttribute("position"),
        normal = g.getAttribute("normal");
      for (let i = 0; i < p.count; i++) {
        verts.push(p.getX(i), p.getY(i), p.getZ(i));
        normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      }
      g.dispose();
      cone.dispose();
    }
    treeGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(verts, 3),
    );
    treeGeo.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    this.forest = new THREE.InstancedMesh(
      treeGeo,
      new THREE.MeshStandardMaterial({ color: 0xb3bf90, roughness: 1 }),
      11000,
    );
    this.forest.frustumCulled = false;
    this.group.add(this.forest);
    for (let i = 0; i < 11000; i++) {
      this.trees.push({
        x: (hash(i, 21) * 2 - 1) * 8.5,
        z: (hash(i, 74) * 2 - 1) * 8.5,
        size: 0.1 + hash(i, 44) * 0.19,
      });
      this.forest.setColorAt(
        i,
        new THREE.Color().setHSL(
          0.24 + hash(i, 7) * 0.06,
          0.18 + hash(i, 8) * 0.22,
          0.14 + hash(i, 9) * 0.14,
        ),
      );
    }
    const riverMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `varying vec2 vUv;varying vec3 vWorld;void main(){vUv=uv;vWorld=(modelMatrix*vec4(position,1)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1);}`,
      fragmentShader:
        `varying vec2 vUv;varying vec3 vWorld;uniform float time;void main(){float streak=sin(vUv.y*65.-time*3.+sin(vUv.x*30.))*sin(vUv.x*18.+time);vec3 col=mix(vec3(.07,.20,.22),vec3(.40,.55,.48),smoothstep(.35,.92,streak)*.28+pow(abs(vUv.x-.5)*2.,4.)*.14);gl_FragColor=vec4(col,.90);#include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(
          ";#include",
          ";\n#include",
        ),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.river = new THREE.Mesh(new THREE.BufferGeometry(), riverMat);
    this.river.frustumCulled = false;
    this.river.renderOrder = 2;
    this.group.add(this.river);
    const oceanGeo = new THREE.PlaneGeometry(180, 180, 1, 1);
    oceanGeo.rotateX(-Math.PI / 2);
    const oceanMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, terrain: { value: this.heightTexture } },
      vertexShader: `varying vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1);}`,
      fragmentShader: `varying vec3 vWorld;uniform float time;uniform sampler2D terrain;${noiseGLSL}
      void main(){vec3 p=vWorld;float w=sin(p.x*1.4+time*.8+sin(p.z*1.3))*sin(p.z*1.8-time*.7);vec3 n=normalize(vec3(w*.07,1.,cos(p.z*4.+time)*.07));vec3 v=normalize(cameraPosition-p);float f=pow(1.-max(dot(n,v),0.),4.);vec3 col=mix(vec3(.016,.082,.085),vec3(.15,.26,.29),f);float sun=pow(max(dot(reflect(-v,n),normalize(vec3(-.6,.8,.3))),0.),160.);col+=vec3(.9,.8,.5)*sun*.5;
      if(abs(p.x)<9.9&&abs(p.z)<9.9){float depth=.02-texture2D(terrain,p.xz/20.+.5).r;float shallow=exp(-max(depth,0.)*7.);col=mix(col,vec3(.14,.30,.25),shallow*.6);float foam=(1.-smoothstep(.015,.075,depth+sin(time*1.3+p.x*4.+p.z*3.)*.022))*step(0.,depth);col+=vec3(.42,.49,.40)*foam*.7;}
      col=mix(col,vec3(.12,.20,.22),1.-exp(-length(cameraPosition-p)*.009));gl_FragColor=vec4(col,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    });
    this.ocean = new THREE.Mesh(oceanGeo, oceanMat);
    this.ocean.position.y = 0.02;
    this.group.add(this.ocean);
    const light = new THREE.DirectionalLight(0xffe3b3, 2.2);
    light.position.set(-8, 14, 5);
    this.group.add(light, new THREE.HemisphereLight(0xb6d3e6, 0x344020, 2));
    this.flow = new Float32Array(n * n);
    this.filled = new Float32Array(n * n);
    this.rebuild();
    this.hydrology();
  }
  private rebuild() {
    this.heightTexture.needsUpdate = true;
    const p = this.mesh.geometry.getAttribute("position");
    for (let i = 0; i < this.terrain.heights.length; i++)
      p.setY(i, this.terrain.heights[i]);
    p.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
  }
  private hydrology() {
    const n = this.terrain.n,
      { parent, flow, filled } = drainage(this.terrain.heights, n);
    this.flow = flow;
    this.filled = filled;
    const verts: number[] = [],
      uvs: number[] = [];
    for (let i = 0; i < parent.length; i++) {
      const j = parent[i];
      if (j < 0 || flow[i] < 120 || this.terrain.heights[i] < 0.015) continue;
      const x = ((i % n) / (n - 1) - 0.5) * 20,
        z = (Math.floor(i / n) / (n - 1) - 0.5) * 20,
        nx = ((j % n) / (n - 1) - 0.5) * 20,
        nz = (Math.floor(j / n) / (n - 1) - 0.5) * 20;
      const dx = nx - x,
        dz = nz - z,
        d = Math.hypot(dx, dz),
        width = clamp(Math.sqrt(flow[i]) * 0.0014, 0.013, 0.075),
        sx = (-dz / d) * width,
        sz = (dx / d) * width;
      const y = Math.max(this.terrain.heights[i], filled[i]) + 0.026,
        ny = Math.max(this.terrain.heights[j], filled[j], 0.02) + 0.026;
      verts.push(
        x - sx,
        y,
        z - sz,
        x + sx,
        y,
        z + sz,
        nx - sx,
        ny,
        nz - sz,
        x + sx,
        y,
        z + sz,
        nx + sx,
        ny,
        nz + sz,
        nx - sx,
        ny,
        nz - sz,
      );
      uvs.push(
        0,
        z + x,
        1,
        z + x,
        0,
        nz + nx,
        1,
        z + x,
        1,
        nz + nx,
        0,
        nz + nx,
      );
    }
    this.river.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    this.river.geometry = g;
    this.updateTrees();
    this.changed = false;
    this.revision++;
  }
  private updateTrees() {
    const n = this.terrain.n;
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i],
        y = this.terrain.sample(t.x, t.z);
      const slope =
        Math.hypot(
          this.terrain.sample(t.x + 0.15, t.z) - y,
          this.terrain.sample(t.x, t.z + 0.15) - y,
        ) / 0.15;
      const ix = clamp(Math.round((t.x / 20 + 0.5) * (n - 1)), 0, n - 1),
        iz = clamp(Math.round((t.z / 20 + 0.5) * (n - 1)), 0, n - 1),
        idx = iz * n + ix;
      const live =
        y > 0.2 &&
        y < 3.9 &&
        slope < 1.4 &&
        this.flow[idx] < 60 &&
        this.filled[idx] - y < 0.03;
      this.matrix.position.set(t.x, y - 0.025, t.z);
      this.matrix.rotation.y = hash(i, 3) * 6.28;
      this.matrix.scale.setScalar(live ? t.size : 0);
      this.matrix.updateMatrix();
      this.forest.setMatrixAt(i, this.matrix.matrix);
    }
    this.forest.instanceMatrix.needsUpdate = true;
  }
  update(frame: Frame) {
    if (this.terrain.deform(frame)) {
      this.rebuild();
      this.changed = true;
      this.updateTrees();
    }
    this.hydroTimer += frame.dt;
    if (this.changed && this.hydroTimer > 0.25) {
      this.hydrology();
      this.hydroTimer = 0;
    }
    this.ocean.material.uniforms.time.value = frame.time;
    (this.river.material as THREE.ShaderMaterial).uniforms.time.value =
      frame.time;
  }
  reset() {
    this.terrain.reset();
    this.rebuild();
    this.hydrology();
  }
  dispose() {
    this.heightTexture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.forest.geometry.dispose();
    (this.forest.material as THREE.Material).dispose();
    this.river.geometry.dispose();
    (this.river.material as THREE.Material).dispose();
    this.ocean.geometry.dispose();
    this.ocean.material.dispose();
  }
}
