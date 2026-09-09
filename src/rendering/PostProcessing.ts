import * as THREE from 'three';

// Simple bloom implementation without additional dependencies
// Uses multi-pass rendering with blur

export class PostProcessing {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  // Render targets for ping-pong blur
  private renderTargetA: THREE.WebGLRenderTarget;
  private renderTargetB: THREE.WebGLRenderTarget;
  private renderTargetBright: THREE.WebGLRenderTarget;

  // Full-screen quad for post-processing
  private quadGeometry: THREE.PlaneGeometry;
  private quadMesh: THREE.Mesh;
  private postScene: THREE.Scene;
  private postCamera: THREE.OrthographicCamera;

  // Shaders
  private brightPassMaterial: THREE.ShaderMaterial;
  private blurMaterialH: THREE.ShaderMaterial;
  private blurMaterialV: THREE.ShaderMaterial;
  private compositeMaterial: THREE.ShaderMaterial;

  private enabled = true;
  private bloomStrength = 1.0;
  private bloomThreshold = 0.6;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const width = window.innerWidth;
    const height = window.innerHeight;

    // Create render targets (half resolution for blur)
    const rtParams = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    };

    this.renderTargetA = new THREE.WebGLRenderTarget(width, height, rtParams);
    this.renderTargetB = new THREE.WebGLRenderTarget(width / 2, height / 2, rtParams);
    this.renderTargetBright = new THREE.WebGLRenderTarget(width / 2, height / 2, rtParams);

    // Setup post-processing scene
    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeometry = new THREE.PlaneGeometry(2, 2);

    // Create shader materials
    this.brightPassMaterial = this.createBrightPassMaterial();
    this.blurMaterialH = this.createBlurMaterial('horizontal');
    this.blurMaterialV = this.createBlurMaterial('vertical');
    this.compositeMaterial = this.createCompositeMaterial();

    this.quadMesh = new THREE.Mesh(this.quadGeometry, this.compositeMaterial);
    this.postScene.add(this.quadMesh);
  }

  private createBrightPassMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        threshold: { value: this.bloomThreshold },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float threshold;
        varying vec2 vUv;

        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
          if (brightness > threshold) {
            gl_FragColor = color * (brightness - threshold) / (1.0 - threshold);
          } else {
            gl_FragColor = vec4(0.0);
          }
        }
      `,
    });
  }

  private createBlurMaterial(direction: 'horizontal' | 'vertical'): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2() },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        varying vec2 vUv;

        void main() {
          vec2 texelSize = 1.0 / resolution;
          vec3 result = vec3(0.0);

          // 9-tap Gaussian blur
          float weights[5];
          weights[0] = 0.227027;
          weights[1] = 0.1945946;
          weights[2] = 0.1216216;
          weights[3] = 0.054054;
          weights[4] = 0.016216;

          result += texture2D(tDiffuse, vUv).rgb * weights[0];

          ${direction === 'horizontal' ? `
          for (int i = 1; i < 5; i++) {
            result += texture2D(tDiffuse, vUv + vec2(texelSize.x * float(i) * 2.0, 0.0)).rgb * weights[i];
            result += texture2D(tDiffuse, vUv - vec2(texelSize.x * float(i) * 2.0, 0.0)).rgb * weights[i];
          }
          ` : `
          for (int i = 1; i < 5; i++) {
            result += texture2D(tDiffuse, vUv + vec2(0.0, texelSize.y * float(i) * 2.0)).rgb * weights[i];
            result += texture2D(tDiffuse, vUv - vec2(0.0, texelSize.y * float(i) * 2.0)).rgb * weights[i];
          }
          `}

          gl_FragColor = vec4(result, 1.0);
        }
      `,
    });
  }

  private createCompositeMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        bloomStrength: { value: this.bloomStrength },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tBloom;
        uniform float bloomStrength;
        varying vec2 vUv;

        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          vec4 bloom = texture2D(tBloom, vUv);
          gl_FragColor = color + bloom * bloomStrength;
        }
      `,
    });
  }

  setBloomStrength(strength: number): void {
    this.bloomStrength = strength;
    this.compositeMaterial.uniforms.bloomStrength.value = strength;
  }

  setBloomThreshold(threshold: number): void {
    this.bloomThreshold = threshold;
    this.brightPassMaterial.uniforms.threshold.value = threshold;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  resize(width: number, height: number): void {
    this.renderTargetA.setSize(width, height);
    this.renderTargetB.setSize(width / 2, height / 2);
    this.renderTargetBright.setSize(width / 2, height / 2);
  }

  render(): void {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const width = this.renderTargetB.width;
    const height = this.renderTargetB.height;

    // 1. Render scene to target A
    this.renderer.setRenderTarget(this.renderTargetA);
    this.renderer.render(this.scene, this.camera);

    // 2. Extract bright areas
    this.quadMesh.material = this.brightPassMaterial;
    this.brightPassMaterial.uniforms.tDiffuse.value = this.renderTargetA.texture;
    this.renderer.setRenderTarget(this.renderTargetBright);
    this.renderer.render(this.postScene, this.postCamera);

    // 3. Horizontal blur
    this.quadMesh.material = this.blurMaterialH;
    this.blurMaterialH.uniforms.tDiffuse.value = this.renderTargetBright.texture;
    this.blurMaterialH.uniforms.resolution.value.set(width, height);
    this.renderer.setRenderTarget(this.renderTargetB);
    this.renderer.render(this.postScene, this.postCamera);

    // 4. Vertical blur
    this.quadMesh.material = this.blurMaterialV;
    this.blurMaterialV.uniforms.tDiffuse.value = this.renderTargetB.texture;
    this.blurMaterialV.uniforms.resolution.value.set(width, height);
    this.renderer.setRenderTarget(this.renderTargetBright);
    this.renderer.render(this.postScene, this.postCamera);

    // 5. Composite original + bloom
    this.quadMesh.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.tDiffuse.value = this.renderTargetA.texture;
    this.compositeMaterial.uniforms.tBloom.value = this.renderTargetBright.texture;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }

  dispose(): void {
    this.renderTargetA.dispose();
    this.renderTargetB.dispose();
    this.renderTargetBright.dispose();
    this.quadGeometry.dispose();
    this.brightPassMaterial.dispose();
    this.blurMaterialH.dispose();
    this.blurMaterialV.dispose();
    this.compositeMaterial.dispose();
  }
}
