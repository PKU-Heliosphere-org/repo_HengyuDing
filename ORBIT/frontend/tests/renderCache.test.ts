import { describe, expect, it } from "vitest";
import { appendWindow, cacheSegments } from "../src/useRenderCache";
import { planetSnapshot } from "../src/planetMath";
import type { PlanetWindow } from "../src/types";

describe("render cache coverage", () => {
  it("covers the selected interval and pre-roll history without gaps within API limits", () => {
    const day = 86400;
    const parts = cacheSegments(400 * day, 950 * day, 365 * day, 0);
    expect(parts[0].start).toBe(35 * day);
    expect(parts.at(-1)!.end).toBe(950 * day);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i) expect(p.start).toBe(parts[i - 1].end);
      expect((p.end - p.start) / p.step).toBeLessThanOrEqual(3000);
      expect(p.end - p.start).toBeLessThanOrEqual(120 * day);
      expect(p.step).toBe(p.end <= 400 * day ? 21600 : 3600);
    }
    expect(cacheSegments(10 * day, 11 * day, 60 * day, 5 * day)[0].start).toBe(
      5 * day,
    );
  });
  it("merges shared boundaries once and preserves interpolation at chunk seams", () => {
    const part = (times: number[]): PlanetWindow => ({
      reference_tai: "2026-01-01T00:00:37",
      center: "sun",
      frame: "J2000",
      times,
      sun_positions_km: times.map(() => [0, 0, 0]),
      sun_velocities_km_s: times.map(() => [0, 0, 0]),
      warnings: ["local"],
      ephemeris: "DE440s",
      bodies: {
        earth: {
          positions_km: times.map((t) => [t, 0, 0]),
          velocities_km_s: times.map(() => [1, 0, 0]),
          quaternions: times.map(() => [0, 0, 0, 1]),
          radii_km: [1, 1, 1],
          orientation_quality: times.map(() => "observed"),
        },
      },
    });
    const result = part([0, 21600]);
    appendWindow(result, part([21600, 25200, 28800]));
    expect(result.times).toEqual([0, 21600, 25200, 28800]);
    expect(result.warnings).toEqual(["local"]);
    for (const t of [0, 21599, 21600, 21601, 28800])
      expect(planetSnapshot(result, t)!.bodies.earth!.position[0]).toBeCloseTo(
        t,
      );
    expect(planetSnapshot(result, 28801)).toBeNull();
    expect(result.bodies.earth!.quaternions).toHaveLength(result.times.length);
  });
});
