import { Matrix4, Quaternion, Vector3 } from "three";
import type { CameraKeyframe, CameraState, Vec3 } from "./types";

export const KEYFRAME_EPSILON = 0.001;
export const MAX_CAMERA_KEYFRAMES = 1000;

function orientation(camera: CameraState) {
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().lookAt(
      new Vector3(...camera.position_km),
      new Vector3(...camera.target_km),
      new Vector3(...camera.up),
    ),
  );
}

// Interpolate orientation and distance rather than the camera's straight-line
// position: opposite views must not pass through their observation target.
export function cameraAt(
  keys: CameraKeyframe[],
  time: number,
): CameraState | null {
  if (!keys.length) return null;
  if (time <= keys[0].time) return { ...keys[0].camera, follow_id: null };
  if (time >= keys.at(-1)!.time)
    return { ...keys.at(-1)!.camera, follow_id: null };
  const right = keys.findIndex((k) => k.time >= time);
  const a = keys[right - 1],
    b = keys[right];
  const t = (time - a.time) / (b.time - a.time);
  const eased = t * t * (3 - 2 * t);
  const q = orientation(a.camera).slerp(orientation(b.camera), eased);
  const target = new Vector3(...a.camera.target_km).lerp(
    new Vector3(...b.camera.target_km),
    eased,
  );
  const distance = (c: CameraState) =>
    new Vector3(...c.position_km).distanceTo(new Vector3(...c.target_km));
  const logLerp = (x: number, y: number) =>
    Math.exp(Math.log(x) * (1 - eased) + Math.log(y) * eased);
  const radius = logLerp(distance(a.camera), distance(b.camera));
  return {
    position_km: new Vector3(0, 0, radius)
      .applyQuaternion(q)
      .add(target)
      .toArray() as Vec3,
    target_km: target.toArray() as Vec3,
    up: new Vector3(0, 1, 0).applyQuaternion(q).toArray() as Vec3,
    fov: (a.camera.fov ?? 34) * (1 - eased) + (b.camera.fov ?? 34) * eased,
    zoom: logLerp(a.camera.zoom ?? 1, b.camera.zoom ?? 1),
    follow_id: null,
  };
}

export function recordCamera(
  keys: CameraKeyframe[],
  time: number,
  camera: CameraState,
  id: string,
): CameraKeyframe[] {
  const existing = keys.find((k) => Math.abs(k.time - time) < KEYFRAME_EPSILON);
  const key = {
    id: existing?.id ?? id,
    time: existing?.time ?? time,
    camera: { ...camera, follow_id: null },
  };
  return [...keys.filter((k) => k.id !== key.id), key].sort(
    (a, b) => a.time - b.time,
  );
}
