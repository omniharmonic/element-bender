import * as THREE from "three";
import { fullscreenVertex } from "./core";

/** Rasterize a 128³ density volume into a slice atlas, once per simulation frame. */
export class CloudField {
  readonly target = new THREE.WebGLRenderTarget(2048, 1024, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  readonly min = new THREE.Vector3(-11, -0.5, -6);
  readonly max = new THREE.Vector3(11, 10, 6);
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private material: THREE.ShaderMaterial;
  private lastTime = -1;
  constructor(
    private centers: THREE.Vector4[],
    noise: THREE.Data3DTexture,
  ) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        clouds: { value: centers },
        boundsMin: { value: this.min },
        boundsMax: { value: this.max },
        shapeNoise: { value: noise },
        time: { value: 0 },
        wind: { value: 0 },
      },
      fragmentShader: `
      precision highp float; varying vec2 vUv;
      uniform vec3 boundsMin,boundsMax;uniform highp sampler3D shapeNoise;uniform vec4 clouds[24];uniform float time,wind;
      void main(){
        vec2 pixel=floor(gl_FragCoord.xy);vec2 tile=floor(pixel/128.);float slice=tile.x+tile.y*16.;
        vec3 coord=vec3(mod(pixel,128.),slice)/127.;
        vec3 p=boundsMin+coord*(boundsMax-boundsMin);
        float field=-20.;
        for(int i=0;i<24;i++){
          vec3 q=(p-clouds[i].xyz)/vec3(1.15,.92,1.);
          float f=clouds[i].w-length(q);float blend=max(0.,.28-abs(field-f))/.28;
          field=max(field,f)+blend*blend*.07;
        }
        if(field<-.42){gl_FragColor=vec4(0);return;}
        vec3 q=p*.2+vec3(time*.0025,0.,wind*.003),cells=texture(shapeNoise,q).rgb;
        float billow=dot(cells,vec3(.62,.27,.11));
        float density=smoothstep(-.03,.20,field+(billow-.48)*1.25-(texture(shapeNoise,q*3.7).b-.4)*.16)*1.65;
        gl_FragColor=vec4(density,0,0,1);
      }`,
    });
    this.scene.add(
      new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material),
    );
  }
  render(renderer: THREE.WebGLRenderer, time: number, wind: number) {
    if (time === this.lastTime) return;
    this.lastTime = time;
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    for (const p of this.centers) {
      this.min.x = Math.min(this.min.x, p.x - p.w * 1.15 - 0.55);
      this.max.x = Math.max(this.max.x, p.x + p.w * 1.15 + 0.55);
      this.min.y = Math.min(this.min.y, p.y - p.w * 0.92 - 0.55);
      this.max.y = Math.max(this.max.y, p.y + p.w * 0.92 + 0.55);
      this.min.z = Math.min(this.min.z, p.z - p.w - 0.55);
      this.max.z = Math.max(this.max.z, p.z + p.w + 0.55);
    }
    this.material.uniforms.time.value = time;
    this.material.uniforms.wind.value = wind;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previous);
  }
  invalidate() {
    this.lastTime = -1;
  }
  dispose() {
    this.target.dispose();
    this.material.dispose();
    (this.scene.children[0] as THREE.Mesh).geometry.dispose();
  }
}
