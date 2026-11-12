import type { Elements, Vec3 } from "./types";

// Classical elements are a derived view; singular/parabolic states remain valid vectors.
export function elementsFromState(
  r: Vec3,
  v: Vec3,
  mu: number,
): Elements | null {
  const dot = (a: Vec3, b: Vec3) => a.reduce((s, x, i) => s + x * b[i], 0);
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const length = Math.hypot(...r),
    speed = Math.hypot(...v);
  if (!length || !speed || !(mu > 0)) return null;
  const h = cross(r, v),
    hl = Math.hypot(...h);
  if (hl <= length * speed * 1e-12) return null;
  const normal = h.map((x) => x / hl) as Vec3;
  const ev = cross(v, h).map((x, i) => x / mu - r[i] / length) as Vec3;
  const e = Math.hypot(...ev),
    inverseA = 2 / length - (speed * speed) / mu;
  if (Math.abs(1 - e) <= 1e-8 || !inverseA) return null;
  const node: Vec3 = [-h[1], h[0], 0],
    nl = Math.hypot(...node);
  const reference: Vec3 =
    nl > hl * 1e-12 ? (node.map((x) => x / nl) as Vec3) : [1, 0, 0];
  const periapsis = e > 1e-10 ? (ev.map((x) => x / e) as Vec3) : reference;
  const degrees = (x: number) => ((((x * 180) / Math.PI) % 360) + 360) % 360;
  const angle = (a: Vec3, b: Vec3) =>
    degrees(Math.atan2(dot(cross(a, b), normal), dot(a, b)));
  const result = {
    a: 1 / inverseA,
    e,
    i: (Math.acos(Math.max(-1, Math.min(1, normal[2]))) * 180) / Math.PI,
    raan: nl > hl * 1e-12 ? degrees(Math.atan2(node[1], node[0])) : 0,
    arg_periapsis: e > 1e-10 ? angle(reference, periapsis) : 0,
    true_anomaly: angle(periapsis, r),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}
