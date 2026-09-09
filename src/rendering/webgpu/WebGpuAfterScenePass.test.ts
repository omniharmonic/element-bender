import { describe, expect, it, vi } from 'vitest';
import { WebGpuAfterScenePassRegistry } from './WebGpuAfterScenePass';

describe('WebGpuAfterScenePassRegistry', () => {
  it('renders registered passes in order and supports unregister', () => {
    const registry = new WebGpuAfterScenePassRegistry();
    const calls: string[] = [];
    const unregisterA = registry.add({
      enabled: true,
      resize: vi.fn(),
      renderAfterScene: () => calls.push('a'),
    });
    registry.add({
      enabled: true,
      resize: vi.fn(),
      renderAfterScene: () => calls.push('b'),
    });

    registry.renderAfterScene({} as never);
    unregisterA();
    registry.renderAfterScene({} as never);

    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('propagates resize to enabled passes only', () => {
    const registry = new WebGpuAfterScenePassRegistry();
    const enabledResize = vi.fn();
    const disabledResize = vi.fn();
    registry.add({ enabled: true, resize: enabledResize, renderAfterScene: vi.fn() });
    registry.add({ enabled: false, resize: disabledResize, renderAfterScene: vi.fn() });

    registry.resize(1280, 720, 2);

    expect(enabledResize).toHaveBeenCalledWith(1280, 720, 2);
    expect(disabledResize).not.toHaveBeenCalled();
  });
});
