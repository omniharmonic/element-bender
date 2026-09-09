import { describe, expect, it } from "vitest";
import { Vector2, Vector3 } from "three";
import { Terrain, drainage } from "./Earth";
import { Liquid } from "./Water";
import { EmbodiedGestures } from "./Gestures";
import type { Frame, Hand } from "./core";
const frame = (hands: Hand[] = []): Frame => ({
  dt: 1 / 60,
  time: 0,
  hands,
  power: 1,
  radius: 1.8,
});
const hand = (action: Hand["action"], x = 0, y = 0, z = 0): Hand => ({
  action,
  position: new Vector3(x, y, z),
  velocity: new Vector3(),
  screen: new Vector2(),
  strength: 1,
});

describe("living watershed", () => {
  it("routes every interior cell to an edge without cycles, even inside a closed depression", () => {
    const n = 9,
      h = new Float32Array(n * n).fill(4);
    for (let y = 2; y < 7; y++) for (let x = 2; x < 7; x++) h[y * n + x] = 1;
    const { parent, flow, filled } = drainage(h, n);
    for (let i = 0; i < h.length; i++) {
      const visited = new Set<number>();
      let at = i;
      while (parent[at] >= 0) {
        expect(visited.has(at)).toBe(false);
        visited.add(at);
        expect(filled[parent[at]]).toBeLessThanOrEqual(filled[at]);
        at = parent[at];
      }
      expect(
        at % n === 0 || at % n === n - 1 || at < n || at >= n * (n - 1),
      ).toBe(true);
    }
    let rain = 0;
    for (let i = 0; i < h.length; i++) if (parent[i] < 0) rain += flow[i];
    expect(rain).toBe(n * n);
  });
  it("raising a barrier changes drainage and terrain persists after forces stop", () => {
    const t = new Terrain(41),
      before = t.heights.slice();
    const initial = drainage(t.heights, t.n).parent;
    for (let i = 0; i < 180; i++) t.deform(frame([hand("lift", 0, 0, 0)]));
    expect(t.sample(0, 0)).toBeGreaterThan(before[20 * 41 + 20] + 1);
    const sculpted = t.heights.slice();
    t.deform(frame());
    expect(t.heights).toEqual(sculpted);
    const after = drainage(t.heights, t.n).parent;
    expect(after.some((value, i) => value !== initial[i])).toBe(true);
    t.reset();
    expect(t.heights).toEqual(before);
  });
  it("lowering land has the opposite effect and never writes beyond safe elevation bounds", () => {
    const t = new Terrain(31),
      before = t.sample(0, 0);
    for (let i = 0; i < 300; i++) t.deform(frame([hand("push")]));
    expect(t.sample(0, 0)).toBeLessThan(before);
    expect(Math.min(...t.heights)).toBeGreaterThanOrEqual(-1.801);
  });
});

describe("cohesive water", () => {
  it("preserves particle count, falls under gravity, and stays finite through collisions", () => {
    const l = new Liquid(160);
    const initial =
      l.positions.filter((_, i) => i % 3 === 1).reduce((a, b) => a + b, 0) /
      160;
    for (let i = 0; i < 180; i++) l.step(1 / 90, frame());
    expect(l.positions.length).toBe(480);
    expect([...l.positions, ...l.velocities].every(Number.isFinite)).toBe(true);
    const mean =
      l.positions.filter((_, i) => i % 3 === 1).reduce((a, b) => a + b, 0) /
      160;
    expect(mean).toBeLessThan(initial);
    for (let i = 0; i < 160; i++)
      expect(l.positions[i * 3 + 1]).toBeGreaterThanOrEqual(0.1799);
  });
  it("a gathering force can lift water and releasing it restores gravity", () => {
    const l = new Liquid(200);
    for (let i = 0; i < 100; i++) l.step(1 / 90, frame());
    const mean = () =>
      l.positions.filter((_, i) => i % 3 === 1).reduce((a, b) => a + b, 0) /
      200;
    const rest = mean();
    for (let i = 0; i < 240; i++)
      l.step(1 / 90, frame([hand("gather", 0, 2, 0)]));
    const lifted = mean();
    expect(lifted).toBeGreaterThan(rest + 0.5);
    for (let i = 0; i < 240; i++) l.step(1 / 90, frame());
    expect(mean()).toBeLessThan(lifted - 0.3);
  });
  it("extreme alternating gestures do not create non-finite states", () => {
    const l = new Liquid(100);
    const actions: Hand["action"][] = [
      "gather",
      "push",
      "swirl",
      "lift",
      "calm",
    ];
    for (let i = 0; i < 360; i++)
      l.step(1 / 90, {
        ...frame([
          hand(actions[Math.floor(i / 30) % 5], Math.sin(i * 0.05) * 2, 2, 0),
        ]),
        power: 2.5,
      });
    expect([...l.positions, ...l.velocities].every(Number.isFinite)).toBe(true);
  });
});

describe("camera gesture intent", () => {
  const palm = () =>
    Array.from({ length: 21 }, (_, i) => ({
      x: 0.5 + (i % 4) * 0.03,
      y: 0.7 - Math.floor(i / 4) * 0.09,
      z: 0,
    }));
  it("recognizes a pinch and gives it priority over a selected action", () => {
    const p = palm();
    p[4] = { ...p[8] };
    expect(new EmbodiedGestures().classify("Left", p, [], 0, "swirl")).toBe(
      "gather",
    );
  });
  it("retains an explicit action for an open hand", () => {
    const p = palm();
    p[4] = { x: 0.2, y: 0.3, z: 0 };
    expect(new EmbodiedGestures().classify("Left", p, [], 0, "lift")).toBe(
      "lift",
    );
  });
});
