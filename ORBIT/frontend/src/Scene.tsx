import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { download } from "./api";
import { offsetSeconds, sampleAt } from "./time";
import { drawingIndices, drawingSegments } from "./geometry";
import type { Curve, Dataset, Layer, Vec3 } from "./types";

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
};
export type SceneHandle = { exportPng: () => void };
type Marker = {
  layer: Layer;
  dataset: Dataset;
  point: THREE.Sprite;
  label: HTMLDivElement;
  trail: THREE.LineSegments;
  trailBuffer: Float32Array;
  offset: number;
  displaySegments: [number, number][];
  labelX?: number;
  labelY?: number;
};
type Runtime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  group: THREE.Group;
  markers: Marker[];
  unit: number;
};
const v3 = (v: Vec3, unit: number) =>
  new THREE.Vector3(v[0] / unit, v[1] / unit, v[2] / unit);
function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material))
        mesh.material.forEach((m) => m.dispose());
      else mesh.material.dispose();
    }
  });
  group.clear();
}
function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.09, "rgba(255,255,255,1)");
  gradient.addColorStop(0.22, "rgba(255,255,255,.42)");
  gradient.addColorStop(0.5, "rgba(255,255,255,.09)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
function lineSegments(
  points: Vec3[],
  unit: number,
  color: string,
  breaks: Set<number>,
  opacity: number,
) {
  const values = [];
  for (const point of drawingSegments(points, breaks, unit * 0.0004))
    values.push(point[0] / unit, point[1] / unit, point[2] / unit);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(values, 3),
  );
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

export const OrbitScene = forwardRef<SceneHandle, Props>(
  function OrbitScene(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const labels = useRef<HTMLDivElement>(null);
    const runtime = useRef<Runtime | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const [error, setError] = useState("");
    const [ready, setReady] = useState(false);
    const [resizeTick, setResizeTick] = useState(0);
    const [scale, setScale] = useState(1);
    useEffect(() => {
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          preserveDrawingBuffer: true,
        });
      } catch {
        setError("无法启动 WebGL2。请启用浏览器硬件加速，并检查显卡驱动。");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor("#080d13");
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.current!.prepend(renderer.domElement);
      const scene = new THREE.Scene();
      const group = new THREE.Group();
      scene.add(group);
      const camera = new THREE.PerspectiveCamera(34, 1, 0.001, 100);
      camera.up.set(0, 0, 1);
      camera.position.set(1.15, -2.15, 1.75);
      camera.lookAt(0, 0, 0);
      runtime.current = {
        renderer,
        scene,
        camera,
        group,
        markers: [],
        unit: 1,
      };
      const resize = () => {
        if (!host.current) return;
        const { width, height } = host.current.getBoundingClientRect();
        renderer.setSize(width, height);
        camera.aspect = width / height;
        const halfFov = Math.atan(
          Math.tan(THREE.MathUtils.degToRad(17)) * Math.min(1, camera.aspect),
        );
        camera.position
          .set(1.15, -2.15, 1.75)
          .setLength(1.12 / Math.sin(halfFov));
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        setResizeTick((v) => v + 1);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host.current!);
      resize();
      setReady(true);
      return () => {
        observer.disconnect();
        disposeGroup(group);
        renderer.dispose();
        renderer.domElement.remove();
        runtime.current = null;
      };
    }, []);

    useEffect(() => {
      const r = runtime.current;
      if (!r) return;
      disposeGroup(r.group);
      labels.current!.replaceChildren();
      r.markers = [];
      let bound = 1;
      const active = props.layers.filter((l) => l.visible);
      for (const layer of active) {
        const ds = props.datasets.find((d) => d.id === layer.dataset_id);
        if (!ds) continue;
        const points =
          layer.kind === "hypothesis"
            ? [
                ...(layer.curve?.points || []),
                ...(layer.curve ? [layer.curve.position_km] : []),
              ]
            : ds.samples.map((s) => s.position_km);
        for (const p of points) bound = Math.max(bound, Math.hypot(...p));
      }
      if (props.conic)
        for (const p of props.conic.points)
          bound = Math.max(bound, Math.hypot(...p));
      r.unit = bound;
      setScale(bound);
      const texture = glowTexture();
      const sprite = (color: string, size: number) => {
        const p = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: texture,
            color,
            transparent: true,
            depthTest: false,
            sizeAttenuation: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        p.scale.set(size, size, size);
        r.group.add(p);
        return p;
      };
      const central = sprite(
        props.datasets[0]?.metadata.center === "earth" ? "#7dbbef" : "#ffe0a3",
        0.047,
      );
      central.position.set(0, 0, 0);
      if (props.grid) {
        for (const radius of [0.25, 0.5, 0.75, 1]) {
          const points: Vec3[] = Array.from({ length: 181 }, (_, i) => [
            Math.cos((i * Math.PI) / 90) * radius,
            Math.sin((i * Math.PI) / 90) * radius,
            0,
          ]);
          r.group.add(lineSegments(points, 1, "#8c9eb7", new Set(), 0.13));
        }
        const extent = 1.12;
        const points: Vec3[] = [
          [-extent, 0, 0],
          [extent, 0, 0],
          [0, -extent, 0],
          [0, extent, 0],
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(
          points.map((p) => v3(p, 1)),
        );
        r.group.add(
          new THREE.LineSegments(
            geo,
            new THREE.LineBasicMaterial({
              color: "#67758a",
              transparent: true,
              opacity: 0.16,
            }),
          ),
        );
      }
      if (props.axes) {
        const axis = new THREE.AxesHelper(0.45);
        r.group.add(axis);
      }
      if (props.conic)
        r.group.add(
          lineSegments(props.conic.points, bound, "#f2cb77", new Set(), 0.7),
        );
      for (const layer of active) {
        const ds = props.datasets.find((d) => d.id === layer.dataset_id);
        if (!ds) continue;
        if (layer.showTrack) {
          const points =
            layer.kind === "hypothesis"
              ? layer.curve?.points || []
              : ds.samples.map((s) => s.position_km);
          r.group.add(
            lineSegments(
              points,
              bound,
              layer.color,
              new Set(layer.kind === "dataset" ? ds.breaks : []),
              layer.id === props.selected ? 0.67 : 0.36,
            ),
          );
        }
        const point = sprite(
          layer.color,
          layer.id === props.selected ? 0.032 : 0.024,
        );
        const label = document.createElement("div");
        label.className = "object-label";
        label.textContent = layer.name;
        label.style.color = layer.color;
        labels.current!.append(label);
        const trailBuffer = new Float32Array(4096 * 6);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          "position",
          new THREE.BufferAttribute(trailBuffer, 3).setUsage(
            THREE.DynamicDrawUsage,
          ),
        );
        geo.setDrawRange(0, 0);
        const colors = new Float32Array(4096 * 6);
        const color = new THREE.Color(layer.color);
        for (let i = 0; i < 4096; i++)
          for (let j = 0; j < 2; j++)
            color
              .clone()
              .multiplyScalar(0.1 + (0.9 * i) / 4095)
              .toArray(colors, (i * 2 + j) * 3);
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const trail = new THREE.LineSegments(
          geo,
          new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.94,
          }),
        );
        trail.frustumCulled = false;
        r.group.add(trail);
        r.markers.push({
          layer,
          dataset: ds,
          point,
          label,
          trail,
          trailBuffer,
          offset: props.base ? offsetSeconds(ds, props.base) : 0,
          displaySegments: drawingIndices(
            ds.samples.map((s) => s.position_km),
            new Set(ds.breaks),
            bound * 0.0004,
          ),
        });
      }
      // Dispose per-build shared texture together with its sprite materials on rebuild.
      return () => texture.dispose();
    }, [
      ready,
      props.datasets,
      props.layers,
      props.selected,
      props.grid,
      props.axes,
      props.fit,
      props.conic,
      props.base,
    ]);

    useEffect(() => {
      const r = runtime.current;
      if (!r || !host.current) return;
      const width = host.current.clientWidth,
        height = host.current.clientHeight;
      const occupied: { x: number; y: number; width: number }[] = [];
      const ordered = [...r.markers].sort(
        (a, b) =>
          Number(b.layer.id === props.selected) -
          Number(a.layer.id === props.selected),
      );
      for (const m of ordered) {
        const at =
          m.layer.kind === "hypothesis"
            ? m.layer.curve
              ? { position: m.layer.curve.position_km, index: 0 }
              : null
            : sampleAt(
                m.dataset.samples,
                props.time - m.offset,
                m.dataset.metadata.max_interpolation_gap_s,
              );
        m.point.visible = !!at;
        m.label.style.display = at && m.layer.showLabel ? "block" : "none";
        m.trail.visible =
          !!at && m.layer.showTrail && m.layer.kind === "dataset";
        if (!at) continue;
        m.point.position.copy(v3(at.position, r.unit));
        const projected = m.point.position.clone().project(r.camera);
        if (m.layer.showLabel) {
          const labelWidth = Math.min(m.label.offsetWidth, width - 32);
          const x = Math.max(
            12,
            Math.min(
              width - labelWidth - 12,
              ((projected.x + 1) * width) / 2 + 12,
            ),
          );
          let y = Math.max(
            12,
            Math.min(height - 28, ((-projected.y + 1) * height) / 2 - 6),
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
          if (y > height - 20 || projected.z < -1 || projected.z > 1)
            m.label.style.display = "none";
          else {
            occupied.push({ x, y, width: labelWidth });
            m.labelX = x;
            m.labelY = y;
            m.label.style.transform = `translate(${x}px, ${y}px)`;
          }
        }
        if (m.trail.visible) {
          const end = props.time - m.offset;
          const start = end - props.trailSeconds;
          const segments: number[] = [];
          for (const [a, b] of m.displaySegments) {
            const first = m.dataset.samples[a],
              last = m.dataset.samples[b];
            if (last.t <= start || first.t >= end) continue;
            const p0 =
              first.t < start
                ? sampleAt(
                    m.dataset.samples,
                    start,
                    m.dataset.metadata.max_interpolation_gap_s,
                  )?.position
                : first.position_km;
            const p1 = last.t > end ? at.position : last.position_km;
            if (p0 && p1)
              segments.push(
                p0[0] / r.unit,
                p0[1] / r.unit,
                p0[2] / r.unit,
                p1[0] / r.unit,
                p1[1] / r.unit,
                p1[2] / r.unit,
              );
          }
          const n = Math.min(4096, segments.length / 6);
          // Keep recent segments if an exceptionally complex tail exceeds the draw budget.
          m.trailBuffer.set(segments.slice(-n * 6));
          (
            m.trail.geometry.attributes.position as THREE.BufferAttribute
          ).needsUpdate = true;
          m.trail.geometry.setDrawRange(0, n * 2);
          const color = new THREE.Color(m.layer.color);
          const colors = m.trail.geometry.attributes
            .color as THREE.BufferAttribute;
          for (let i = 0; i < n; i++)
            for (let j = 0; j < 2; j++) {
              const brightness = 0.12 + (0.88 * i) / Math.max(1, n - 1);
              colors.setXYZ(
                i * 2 + j,
                color.r * brightness,
                color.g * brightness,
                color.b * brightness,
              );
            }
          colors.needsUpdate = true;
        }
      }
      r.renderer.render(r.scene, r.camera);
    }, [
      ready,
      resizeTick,
      props.time,
      props.layers,
      props.datasets,
      props.base,
      props.trailSeconds,
      props.selected,
      props.grid,
      props.axes,
      props.fit,
      props.conic,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        exportPng() {
          const r = runtime.current;
          if (!r) return;
          r.renderer.render(r.scene, r.camera);
          const source = r.renderer.domElement;
          const canvas = document.createElement("canvas");
          canvas.width = source.width;
          canvas.height = source.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(source, 0, 0);
          const ratio = r.renderer.getPixelRatio();
          ctx.font = `${14 * ratio}px sans-serif`;
          ctx.fillStyle = "#d5ddeb";
          latest.current.overlay.forEach((s, i) =>
            ctx.fillText(s, 24 * ratio, (30 + i * 24) * ratio),
          );
          for (const m of r.markers)
            if (
              m.point.visible &&
              m.layer.showLabel &&
              m.label.style.display !== "none"
            ) {
              ctx.fillStyle = m.layer.color;
              ctx.fillText(
                m.layer.name,
                (m.labelX || 0) * ratio,
                ((m.labelY || 0) + 10) * ratio,
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
      <div className="scene-host" ref={host}>
        <div className="scene-labels" ref={labels} />
        {props.grid && props.datasets.length > 0 && (
          <div className="scene-scale">
            参考外环半径{" "}
            {scale > 1e7
              ? (scale / 149597870.7).toFixed(3) + " AU"
              : scale.toPrecision(4) + " km"}
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
