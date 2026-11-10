import { expect, it } from "vitest";
import { drawingIndices } from "../src/geometry";
import type { Vec3 } from "../src/types";
it("simplifies drawing without joining missing intervals or altering source points", () => {
  const points: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [10, 0, 0],
    [11, 1, 0],
    [12, 0, 0],
  ];
  const before = JSON.stringify(points);
  expect(drawingIndices(points, new Set([3]), 0.01)).toEqual([
    [0, 2],
    [3, 4],
    [4, 5],
  ]);
  expect(JSON.stringify(points)).toBe(before);
});
it("preserves the shape of a closed densely sampled curve", () => {
  const points: Vec3[] = Array.from({ length: 10001 }, (_, i) => [
    Math.cos((i * 2 * Math.PI) / 10000),
    Math.sin((i * 2 * Math.PI) / 10000),
    0,
  ]);
  const segments = drawingIndices(points, new Set(), 0.0004);
  expect(segments.length).toBeGreaterThan(50);
  expect(segments.length).toBeLessThan(500);
  expect(segments[0][0]).toBe(0);
  expect(segments.at(-1)![1]).toBe(10000);
});
