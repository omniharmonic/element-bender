import { clamp, type Action } from "./core";
export interface Landmark {
  x: number;
  y: number;
  z: number;
}
interface History {
  time: number;
  x: number;
  y: number;
  size: number;
}

/** Gesture inference keeps a short time-window; circles require both travel and signed turning. */
export class EmbodiedGestures {
  private history = new Map<string, History[]>();
  private swirlUntil = new Map<string, number>();
  classify(
    id: string,
    points: Landmark[],
    world: Landmark[],
    now: number,
    selected: Action,
  ): Action {
    if (points.length < 21) return selected;
    const dist = (a: number, b: number) =>
      Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
    const size = Math.max(0.025, dist(0, 9)),
      pinch = dist(4, 8) / size;
    const openness =
      [8, 12, 16, 20].reduce((sum, k) => sum + dist(0, k) / size, 0) / 4;
    const p = { time: now, x: points[9].x, y: points[9].y, size };
    const history = this.history.get(id) ?? [];
    history.push(p);
    while (history.length && now - history[0].time > 800) history.shift();
    this.history.set(id, history);
    if (pinch < 0.42 || openness < 1.35) return "gather";
    if (selected !== "flow") return selected;
    if (history.length >= 8) {
      let turn = 0,
        travel = 0;
      for (let i = 2; i < history.length; i++) {
        const a = history[i - 2],
          b = history[i - 1],
          c = history[i],
          ax = b.x - a.x,
          ay = b.y - a.y,
          bx = c.x - b.x,
          by = c.y - b.y;
        const al = Math.hypot(ax, ay),
          bl = Math.hypot(bx, by);
        travel += bl;
        if (al > 0.004 && bl > 0.004)
          turn += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
      }
      if (Math.abs(turn) > 2.0 && travel > 0.28)
        this.swirlUntil.set(id, now + 650);
      if ((this.swirlUntil.get(id) ?? 0) > now) return "swirl";
      const old = history[Math.max(0, history.length - 6)],
        rate = (p.size - old.size) / Math.max(0.05, (now - old.time) / 1000);
      if (rate > 0.065) return "push";
      if (rate < -0.055) return "gather";
    }
    if (world.length >= 21) {
      const a = {
        x: world[5].x - world[17].x,
        y: world[5].y - world[17].y,
        z: world[5].z - world[17].z,
      };
      const b = {
        x: world[9].x - world[0].x,
        y: world[9].y - world[0].y,
        z: world[9].z - world[0].z,
      };
      const nx = a.y * b.z - a.z * b.y,
        ny = a.z * b.x - a.x * b.z,
        nz = a.x * b.y - a.y * b.x;
      const orientation = clamp(
        (ny / (Math.hypot(nx, ny, nz) + 1e-6)) * (id === "Right" ? 1 : -1),
        -1,
        1,
      );
      if (orientation < -0.72) return "lift";
      if (orientation > 0.72) return "calm";
    }
    return "flow";
  }
  clear() {
    this.history.clear();
    this.swirlUntil.clear();
  }
}
