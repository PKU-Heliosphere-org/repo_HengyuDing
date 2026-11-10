import type { Vec3 } from "./types";

// Iterative Ramer–Douglas–Peucker in science coordinates; only the drawing is simplified.
// Segments separated by missing data are processed independently and stay disconnected.
export function drawingIndices(
  points: Vec3[],
  breaks: Set<number>,
  tolerance: number,
): [number, number][] {
  const result: [number, number][] = [];
  const boundaries = [
    0,
    ...[...breaks]
      .filter((i) => i > 0 && i < points.length)
      .sort((a, b) => a - b),
    points.length,
  ];
  for (let group = 1; group < boundaries.length; group++) {
    const first = boundaries[group - 1],
      last = boundaries[group] - 1;
    if (last <= first) continue;
    const keep = new Set([first, last]);
    const stack: [[number, number]] | [number, number][] = [[first, last]];
    while (stack.length) {
      const [start, end] = stack.pop()!;
      const a = points[start],
        b = points[end];
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        dz = b[2] - a[2];
      const length = dx * dx + dy * dy + dz * dz;
      let furthest = -1,
        max = tolerance * tolerance;
      for (let i = start + 1; i < end; i++) {
        const p = points[i];
        const t = length
          ? Math.max(
              0,
              Math.min(
                1,
                ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) /
                  length,
              ),
            )
          : 0;
        const distance =
          (p[0] - a[0] - t * dx) ** 2 +
          (p[1] - a[1] - t * dy) ** 2 +
          (p[2] - a[2] - t * dz) ** 2;
        if (distance > max) {
          max = distance;
          furthest = i;
        }
      }
      if (furthest !== -1) {
        keep.add(furthest);
        stack.push([start, furthest], [furthest, end]);
      }
    }
    const indices = [...keep].sort((a, b) => a - b);
    for (let i = 1; i < indices.length; i++)
      result.push([indices[i - 1], indices[i]]);
  }
  return result;
}

export function drawingSegments(
  points: Vec3[],
  breaks: Set<number>,
  tolerance: number,
): Vec3[] {
  return drawingIndices(points, breaks, tolerance).flatMap(([a, b]) => [
    points[a],
    points[b],
  ]);
}
