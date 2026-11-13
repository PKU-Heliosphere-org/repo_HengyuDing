import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { cameraAt, recordCamera } from "../src/cameraKeyframes";
import type { CameraKeyframe, CameraState } from "../src/types";

const a: CameraState = {
  position_km: [0, 0, 10],
  target_km: [0, 0, 0],
  up: [0, 1, 0],
  follow_id: null,
  fov: 34,
  zoom: 1,
};
const b: CameraState = {
  position_km: [0, 0, -40],
  target_km: [0, 0, 0],
  up: [0, 1, 0],
  follow_id: null,
  fov: 60,
  zoom: 4,
};
const keys: CameraKeyframe[] = [
  { id: "a", time: 10, camera: a },
  { id: "b", time: 20, camera: b },
];

describe("camera keyframe interpolation", () => {
  it("holds endpoints, handles empty and single tracks, and uses exact recorded views", () => {
    expect(cameraAt([], 0)).toBeNull();
    expect(cameraAt(keys.slice(0, 1), 100)).toEqual(a);
    expect(cameraAt(keys, 0)).toEqual(a);
    expect(cameraAt(keys, 20)).toEqual(b);
    expect(cameraAt(keys, 100)).toEqual(b);
  });
  it("rotates around the target without crossing it and interpolates optical zoom", () => {
    const c = cameraAt(keys, 15)!;
    expect(Math.hypot(...c.position_km)).toBeCloseTo(20);
    expect(c.fov).toBeCloseTo(47);
    expect(c.zoom).toBeCloseTo(2);
    const direction = new Vector3(...c.position_km).sub(
      new Vector3(...c.target_km),
    );
    expect(direction.dot(new Vector3(...c.up))).toBeCloseTo(0);
    for (let t = 10; t <= 20; t += 0.1)
      expect(
        Math.hypot(...cameraAt(keys, t)!.position_km),
      ).toBeGreaterThanOrEqual(9.999);
  });
  it("preserves roll, eases in and out, and moves the observation target smoothly", () => {
    const roll: CameraKeyframe[] = [
      keys[0],
      {
        id: "roll",
        time: 20,
        camera: {
          ...a,
          up: [0, -1, 0],
          target_km: [10, 0, 0],
          position_km: [10, 0, 10],
        },
      },
    ];
    const mid = cameraAt(roll, 15)!;
    expect(mid.target_km[0]).toBeCloseTo(5);
    expect(Math.abs(mid.up[0])).toBeCloseTo(1);
    const initial = cameraAt(roll, 10.001)!;
    expect(
      new Vector3(...initial.position_km).distanceTo(
        new Vector3(...a.position_km),
      ),
    ).toBeLessThan(0.00001);
    expect(cameraAt(roll, 19.999)!.target_km[0]).toBeGreaterThan(9.99999);
  });
  it("updates same-time keys without duplicates and keeps times sorted and inputs unchanged", () => {
    const next = recordCamera(keys, 15, a, "new");
    expect(next.map((k) => k.time)).toEqual([10, 15, 20]);
    const updated = recordCamera(
      next,
      15,
      { ...b, follow_id: "earth" },
      "unused",
    );
    expect(updated).toHaveLength(3);
    expect(updated[1].id).toBe("new");
    expect(updated[1].camera.follow_id).toBeNull();
    expect(keys).toHaveLength(2);
  });
});
