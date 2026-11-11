import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  Axis3D,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  Grid3X3,
  Globe2,
  Move3D,
  RotateCw,
  Layers3,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api, download, post } from "./api";
import { LayerAppearance } from "./LayerAppearance";
import { ImportDialog } from "./ImportDialog";
import { PlanetDialog } from "./PlanetDialog";
import { PlanetInspector } from "./PlanetInspector";
import { usePlanetWindow } from "./usePlanetWindow";
import { planetSnapshot } from "./planetMath";
import { OrbitScene } from "./Scene";
import type { SceneHandle } from "./Scene";
import {
  calendarSeconds,
  offsetSeconds,
  sampleAt,
  utcInputSeconds,
  utcLabel,
} from "./time";
import {
  defaultMetadata,
  elementFields,
  titles,
  DEFAULT_GLOW_SIZE,
  DEFAULT_LINE_WIDTH,
} from "./types";
import type {
  Curve,
  Dataset,
  Elements,
  Hypothesis,
  Layer,
  Leap,
  ProjectState,
  BodyId,
  CameraState,
  PlanetCatalog,
  SceneSystem,
} from "./types";

const PALETTE = ["#69caca", "#eebf78", "#9d9be9", "#e88eaa", "#8cbd87"];
const AU = 149597870.7;
const number = (n: number | null | undefined, digits = 4) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("en-US", { maximumFractionDigits: digits });
const niceDate = (s: string) => s.replace("T", " ").replace(/\.\d+Z$/, " UTC");
function Tool({
  label,
  children,
  onClick,
  disabled,
  active,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={`tool ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function App() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [base, setBase] = useState("");
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(86400);
  const [playing, setPlaying] = useState(false);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [axes, setAxes] = useState(false);
  const [grid, setGrid] = useState(true);
  const [fit, setFit] = useState(0);
  const [radius, setRadius] = useState(3 * AU);
  const [trailSeconds, setTrailSeconds] = useState(60 * 86400);
  const [importing, setImporting] = useState(false);
  const [initialFile, setInitialFile] = useState<File>();
  const [leaps, setLeaps] = useState<Leap[]>([]);
  const [status, setStatus] = useState("正在连接本地服务…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{
    curve: Curve;
    input: Hypothesis;
    epoch: string;
  } | null>(null);
  const [editEpoch, setEditEpoch] = useState("");
  const [conic, setConic] = useState<Curve | null>(null);
  const [conicEpoch, setConicEpoch] = useState("");
  const [help, setHelp] = useState(false);
  const [showParams, setShowParams] = useState(true);
  const [system, setSystem] = useState<SceneSystem>({
    center: "sun",
    frame: "J2000",
  });
  const [catalog, setCatalog] = useState<PlanetCatalog | null>(null);
  const [planetDialog, setPlanetDialog] = useState(false);
  const [stars, setStars] = useState(false);
  const [cameraRestore, setCameraRestore] = useState<CameraState | null>(null);
  const [following, setFollowing] = useState<string | null>(null);
  const planetIds = useMemo(
    () => [
      ...new Set(
        layers.filter((l) => l.kind === "planet").map((l) => l.body_id!),
      ),
    ],
    [layers],
  );
  const ephemeris = usePlanetWindow(
    planetIds,
    system,
    base,
    time,
    speed,
    leaps,
    catalog,
  );
  const planetTrailIds = useMemo(
    () =>
      layers
        .filter((l) => l.kind === "planet" && l.visible && l.showTrail)
        .map((l) => l.body_id!),
    [layers],
  );
  const planetTrails = usePlanetWindow(
    planetTrailIds,
    system,
    base,
    time,
    speed,
    leaps,
    catalog,
    trailSeconds,
  );
  const planetFrame = useMemo(
    () => planetSnapshot(ephemeris.data, time),
    [ephemeris.data, time],
  );
  const planetBuffer = useRef({
    data: ephemeris.data,
    active: planetIds.length > 0,
  });
  planetBuffer.current = { data: ephemeris.data, active: planetIds.length > 0 };
  const scene = useRef<SceneHandle>(null);
  const openProject = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const currentLayer = layers.find((l) => l.id === selected);
  const currentDataset = datasets.find(
    (d) => d.id === currentLayer?.dataset_id,
  );
  const current = useMemo(
    () =>
      currentDataset && base
        ? sampleAt(
            currentDataset.samples,
            time - offsetSeconds(currentDataset, base),
            currentDataset.metadata.max_interpolation_gap_s,
          )
        : null,
    [currentDataset, base, time],
  );
  const sourceSample = current?.sample;
  const referenceEpoch =
    currentLayer?.hypothesis?.metadata.reference_epoch ||
    currentDataset?.metadata.reference_epoch ||
    "J2000.0 (JD 2451545.0 TT)";
  const currentPlanet = currentLayer?.body_id
    ? planetFrame?.bodies[currentLayer.body_id]
    : undefined;
  const displayedElements =
    currentLayer?.kind === "hypothesis"
      ? currentLayer.hypothesis?.elements
      : sourceSample?.elements;
  const utc = utcLabel(base, time, leaps);
  const bounds = useMemo(() => {
    if (!base) return [0, 0];
    if (planetIds.length && catalog && leaps.length)
      return [
        utcInputSeconds(catalog.min_utc.replace(/Z$/, ""), base, leaps),
        utcInputSeconds(catalog.max_utc.replace(/Z$/, ""), base, leaps),
      ];
    if (!datasets.length) return [0, 0];
    return [
      Math.min(...datasets.map((d) => offsetSeconds(d, base) + d.samples[0].t)),
      Math.max(
        ...datasets.map((d) => offsetSeconds(d, base) + d.samples.at(-1)!.t),
      ),
    ];
  }, [datasets, base, planetIds, catalog, leaps]);

  useEffect(() => {
    void api<PlanetCatalog>("/planets/catalog")
      .then(setCatalog)
      .catch((e) => setError(e.message));
    api<{ leap_seconds: Leap[] }>("/presets")
      .then((p) => {
        setLeaps(p.leap_seconds);
        setStatus("本地服务已连接");
      })
      .catch((e) => {
        setStatus("服务未连接");
        setError(e.message);
      });
  }, []);
  useEffect(() => {
    version.current++;
    setEditing(false);
    setPreview(null);
    setConic(null);
  }, [selected]);
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    let previous = performance.now();
    let lastUpdate = previous;
    const tick = (now: number) => {
      if (now - lastUpdate >= 16) {
        const dt = Math.min((now - previous) / 1000, 0.25) * speed;
        previous = now;
        lastUpdate = now;
        setTime((t) => {
          const next = t + dt;
          const buffer = planetBuffer.current;
          if (
            buffer.active &&
            (!buffer.data ||
              Math.min(next, end) < buffer.data.times[0] ||
              Math.min(next, end) > buffer.data.times.at(-1)!)
          )
            return t;
          if (next >= end) {
            setPlaying(false);
            return end;
          }
          return next;
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, end]);
  const togglePlay = useCallback(() => {
    if (end <= start) return;
    if (time >= end) setTime(start);
    setPlaying((v) => !v);
  }, [end, start, time]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest(
          "input,textarea,select,button",
        ) ||
        importing ||
        planetDialog ||
        help
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay, importing, help, planetDialog]);

  function patchLayer(id: string, patch: Partial<Layer>) {
    setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function addDataset(ds: Dataset) {
    if (!layers.length)
      setSystem({ center: ds.metadata.center, frame: ds.metadata.frame });
    const nextBase = base || ds.reference_tai;
    const offset =
      calendarSeconds(ds.reference_tai) - calendarSeconds(nextBase);
    setDatasets((prev) => [...prev, ds]);
    setBase(nextBase);
    const first = ds.samples[0].t + offset,
      last = ds.samples.at(-1)!.t + offset;
    setStart(layers.length ? Math.min(start, first) : first);
    setEnd(layers.length ? Math.max(end, last) : last);
    const layer: Layer = {
      id: crypto.randomUUID(),
      dataset_id: ds.id,
      kind: "dataset",
      name: ds.metadata.object_name,
      glowSize: DEFAULT_GLOW_SIZE,
      lineWidth: DEFAULT_LINE_WIDTH,
      color: PALETTE[layers.length % PALETTE.length],
      visible: true,
      showTrack: true,
      showTrail: true,
      showLabel: true,
    };
    setLayers((ls) => [...ls, layer]);
    setSelected(layer.id);
    setTime(first);
    setPlaying(false);
    setImporting(false);
    setInitialFile(undefined);
    setError("");
    setStatus(`已导入 ${ds.samples.length.toLocaleString()} 个有效采样点`);
  }
  async function addPlanets(
    ids: BodyId[],
    coordinateSystem: SceneSystem,
    epoch: string,
  ) {
    if (!catalog?.ready || !leaps.length)
      throw new Error("本地星历或时间预设尚未就绪。");
    const chosen = ids.filter((id) => !planetIds.includes(id));
    if (!chosen.length) throw new Error("所选行星已经在场景中。");
    if (!base) {
      const tai =
        utcInputSeconds(epoch, "2000-01-01T00:00:00", leaps) +
        calendarSeconds("2000-01-01T00:00:00");
      if (!Number.isFinite(tai)) throw new Error("请填写有效的 UTC 初始日期。");
      const utcEpoch = Date.parse(epoch + "Z");
      if (
        utcEpoch < Date.parse(catalog.min_utc) ||
        utcEpoch > Date.parse(catalog.max_utc)
      )
        throw new Error("行星日期需在 1972–2150 年星历范围内。");
      const nextBase = new Date(tai * 1000).toISOString().replace(/Z$/, "");
      setBase(nextBase);
      setStart(0);
      setTime(0);
      setEnd(
        Math.min(
          365.25 * 86400,
          utcInputSeconds(catalog.max_utc.replace(/Z$/, ""), nextBase, leaps),
        ),
      );
      setSystem(coordinateSystem);
      setSpeed(3600);
    }
    const added: Layer[] = chosen.map((id) => {
      const body = catalog.bodies.find((b) => b.id === id)!;
      return {
        id: crypto.randomUUID(),
        kind: "planet",
        body_id: id,
        name: body.name,
        color: body.color,
        visible: true,
        showTrack: true,
        showTrail: false,
        showLabel: true,
        showMeridian: id === "earth",
        glowSize: DEFAULT_GLOW_SIZE,
        lineWidth: DEFAULT_LINE_WIDTH,
      };
    });
    setLayers((current) => [...current, ...added]);
    setSelected(added[0].id);
    setPlaying(false);
    setPlanetDialog(false);
    setStatus("已添加 " + added.length + " 个行星图层");
  }
  async function loadSample() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/examples/sample");
      if (!response.ok) throw new Error("未找到样例文件");
      const blob = await response.blob();
      setInitialFile(
        new File([blob], "参考星历表_Sat_ELEMENTS.csv", { type: "text/csv" }),
      );
      setImporting(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function removeLayer(id: string) {
    const next = layers.filter((l) => l.id !== id);
    setLayers(next);
    if (selected === id) setSelected(next[0]?.id ?? null);
    const keep = new Set(next.map((l) => l.dataset_id));
    const remaining = datasets.filter((d) => keep.has(d.id));
    setDatasets(remaining);
    setPlaying(false);
    if (remaining.length && !next.some((l) => l.kind === "planet")) {
      const lo = Math.min(
        ...remaining.map((d) => offsetSeconds(d, base) + d.samples[0].t),
      );
      const hi = Math.max(
        ...remaining.map((d) => offsetSeconds(d, base) + d.samples.at(-1)!.t),
      );
      let from = Math.max(start, lo),
        to = Math.min(end, hi);
      if (from > to) {
        from = lo;
        to = hi;
      }
      setStart(from);
      setEnd(to);
      setTime((t) => Math.max(from, Math.min(to, t)));
    }
    if (!next.length) {
      setPlaying(false);
      setBase("");
      setTime(0);
      setStart(0);
      setEnd(0);
    }
  }
  function newProject() {
    if (
      layers.length &&
      !window.confirm("新建工作台将清空当前会话。请先保存需要保留的项目。")
    )
      return;
    setDatasets([]);
    setLayers([]);
    setSelected(null);
    setBase("");
    setTime(0);
    setStart(0);
    setEnd(0);
    setPlaying(false);
    setCameraRestore(null);
    setFollowing(null);
    setPreview(null);
    setConic(null);
    setError("");
    setStatus("新工作台已就绪");
  }
  async function saveProject() {
    setBusy(true);
    setError("");
    try {
      const state: ProjectState = {
        layers,
        selected,
        clock: { base_tai: base, time, speed, start, end },
        axes,
        grid,
        radius_km: radius,
        trail_s: trailSeconds,
        scene: system,
        stars,
        camera: scene.current?.getCamera() || undefined,
      };
      const project = await post<unknown>("/projects/export", {
        dataset_ids: datasets.map((d) => d.id),
        state,
      });
      download(
        new Blob([JSON.stringify(project)], { type: "application/json" }),
        "ORBIT-project.orbit.json",
      );
      setStatus("项目已下载，含源数据与清洗记录");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restoreProject(file?: File) {
    if (!file) return;
    if (
      layers.length &&
      !window.confirm("打开项目会替换当前工作台，是否继续？")
    )
      return;
    setBusy(true);
    setPlaying(false);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const restored = await api<{ state: ProjectState; datasets: Dataset[] }>(
        "/projects/import",
        { method: "POST", body },
      );
      const s = restored.state;
      setSystem(
        s.scene || {
          center: restored.datasets[0].metadata.center,
          frame: restored.datasets[0].metadata.frame,
        },
      );
      setStars(s.stars || false);
      setCameraRestore(s.camera || null);
      setFollowing(s.camera?.follow_id || null);
      if (!s.camera) setFit((v) => v + 1);
      setDatasets(restored.datasets);
      setLayers(s.layers);
      setSelected(
        s.layers.some((l) => l.id === s.selected)
          ? s.selected
          : (s.layers[0]?.id ?? null),
      );
      setBase(s.clock.base_tai);
      setTime(s.clock.time);
      setSpeed(s.clock.speed);
      setAxes(s.axes);
      setGrid(s.grid);
      setRadius(s.radius_km);
      setTrailSeconds(s.trail_s);
      const lo = Math.min(
        ...restored.datasets.map(
          (d) => offsetSeconds(d, s.clock.base_tai) + d.samples[0].t,
        ),
      );
      const hi = Math.max(
        ...restored.datasets.map(
          (d) => offsetSeconds(d, s.clock.base_tai) + d.samples.at(-1)!.t,
        ),
      );
      setStart(s.clock.start ?? (Number.isFinite(lo) ? lo : 0));
      setEnd(s.clock.end ?? (Number.isFinite(hi) ? hi : 86400));
      setConic(null);
      setPreview(null);
      setEditing(false);
      setStatus("项目已恢复，采样位置已重新计算");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (openProject.current) openProject.current.value = "";
    }
  }
  function startEditing() {
    if (!displayedElements) return;
    setPlaying(false);
    setEditEpoch(
      currentLayer?.kind === "hypothesis"
        ? currentLayer.source_epoch || ""
        : sourceSample!.epoch_utc,
    );
    setDraft(
      Object.fromEntries(
        elementFields.map((k) => [k, String(displayedElements[k])]),
      ),
    );
    setEditing(true);
    setPreview(null);
    setConic(null);
  }
  async function calculate(edited: boolean) {
    if (!currentDataset || (!edited && !displayedElements)) return;
    setBusy(true);
    setError("");
    const requestVersion = ++version.current;
    try {
      const elements = edited
        ? (Object.fromEntries(
            elementFields.map((k) => [
              k,
              draft[k]?.trim() ? Number(draft[k]) : NaN,
            ]),
          ) as Elements)
        : displayedElements!;
      if (Object.values(elements).some((v) => !Number.isFinite(v)))
        throw new Error("请填写完整、有限的轨道根数。");
      if (!Number.isFinite(radius) || radius <= 0)
        throw new Error("显示半径必须是正数。");
      const input: Hypothesis = {
        elements,
        metadata: currentDataset.metadata,
        radius_km: radius,
        request_version: requestVersion,
      };
      const curve = await post<Curve>("/orbits/preview", input);
      if (requestVersion !== version.current) return;
      const epoch = edited
        ? editEpoch
        : currentLayer?.kind === "hypothesis"
          ? currentLayer.source_epoch || ""
          : sourceSample!.epoch_utc;
      if (edited) setPreview({ curve, input, epoch });
      else {
        setConic(curve);
        setConicEpoch(epoch);
      }
      setPlaying(false);
    } catch (e) {
      if (requestVersion === version.current) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function keepHypothesis() {
    if (!preview || !currentDataset) return;
    const layer: Layer = {
      id: crypto.randomUUID(),
      dataset_id: currentDataset.id,
      kind: "hypothesis",
      name: `${currentLayer?.name?.slice(0, 110)} · 假设`,
      glowSize: DEFAULT_GLOW_SIZE,
      color: PALETTE[layers.length % PALETTE.length],
      visible: true,
      showTrack: true,
      showTrail: false,
      showLabel: true,
      hypothesis: preview.input,
      curve: preview.curve,
      source_epoch: preview.epoch,
    };
    setLayers((ls) => [...ls, layer]);
    setSelected(layer.id);
    setPreview(null);
    setEditing(false);
    setStatus("已另存静态假设图层，未进行时间传播");
  }
  function jumpSample(direction: number) {
    if (!currentDataset || !base) return;
    setPlaying(false);
    const offset = offsetSeconds(currentDataset, base);
    const local = time - offset;
    const found =
      direction > 0
        ? currentDataset.samples.find((s) => s.t > local + 1e-6)
        : [...currentDataset.samples].reverse().find((s) => s.t < local - 1e-6);
    if (found) setTime(Math.max(start, Math.min(end, found.t + offset)));
  }
  function changeRange(which: "start" | "end", value: string) {
    const t = utcInputSeconds(value, base, leaps);
    if (!Number.isFinite(t)) return;
    if (
      t < bounds[0] - 0.001 ||
      t > bounds[1] + 0.001 ||
      (which === "start" ? t > end : t < start)
    ) {
      setError("时间范围需位于数据覆盖范围内，且起点不晚于终点。");
      return;
    }
    setPlaying(false);
    if (which === "start") {
      setStart(t);
      setTime((v) => Math.max(v, t));
    } else {
      setEnd(t);
      setTime((v) => Math.min(v, t));
    }
  }
  const position =
    currentLayer?.kind === "planet"
      ? currentPlanet?.position
      : currentLayer?.kind === "hypothesis"
        ? currentLayer.curve?.position_km
        : current?.position;
  const distance = position ? Math.hypot(...position) : null;
  const sceneCurve = preview?.curve || conic;
  const mode =
    currentLayer?.kind === "planet"
      ? "行星星历"
      : currentLayer?.kind === "hypothesis"
        ? "静态假设"
        : current?.interpolated
          ? "位置插值"
          : "源采样";

  return (
    <div className="workbench">
      <header className="app-header">
        <a className="brand" href="/" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">
            <span />
          </span>
          <strong>ORBIT</strong>
        </a>
        <div className="header-actions">
          <span className="local-badge">
            <i />
            本地运行
          </span>
          <span className="version">v0.2</span>
          <Tool label="使用说明" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
          </Tool>
        </div>
      </header>
      <div className="toolbar">
        <div className="toolbar-group">
          <button
            className="primary compact"
            onClick={() => {
              setInitialFile(undefined);
              setPlaying(false);
              setImporting(true);
            }}
            disabled={busy}
          >
            <Plus size={15} />
            导入数据
          </button>
          <button
            className="quiet compact"
            onClick={() => {
              setPlanetDialog(true);
              setPlaying(false);
            }}
            disabled={busy}
          >
            <Globe2 size={15} />
            添加行星
          </button>
          <Tool label="新建工作台" onClick={newProject} disabled={busy}>
            <FilePlus2 size={17} />
          </Tool>
          <Tool
            label="打开项目"
            onClick={() => openProject.current?.click()}
            disabled={busy}
          >
            <FolderOpen size={17} />
          </Tool>
          <Tool
            label="保存项目"
            onClick={saveProject}
            disabled={busy || !layers.length}
          >
            <Save size={17} />
          </Tool>
          <input
            hidden
            type="file"
            ref={openProject}
            accept=".json"
            onChange={(e) => restoreProject(e.target.files?.[0])}
          />
          <span className="separator" />
          <Tool label="恢复并适配视图" onClick={() => setFit((v) => v + 1)}>
            <Crosshair size={17} />
          </Tool>
          <Tool
            label="参考平面"
            onClick={() => setGrid((v) => !v)}
            active={grid}
          >
            <Grid3X3 size={17} />
          </Tool>
          <Tool label="坐标轴" onClick={() => setAxes((v) => !v)} active={axes}>
            <Axis3D size={17} />
          </Tool>
        </div>
        <div className="toolbar-group">
          <span className="toolbar-note">自由视角 / 轨道与行星</span>
          <Tool
            label="星空背景"
            onClick={() => setStars((v) => !v)}
            active={stars}
          >
            <Sparkles size={16} />
          </Tool>
          <button
            className="quiet compact"
            onClick={() => scene.current?.exportPng()}
            disabled={!layers.length}
          >
            <ArrowDownToLine size={15} />
            导出 PNG
          </button>
        </div>
      </div>
      <div className="workspace">
        <aside className="sidebar">
          <div className="panel-heading">
            <div>
              <Layers3 size={15} />
              <span>对象图层</span>
              <b>{layers.length.toString().padStart(2, "0")}</b>
            </div>
            <Tool
              label="添加图层"
              onClick={() => {
                setInitialFile(undefined);
                setImporting(true);
              }}
            >
              <Plus size={16} />
            </Tool>
          </div>
          <div className="layer-list">
            {!layers.length && (
              <div className="empty-layers">
                <span className="small-orbit" />
                <p>尚未添加对象</p>
                <span>导入 CSV / XLSX，构建你的轨道场景</span>
              </div>
            )}
            {layers.map((l, i) => (
              <div
                key={l.id}
                className={`layer-row ${selected === l.id ? "selected" : ""}`}
              >
                <button
                  className="visibility"
                  title="切换显隐"
                  aria-label={`${l.name}显隐`}
                  onClick={() => patchLayer(l.id, { visible: !l.visible })}
                >
                  {l.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <button
                  className="layer-select"
                  onClick={() => setSelected(l.id)}
                >
                  <i style={{ background: l.color }} />
                  <span>
                    <strong>{l.name}</strong>
                    <small>
                      {l.kind === "hypothesis"
                        ? "假设轨道 · 静态"
                        : l.kind === "planet"
                          ? "行星图层 · DE440s"
                          : `采样轨迹 ${String(i + 1).padStart(2, "0")}`}
                    </small>
                  </span>
                </button>
                <button
                  className="delete-layer"
                  title="移除图层"
                  aria-label={`移除${l.name}`}
                  onClick={() => removeLayer(l.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          {currentLayer?.kind === "planet" ? (
            <PlanetInspector
              layer={currentLayer}
              info={catalog?.bodies.find((b) => b.id === currentLayer.body_id)}
              state={currentPlanet}
              system={system}
              following={following === currentLayer.id}
              patch={(patch) => patchLayer(currentLayer.id, patch)}
              focus={() => scene.current?.command("focus")}
              follow={() => scene.current?.command("follow")}
            />
          ) : currentLayer && currentDataset ? (
            <div className="properties">
              <button
                className="properties-heading"
                onClick={() => setShowParams((v) => !v)}
              >
                <span>
                  <Settings2 size={14} />
                  对象属性
                </span>
                <ChevronRight
                  size={15}
                  className={showParams ? "rotate" : ""}
                />
              </button>
              {showParams && (
                <>
                  <div className="property-body">
                    <label className="name-field">
                      名称
                      <input
                        value={currentLayer.name}
                        onChange={(e) =>
                          patchLayer(currentLayer.id, { name: e.target.value })
                        }
                      />
                    </label>
                    <div className="layer-style">
                      <label>
                        颜色
                        <input
                          aria-label="轨道颜色"
                          type="color"
                          value={currentLayer.color}
                          onChange={(e) =>
                            patchLayer(currentLayer.id, {
                              color: e.target.value,
                            })
                          }
                        />
                      </label>
                      {(["showTrack", "showTrail", "showLabel"] as const).map(
                        (k, i) => (
                          <label key={k}>
                            <input
                              type="checkbox"
                              checked={currentLayer[k]}
                              disabled={
                                currentLayer.kind === "hypothesis" &&
                                k === "showTrail"
                              }
                              onChange={(e) =>
                                patchLayer(currentLayer.id, {
                                  [k]: e.target.checked,
                                })
                              }
                            />
                            {["轨道", "尾迹", "标签"][i]}
                          </label>
                        ),
                      )}
                    </div>
                    <LayerAppearance
                      layer={currentLayer}
                      patch={(patch) => patchLayer(currentLayer.id, patch)}
                    />
                    <div className="metadata-line">
                      <span>
                        {currentDataset.metadata.center === "sun"
                          ? "太阳中心"
                          : "地球中心"}
                      </span>
                      <span>{currentDataset.metadata.frame}</span>
                    </div>
                    <div
                      className={`assumption ${currentDataset.metadata.metadata_status === "verified" ? "verified" : ""}`}
                    >
                      <i />
                      {currentDataset.metadata.metadata_status === "verified"
                        ? "元数据已核实"
                        : "参考系为暂用假设"}
                    </div>
                    <div className="section-label">
                      轨道根数 <span>{mode}</span>
                    </div>
                    {displayedElements ? (
                      <dl className="elements">
                        {elementFields.map((f) => (
                          <div key={f}>
                            <dt>{titles[f]}</dt>
                            <dd>
                              {number(displayedElements[f], f === "e" ? 7 : 4)}
                              <small>
                                {f === "a" ? "km" : f === "e" ? "" : "°"}
                              </small>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="hint">当前时刻无有效采样或处于缺测区段。</p>
                    )}
                    <div className="source-time">
                      <span>根数源历元</span>
                      <code>
                        {currentLayer.kind === "hypothesis"
                          ? niceDate(currentLayer.source_epoch || "")
                          : sourceSample
                            ? niceDate(sourceSample.epoch_utc)
                            : "—"}
                      </code>
                    </div>
                    <div className="inspector-actions">
                      <button
                        className="quiet"
                        disabled={!displayedElements || busy}
                        onClick={() => calculate(false)}
                      >
                        密切轨道
                      </button>
                      <button
                        className="quiet"
                        disabled={!displayedElements || busy}
                        onClick={startEditing}
                      >
                        <Settings2 size={13} />
                        编辑参数
                      </button>
                    </div>
                    {editing && (
                      <section className="edit-panel">
                        <h3>
                          假设轨道预览{" "}
                          <button
                            aria-label="取消参数编辑"
                            onClick={() => {
                              version.current++;
                              setEditing(false);
                              setPreview(null);
                            }}
                          >
                            <X size={14} />
                          </button>
                        </h3>
                        <p className="hint">独立静态几何，不改写源数据。</p>
                        <p className="hint">基准历元：{niceDate(editEpoch)}</p>
                        {elementFields.map((f) => (
                          <label key={f}>
                            {titles[f]}
                            <input
                              aria-label={`编辑${f}`}
                              type="number"
                              step="any"
                              value={draft[f] || ""}
                              onChange={(e) => {
                                version.current++;
                                setDraft((d) => ({
                                  ...d,
                                  [f]: e.target.value,
                                }));
                                setPreview(null);
                              }}
                            />
                          </label>
                        ))}
                        <button
                          className="primary"
                          onClick={() => calculate(true)}
                          disabled={busy}
                        >
                          计算预览
                        </button>
                        {preview && (
                          <button className="quiet" onClick={keepHypothesis}>
                            <Plus size={13} />
                            另存假设图层
                          </button>
                        )}
                      </section>
                    )}
                    <details className="quality-details">
                      <summary>数据与清洗记录</summary>
                      <p>
                        {currentDataset.samples.length.toLocaleString()}{" "}
                        个有效采样点 ·{" "}
                        {String(currentDataset.stats.hyperbolic_rows)}{" "}
                        条双曲记录
                      </p>
                      {currentDataset.audit.map((v, i) => (
                        <p key={i}>{v}</p>
                      ))}
                      {currentDataset.warnings.map((v, i) => (
                        <p key={i}>{v}</p>
                      ))}
                      <p>{currentDataset.metadata.metadata_notes}</p>
                      <p>μ = {currentDataset.metadata.mu_km3_s2} km³/s²</p>
                      <p>{currentDataset.metadata.mu_source}</p>
                    </details>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="sidebar-footnote">
              <span>01</span>
              <p>
                从数据出发
                <br />
                <strong>探索轨道的几何与时间</strong>
              </p>
            </div>
          )}
        </aside>
        <main className="main-area">
          <section className="viewport" aria-label="三维轨道场景">
            <OrbitScene
              ref={scene}
              datasets={datasets}
              layers={layers}
              selected={selected}
              base={base}
              time={time}
              axes={axes}
              grid={grid}
              trailSeconds={trailSeconds}
              fit={fit}
              conic={sceneCurve}
              system={system}
              stars={stars}
              planetWindow={ephemeris.data}
              planetTrails={planetTrails.data}
              cameraRestore={cameraRestore}
              onFollow={setFollowing}
              onError={setError}
              overlay={[
                "ORBIT · " + (utc === "—" ? "静态场景" : niceDate(utc)),
                `${system.center === "earth" ? "地球中心" : "太阳中心"} / ${system.frame} · ${datasets[0]?.metadata.metadata_status === "provisional" ? "数据参考系暂用假设" : "场景参考系"}`,
                ...(currentPlanet?.quality === "approximate"
                  ? ["地球姿态近似：UT1≈UTC，极移=0"]
                  : []),
                ...(currentLayer ? [currentLayer.name + " · " + mode] : []),
                ...(distance
                  ? ["距离 " + number(distance / AU, 6) + " AU"]
                  : []),
                ...(sceneCurve
                  ? [
                      "密切/假设曲线 · " +
                        niceDate(preview?.epoch || conicEpoch),
                    ]
                  : []),
              ]}
            />
            {!layers.length && (
              <div className="view-corner">
                <span className="eyebrow">ORBITAL VIEW</span>
                <span>三维轨道工作空间</span>
              </div>
            )}
            {layers.length > 0 ? (
              <>
                <div className="scene-readout" aria-label="场景读数">
                  <div className="simulation-time">
                    <span className="eyebrow">模拟时间 / UTC</span>
                    <h2>
                      <time dateTime={utc}>
                        {utc === "—"
                          ? "—"
                          : `${utc.slice(0, 10)} ${utc.slice(11, 19)}`}
                      </time>
                    </h2>
                  </div>
                  <div
                    className="scene-reference"
                    title={`参考历元：${referenceEpoch}`}
                  >
                    {system.center === "sun" ? "太阳中心" : "地球中心"} ·{" "}
                    {system.frame}
                  </div>
                  {distance != null && (
                    <dl>
                      <div>
                        <dt>中心距离</dt>
                        <dd>
                          {number(distance / AU, 5)} <small>AU</small>
                        </dd>
                      </div>
                      <div>
                        <dt>
                          {currentLayer?.kind === "planet"
                            ? "星历插值速度"
                            : currentLayer?.kind === "hypothesis"
                              ? "假设密切速度"
                              : "源采样密切速度"}
                        </dt>
                        <dd>
                          {number(
                            currentLayer?.kind === "planet"
                              ? currentPlanet
                                ? Math.hypot(...currentPlanet.velocity)
                                : null
                              : currentLayer?.kind === "hypothesis"
                                ? currentLayer.curve?.speed_km_s
                                : sourceSample?.speed_km_s,
                            3,
                          )}{" "}
                          <small>km/s</small>
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
                <div className="scene-legend">
                  {layers
                    .filter((l) => l.visible)
                    .map((l) => (
                      <span key={l.id}>
                        <i style={{ background: l.color }} />
                        {l.name}
                        {l.kind === "hypothesis" ? " · 假设" : ""}
                      </span>
                    ))}
                </div>
                <div className="scene-bottom-note">
                  <span>
                    {currentLayer?.kind === "planet" && !currentPlanet
                      ? "行星位置读取中"
                      : currentLayer?.kind === "dataset" && !current
                        ? "所选对象：当前无数据"
                        : mode}
                  </span>
                </div>
                {sceneCurve && (
                  <div className="curve-banner">
                    <span>
                      {preview ? "假设几何预览" : "选中采样的密切轨道"} ·{" "}
                      {niceDate(preview?.epoch || conicEpoch)}
                      {sceneCurve.truncated ? " · 曲线已按半径截断" : ""}
                    </span>
                    <button
                      aria-label="关闭轨道预览"
                      onClick={() => {
                        setConic(null);
                        setPreview(null);
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-scene">
                <div className="orbit-emblem">
                  <span />
                  <span />
                  <span />
                  <i />
                </div>
                <span className="eyebrow">A NEW PERSPECTIVE ON ORBITS</span>
                <h1>
                  让轨道数据，
                  <br />
                  成为可探索的空间。
                </h1>
                <p>导入轨道根数，在三维视图中回放、观察与比较。</p>
                <div>
                  <button
                    className="primary"
                    onClick={() => {
                      setInitialFile(undefined);
                      setImporting(true);
                    }}
                  >
                    <Upload size={15} />
                    导入 CSV / XLSX
                  </button>
                  <button
                    className="quiet"
                    onClick={() => setPlanetDialog(true)}
                  >
                    <Globe2 size={15} />
                    添加行星
                  </button>
                  <button
                    className="quiet"
                    onClick={loadSample}
                    disabled={busy}
                  >
                    打开样例 <ChevronRight size={14} />
                  </button>
                </div>
                <span className="empty-caption">
                  本地处理 / 多对象图层 / 几何分析
                </span>
              </div>
            )}
            <div className="view-tools">
              <select
                aria-label="标准视角"
                defaultValue=""
                onChange={(e) => {
                  scene.current?.command(e.target.value as "top");
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  自由视角
                </option>
                <option value="top">俯视 XY</option>
                <option value="front">正视 XZ</option>
                <option value="side">侧视 YZ</option>
              </select>
              <Tool
                label="聚焦选中对象"
                onClick={() => scene.current?.command("focus")}
                disabled={!currentLayer}
              >
                <Crosshair size={17} />
              </Tool>
              <Tool
                label="跟随选中对象"
                onClick={() => scene.current?.command("follow")}
                active={!!selected && following === selected}
                disabled={!currentLayer}
              >
                <Move3D size={17} />
              </Tool>
              <Tool
                label="向左滚转15度"
                onClick={() => scene.current?.command("rollLeft")}
              >
                <RotateCcw size={16} />
              </Tool>
              <Tool
                label="向右滚转15度"
                onClick={() => scene.current?.command("rollRight")}
              >
                <RotateCw size={16} />
              </Tool>
              <Tool label="适配可见轨迹" onClick={() => setFit((v) => v + 1)}>
                <Crosshair size={18} />
              </Tool>
              <Tool label="恢复默认视图" onClick={() => setFit((v) => v + 1)}>
                <RotateCcw size={17} />
              </Tool>
            </div>
          </section>
          {(ephemeris.loading ||
            ephemeris.error ||
            planetTrails.loading ||
            planetTrails.error) && (
            <div
              className={
                "ephemeris-banner " +
                (ephemeris.error || planetTrails.error ? "failed" : "")
              }
            >
              {ephemeris.error ||
                planetTrails.error ||
                (planetTrails.loading
                  ? "正在读取行星尾迹…"
                  : "正在读取本地星历…")}
            </div>
          )}
          <section className="timeline" aria-label="时间轴">
            <div className="timeline-heading">
              <div>
                <Activity size={14} />
                <strong>时间轴</strong>
                <span>
                  {planetIds.length ? "采样回放 / 行星星历" : "采样数据回放"}
                </span>
              </div>
              <div className="timeline-options">
                <label>
                  尾迹{" "}
                  <select
                    aria-label="尾迹时长"
                    value={trailSeconds}
                    onChange={(e) => setTrailSeconds(Number(e.target.value))}
                  >
                    {[1, 7, 30, 60, 180, 365].map((d) => (
                      <option key={d} value={d * 86400}>
                        {d} 天
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  曲线半径{" "}
                  <input
                    aria-label="曲线显示半径AU"
                    title="密切轨道和参数预览曲线的显示截断半径，以中心天体为原点；不改变轨道数据。"
                    type="number"
                    min="0.00001"
                    step="0.5"
                    value={Number((radius / AU).toPrecision(8))}
                    onChange={(e) => {
                      version.current++;
                      setRadius(Number(e.target.value) * AU);
                      setPreview(null);
                      setConic(null);
                    }}
                  />
                  <span>AU</span>
                </label>
              </div>
            </div>
            <div className="timeline-ruler">
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i}>
                  {base
                    ? utcLabel(
                        base,
                        start + ((end - start) * i) / 4,
                        leaps,
                      ).slice(0, 10)
                    : "—"}
                </span>
              ))}
            </div>
            <div className="timeline-tracks">
              {layers
                .filter((l) => l.kind === "dataset")
                .map((l) => {
                  const ds = datasets.find((d) => d.id === l.dataset_id)!;
                  const from = offsetSeconds(ds, base) + ds.samples[0].t,
                    to = offsetSeconds(ds, base) + ds.samples.at(-1)!.t;
                  const left =
                      100 *
                      Math.max(0, (from - start) / Math.max(1, end - start)),
                    right =
                      100 *
                      Math.min(1, (to - start) / Math.max(1, end - start));
                  return (
                    <div key={l.id} className="track" title={l.name}>
                      <span
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(0, right - left)}%`,
                          background: l.color,
                        }}
                      />
                    </div>
                  );
                })}
              {!layers.length && (
                <div className="track">
                  <span className="placeholder-track" />
                </div>
              )}
              {layers
                .filter((l) => l.kind === "planet")
                .map((l) => (
                  <div
                    className="track planet-track"
                    title={l.name + " · 星历覆盖"}
                    key={l.id}
                  >
                    <span
                      style={{ left: 0, width: "100%", background: l.color }}
                    />
                  </div>
                ))}
              <div
                className="playhead"
                style={{
                  left: `${100 * Math.max(0, Math.min(1, (time - start) / Math.max(1, end - start)))}%`,
                }}
              />
              <input
                aria-label="时间游标"
                className="time-slider"
                type="range"
                min={start}
                max={Math.max(start + 0.001, end)}
                step="any"
                value={time}
                disabled={!layers.length || start === end}
                onChange={(e) => {
                  setPlaying(false);
                  setTime(Number(e.target.value));
                }}
              />
            </div>
            <div className="transport">
              <div className="playback">
                <Tool
                  label="前一采样"
                  onClick={() => jumpSample(-1)}
                  disabled={!currentDataset || editing}
                >
                  <SkipBack size={16} />
                </Tool>
                <button
                  className="play-button"
                  aria-label={playing ? "暂停" : "播放"}
                  disabled={
                    !layers.length ||
                    end <= start ||
                    editing ||
                    (planetIds.length > 0 && !planetFrame)
                  }
                  onClick={togglePlay}
                >
                  {playing ? (
                    <Pause size={17} fill="currentColor" />
                  ) : (
                    <Play size={17} fill="currentColor" />
                  )}
                </button>
                <Tool
                  label="后一采样"
                  onClick={() => jumpSample(1)}
                  disabled={!currentDataset || editing}
                >
                  <SkipForward size={16} />
                </Tool>
                <select
                  aria-label="播放倍率"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  {[
                    [1, "1 秒 / 秒"],
                    [60, "1 分 / 秒"],
                    [3600, "1 时 / 秒"],
                    [86400, "1 天 / 秒"],
                    [864000, "10 天 / 秒"],
                    [2592000, "30 天 / 秒"],
                    [31557600, "1 年 / 秒"],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <code className="current-time">
                {base ? niceDate(utc) : "尚无时间数据"}
              </code>
              <div className="range-fields">
                <label>
                  起
                  <input
                    aria-label="回放起点"
                    type="datetime-local"
                    step="1"
                    disabled={!base}
                    value={
                      base ? utcLabel(base, start, leaps).slice(0, 19) : ""
                    }
                    onChange={(e) => changeRange("start", e.target.value)}
                  />
                </label>
                <label>
                  止
                  <input
                    aria-label="回放终点"
                    type="datetime-local"
                    step="1"
                    disabled={!base}
                    value={base ? utcLabel(base, end, leaps).slice(0, 19) : ""}
                    onChange={(e) => changeRange("end", e.target.value)}
                  />
                </label>
              </div>
            </div>
          </section>
        </main>
      </div>
      <footer className="statusbar">
        <span>
          {busy ? <Loader2 size={12} className="spin" /> : <i />}
          {status}
        </span>
        <span>
          {datasets
            .reduce((sum, d) => sum + d.samples.length, 0)
            .toLocaleString()}{" "}
          采样点{planetIds.length > 0 ? " / " + planetIds.length + " 行星" : ""}
          <span className="status-separator">/</span>导入数据无时间传播
          <span className="status-separator">/</span>WebGL2
        </span>
      </footer>
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button aria-label="关闭错误" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {importing && (
        <ImportDialog
          initialFile={initialFile}
          scene={
            datasets[0]?.metadata ||
            (layers.length
              ? {
                  ...defaultMetadata,
                  ...system,
                  metadata_status: "verified",
                  metadata_notes: "与当前行星场景使用相同的中心和参考系",
                }
              : undefined)
          }
          onClose={() => {
            setImporting(false);
            setInitialFile(undefined);
          }}
          onImport={addDataset}
        />
      )}
      {planetDialog && (
        <PlanetDialog
          catalog={catalog}
          existing={planetIds}
          scene={layers.length ? system : null}
          busy={busy}
          onClose={() => setPlanetDialog(false)}
          onAdd={addPlanets}
        />
      )}
      {help && (
        <div className="modal-backdrop">
          <section className="help-dialog" role="dialog" aria-label="使用说明">
            <header>
              <div>
                <span className="eyebrow">GETTING STARTED</span>
                <h2>从一份星历表开始</h2>
              </div>
              <button aria-label="关闭说明" onClick={() => setHelp(false)}>
                <X size={18} />
              </button>
            </header>
            <ol>
              <li>
                导入 CSV / XLSX，选择中心天体、坐标系、根数历元和时间体系。
              </li>
              <li>
                运行预检。确认完全重复去重，逐组选取冲突记录，再次预检后添加。
              </li>
              <li>
                时间轴回放导入的采样位置；采样之间为显示插值，超出数据覆盖范围不外推。
              </li>
              <li>
                选择对象查看根数。编辑参数生成静态几何预览，可另存假设图层。
              </li>
              <li>保存项目包含源数据、元数据与清洗记录；PNG 输出当前场景。</li>
            </ol>
            <p className="hint">
              空格播放/暂停。左键旋转、滚轮缩放、右键平移，可自由翻转；聚焦与跟随可近距离查看行星。行星使用本地星历，导入数据
              不含时间传播。样例参考系暂按日心 J2000 赤道面，待核实。时间轴支持
              1972 年起的数据，未来 UTC 使用现有闰秒表。
            </p>
            <button className="primary" onClick={() => setHelp(false)}>
              开始探索 <Sparkles size={14} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
