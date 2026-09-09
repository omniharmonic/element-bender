import * as THREE from "three";
export type Element = "air" | "water" | "earth" | "fire";
export type Action = "flow" | "gather" | "push" | "swirl" | "lift" | "calm";
export interface Hand {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  screen: THREE.Vector2;
  strength: number;
  action: Action;
}
export interface Frame {
  dt: number;
  time: number;
  hands: Hand[];
  power: number;
  radius: number;
}
export const clamp = (x: number, a: number, b: number) =>
  Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function noise(x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  let u = x - ix,
    v = y - iy;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  return lerp(
    lerp(hash(ix, iy), hash(ix + 1, iy), u),
    lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u),
    v,
  );
}
export function fbm(x: number, y: number) {
  let value = 0,
    amp = 0.5;
  for (let i = 0; i < 6; i++) {
    value += amp * noise(x, y);
    x = x * 2.03 + 13.2;
    y = y * 2.03 + 9.4;
    amp *= 0.5;
  }
  return value;
}
export const fullscreenVertex = `varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}`;
export const noiseGLSL = `
float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float f=0.,a=.5;for(int i=0;i<4;i++){f+=a*noise(p);p=p*2.03+vec3(13.2,9.4,7.1);a*=.5;}return f;}
`;
