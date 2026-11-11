import type {
  BodyId,
  PlanetSnapshot,
  PlanetWindow,
  QuaternionArray,
  Vec3,
} from "./types";

export function hermite(
  p0: Vec3,
  v0: Vec3,
  p1: Vec3,
  v1: Vec3,
  dt: number,
  alpha: number,
): Vec3 {
  const a2 = alpha * alpha,
    a3 = a2 * alpha;
  return p0.map(
    (v, i) =>
      (2 * a3 - 3 * a2 + 1) * v +
      (a3 - 2 * a2 + alpha) * dt * v0[i] +
      (-2 * a3 + 3 * a2) * p1[i] +
      (a3 - a2) * dt * v1[i],
  ) as Vec3;
}
export function hermiteVelocity(
  p0: Vec3,
  v0: Vec3,
  p1: Vec3,
  v1: Vec3,
  dt: number,
  alpha: number,
): Vec3 {
  const a2 = alpha * alpha;
  return p0.map(
    (v, i) =>
      ((6 * a2 - 6 * alpha) * v) / dt +
      (3 * a2 - 4 * alpha + 1) * v0[i] +
      ((-6 * a2 + 6 * alpha) * p1[i]) / dt +
      (3 * a2 - 2 * alpha) * v1[i],
  ) as Vec3;
}
export function slerp(
  a: QuaternionArray,
  b: QuaternionArray,
  t: number,
): QuaternionArray {
  let dot = a.reduce((v, x, i) => v + x * b[i], 0);
  const end = dot < 0 ? (b.map((v) => -v) as QuaternionArray) : b;
  dot = Math.abs(dot);
  let q: QuaternionArray;
  if (dot > 0.9995)
    q = a.map((v, i) => v + t * (end[i] - v)) as QuaternionArray;
  else {
    const theta = Math.acos(Math.min(1, dot));
    const s = Math.sin(theta);
    q = a.map(
      (v, i) =>
        (Math.sin((1 - t) * theta) * v + Math.sin(t * theta) * end[i]) / s,
    ) as QuaternionArray;
  }
  const norm = Math.hypot(...q);
  return q.map((v) => v / norm) as QuaternionArray;
}
export function planetSnapshot(
  window: PlanetWindow | null,
  t: number,
): PlanetSnapshot | null {
  if (!window || t < window.times[0] || t > window.times.at(-1)!) return null;
  let lo = 0,
    hi = window.times.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (window.times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const right = Math.max(1, lo),
    left = right - 1,
    dt = window.times[right] - window.times[left],
    alpha = (t - window.times[left]) / dt;
  const bodies: PlanetSnapshot["bodies"] = {};
  for (const [key, body] of Object.entries(window.bodies)) {
    if (!body) continue;
    const q0 = body.orientation_quality[left],
      q1 = body.orientation_quality[right];
    bodies[key as BodyId] = {
      position: hermite(
        body.positions_km[left],
        body.velocities_km_s[left],
        body.positions_km[right],
        body.velocities_km_s[right],
        dt,
        alpha,
      ),
      velocity: hermiteVelocity(
        body.positions_km[left],
        body.velocities_km_s[left],
        body.positions_km[right],
        body.velocities_km_s[right],
        dt,
        alpha,
      ),
      quaternion: slerp(body.quaternions[left], body.quaternions[right], alpha),
      radii: body.radii_km,
      quality:
        alpha < 1e-8
          ? q0
          : alpha > 1 - 1e-8
            ? q1
            : q0 === "approximate" || q1 === "approximate"
              ? "approximate"
              : q0 === "predicted" || q1 === "predicted"
                ? "predicted"
                : q0,
    };
  }
  return {
    bodies,
    sun: hermite(
      window.sun_positions_km[left],
      window.sun_velocities_km_s[left],
      window.sun_positions_km[right],
      window.sun_velocities_km_s[right],
      dt,
      alpha,
    ),
    sunVelocity: hermiteVelocity(
      window.sun_positions_km[left],
      window.sun_velocities_km_s[left],
      window.sun_positions_km[right],
      window.sun_velocities_km_s[right],
      dt,
      alpha,
    ),
  };
}

// DE440 solar GM (km^3/s^2), matching backend.models.CENTERS['sun'].
export const SOLAR_MU = 132712440041.279419;
export function osculatingPlanetOrbit(
  position: Vec3,
  velocity: Vec3,
  sun: Vec3,
  sunVelocity: Vec3,
  count = 1024,
) {
  const r = position.map((x, i) => x - sun[i]) as Vec3;
  const v = velocity.map((x, i) => x - sunVelocity[i]) as Vec3;
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const radius = Math.hypot(...r),
    h = cross(r, v),
    hLength = Math.hypot(...h);
  if (!radius || !hLength) return [];
  const vxh = cross(v, h);
  const eccentricity = vxh.map((x, i) => x / SOLAR_MU - r[i] / radius) as Vec3;
  const e = Math.hypot(...eccentricity),
    p = (hLength * hLength) / SOLAR_MU;
  if (!Number.isFinite(e) || e >= 1) return []; // Never invent a closed hyperbola.
  const periapsis = (
    e > 1e-10 ? eccentricity.map((x) => x / e) : r.map((x) => x / radius)
  ) as Vec3;
  const transverse = cross(h.map((x) => x / hLength) as Vec3, periapsis);
  const anomaly = Math.atan2(
    r.reduce((sum, x, i) => sum + x * transverse[i], 0),
    r.reduce((sum, x, i) => sum + x * periapsis[i], 0),
  );
  const points: Vec3[] = [];
  for (let j = 0; j < count; j++) {
    const nu = anomaly + (2 * Math.PI * j) / count,
      c = Math.cos(nu),
      s = Math.sin(nu),
      distance = p / (1 + e * c);
    points.push(
      periapsis.map(
        (x, i) => sun[i] + distance * (x * c + transverse[i] * s),
      ) as Vec3,
    );
  }
  points[0] = [...position];
  points.push([...points[0]]);
  return points;
}
