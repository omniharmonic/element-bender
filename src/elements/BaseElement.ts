import * as THREE from 'three';
import { GestureState } from '../gestures/GestureState';
import { InfluenceField } from '../gestures/InfluenceField';
import type { RenderContext } from '../rendering/RenderContext';

export type ElementType = 'fire' | 'water' | 'air' | 'earth';

export abstract class BaseElement {
  protected context: RenderContext;
  protected scene: THREE.Scene;
  protected camera: THREE.PerspectiveCamera;
  protected influenceField: InfluenceField;
  protected active = false;

  constructor(context: RenderContext) {
    this.context = context;
    this.scene = context.scene;
    this.camera = context.camera;
    this.influenceField = new InfluenceField();
  }

  abstract init(): Promise<void>;
  abstract update(deltaTime: number, gestures: GestureState): void;
  abstract dispose(): void;

  activate(): void {
    this.active = true;
  }

  deactivate(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  updateInfluence(gestures: GestureState): void {
    this.influenceField.updateFromGestures(gestures);
  }
}
