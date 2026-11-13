export type Vec3 = [number, number, number];
export type Elements = {
  a: number;
  e: number;
  i: number;
  raan: number;
  arg_periapsis: number;
  true_anomaly: number;
};
export const elementFields = [
  "a",
  "e",
  "i",
  "raan",
  "arg_periapsis",
  "true_anomaly",
] as const;
export const stateFields = ["x", "y", "z", "vx", "vy", "vz"] as const;
export type InputType = "elements" | "cartesian";
export const titles: Record<string, string> = {
  epoch: "数据历元",
  a: "半长轴 a",
  e: "偏心率 e",
  i: "倾角 i",
  raan: "升交点赤经 Ω",
  arg_periapsis: "近心点幅角 ω",
  true_anomaly: "真近点角 ν",
  mean_anomaly: "平近点角 M",
  x: "位置 X",
  y: "位置 Y",
  z: "位置 Z",
  vx: "速度 VX",
  vy: "速度 VY",
  vz: "速度 VZ",
};
export type Metadata = {
  object_name: string;
  center: "sun" | "earth";
  frame: "J2000" | "ECLIPJ2000";
  reference_epoch: string;
  epoch_mode: "per_row" | "single";
  single_epoch: string | null;
  time_scale: "UTC" | "TT" | "TDB";
  length_unit: "km" | "m" | "AU";
  speed_unit?: "km/s" | "m/s" | "AU/day" | "AU/s";
  angle_unit: "deg" | "rad";
  mu_km3_s2?: number | null;
  mu_source?: string;
  metadata_status: "provisional" | "verified";
  metadata_notes: string;
  max_interpolation_gap_s: number;
};
export const defaultMetadata: Metadata = {
  object_name: "轨道对象",
  center: "sun",
  frame: "J2000",
  reference_epoch: "J2000.0 (JD 2451545.0 TT)",
  epoch_mode: "per_row",
  single_epoch: null,
  time_scale: "UTC",
  length_unit: "km",
  speed_unit: "km/s",
  angle_unit: "deg",
  metadata_status: "provisional",
  metadata_notes: "参考平面暂按 J2000 赤道面，待核实；UTCG 按 UTC 解释。",
  max_interpolation_gap_s: 172800,
};
export type Sample = {
  source_rows: number[];
  t: number;
  epoch_utc: string;
  epoch_tai: string;
  position_km: Vec3;
  velocity_km_s: Vec3;
};
export type Dataset = {
  id: string;
  filename: string;
  source_format?: "csv" | "xlsx";
  worksheet?: string | null;
  input_type?: InputType;
  velocity_source?: "elements" | "provided" | "finite_difference";
  metadata: Metadata;
  reference_tai: string;
  samples: Sample[];
  breaks: number[];
  warnings: string[];
  audit: string[];
  stats: Record<string, unknown>;
  source_sha256: string;
};
export type Curve = {
  points: Vec3[];
  closed: boolean;
  truncated: boolean;
  position_km: Vec3;
  distance_km: number;
  speed_km_s: number | null;
  period_s: number | null;
  periapsis_km: number;
  orbit_type: string;
  warnings: string[];
  request_version: number;
};
export type Hypothesis = {
  elements: Elements;
  metadata: Metadata;
  radius_km: number;
  request_version: number;
};
// Glow size is the diameter at the inner halo stop (42% opacity).
export const GLOW_INNER_FRACTION = 0.22;
export const DEFAULT_GLOW_SIZE = 6;
export const DEFAULT_LINE_WIDTH = 1;
export type Layer = {
  id: string;
  dataset_id?: string;
  kind: "dataset" | "hypothesis" | "planet";
  body_id?: BodyId;
  showMeridian?: boolean;
  glowSize?: number;
  lineWidth?: number;
  name: string;
  color: string;
  visible: boolean;
  showTrack: boolean;
  showTrail: boolean;
  showLabel: boolean;
  hypothesis?: Hypothesis;
  curve?: Curve;
  source_epoch?: string;
};
export type Decisions = {
  deduplicate: boolean;
  sort: boolean;
  exclude_rows: number[];
  conflict_choices: Record<string, number>;
  override_units: boolean;
};
export type ImportSelection = {
  epoch_column: string;
  time_scale: Metadata["time_scale"];
  start: string | null;
  end: string | null;
  interval_s: number | null;
};
export type Inspection = {
  id: string;
  filename: string;
  source_format?: "csv" | "xlsx";
  worksheet?: string | null;
  worksheets?: string[];
  headers: string[];
  mapping: Record<string, string>;
  input_types: InputType[];
  requires_reduction?: boolean;
  source_input_rows?: number | null;
  source_count_exact?: boolean;
  source_bytes?: number;
  retained_bytes?: number;
  selection?: ImportSelection | null;
  input_rows: number;
  preview: { source_row: number; values: Record<string, string> }[];
};
export type ReductionJob = {
  id: string;
  status:
    "queued" | "running" | "cancelling" | "cancelled" | "completed" | "failed";
  phase: "counting" | "reading" | "processing" | "completed";
  scanned: number;
  total: number | null;
  total_exact: boolean;
  result?: Inspection | null;
  error?: { message: string } | null;
};
export type Report = {
  ok: boolean;
  issues: { message: string; source_rows: number[]; field?: string }[];
  warnings: string[];
  conflicts: {
    id: string;
    epoch_utc: string;
    resolved: boolean;
    records: {
      source_rows: number[];
      elements: Elements | null;
      position_km: Vec3;
      velocity_km_s: Vec3 | null;
    }[];
  }[];
  stats: Record<string, unknown>;
};
export type Leap = { utc_ms: number; offset: number };
export type ProjectState = {
  layers: Layer[];
  selected: string | null;
  clock: {
    base_tai: string;
    time: number;
    speed: number;
    start?: number;
    end?: number;
  };
  axes: boolean;
  grid: boolean;
  radius_km: number;
  trail_s: number;
  scene?: SceneSystem;
  camera?: CameraState;
  camera_keyframes?: CameraKeyframe[];
  camera_keyframes_enabled?: boolean;
  stars?: boolean;
};

export type BodyId =
  | "mercury"
  | "venus"
  | "earth"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune";
export type SceneSystem = {
  center: "sun" | "earth";
  frame: "J2000" | "ECLIPJ2000";
};
export type CameraState = {
  position_km: Vec3;
  target_km: Vec3;
  up: Vec3;
  follow_id: string | null;
  fov?: number;
  zoom?: number;
};
export type CameraKeyframe = { id: string; time: number; camera: CameraState };
export type PlanetInfo = {
  id: BodyId;
  name: string;
  color: string;
  radii_km: Vec3;
  texture: string;
  position_reference: "planet_center" | "system_barycenter";
};
export type PlanetCatalog = {
  ready: boolean;
  ephemeris: string;
  min_utc: string;
  max_utc: string;
  bodies: PlanetInfo[];
};
export type QuaternionArray = [number, number, number, number];
export type OrientationQuality =
  "observed" | "predicted" | "approximate" | "iau_nominal";
export type PlanetWindow = {
  reference_tai: string;
  times: number[];
  center: SceneSystem["center"];
  frame: SceneSystem["frame"];
  bodies: Partial<
    Record<
      BodyId,
      {
        positions_km: Vec3[];
        velocities_km_s: Vec3[];
        quaternions: QuaternionArray[];
        radii_km: Vec3;
        orientation_quality: OrientationQuality[];
      }
    >
  >;
  sun_positions_km: Vec3[];
  sun_velocities_km_s: Vec3[];
  warnings: string[];
  ephemeris: string;
};
export type PlanetState = {
  position: Vec3;
  velocity: Vec3;
  quaternion: QuaternionArray;
  radii: Vec3;
  quality: OrientationQuality;
};
export type PlanetSnapshot = {
  bodies: Partial<Record<BodyId, PlanetState>>;
  sun: Vec3;
  sunVelocity: Vec3;
};
