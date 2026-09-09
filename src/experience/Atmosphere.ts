import * as THREE from "three";
import { CloudField } from "./CloudField";
import { createCloudNoise } from "./CloudNoise";
import {
  fullscreenVertex,
  noiseGLSL,
  type Element,
  type Frame,
  clamp,
} from "./core";

export class Atmosphere {
  scene = new THREE.Scene();
  camera = new THREE.Camera();
  material: THREE.ShaderMaterial;
  private centers = Array.from({ length: 24 }, () => new THREE.Vector4());
  private origins = Array.from({ length: 24 }, () => new THREE.Vector3());
  private velocities = Array.from({ length: 24 }, () => new THREE.Vector3());
  private wind = 0;
  private noiseTexture = createCloudNoise();
  private field = new CloudField(this.centers, this.noiseTexture);
  constructor() {
    this.reset();
    this.material = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        inverseProjection: { value: new THREE.Matrix4() },
        cameraWorld: { value: new THREE.Matrix4() },
        time: { value: 0 },
        mode: { value: 0 },
        clouds: { value: this.centers },
        fire: { value: null },
        sunset: { value: 0.65 },
        wind: { value: 0 },
        densityAtlas: { value: this.field.target.texture },
        volumeMin: { value: this.field.min },
        volumeMax: { value: this.field.max },
      },
      fragmentShader: `
      precision highp float; varying vec2 vUv;
      uniform vec3 volumeMin,volumeMax;uniform sampler2D densityAtlas;uniform mat4 inverseProjection,cameraWorld;uniform float time,sunset,wind;uniform int mode;uniform vec4 clouds[24];uniform sampler2D fire;
      ${noiseGLSL}
      vec3 sunDir(){return normalize(vec3(-.72,.38+sunset*.15,.48));}
      vec3 sky(vec3 rd){
        float h=max(rd.y,0.);float sun=max(dot(rd,normalize(vec3(-.55,.07,-.83))),0.);
        vec3 col=mix(vec3(.44,.16,.075),vec3(.042,.095,.19),pow(h,.4));
        col=mix(col,vec3(.12,.21,.34),smoothstep(.0,.8,sunset)*.20);
        col+=vec3(1.,.52,.22)*pow(sun,12.)*.32;
        col+=vec3(.45,.19,.055)*pow(sun,90.)*.4;
        col=mix(vec3(.085,.10,.155),col,smoothstep(-.26,.02,rd.y));
        if(mode==1){col=mix(vec3(.055,.10,.15),vec3(.008,.025,.065),pow(max(rd.y,0.),.45));col+=vec3(.68,.87,.94)*pow(max(dot(rd,normalize(vec3(-.5,.4,-.7))),0.),480.)*.8;}
        if(mode==2){col=mix(vec3(.65,.72,.66),vec3(.25,.44,.55),pow(h,.5));col+=vec3(.75,.62,.37)*pow(sun,60.)*.4;}
        if(mode==3)col=vec3(.009,.012,.017)+vec3(.035,.012,.004)*pow(max(0.,1.-abs(rd.y)),10.);
        return col;
      }
      float cloudDensity(vec3 p){
        vec3 coord=(p-volumeMin)/(volumeMax-volumeMin);
        if(any(lessThan(coord,vec3(0)))||any(greaterThan(coord,vec3(1))))return 0.;
        vec3 grid=coord*127.;float z=floor(grid.z),z1=min(z+1.,127.);
        vec2 tile=vec2(mod(z,16.),floor(z/16.)),tile1=vec2(mod(z1,16.),floor(z1/16.));
        vec2 uv=(tile*128.+grid.xy+.5)/vec2(2048.,1024.);
        vec2 uv1=(tile1*128.+grid.xy+.5)/vec2(2048.,1024.);
        return mix(texture2D(densityAtlas,uv).r,texture2D(densityAtlas,uv1).r,fract(grid.z));
      }

      vec2 box(vec3 ro,vec3 rd,vec3 lo,vec3 hi){vec3 a=(lo-ro)/rd,b=(hi-ro)/rd;vec3 mn=min(a,b),mx=max(a,b);return vec2(max(max(mn.x,mn.y),mn.z),min(min(mx.x,mx.y),mx.z));}
      vec3 renderCloud(vec3 ro,vec3 rd,vec3 background){
        vec2 hit=box(ro,rd,volumeMin,volumeMax);if(hit.x>hit.y||hit.y<0.)return background;
        float stepSize=(hit.y-max(hit.x,0.))/128.;float t=max(hit.x,0.)+hash(vec3(gl_FragCoord.xy,0.))*stepSize;
        vec3 color=vec3(0);float trans=1.;
        for(int i=0;i<128;i++){
          vec3 p=ro+rd*t;float d=cloudDensity(p);
          if(d>.004){
            float optical=cloudDensity(p+sunDir()*.38)*.38+cloudDensity(p+sunDir()*.95)*.65+cloudDensity(p+sunDir()*1.95)*1.1;
            float direct=exp(-optical*2.8)+exp(-optical*.6)*.10;
            float forward=pow(max(dot(rd,sunDir()),0.),8.);
            vec3 shade=vec3(.055,.085,.145)*(.65+exp(-d*.7)*.3)+vec3(1.08,.59,.30)*(direct*(.65+forward*.7));
            shade+=vec3(.15,.19,.27)*clamp((p.y-1.)*.08,0.,.3);
            float alpha=1.-exp(-d*stepSize*1.8);color+=trans*shade*alpha;trans*=1.-alpha;
            if(trans<.015)break;
          }
          t+=stepSize;
        }
        return color+background*trans;
      }
      vec3 renderFire(vec3 ro,vec3 rd,vec3 background){
        vec2 hit=box(ro,rd,vec3(-5,0,-1.5),vec3(5,8,1.5));if(hit.x>hit.y||hit.y<0.)return background;
        float stepSize=(hit.y-max(hit.x,0.))/56.;float t=max(hit.x,0.)+hash(vec3(gl_FragCoord.xy,0.))*stepSize;
        vec3 color=vec3(0);float trans=1.;
        for(int i=0;i<56;i++){
          vec3 p=ro+rd*t;vec3 q=p+vec3(0.,-time*1.1,0.);
          float turbulence=fbm(q*3.1);vec2 uv=vec2(p.x/10.+.5,p.y/8.);
          uv.x+=(turbulence-.5)*.034;
          vec4 f=texture2D(fire,uv);float section=exp(-p.z*p.z*(2.5+turbulence*2.));
          float heat=max(0.,f.z*section-(1.-turbulence)*.28);
          float smoke=f.w*section*.8;
          float alpha=1.-exp(-(heat*2.+smoke)*stepSize*2.);
          vec3 emission=vec3(1.2,.05,.001)*smoothstep(.025,.24,heat);
          emission=mix(emission,vec3(3.3,.72,.018),smoothstep(.15,.7,heat));
          emission=mix(emission,vec3(5.,2.8,.7),smoothstep(.6,1.65,heat));
          vec3 smokeColor=vec3(.08,.065,.065)+vec3(.25,.058,.005)*f.z;
          color+=trans*(emission*heat*stepSize*1.5+smokeColor*alpha*.35);trans*=1.-alpha;
          if(trans<.008)break;t+=stepSize;
        }
        return color+background*trans;
      }
      void main(){
        vec4 ray=inverseProjection*vec4(vUv*2.-1.,1.,1.);vec3 rd=normalize((cameraWorld*vec4(ray.xyz/ray.w,0.)).xyz);vec3 ro=cameraWorld[3].xyz;
        vec3 col=sky(rd);
        // Distant atmospheric banks: a second scale makes the hero cloud belong to a world.
        if(mode==0){
          float horizon=exp(-pow((rd.y+.025)*13.,2.));float n=fbm(vec3(rd.x*24.,rd.y*54.,5.));
          col=mix(col,vec3(.20,.12,.14),horizon*smoothstep(.39,.7,n)*.55);
          col=renderCloud(ro,rd,col);
        }
        if(mode==3){
          if(rd.y<0.){float t=-ro.y/rd.y;vec3 p=ro+rd*t;float n=fbm(p*2.);col=mix(vec3(.011,.012,.013)*(n*.8+.3)+vec3(.28,.052,.008)*exp(-length(p.xz)*.85)*(n+.2),col,1.-exp(-t*.04));}
          col=renderFire(ro,rd,col);
          float glow=exp(-pow(length((vUv-vec2(.5,.31))*vec2(1.,1.3))*3.1,2.));col+=vec3(.085,.009,.001)*glow;
        }
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }
  prepare(renderer: THREE.WebGLRenderer, time: number) {
    this.field.render(renderer, time, this.wind);
  }
  reset() {
    this.field.invalidate();
    for (let i = 0; i < 24; i++) {
      const a = i * 2.39996,
        r = Math.sqrt(i / 24) * 3.5;
      const p = this.origins[i];
      p.set(
        Math.cos(a) * r,
        2.9 + Math.sin(i * 2.4) * 0.75 + (i < 8 ? 1.15 : 0),
        Math.sin(a) * r * 0.55,
      );
      this.centers[i].set(p.x, p.y, p.z, 0.78 + (i % 4) * 0.14);
      this.velocities[i].set(0, 0, 0);
    }
    this.wind = 0;
  }
  update(
    frame: Frame,
    camera: THREE.PerspectiveCamera,
    element: Element,
    fire?: THREE.Texture,
  ) {
    const u = this.material.uniforms;
    u.inverseProjection.value.copy(camera.projectionMatrixInverse);
    u.cameraWorld.value.copy(camera.matrixWorld);
    u.time.value = frame.time;
    u.mode.value = ["air", "water", "earth", "fire"].indexOf(element);
    if (fire) u.fire.value = fire;
    if (element !== "air") return;
    this.wind += frame.dt * 0.12;
    u.wind.value = this.wind;
    for (let i = 0; i < 24; i++) {
      const p = this.centers[i],
        v = this.velocities[i],
        o = this.origins[i];
      v.x +=
        (Math.sin(frame.time * 0.19 + i) * 0.08 + (o.x - p.x) * 0.11) *
        frame.dt;
      v.y +=
        (Math.cos(frame.time * 0.23 + i) * 0.045 + (o.y - p.y) * 0.12) *
        frame.dt;
      v.z += (o.z - p.z) * frame.dt * 0.12;
      let targetRadius = 0.78 + (i % 4) * 0.14;
      for (const h of frame.hands) {
        const dx = p.x - h.position.x,
          dy = p.y - h.position.y,
          dz = p.z - h.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.1,
          fall = Math.exp((-dist * dist) / (frame.radius * frame.radius * 4));
        const force = frame.dt * frame.power * fall;
        v.x += h.velocity.x * force * 1.8;
        v.y += h.velocity.y * force * 1.8;
        if (h.action === "gather") {
          v.x -= dx * force * 4;
          v.y -= dy * force * 4;
          v.z -= dz * force * 4;
          targetRadius *= 0.78;
        }
        if (h.action === "push") {
          v.x += (dx / dist) * force * 8;
          v.y += (dy / dist) * force * 8;
          v.z += (dz / dist) * force * 5;
          targetRadius *= 1.12;
        }
        if (h.action === "swirl") {
          v.x += (-dy * 3 - dx * 0.4) * force;
          v.y += (dx * 3 - dy * 0.4) * force;
          v.z -= dz * force;
        }
        if (h.action === "lift") v.y += force * 7;
        if (h.action === "calm") {
          v.multiplyScalar(Math.exp(-force * 3));
          v.y -= force * 3;
        }
      }
      v.multiplyScalar(Math.exp(-frame.dt * 0.85));
      v.clampLength(0, 6);
      p.x = clamp(p.x + v.x * frame.dt, -8, 8);
      p.y = clamp(p.y + v.y * frame.dt, 0.1, 8);
      p.z = clamp(p.z + v.z * frame.dt, -4, 4);
      p.w += (targetRadius - p.w) * frame.dt * 2;
    }
  }
  dispose() {
    this.field.dispose();
    this.noiseTexture.dispose();
    this.material.dispose();
    for (const o of this.scene.children) (o as THREE.Mesh).geometry.dispose();
  }
}
