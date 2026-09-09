import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, color, float, mix, screenUV, smoothstep, texture, vec2 } from 'three/tsl';

export interface BilateralBlurMaterialOptions {
  input: THREE.Texture;
  depth: THREE.Texture;
  texelSize: THREE.Vector2;
  direction: THREE.Vector2;
}

export interface PbrCompositeMaterialOptions {
  thickness: THREE.Texture;
  depth: THREE.Texture;
  foam: THREE.Texture;
  blurredThickness: THREE.Texture;
}

export function createBilateralBlurMaterial(options: BilateralBlurMaterialOptions): MeshBasicNodeMaterial {
  const material = createFullscreenNodeMaterial();
  const step = vec2(
    options.texelSize.x * options.direction.x,
    options.texelSize.y * options.direction.y
  );

  material.colorNode = Fn(() => {
    const px = screenUV;
    const centerDepth = texture(options.depth, px).r;
    const accum = texture(options.input, px).mul(float(0.227027)).toVar();

    const depthWeight1 = float(1)
      .sub(texture(options.depth, px.add(step)).r.sub(centerDepth).abs().mul(float(28)))
      .max(float(0));
    const depthWeight2 = float(1)
      .sub(texture(options.depth, px.sub(step)).r.sub(centerDepth).abs().mul(float(28)))
      .max(float(0));
    const farStep = step.mul(float(2));
    const depthWeight3 = float(1)
      .sub(texture(options.depth, px.add(farStep)).r.sub(centerDepth).abs().mul(float(34)))
      .max(float(0));
    const depthWeight4 = float(1)
      .sub(texture(options.depth, px.sub(farStep)).r.sub(centerDepth).abs().mul(float(34)))
      .max(float(0));

    accum.addAssign(texture(options.input, px.add(step)).mul(float(0.316216).mul(depthWeight1)));
    accum.addAssign(texture(options.input, px.sub(step)).mul(float(0.316216).mul(depthWeight2)));
    accum.addAssign(texture(options.input, px.add(farStep)).mul(float(0.070270).mul(depthWeight3)));
    accum.addAssign(texture(options.input, px.sub(farStep)).mul(float(0.070270).mul(depthWeight4)));
    return accum;
  })();

  material.userData.pass = 'bilateral-depth-aware-blur';
  material.userData.terms = ['depthDelta', 'gaussianKernel'];
  return material;
}

export function createPbrCompositeMaterial(options: PbrCompositeMaterialOptions): MeshBasicNodeMaterial {
  const material = createFullscreenNodeMaterial();

  material.colorNode = Fn(() => {
    const px = screenUV;
    const thickness = texture(options.blurredThickness, px).r;
    const rawThickness = texture(options.thickness, px).r;
    const depth = texture(options.depth, px).r;
    const foam = texture(options.foam, px).r;
    const absorption = smoothstep(float(0.02), float(0.62), thickness);
    const fresnel = smoothstep(float(0.08), float(0.78), rawThickness);
    const caustics = px.x.mul(float(72)).add(px.y.mul(float(113))).sin().mul(float(0.5)).add(float(0.5));
    const deepWater = color(0x062a3c);
    const shallowWater = color(0x8ff7ff);
    const glint = color(0xeaffff);
    const absorbed = mix(shallowWater, deepWater, absorption.add(depth.mul(float(0.18))).min(float(1)));
    const lit = absorbed.add(glint.mul(fresnel.mul(float(0.28)).add(caustics.mul(float(0.045)))));
    return mix(lit, glint, smoothstep(float(0.06), float(0.34), foam));
  })();
  (material as any).opacityNode = Fn(() => {
    const px = screenUV;
    const thickness = texture(options.blurredThickness, px).r;
    const foam = texture(options.foam, px).r;
    return smoothstep(float(0.015), float(0.32), thickness).mul(float(0.62)).add(foam.mul(float(0.22))).min(float(0.88));
  })();

  material.userData.pass = 'beer-lambert-fresnel-caustic-composite';
  material.userData.terms = ['BeerLambertAbsorption', 'Fresnel', 'caustics', 'foam'];
  return material;
}

export function createTextureOverlayMaterial(textureMap: THREE.Texture, opacity: number): MeshBasicNodeMaterial {
  const material = createFullscreenNodeMaterial();
  material.colorNode = texture(textureMap, screenUV);
  (material as any).opacityNode = float(opacity);
  material.userData.pass = 'screen-texture-overlay';
  return material;
}

function createFullscreenNodeMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;
  material.depthTest = false;
  material.depthWrite = false;
  return material;
}
