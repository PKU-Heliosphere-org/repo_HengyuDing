import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  hermite,
  hermiteVelocity,
  planetSnapshot,
  slerp,
} from "../src/planetMath";
import { AU_KM, PlanetVisual } from "../src/planetSurface";
import type { PlanetState, PlanetWindow } from "../src/types";

describe("ephemeris display interpolation", () => {
  it("reconstructs constant acceleration and its velocity from endpoint states", () => {
    expect(
      hermite([0, 0, 0], [0, 0, 0], [8, 0, 0], [4, 0, 0], 4, 0.375)[0],
    ).toBeCloseTo(1.125, 10);
    expect(
      hermiteVelocity([0, 0, 0], [0, 0, 0], [8, 0, 0], [4, 0, 0], 4, 0.375)[0],
    ).toBeCloseTo(1.5, 10);
  });
  it("takes the short quaternion arc across wrap and ignores quaternion sign", () => {
    const a = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), (359 * Math.PI) / 180)
      .toArray();
    const b = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 180)
      .toArray();
    const middle = slerp(a, b, 0.5);
    expect(Math.abs(middle[3])).toBeCloseTo(1, 10);
    const inverted = a.map((v) => -v) as typeof a;
    expect(
      Math.abs(slerp(a, inverted, 0.5).reduce((n, v, i) => n + v * a[i], 0)),
    ).toBeCloseTo(1, 10);
  });
  it("never extrapolates planetary positions and marks approximate attitude", () => {
    const data = {
      reference_tai: "2028-01-01T00:00:37",
      times: [0, 3600],
      center: "sun",
      frame: "J2000",
      ephemeris: "DE440s",
      warnings: [],
      sun_positions_km: [
        [0, 0, 0],
        [0, 0, 0],
      ],
      sun_velocities_km_s: [
        [0, 0, 0],
        [0, 0, 0],
      ],
      bodies: {
        earth: {
          positions_km: [
            [0, 0, 0],
            [3600, 0, 0],
          ],
          velocities_km_s: [
            [1, 0, 0],
            [1, 0, 0],
          ],
          quaternions: [
            [0, 0, 0, 1],
            [0, 0, 0, 1],
          ],
          radii_km: [6378, 6378, 6357],
          orientation_quality: ["observed", "approximate"],
        },
      },
    } as PlanetWindow;
    expect(planetSnapshot(data, -1)).toBeNull();
    expect(planetSnapshot(data, 3601)).toBeNull();
    expect(planetSnapshot(data, 0)!.bodies.earth!.quality).toBe("observed");
    expect(planetSnapshot(data, 1800)!.bodies.earth!.quality).toBe(
      "approximate",
    );
    expect(planetSnapshot(data, 1800)!.bodies.earth!.position).toEqual([
      1800, 0, 0,
    ]);
  });
});

describe("surface coordinates, illumination and physical scale", () => {
  const maps: THREE.Texture[] = [];
  const repo = {
    get() {
      const texture = new THREE.Texture();
      maps.push(texture);
      return texture;
    },
    dispose() {
      maps.forEach((t) => t.dispose());
    },
  };
  it("maps texture centre to longitude zero, east to +Y, north to +Z", () => {
    const visual = new PlanetVisual(
      "earth",
      "#72b8ed",
      repo,
      new THREE.Texture(),
    );
    const positions = visual.surface.geometry.attributes.position;
    const at = (u: number, v: number) =>
      new THREE.Vector3()
        .fromBufferAttribute(positions, (1 - v) * 64 * 97 + u * 96)
        .toArray();
    const zero = at(0.5, 0.5),
      east = at(0.75, 0.5),
      north = at(0.5, 1);
    expect(zero[0]).toBeCloseTo(1);
    expect(zero[1]).toBeCloseTo(0);
    expect(zero[2]).toBeCloseTo(0);
    expect(east[1]).toBeCloseTo(1);
    expect(north[2]).toBeCloseTo(1);
    expect(visual.surface.material.uniforms.uDay.value).not.toBe(
      visual.surface.material.uniforms.uNight.value,
    );
    visual.dispose();
  });
  it("changes only LOD, never physical radius, and transforms the solar direction into the body frame", () => {
    const visual = new PlanetVisual(
      "earth",
      "#72b8ed",
      repo,
      new THREE.Texture(),
    );
    const state: PlanetState = {
      position: [AU_KM, 0, 0],
      velocity: [0, 30, 0],
      quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      radii: [6378.1366, 6378.1366, 6356.7519],
      quality: "approximate",
    };
    const camera = new THREE.PerspectiveCamera(34, 1, 1e-9, 1000);
    camera.position.set(0, 0, 4);
    expect(visual.update(state, [0, 0, 0], camera, 900, true)).toBe("glow");
    camera.position.set(1 + (4 * 6378.1366) / AU_KM, 0, 0);
    expect(visual.update(state, [0, 0, 0], camera, 900, true)).toBe("surface");
    expect(visual.body.scale.x * AU_KM).toBeCloseTo(6378.1366, 8);
    expect(visual.meridian.visible).toBe(true);
    const direction = visual.surface.material.uniforms.uSunLocal
      .value as THREE.Vector3;
    expect(direction.x).toBeCloseTo(0);
    expect(direction.y).toBeCloseTo(1);
    expect(direction.z).toBeCloseTo(0);
    visual.dispose();
    repo.dispose();
  });
});
