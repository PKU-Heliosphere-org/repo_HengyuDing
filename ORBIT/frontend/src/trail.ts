import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

// A 6px inner halo diameter has a 3px trail head. Age is measured in time, so
// nonuniform sampling and data gaps cannot change the taper or its duration.
export function trailFraction(time: number, end: number, duration: number) {
  return Math.max(0, Math.min(1, 1 - (end - time) / duration));
}

function geometryFor(capacity: number) {
  const geometry = new LineSegmentsGeometry()
    .setPositions(new Float32Array(capacity * 6))
    .setColors(new Float32Array(capacity * 6));
  const taper = new THREE.InstancedInterleavedBuffer(
    new Float32Array(capacity * 2),
    2,
  );
  taper.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(
    "instanceTaperStart",
    new THREE.InterleavedBufferAttribute(taper, 1, 0),
  );
  geometry.setAttribute(
    "instanceTaperEnd",
    new THREE.InterleavedBufferAttribute(taper, 1, 1),
  );
  for (const name of ["instanceStart", "instanceColorStart"])
    (
      geometry.attributes[name] as THREE.InterleavedBufferAttribute
    ).data.setUsage(THREE.DynamicDrawUsage);
  geometry.instanceCount = 0;
  return geometry;
}

export function createTrail(glowSize: number) {
  const material = new LineMaterial({
    color: 0xffffff,
    linewidth: glowSize * 0.5,
    vertexColors: true,
    transparent: false,
    alphaToCoverage: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  // Retain Three's round joins, MSAA edges, near-plane clipping and log depth.
  // Opaque colours avoid bright dots from overlapping transparent end caps.
  material.vertexShader = material.vertexShader
    .replace(
      "uniform float linewidth;",
      "uniform float linewidth;\nattribute float instanceTaperStart;\nattribute float instanceTaperEnd;",
    )
    .replace(
      "offset *= linewidth;",
      "offset *= linewidth * ((position.y < 0.5) ? instanceTaperStart : instanceTaperEnd);",
    );
  const trail = new LineSegments2(geometryFor(256), material);
  trail.frustumCulled = false;
  trail.renderOrder = 2;
  return trail;
}

export function writeTrail(
  trail: LineSegments2,
  segments: number[],
  times: number[],
  color: string,
  end: number,
  duration: number,
) {
  const count = segments.length / 6;
  if (count > trail.geometry.attributes.instanceStart.count) {
    trail.geometry.dispose();
    trail.geometry = geometryFor(2 ** Math.ceil(Math.log2(count)));
  }
  const positions = trail.geometry.attributes
    .instanceStart as THREE.InterleavedBufferAttribute;
  const colors = trail.geometry.attributes
    .instanceColorStart as THREE.InterleavedBufferAttribute;
  const taper = trail.geometry.attributes
    .instanceTaperStart as THREE.InterleavedBufferAttribute;
  (positions.data.array as Float32Array).set(segments);
  const c = new THREE.Color(color);
  for (let i = 0; i < count * 2; i++) {
    const age = trailFraction(times[i], end, duration);
    taper.data.array[i] = age;
    const brightness = 0.15 + 0.85 * age;
    colors.data.array[i * 3] = c.r * brightness;
    colors.data.array[i * 3 + 1] = c.g * brightness;
    colors.data.array[i * 3 + 2] = c.b * brightness;
  }
  positions.data.needsUpdate =
    colors.data.needsUpdate =
    taper.data.needsUpdate =
      true;
  trail.geometry.instanceCount = count;
}
