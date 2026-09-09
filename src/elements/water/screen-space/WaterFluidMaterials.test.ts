import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBilateralBlurMaterial, createPbrCompositeMaterial } from './WaterFluidMaterials';

describe('Water fluid screen-space materials', () => {
  it('creates a depth-aware bilateral blur material with explicit reconstruction metadata', () => {
    const input = new THREE.Texture();
    const depth = new THREE.Texture();
    const material = createBilateralBlurMaterial({
      input,
      depth,
      texelSize: new THREE.Vector2(1 / 512, 1 / 256),
      direction: new THREE.Vector2(1, 0),
    });

    expect(material.type).toBe('MeshBasicNodeMaterial');
    expect(material.userData.pass).toBe('bilateral-depth-aware-blur');
    expect(material.userData.terms).toEqual(expect.arrayContaining(['depthDelta', 'gaussianKernel']));
  });

  it('creates a physically motivated water composite material', () => {
    const material = createPbrCompositeMaterial({
      thickness: new THREE.Texture(),
      depth: new THREE.Texture(),
      foam: new THREE.Texture(),
      blurredThickness: new THREE.Texture(),
    });

    expect(material.type).toBe('MeshBasicNodeMaterial');
    expect(material.userData.pass).toBe('beer-lambert-fresnel-caustic-composite');
    expect(material.userData.terms).toEqual(expect.arrayContaining(['BeerLambertAbsorption', 'Fresnel', 'caustics', 'foam']));
  });
});
