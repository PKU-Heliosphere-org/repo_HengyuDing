import { describe, it, expect } from "vitest";
import { createTrail, trailFraction, writeTrail } from "../src/trail";
import { InterleavedBufferAttribute } from "three";

describe("historical trails", () => {
  it("uses elapsed time rather than sample count for taper, including gaps", () => {
    const trail = createTrail(24);
    writeTrail(
      trail,
      [0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0],
      [0, 10, 80, 100],
      "#69caca",
      100,
      100,
    );
    const widths = trail.geometry.attributes
      .instanceTaperStart as InterleavedBufferAttribute;
    expect(Array.from(widths.data.array)).toEqual(
      expect.arrayContaining([0, 1]),
    );
    expect(widths.data.array[1]).toBeCloseTo(0.1);
    expect(widths.data.array[2]).toBeCloseTo(0.8);
    expect(trail.material.linewidth).toBe(12);
    expect(trailFraction(-1, 100, 100)).toBe(0);
    expect(trailFraction(101, 100, 100)).toBe(1);
    trail.geometry.dispose();
    trail.material.dispose();
  });
  it("retains the beginning and end of histories exceeding 4096 segments", () => {
    const trail = createTrail(48);
    const segments = [],
      times = [];
    for (let i = 0; i < 6000; i++) {
      segments.push(i, 0, 0, i + 1, 0, 0);
      times.push(i, i + 1);
    }
    writeTrail(trail, segments, times, "#69caca", 6000, 6000);
    expect(trail.geometry.instanceCount).toBe(6000);
    expect(trail.geometry.attributes.instanceStart.getX(0)).toBe(0);
    expect(trail.geometry.attributes.instanceEnd.getX(5999)).toBe(6000);
    // Shrinking the window must not leave stale geometry visible.
    writeTrail(trail, segments.slice(-6), [5999, 6000], "#69caca", 6000, 10);
    expect(trail.geometry.instanceCount).toBe(1);
    expect(trail.geometry.attributes.instanceStart.getX(0)).toBe(5999);
    trail.geometry.dispose();
    trail.material.dispose();
  });
});
