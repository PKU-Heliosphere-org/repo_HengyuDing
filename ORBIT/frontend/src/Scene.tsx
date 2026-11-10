import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { download } from "./api";
import { drawingIndices, drawingSegments } from "./geometry";
import { offsetSeconds, sampleAt } from "./time";
import { planetSnapshot } from "./planetMath";
import { AU_KM, PlanetVisual, textureRepository } from "./planetSurface";
import type {
  BodyId,
  CameraState,
  Curve,
  Dataset,
  Layer,
  PlanetWindow,
  SceneSystem,
  Vec3,
} from "./types";

type Props = {
  datasets: Dataset[];
  layers: Layer[];
  selected: string | null;
  base: string;
  time: number;
  axes: boolean;
  grid: boolean;
  trailSeconds: number;
  fit: number;
  overlay: string[];
  conic?: Curve | null;
  planetWindow?: PlanetWindow | null;
  system: SceneSystem;
  stars: boolean;
  cameraRestore?: CameraState | null;
  onFollow: (id: string | null) => void;
  onError: (error: string) => void;
};
export type SceneHandle = {
  exportPng: () => void;
  command: (
    type:
      | "focus"
      | "follow"
      | "overview"
      | "top"
      | "front"
      | "side"
      | "rollLeft"
      | "rollRight",
  ) => void;
  getCamera: () => CameraState | null;
};
type Marker = {
  layer: Layer;
  ds: Dataset;
  point: THREE.Sprite;
  label: HTMLDivElement;
  trail: THREE.LineSegments;
  buffer: Float32Array;
  segments: [number, number][];
  offset: number;
  toleranceKm: number;
};
type PlanetMarker = {
  layer: Layer;
  visual: PlanetVisual;
  label: HTMLDivElement;
};
type Runtime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: TrackballControls;
  content: THREE.Group;
  markers: Marker[];
  planets: PlanetMarker[];
  bound: number;
  dirty: boolean;
  poses: Map<
    string,
    { position: THREE.Vector3; radius: number; focusRadius?: number }
  >;
  followId: string | null;
  lastFollow: THREE.Vector3 | null;
  draw: () => void;
  sun: THREE.Group;
  sunGlow: THREE.Sprite;
  sunMesh: THREE.Mesh;
  center: THREE.Sprite;
};
const fromKm = (p: Vec3) =>
  new THREE.Vector3().fromArray(p).divideScalar(AU_KM);
function disposeContent(group: THREE.Group) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!(o as THREE.Sprite).isSprite) mesh.geometry?.dispose();
    if (mesh.material)
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(
        (m) => m.dispose(),
      );
  });
  group.clear();
}
function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.09, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,255,255,.42)");
  g.addColorStop(0.5, "rgba(255,255,255,.09)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
function curveLines(
  points: Vec3[],
  breaks: Set<number>,
  color: string,
  bound: number,
  opacity: number,
) {
  const anchor = points.length ? fromKm(points[0]) : new THREE.Vector3();
  const values: number[] = [];
  for (const p of drawingSegments(
    points,
    breaks,
    Math.max(1, bound * AU_KM) * 0.0004,
  ))
    values.push(
      p[0] / AU_KM - anchor.x,
      p[1] / AU_KM - anchor.y,
      p[2] / AU_KM - anchor.z,
    );
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
  const line = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
  line.position.copy(anchor);
  line.userData.orbitGeometry = {
    points,
    breaks,
    maximum: Math.max(1, bound * AU_KM) * 0.0004,
    tolerance: Math.max(1, bound * AU_KM) * 0.0004,
  };
  return line;
}
function refineLine(line: THREE.LineSegments, tolerance: number) {
  const source = line.userData.orbitGeometry as
    | {
        points: Vec3[];
        breaks: Set<number>;
        maximum: number;
        tolerance: number;
      }
    | undefined;
  if (!source) return;
  const wanted = Math.min(source.maximum, tolerance);
  if (wanted >= source.tolerance * 0.5 && wanted <= source.tolerance * 2)
    return;
  const values: number[] = [];
  for (const p of drawingSegments(source.points, source.breaks, wanted))
    values.push(
      p[0] / AU_KM - line.position.x,
      p[1] / AU_KM - line.position.y,
      p[2] / AU_KM - line.position.z,
    );
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry();
  line.geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(values, 3),
  );
  source.tolerance = wanted;
}
function captureCamera(r: Runtime): CameraState {
  return {
    position_km: r.camera.position
      .clone()
      .multiplyScalar(AU_KM)
      .toArray() as Vec3,
    target_km: r.controls.target
      .clone()
      .multiplyScalar(AU_KM)
      .toArray() as Vec3,
    up: r.camera.up.toArray() as Vec3,
    follow_id: r.followId,
  };
}

export const OrbitScene = forwardRef<SceneHandle, Props>(
  function OrbitScene(props, ref) {
    const host = useRef<HTMLDivElement>(null),
      labels = useRef<HTMLDivElement>(null),
      runtime = useRef<Runtime | null>(null),
      latest = useRef(props);
    latest.current = props;
    const [ready, setReady] = useState(false),
      [error, setError] = useState(""),
      [scale, setScale] = useState(1);
    const repository = useRef<ReturnType<typeof textureRepository> | null>(
        null,
      ),
      glow = useRef<THREE.Texture | null>(null),
      didFit = useRef(false),
      savedKey = useRef<CameraState | null>(null);
    const notifyFollow = (r: Runtime, id: string | null) => {
      r.followId = id;
      r.lastFollow = null;
      latest.current.onFollow(id);
      r.dirty = true;
    };
    function moveCamera(type: "overview" | "top" | "front" | "side") {
      const r = runtime.current;
      if (!r) return;
      notifyFollow(r, null);
      const radius = Math.max(0.000001, r.bound),
        distance =
          (radius * 1.18) /
          Math.sin(THREE.MathUtils.degToRad(r.camera.fov / 2));
      r.controls.target.set(0, 0, 0);
      r.controls.minDistance = 1e-10;
      r.camera.up.set(0, 0, 1);
      if (type === "top") {
        r.camera.up.set(0, 1, 0);
        r.camera.position.set(0, 0, distance);
      } else if (type === "front") r.camera.position.set(0, -distance, 0);
      else if (type === "side") r.camera.position.set(distance, 0, 0);
      else r.camera.position.set(1.15, -2.15, 1.75).setLength(distance);
      r.camera.lookAt(r.controls.target);
      r.controls.update();
      r.dirty = true;
    }
    function command(type: Parameters<SceneHandle["command"]>[0]) {
      const r = runtime.current;
      if (!r) return;
      if (["overview", "top", "front", "side"].includes(type)) {
        moveCamera(type as "overview");
        return;
      }
      if (type === "rollLeft" || type === "rollRight") {
        const axis = r.controls.target
          .clone()
          .sub(r.camera.position)
          .normalize();
        r.camera.up.applyAxisAngle(
          axis,
          ((type === "rollLeft" ? 1 : -1) * Math.PI) / 12,
        );
        r.controls.update();
        r.dirty = true;
        return;
      }
      const id = latest.current.selected,
        pose = id ? r.poses.get(id) : null;
      if (!id || !pose) {
        latest.current.onError("选中对象当前没有可用位置，或图层已隐藏。");
        return;
      }
      if (type === "follow") {
        notifyFollow(r, r.followId === id ? null : id);
        r.lastFollow = pose.position.clone();
        return;
      }
      const direction = r.camera.position
        .clone()
        .sub(r.controls.target)
        .normalize();
      if (!direction.lengthSq()) direction.set(1, -2, 1).normalize();
      r.controls.target.copy(pose.position);
      r.camera.position
        .copy(pose.position)
        .addScaledVector(
          direction,
          Math.max((pose.focusRadius || pose.radius) * 4, 0.0000002),
        );
      r.controls.minDistance = Math.max(pose.radius * 1.025, 1e-10);
      notifyFollow(r, id);
      r.lastFollow = pose.position.clone();
      r.camera.lookAt(r.controls.target);
      r.controls.update();
      r.dirty = true;
    }
    useEffect(() => {
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          preserveDrawingBuffer: true,
          logarithmicDepthBuffer: true,
        });
      } catch {
        setError("无法启动 WebGL2，请启用浏览器硬件加速并检查显卡驱动。");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor("#080d13");
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.current!.prepend(renderer.domElement);
      const scene = new THREE.Scene(),
        camera = new THREE.PerspectiveCamera(34, 1, 1e-9, 10000);
      camera.up.set(0, 0, 1);
      camera.position.set(2, -3, 2.5);
      const controls = new TrackballControls(camera, renderer.domElement);
      controls.rotateSpeed = 2.4;
      controls.zoomSpeed = 1.25;
      controls.panSpeed = 0.55;
      controls.dynamicDampingFactor = 0.18;
      controls.staticMoving = true;
      controls.minDistance = 1e-10;
      controls.maxDistance = 1e5;
      const content = new THREE.Group();
      scene.add(content);
      const map = glowTexture();
      glow.current = map;
      const makeSprite = (color: string, size: number) => {
        const s = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map,
            color,
            transparent: true,
            depthWrite: false,
            sizeAttenuation: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
          }),
        );
        s.scale.setScalar(size);
        return s;
      };
      const sun = new THREE.Group(),
        sunMesh = new THREE.Mesh(
          new THREE.SphereGeometry(695700 / AU_KM, 64, 40),
          new THREE.MeshBasicMaterial({ color: "#fff0d0" }),
        ),
        sunGlow = makeSprite("#ffe4ac", 0.038);
      sun.add(sunMesh, sunGlow);
      scene.add(sun);
      const center = makeSprite("#7dbbef", 0.02);
      scene.add(center);
      const r: Runtime = {
        renderer,
        scene,
        camera,
        controls,
        content,
        markers: [],
        planets: [],
        bound: 1,
        dirty: true,
        poses: new Map(),
        followId: null,
        lastFollow: null,
        draw: () => {},
        sun,
        sunGlow,
        sunMesh,
        center,
      };
      runtime.current = r;
      repository.current = textureRepository(
        () => {
          r.dirty = true;
        },
        (message) => latest.current.onError(message),
      );
      let lastProps: Props | null = null,
        lastFollowNotified: string | null = null;
      const drawnPosition = new THREE.Vector3(Infinity, Infinity, Infinity),
        drawnUp = new THREE.Vector3(),
        drawnTarget = new THREE.Vector3();
      const draw = () => {
        const p = latest.current;
        if (lastProps !== p) {
          r.dirty = true;
          lastProps = p;
        }
        controls.update();
        // Trackball's fixed change-event epsilon is too large for kilometre-scale views in AU.
        if (
          !camera.position.equals(drawnPosition) ||
          !camera.up.equals(drawnUp) ||
          !controls.target.equals(drawnTarget)
        )
          r.dirty = true;
        if (!r.dirty) return;
        r.dirty = false;
        const snapshot = planetSnapshot(p.planetWindow || null, p.time);
        r.poses.clear();
        const pendingLabels: {
          el: HTMLDivElement;
          position: THREE.Vector3;
          color: string;
          name: string;
          radius: number;
          id: string;
        }[] = [];
        const width = host.current?.clientWidth || 1,
          height = host.current?.clientHeight || 1;
        const drawingTolerance = Math.max(
          0.000001,
          ((camera.position.distanceTo(controls.target) *
            AU_KM *
            2 *
            Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
            height) *
            0.25,
        );
        r.content.traverse((object) => {
          if ((object as THREE.LineSegments).isLineSegments)
            refineLine(object as THREE.LineSegments, drawingTolerance);
        });
        for (const m of r.markers) {
          const wanted = Math.min(r.bound * AU_KM * 0.0004, drawingTolerance);
          if (wanted < m.toleranceKm * 0.5 || wanted > m.toleranceKm * 2) {
            m.segments = drawingIndices(
              m.ds.samples.map((s) => s.position_km),
              new Set(m.ds.breaks),
              wanted,
            );
            m.toleranceKm = wanted;
          }
          const at =
            m.layer.kind === "hypothesis"
              ? m.layer.curve
                ? { position: m.layer.curve.position_km }
                : null
              : sampleAt(
                  m.ds.samples,
                  p.time - m.offset,
                  m.ds.metadata.max_interpolation_gap_s,
                );
          m.point.visible = !!at;
          m.label.style.display = "none";
          m.trail.visible =
            !!at && m.layer.showTrail && m.layer.kind === "dataset";
          if (!at) continue;
          m.point.position.copy(fromKm(at.position));
          r.poses.set(m.layer.id, {
            position: m.point.position.clone(),
            radius: Math.max(1 / AU_KM, r.bound * 0.00001),
          });
          if (m.layer.showLabel)
            pendingLabels.push({
              el: m.label,
              position: m.point.position,
              color: m.layer.color,
              name: m.layer.name,
              radius: 0,
              id: m.layer.id,
            });
          if (m.trail.visible) {
            const end = p.time - m.offset,
              start = end - p.trailSeconds,
              segments: number[] = [];
            const anchor = fromKm(m.ds.samples[0].position_km);
            for (const [a, b] of m.segments) {
              const first = m.ds.samples[a],
                last = m.ds.samples[b];
              if (last.t <= start || first.t >= end) continue;
              const p0 =
                  first.t < start
                    ? sampleAt(
                        m.ds.samples,
                        start,
                        m.ds.metadata.max_interpolation_gap_s,
                      )?.position
                    : first.position_km,
                p1 = last.t > end ? at.position : last.position_km;
              if (p0 && p1)
                segments.push(
                  p0[0] / AU_KM - anchor.x,
                  p0[1] / AU_KM - anchor.y,
                  p0[2] / AU_KM - anchor.z,
                  p1[0] / AU_KM - anchor.x,
                  p1[1] / AU_KM - anchor.y,
                  p1[2] / AU_KM - anchor.z,
                );
            }
            const n = Math.min(4096, segments.length / 6);
            m.buffer.set(segments.slice(-n * 6));
            m.trail.geometry.setDrawRange(0, n * 2);
            (
              m.trail.geometry.attributes.position as THREE.BufferAttribute
            ).needsUpdate = true;
            const colors = m.trail.geometry.attributes
                .color as THREE.BufferAttribute,
              c = new THREE.Color(m.layer.color);
            for (let i = 0; i < n; i++) {
              const v = 0.12 + (0.88 * i) / Math.max(1, n - 1);
              colors.setXYZ(i * 2, c.r * v, c.g * v, c.b * v);
              colors.setXYZ(i * 2 + 1, c.r * v, c.g * v, c.b * v);
            }
            colors.needsUpdate = true;
          }
        }
        for (const m of r.planets) {
          const state = snapshot?.bodies[m.layer.body_id!];
          m.visual.root.visible = !!state;
          m.label.style.display = "none";
          if (!state) continue;
          m.visual.root.position.copy(fromKm(state.position));
          r.poses.set(m.layer.id, {
            position: m.visual.root.position.clone(),
            radius: Math.max(...state.radii) / AU_KM,
            focusRadius:
              (Math.max(...state.radii) / AU_KM) *
              (m.layer.body_id === "saturn" ? 2.33 : 1),
          });
        }
        if (r.followId) {
          const pose = r.poses.get(r.followId);
          if (pose) {
            if (r.lastFollow) {
              const shift = pose.position.clone().sub(r.lastFollow);
              camera.position.add(shift);
              controls.target.add(shift);
            }
            r.lastFollow = pose.position.clone();
            controls.minDistance = Math.max(pose.radius * 1.025, 1e-10);
          } else {
            r.followId = null;
            r.lastFollow = null;
          }
        }
        if (lastFollowNotified !== r.followId) {
          lastFollowNotified = r.followId;
          latest.current.onFollow(r.followId);
        }
        for (const m of r.planets) {
          const state = snapshot?.bodies[m.layer.body_id!];
          if (!state || !snapshot) continue;
          const lod = m.visual.update(
            state,
            snapshot.sun,
            camera,
            height,
            !!m.layer.showMeridian,
          );
          host.current!.dataset[m.layer.body_id! + "Lod"] = lod;
          if (m.layer.showLabel)
            pendingLabels.push({
              el: m.label,
              position: m.visual.root.position,
              color: m.layer.color,
              name: m.layer.name,
              radius: Math.max(...state.radii) / AU_KM,
              id: m.layer.id,
            });
        }
        sun.visible = p.system.center === "sun" || !!snapshot;
        sun.position.copy(
          snapshot ? fromKm(snapshot.sun) : new THREE.Vector3(),
        );
        sunGlow.position
          .copy(camera.position)
          .sub(sun.position)
          .setLength((695700 / AU_KM) * 1.02);
        const sunDiameter =
          (height * (695700 / AU_KM)) /
          (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
            Math.max(1e-12, camera.position.distanceTo(sun.position)));
        sunGlow.material.opacity =
          1 - THREE.MathUtils.smoothstep(sunDiameter, 8, 80) * 0.8;
        center.visible =
          p.system.center === "earth" &&
          !p.layers.some((l) => l.kind === "planet" && l.body_id === "earth");
        const solids = [
          ...r.planets
            .filter((m) => m.visual.root.visible)
            .map((m) => ({
              center: m.visual.root.position,
              radius: m.visual.radiusKm / AU_KM,
            })),
          ...(sun.visible
            ? [{ center: sun.position, radius: 695700 / AU_KM }]
            : []),
        ];
        for (const solid of solids) {
          const delta = camera.position.clone().sub(solid.center);
          if (delta.length() < solid.radius * 1.015) {
            if (!delta.lengthSq()) delta.set(0, 0, 1);
            camera.position
              .copy(solid.center)
              .add(delta.setLength(solid.radius * 1.015));
            camera.lookAt(controls.target);
          }
        }
        const distance = camera.position.distanceTo(controls.target);
        const near = Math.max(1e-13, Math.min(0.01, distance * 1e-4));
        if (Math.abs(near - camera.near) > near * 0.01) {
          camera.near = near;
          camera.far = Math.max(
            1000,
            camera.position.length() * 5 + controls.target.length() * 5,
          );
          camera.updateProjectionMatrix();
        }
        camera.updateMatrixWorld();
        const occupied: { x: number; y: number; width: number }[] = [];
        pendingLabels.sort(
          (a, b) => Number(b.id === p.selected) - Number(a.id === p.selected),
        );
        for (const label of pendingLabels) {
          label.el.style.display = "block";
          const projected = label.position.clone().project(camera);
          if (
            Math.abs(projected.x) > 1.1 ||
            Math.abs(projected.y) > 1.1 ||
            projected.z < -1 ||
            projected.z > 1
          ) {
            label.el.style.display = "none";
            continue;
          }
          const labelWidth = label.el.offsetWidth;
          const radiusPx =
            (height * label.radius) /
            (2 *
              Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
              Math.max(1e-12, camera.position.distanceTo(label.position)));
          const x = Math.max(
            10,
            Math.min(
              width - labelWidth - 12,
              ((projected.x + 1) * width) / 2 + radiusPx + 12,
            ),
          );
          let y = Math.max(
            10,
            Math.min(height - 24, ((-projected.y + 1) * height) / 2 - 6),
          );
          let attempts = 0;
          while (
            occupied.some(
              (v) =>
                x < v.x + v.width + 6 &&
                x + labelWidth + 6 > v.x &&
                Math.abs(y - v.y) < 16,
            ) &&
            attempts++ < 12
          )
            y += 17;
          if (y > height - 20) label.el.style.display = "none";
          else {
            occupied.push({ x, y, width: labelWidth });
            label.el.style.transform = "translate(" + x + "px," + y + "px)";
            label.el.dataset.x = String(x);
            label.el.dataset.y = String(y);
          }
        }
        renderer.render(scene, camera);
        drawnPosition.copy(camera.position);
        drawnUp.copy(camera.up);
        drawnTarget.copy(controls.target);
        host.current!.dataset.camera = JSON.stringify(captureCamera(r));
      };
      r.draw = draw;
      controls.addEventListener("change", () => {
        r.dirty = true;
      });
      const resize = () => {
        if (!host.current) return;
        const { width, height } = host.current.getBoundingClientRect();
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        controls.handleResize();
        r.dirty = true;
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host.current!);
      resize();
      setReady(true);
      let frame: number;
      const loop = () => {
        draw();
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        disposeContent(content);
        disposeContent(sun);
        center.material.dispose();
        repository.current?.dispose();
        map.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        runtime.current = null;
      };
    }, []);
    useEffect(() => {
      const r = runtime.current,
        repo = repository.current,
        map = glow.current;
      if (!r || !repo || !map) return;
      disposeContent(r.content);
      r.markers = [];
      r.planets = [];
      labels.current!.replaceChildren();
      let bound = 0.1;
      for (const ds of props.datasets)
        for (const s of ds.samples)
          bound = Math.max(bound, Math.hypot(...s.position_km) / AU_KM);
      const snapshot = planetSnapshot(props.planetWindow || null, props.time);
      if (snapshot)
        for (const body of Object.values(snapshot.bodies))
          if (body)
            bound = Math.max(bound, Math.hypot(...body.position) / AU_KM);
      if (props.conic)
        for (const p of props.conic.points)
          bound = Math.max(bound, Math.hypot(...p) / AU_KM);
      r.bound = bound;
      setScale(bound);
      const makeLabel = (layer: Layer) => {
        const label = document.createElement("div");
        label.className = "object-label";
        label.textContent = layer.name;
        label.style.color = layer.color;
        labels.current!.append(label);
        return label;
      };
      if (props.grid) {
        for (const fraction of [0.25, 0.5, 0.75, 1]) {
          const points: Vec3[] = Array.from({ length: 181 }, (_, i) => [
            Math.cos((i * Math.PI) / 90) * bound * fraction * AU_KM,
            Math.sin((i * Math.PI) / 90) * bound * fraction * AU_KM,
            0,
          ]);
          r.content.add(curveLines(points, new Set(), "#8c9eb7", bound, 0.13));
        }
      }
      if (props.axes) r.content.add(new THREE.AxesHelper(bound * 0.4));
      if (props.conic)
        r.content.add(
          curveLines(props.conic.points, new Set(), "#f2cb77", bound, 0.7),
        );
      for (const layer of props.layers.filter((l) => l.visible)) {
        if (layer.kind === "planet") {
          const visual = new PlanetVisual(
            layer.body_id!,
            layer.color,
            repo,
            map,
          );
          r.content.add(visual.root);
          r.planets.push({ layer, visual, label: makeLabel(layer) });
          const body = props.planetWindow?.bodies[layer.body_id!];
          if (layer.showTrack && body)
            r.content.add(
              curveLines(
                body.positions_km,
                new Set(),
                layer.color,
                bound,
                0.45,
              ),
            );
          continue;
        }
        const ds = props.datasets.find((d) => d.id === layer.dataset_id);
        if (!ds) continue;
        if (layer.showTrack)
          r.content.add(
            curveLines(
              layer.kind === "hypothesis"
                ? layer.curve?.points || []
                : ds.samples.map((s) => s.position_km),
              new Set(layer.kind === "dataset" ? ds.breaks : []),
              layer.color,
              bound,
              layer.id === props.selected ? 0.65 : 0.35,
            ),
          );
        const point = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map,
            color: layer.color,
            transparent: true,
            depthWrite: false,
            sizeAttenuation: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
          }),
        );
        point.scale.setScalar(layer.id === props.selected ? 0.022 : 0.016);
        r.content.add(point);
        const buffer = new Float32Array(4096 * 6),
          geo = new THREE.BufferGeometry();
        geo.setAttribute(
          "position",
          new THREE.BufferAttribute(buffer, 3).setUsage(THREE.DynamicDrawUsage),
        );
        geo.setAttribute(
          "color",
          new THREE.BufferAttribute(new Float32Array(4096 * 6), 3),
        );
        geo.setDrawRange(0, 0);
        const trail = new THREE.LineSegments(
          geo,
          new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
          }),
        );
        trail.position.copy(fromKm(ds.samples[0].position_km));
        trail.frustumCulled = false;
        r.content.add(trail);
        r.markers.push({
          layer,
          ds,
          point,
          label: makeLabel(layer),
          trail,
          buffer,
          segments: drawingIndices(
            ds.samples.map((s) => s.position_km),
            new Set(ds.breaks),
            bound * AU_KM * 0.0004,
          ),
          offset: props.base ? offsetSeconds(ds, props.base) : 0,
          toleranceKm: bound * AU_KM * 0.0004,
        });
      }
      r.dirty = true;
      r.draw();
      if (
        !didFit.current &&
        props.layers.length &&
        (r.markers.length || snapshot)
      ) {
        didFit.current = true;
        if (!props.cameraRestore) moveCamera("overview");
      }
      if (!props.layers.length) didFit.current = false;
    }, [
      ready,
      props.datasets,
      props.layers,
      props.selected,
      props.base,
      props.axes,
      props.grid,
      props.conic,
      props.planetWindow,
      props.system.center,
      props.system.frame,
    ]);
    useEffect(() => {
      const r = runtime.current;
      if (r && repository.current) {
        r.scene.background = props.stars
          ? repository.current.get("stars.jpg")
          : null;
        if (props.stars && r.scene.background)
          r.scene.background.mapping = THREE.EquirectangularReflectionMapping;
        r.dirty = true;
      }
    }, [ready, props.stars]);
    useEffect(() => {
      if (ready && props.fit) moveCamera("overview");
    }, [ready, props.fit]);
    useEffect(() => {
      const r = runtime.current,
        c = props.cameraRestore;
      if (!r || !c || savedKey.current === c) return;
      savedKey.current = c;
      r.camera.position.copy(fromKm(c.position_km));
      r.controls.target.copy(fromKm(c.target_km));
      r.camera.up.fromArray(c.up).normalize();
      r.followId = c.follow_id;
      r.lastFollow = null;
      r.camera.lookAt(r.controls.target);
      r.controls.update();
      r.dirty = true;
      latest.current.onFollow(c.follow_id);
    }, [ready, props.cameraRestore]);
    useImperativeHandle(
      ref,
      () => ({
        command,
        getCamera() {
          if (runtime.current) {
            runtime.current.dirty = true;
            runtime.current.draw();
          }
          return runtime.current ? captureCamera(runtime.current) : null;
        },
        exportPng() {
          const r = runtime.current;
          if (!r) return;
          r.dirty = true;
          r.draw();
          const source = r.renderer.domElement,
            canvas = document.createElement("canvas");
          canvas.width = source.width;
          canvas.height = source.height;
          const ctx = canvas.getContext("2d")!,
            ratio = r.renderer.getPixelRatio();
          ctx.drawImage(source, 0, 0);
          ctx.font = String(13 * ratio) + "px sans-serif";
          ctx.fillStyle = "#d5ddeb";
          latest.current.overlay.forEach((line, i) =>
            ctx.fillText(line, 24 * ratio, (30 + i * 23) * ratio),
          );
          for (const label of labels.current!.children) {
            const el = label as HTMLDivElement;
            if (el.style.display === "none") continue;
            ctx.fillStyle = el.style.color;
            ctx.fillText(
              el.textContent || "",
              Number(el.dataset.x) * ratio,
              (Number(el.dataset.y) + 10) * ratio,
            );
          }
          canvas.toBlob((blob) => {
            if (blob) download(blob, "ORBIT-scene.png");
          });
        },
      }),
      [],
    );
    return (
      <div className="scene-host" ref={host} aria-label="自由视角三维画布">
        <div className="scene-labels" ref={labels} />
        {props.grid && props.layers.length > 0 && (
          <div className="scene-scale">
            参考外环半径 {scale.toPrecision(4)} AU
          </div>
        )}
        {error && (
          <div className="webgl-error" role="alert">
            {error}
          </div>
        )}
      </div>
    );
  },
);
