import * as THREE from "three";
import { fullscreenVertex, noiseGLSL, type Frame } from "./core";

/** Semi-Lagrangian advection, buoyancy, vorticity confinement and a pressure projection. */
export class FireField {
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private pressure: THREE.WebGLRenderTarget;
  private pressureNext: THREE.WebGLRenderTarget;
  private divergence: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private quad: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  constructor(private renderer: THREE.WebGLRenderer) {
    const rt = () =>
      new THREE.WebGLRenderTarget(192, 288, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
      });
    this.a = rt();
    this.b = rt();
    this.pressure = rt();
    this.pressureNext = rt();
    this.divergence = rt();
    this.material = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        field: { value: this.a.texture },
        pressure: { value: this.pressure.texture },
        divergence: { value: this.divergence.texture },
        texel: { value: new THREE.Vector2(1 / 192, 1 / 288) },
        dt: { value: 1 / 60 },
        time: { value: 0 },
        pass: { value: 0 },
        hands: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        motion: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        power: { value: 1 },
      },
      fragmentShader: `
      precision highp float; varying vec2 vUv;
      uniform sampler2D field,pressure,divergence;uniform vec2 texel;uniform float dt,time,power;uniform int pass;uniform vec4 hands[2],motion[2];
      ${noiseGLSL}
      vec4 sampleF(vec2 uv){return texture2D(field,clamp(uv,texel,1.-texel));}
      float curlAt(vec2 p){return (sampleF(p+vec2(texel.x,0)).y-sampleF(p-vec2(texel.x,0)).y-sampleF(p+vec2(0,texel.y)).x+sampleF(p-vec2(0,texel.y)).x)*.5;}
      void main(){
        vec2 uv=vUv;vec4 f=sampleF(uv);
        if(pass==0){
          vec2 back=uv-f.xy*dt*.12;f=sampleF(back);f.xy*=exp(-dt*.22);f.z*=exp(-dt*.95);f.w*=exp(-dt*.30);
          f.y+=dt*(f.z*4.5-f.w*.22);
          float c=curlAt(uv);vec2 grad=vec2(abs(curlAt(uv+vec2(texel.x,0)))-abs(curlAt(uv-vec2(texel.x,0))),abs(curlAt(uv+vec2(0,texel.y)))-abs(curlAt(uv-vec2(0,texel.y))));
          grad/=length(grad)+.0001;f.xy+=vec2(grad.y,-grad.x)*c*dt*18.;
          float source=exp(-pow((uv.x-.5)/.10,2.)-pow((uv.y-.08)/.031,2.));
          float flicker=.65+.65*noise(vec3(uv.x*38.,time*3.,0.));
          f.z+=source*dt*12.*flicker;f.w+=source*dt*3.;f.x+=source*sin(time*4.+uv.x*28.)*dt*2.;
          for(int i=0;i<2;i++){
            vec4 h=hands[i];vec2 d=uv-h.xy;float r=exp(-dot(d,d)/.018)*h.z;vec2 radial=d/(length(d)+.012);
            vec2 force=motion[i].xy*1.5;
            if(h.w==1.){force-=radial*4.;f.z+=r*dt*3.;}
            if(h.w==2.)force+=radial*9.;
            if(h.w==3.)force+=vec2(-radial.y,radial.x)*9.;
            if(h.w==4.){force.y+=9.;f.z+=r*dt*5.;}
            if(h.w==5.){f.z*=exp(-r*dt*9.);force.y-=5.;}
            f.xy+=force*r*dt*power*3.;
          }
          f.xy=clamp(f.xy,vec2(-15),vec2(15));f.zw=clamp(f.zw,vec2(0),vec2(3));
          if(uv.x<texel.x*2.||uv.x>1.-texel.x*2.||uv.y<texel.y)f.xy*=0.;
          gl_FragColor=f;
        }else if(pass==1){
          float div=(sampleF(uv+vec2(texel.x,0)).x-sampleF(uv-vec2(texel.x,0)).x+sampleF(uv+vec2(0,texel.y)).y-sampleF(uv-vec2(0,texel.y)).y)*.5;
          gl_FragColor=vec4(div,0,0,1);
        }else if(pass==2){
          float p=(texture2D(pressure,uv+vec2(texel.x,0)).x+texture2D(pressure,uv-vec2(texel.x,0)).x+texture2D(pressure,uv+vec2(0,texel.y)).x+texture2D(pressure,uv-vec2(0,texel.y)).x-texture2D(divergence,uv).x)*.25;
          gl_FragColor=vec4(p,0,0,1);
        }else{
          f.xy-=.5*vec2(texture2D(pressure,uv+vec2(texel.x,0)).x-texture2D(pressure,uv-vec2(texel.x,0)).x,texture2D(pressure,uv+vec2(0,texel.y)).x-texture2D(pressure,uv-vec2(0,texel.y)).x);
          gl_FragColor=f;
        }
      }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);
    this.reset();
  }
  get texture() {
    return this.a.texture;
  }
  private render(pass: number, target: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    u.pass.value = pass;
    // WebGL considers every bound sampler, even in inactive uniform branches.
    const detached: string[] = [];
    for (const name of ["field", "pressure", "divergence"])
      if (u[name].value === target.texture) {
        u[name].value = null;
        detached.push(name);
      }
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    for (const name of detached) u[name].value = target.texture;
  }
  reset() {
    const old = this.renderer.getRenderTarget();
    for (const t of [
      this.a,
      this.b,
      this.pressure,
      this.pressureNext,
      this.divergence,
    ]) {
      this.renderer.setRenderTarget(t);
      this.renderer.clearColor();
    }
    this.renderer.setRenderTarget(old);
  }
  update(frame: Frame) {
    const u = this.material.uniforms;
    u.dt.value = frame.dt;
    u.time.value = frame.time;
    u.power.value = frame.power;
    const actions = ["flow", "gather", "push", "swirl", "lift", "calm"];
    for (let i = 0; i < 2; i++) {
      const h = frame.hands[i];
      u.hands.value[i].set(
        h ? h.position.x / 10 + 0.5 : 0,
        h ? h.position.y / 8 : 0,
        h ? 1 : 0,
        h ? actions.indexOf(h.action) : 0,
      );
      u.motion.value[i].set(h ? h.velocity.x : 0, h ? h.velocity.y : 0, 0, 0);
    }
    u.field.value = this.a.texture;
    this.render(0, this.b);
    [this.a, this.b] = [this.b, this.a];
    u.field.value = this.a.texture;
    this.render(1, this.divergence);
    for (let i = 0; i < 12; i++) {
      u.pressure.value = this.pressure.texture;
      this.render(2, this.pressureNext);
      [this.pressure, this.pressureNext] = [this.pressureNext, this.pressure];
    }
    u.pressure.value = this.pressure.texture;
    this.render(3, this.b);
    [this.a, this.b] = [this.b, this.a];
    this.renderer.setRenderTarget(null);
  }
  dispose() {
    for (const t of [
      this.a,
      this.b,
      this.pressure,
      this.pressureNext,
      this.divergence,
    ])
      t.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
