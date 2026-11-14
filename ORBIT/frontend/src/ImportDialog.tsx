import { useEffect, useRef, useState } from "react";
import { X, Upload, Check, AlertTriangle, ArrowRight } from "lucide-react";
import { api, post } from "./api";
import { SpkImportDialog } from "./SpkImportDialog";
import type { SpkInspection } from "./SpkImportDialog";
import { defaultMetadata, elementFields, stateFields, titles } from "./types";
import type {
  Dataset,
  Decisions,
  Inspection,
  Metadata,
  Report,
  InputType,
  ReductionJob,
} from "./types";

type Props = {
  initialFile?: File;
  scene?: Metadata;
  onClose: () => void;
  onImport: (ds: Dataset) => void;
};
type WorkbookChoice = {
  requires_worksheet: true;
  worksheets: string[];
};
const freshDecisions = (): Decisions => ({
  deduplicate: false,
  sort: false,
  exclude_rows: [],
  conflict_choices: {},
  override_units: false,
});
export function ImportDialog({ initialFile, scene, onClose, onImport }: Props) {
  const [file, setFile] = useState<File | undefined>(initialFile);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [spk, setSpk] = useState<SpkInspection | null>(null);
  const [worksheets, setWorksheets] = useState<string[]>([]);
  const [worksheet, setWorksheet] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [inputType, setInputType] = useState<InputType | "">("");
  const [generateVelocity, setGenerateVelocity] = useState(false);
  const [metadata, setMetadata] = useState<Metadata>({
    ...defaultMetadata,
    ...(scene
      ? {
          center: scene.center,
          frame: scene.frame,
          metadata_status: scene.metadata_status,
          metadata_notes: scene.metadata_notes,
        }
      : {}),
  });
  const [decisions, setDecisions] = useState<Decisions>(freshDecisions);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exclude, setExclude] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [sampleInterval, setSampleInterval] = useState("");
  const [selectionDirty, setSelectionDirty] = useState(false);
  const [reductionJob, setReductionJob] = useState<ReductionJob | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const activeReduction = useRef<{
    entry: string;
    job?: string;
    controller: AbortController;
  } | null>(null);
  const reductionActive =
    !!reductionJob &&
    ["queued", "running", "cancelling"].includes(reductionJob.status);
  const reductionPercent =
    reductionJob?.status === "completed"
      ? 100
      : reductionJob?.total
        ? Math.min(
            99,
            Math.floor((reductionJob.scanned / reductionJob.total) * 100),
          )
        : reductionJob && ["cancelled", "failed"].includes(reductionJob.status)
          ? 0
          : undefined;
  useEffect(
    () => () => {
      const active = activeReduction.current;
      if (active) {
        active.controller.abort();
        // Also handles a modal unmount before the start response has returned its job ID.
        void fetch(`/api/v1/imports/${active.entry}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {});
      }
    },
    [],
  );
  function resetInspection() {
    if (spk) void api(`/imports/${spk.id}`, { method: "DELETE" });
    setSpk(null);
    if (inspection) void api(`/imports/${inspection.id}`, { method: "DELETE" });
    setInspection(null);
    setMapping({});
    setInputType("");
    setGenerateVelocity(false);
    setReport(null);
    setDecisions(freshDecisions());
    setExclude("");
    setRangeStart("");
    setRangeEnd("");
    setSampleInterval("");
    setSelectionDirty(false);
    setReductionJob(null);
    setProcessingMessage("");
    setError("");
  }
  function updateMeta(patch: Partial<Metadata>) {
    if (patch.time_scale && inspection?.selection) setSelectionDirty(true);
    setMetadata((m) => ({ ...m, ...patch }));
    setReport(null);
  }
  async function inspect() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.append("file", file);
      if (worksheet) data.append("worksheet", worksheet);
      const found = await api<Inspection | WorkbookChoice | SpkInspection>(
        "/imports/inspect",
        {
          method: "POST",
          body: data,
        },
      );
      if ("source_format" in found && found.source_format === "bsp") {
        setSpk(found);
        return;
      }
      if ("requires_worksheet" in found) {
        setWorksheets(found.worksheets);
        setWorksheet(found.worksheets[0] || "");
        return;
      }
      setInspection(found);
      setWorksheets(found.worksheets || []);
      setWorksheet(found.worksheet || "");
      setMapping(found.mapping);
      setInputType(
        found.input_types.length === 1
          ? found.input_types[0]
          : found.input_types.length > 1
            ? ""
            : "elements",
      );
      setGenerateVelocity(false);
      setSelectionDirty(false);
      setMetadata((m) => ({
        ...m,
        object_name: file.name.replace(/\.(csv|xlsx)$/i, "").slice(0, 120),
      }));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }
  async function check(commit = false) {
    if (!inspection) return;
    setBusy(true);
    setError("");
    try {
      if (inspection.requires_reduction || selectionDirty)
        throw new Error(
          "请先应用时间范围与采样设置，处理结果满足容量后再运行预检。",
        );
      if (!inputType)
        throw new Error("同时存在两套字段，请先选择使用六根数还是位置与速度。");
      if (
        scene &&
        (metadata.center !== scene.center || metadata.frame !== scene.frame)
      )
        throw new Error("当前场景中心或参考系不同，请新建工作台后导入。");
      const rowNumbers = exclude.trim()
        ? exclude.split(/[,，\s]+/).map(Number)
        : [];
      if (rowNumbers.some((v) => !Number.isInteger(v) || v < 2))
        throw new Error("排除行号需为含表头计数的正整数，以逗号分隔。");
      const body = {
        selection: inspection.selection ?? null,
        input_type: inputType,
        velocity_source: generateVelocity ? "finite_difference" : "provided",
        metadata,
        mapping: Object.fromEntries(
          Object.entries(mapping).filter(
            ([k, v]) =>
              v &&
              (k === "epoch" ||
                new Set<string>(
                  inputType === "elements"
                    ? [...elementFields, "mean_anomaly"]
                    : generateVelocity
                      ? stateFields.slice(0, 3)
                      : stateFields,
                ).has(k)),
          ),
        ),
        decisions: { ...decisions, exclude_rows: rowNumbers },
      };
      if (commit) {
        const ds = await post<Dataset>(
          `/imports/${inspection.id}/commit`,
          body,
        );
        onImport(ds);
      } else
        setReport(
          await post<Report>(`/imports/${inspection.id}/validate`, body),
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function applySelection() {
    if (!inspection) return;
    setBusy(true);
    setError("");
    setReport(null);
    setReductionJob(null);
    setProcessingMessage("");
    setCancelPending(false);
    const controller = new AbortController();
    try {
      if (metadata.epoch_mode !== "per_row" || !mapping.epoch)
        throw new Error(
          "时间筛选需要每行时间列，请先设置历元来源和时间列映射。",
        );
      const interval = sampleInterval.trim() ? Number(sampleInterval) : null;
      if (interval !== null && (!Number.isFinite(interval) || interval < 0.001))
        throw new Error("采样间隔至少为 0.001 秒；留空则保留原始分辨率。");
      activeReduction.current = { entry: inspection.id, controller };
      let job = await api<ReductionJob>(
        `/imports/${inspection.id}/reduction-jobs`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            epoch_column: mapping.epoch,
            time_scale: metadata.time_scale,
            start: rangeStart || null,
            end: rangeEnd || null,
            interval_s: interval,
          }),
        },
      );
      activeReduction.current.job = job.id;
      while (!controller.signal.aborted) {
        setReductionJob(job);
        if (job.status === "completed") {
          const next = job.result!;
          setInspection(next);
          setSelectionDirty(false);
          setDecisions(freshDecisions());
          setExclude("");
          if (next.requires_reduction)
            setError(
              "处理后仍超过 100,000 条或 20 MiB，请进一步缩短时间范围或增大采样间隔后重新应用。",
            );
          break;
        }
        if (job.status === "cancelled") {
          setProcessingMessage(
            "已取消处理，上传副本和筛选设置已保留，可调整后重试。",
          );
          break;
        }
        if (job.status === "failed")
          throw new Error(job.error?.message || "处理失败，请重试。");
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (controller.signal.aborted) break;
        job = await api<ReductionJob>(
          `/imports/${inspection.id}/reduction-jobs/${job.id}`,
          { signal: controller.signal },
        );
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        const active = activeReduction.current;
        if (active?.job) {
          await post(
            `/imports/${active.entry}/reduction-jobs/${active.job}/cancel`,
            {},
          ).catch(() => {});
        }
        setReductionJob((previous) =>
          previous ? { ...previous, status: "failed" } : null,
        );
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      activeReduction.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function cancelProcessing() {
    const active = activeReduction.current;
    if (!active?.job || cancelPending) return;
    setCancelPending(true);
    try {
      const snapshot = await post<ReductionJob>(
        `/imports/${active.entry}/reduction-jobs/${active.job}/cancel`,
        {},
      );
      setReductionJob((previous) =>
        previous?.id === snapshot.id && activeReduction.current
          ? snapshot
          : previous,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelPending(false);
    }
  }
  function close() {
    if (busy) return;
    if (inspection) void api(`/imports/${inspection.id}`, { method: "DELETE" });
    onClose();
  }
  function decision(patch: Partial<Decisions>) {
    setDecisions((d) => ({ ...d, ...patch }));
    setReport(null);
  }
  if (spk)
    return (
      <SpkImportDialog
        info={spk}
        scene={scene}
        onClose={() => {
          resetInspection();
          onClose();
        }}
        onBack={resetInspection}
        onImport={onImport}
      />
    );
  return (
    <div className="modal-backdrop">
      <section
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="导入轨道数据"
      >
        <header>
          <div>
            <span className="eyebrow">DATA IMPORT</span>
            <h2>导入轨道数据</h2>
          </div>
          <button aria-label="关闭导入" onClick={close} disabled={busy}>
            <X size={20} />
          </button>
        </header>
        <div className="dialog-body">
          <fieldset className="import-fields" disabled={busy}>
            {!inspection ? (
              <>
                <p className="muted">
                  CSV / XLSX 六根数或位置与速度，或 JPL HORIZONS .bsp
                  小天体星历。表格导入结果最多 100,000 条 / 20 MiB。
                  超限可选择时间段或降低时间分辨率；源文件最多 200 MiB、100
                  万条。CSV 使用 UTF-8。
                </p>
                <label className="file-drop">
                  <Upload size={30} />
                  <strong>{file?.name || "选择星历文件"}</strong>
                  <span>CSV / XLSX 表格或 SPK 二进制星历</span>
                  <input
                    aria-label="选择CSV、XLSX或BSP"
                    type="file"
                    accept=".csv,.xlsx,.bsp,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    disabled={busy}
                    onChange={(e) => {
                      resetInspection();
                      setFile(e.target.files?.[0]);
                      setWorksheets([]);
                      setWorksheet("");
                    }}
                  />
                </label>
                {worksheets.length > 0 && (
                  <div className="form-grid">
                    <label>
                      选择工作表
                      <select
                        aria-label="XLSX工作表"
                        value={worksheet}
                        disabled={busy}
                        onChange={(e) => setWorksheet(e.target.value)}
                      >
                        {worksheets.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="hint">
                      第一条非空行作为表头；日期时间单元格或 ISO
                      时间文本均可读取。
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="file-summary">
                  <Check size={17} />
                  <strong>{inspection.filename}</strong>
                  <span>
                    {inspection.worksheet ? `${inspection.worksheet} · ` : ""}
                    {reductionActive
                      ? " · 正在处理"
                      : inspection.requires_reduction
                        ? inspection.source_input_rows != null
                          ? `${inspection.source_count_exact ? "" : "约 "}${inspection.source_input_rows.toLocaleString()} 条源记录 · 待筛选`
                          : "大文件待筛选"
                        : inspection.selection
                          ? `${inspection.input_rows.toLocaleString()} 条保留记录 / ${inspection.source_input_rows?.toLocaleString()} 条源记录`
                          : `${inspection.input_rows.toLocaleString()} 条原始记录`}
                  </span>
                  {worksheets.length > 1 && (
                    <button onClick={resetInspection} disabled={busy}>
                      更换工作表
                    </button>
                  )}
                </div>
                <h3>01 / 数据解释</h3>
                {inspection.input_types.length > 1 && (
                  <p className="warning">
                    同时检测到六根数和空间坐标，请选择本次导入使用哪套数据。
                  </p>
                )}
                <div className="form-grid">
                  <label>
                    数据类型
                    <select
                      aria-label="数据类型"
                      value={inputType}
                      onChange={(e) => {
                        setInputType(e.target.value as InputType);
                        setGenerateVelocity(false);
                        setReport(null);
                      }}
                    >
                      <option value="" disabled>
                        请选择使用的数据类型
                      </option>
                      <option value="elements">轨道六根数</option>
                      <option value="cartesian">
                        位置与速度（X/Y/Z、VX/VY/VZ）
                      </option>
                    </select>
                  </label>
                  <label>
                    对象名称
                    <input
                      value={metadata.object_name}
                      onChange={(e) =>
                        updateMeta({ object_name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    中心天体
                    <select
                      aria-label="中心天体"
                      value={metadata.center}
                      onChange={(e) =>
                        updateMeta({
                          center: e.target.value as Metadata["center"],
                          mu_km3_s2: null,
                          mu_source: "",
                        })
                      }
                    >
                      <option value="sun">太阳中心</option>
                      <option value="earth">地球中心</option>
                    </select>
                  </label>
                  <label>
                    坐标系
                    <select
                      aria-label="坐标系"
                      value={metadata.frame}
                      onChange={(e) =>
                        updateMeta({
                          frame: e.target.value as Metadata["frame"],
                        })
                      }
                    >
                      <option value="J2000">J2000 · 赤道面</option>
                      <option value="ECLIPJ2000">ECLIPJ2000 · 黄道面</option>
                    </select>
                  </label>
                  <label>
                    坐标参考历元
                    <input readOnly value="J2000.0 · JD 2451545.0 TT" />
                  </label>
                  <label>
                    数据历元来源
                    <select
                      value={metadata.epoch_mode}
                      onChange={(e) =>
                        updateMeta({
                          epoch_mode: e.target.value as Metadata["epoch_mode"],
                        })
                      }
                    >
                      <option value="per_row">每行时间列</option>
                      <option value="single">单条记录 · 统一历元</option>
                    </select>
                  </label>
                  <label>
                    时间体系
                    <select
                      value={metadata.time_scale}
                      onChange={(e) =>
                        updateMeta({
                          time_scale: e.target.value as Metadata["time_scale"],
                        })
                      }
                    >
                      {["UTC", "TT", "TDB"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  {metadata.epoch_mode === "single" && (
                    <label className="wide">
                      统一根数历元
                      <input
                        placeholder="2028-01-30T10:44:00"
                        value={metadata.single_epoch || ""}
                        onChange={(e) =>
                          updateMeta({ single_epoch: e.target.value })
                        }
                      />
                    </label>
                  )}
                  <label>
                    输入长度
                    <select
                      value={metadata.length_unit}
                      onChange={(e) =>
                        updateMeta({
                          length_unit: e.target
                            .value as Metadata["length_unit"],
                        })
                      }
                    >
                      <option>km</option>
                      <option>m</option>
                      <option>AU</option>
                    </select>
                  </label>
                  {inputType === "cartesian" && !generateVelocity && (
                    <label>
                      输入速度
                      <select
                        aria-label="输入速度单位"
                        value={metadata.speed_unit ?? "km/s"}
                        onChange={(e) =>
                          updateMeta({
                            speed_unit: e.target
                              .value as Metadata["speed_unit"],
                          })
                        }
                      >
                        {["km/s", "m/s", "AU/day", "AU/s"].map((unit) => (
                          <option key={unit}>{unit}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {inputType !== "cartesian" && (
                    <label>
                      输入角度
                      <select
                        value={metadata.angle_unit}
                        onChange={(e) =>
                          updateMeta({
                            angle_unit: e.target
                              .value as Metadata["angle_unit"],
                          })
                        }
                      >
                        <option>deg</option>
                        <option>rad</option>
                      </select>
                    </label>
                  )}
                  <label>
                    最大显示插值间隔 / s
                    <input
                      type="number"
                      min="1"
                      value={metadata.max_interpolation_gap_s}
                      onChange={(e) =>
                        updateMeta({
                          max_interpolation_gap_s: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    元数据依据
                    <select
                      value={metadata.metadata_status}
                      onChange={(e) =>
                        updateMeta({
                          metadata_status: e.target
                            .value as Metadata["metadata_status"],
                        })
                      }
                    >
                      <option value="provisional">暂用假设 · 待核实</option>
                      <option value="verified">已核实</option>
                    </select>
                  </label>
                  <label className="wide">
                    说明
                    <input
                      value={metadata.metadata_notes}
                      onChange={(e) =>
                        updateMeta({ metadata_notes: e.target.value })
                      }
                    />
                  </label>
                </div>
                <details className="mu-options">
                  <summary>引力参数（可选覆盖）</summary>
                  <div className="form-grid">
                    <label>
                      μ / km³·s⁻²
                      <input
                        aria-label="自定义引力参数"
                        type="number"
                        step="any"
                        min="0"
                        placeholder="留空使用中心天体预设"
                        value={metadata.mu_km3_s2 ?? ""}
                        onChange={(e) =>
                          updateMeta({
                            mu_km3_s2: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                      />
                    </label>
                    <label>
                      参数来源
                      <input
                        placeholder="留空记为用户指定"
                        value={metadata.mu_source || ""}
                        onChange={(e) =>
                          updateMeta({ mu_source: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </details>

                <p className="hint">
                  参考历元规定坐标轴方向；每行时间规定该行数据的历元。支持 J2000
                  预设，不进行参考系转换或时间传播。
                </p>
                <h3>02 / 字段映射</h3>
                <div className="mapping-grid">
                  {[
                    "epoch",
                    ...(inputType === "cartesian"
                      ? stateFields
                      : [...elementFields, "mean_anomaly"]),
                  ].map((f) => (
                    <label key={f}>
                      {titles[f]}
                      {f === "mean_anomaly" ? "（可选）" : ""}
                      <select
                        aria-label={`映射${f}`}
                        value={mapping[f] || ""}
                        onChange={(e) => {
                          setMapping((m) => ({ ...m, [f]: e.target.value }));
                          if (f === "epoch" && inspection.selection)
                            setSelectionDirty(true);
                          setGenerateVelocity(false);
                          setReport(null);
                        }}
                      >
                        <option value="">不映射</option>
                        {inspection.headers.map((h) => (
                          <option key={h}>{h}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                {inputType === "cartesian" &&
                  (generateVelocity ||
                    stateFields.slice(3).some((f) => !mapping[f])) && (
                    <fieldset className="velocity-choice">
                      <legend>
                        缺少完整速度分量，是否根据位置差分生成速度？
                      </legend>
                      <label>
                        <input
                          type="radio"
                          name="velocity-source"
                          checked={!generateVelocity}
                          onChange={() => {
                            setGenerateVelocity(false);
                            setReport(null);
                          }}
                        />
                        不生成，补充速度列映射后再导入
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="velocity-source"
                          checked={generateVelocity}
                          onChange={() => {
                            setGenerateVelocity(true);
                            setReport(null);
                          }}
                        />
                        差分生成速度
                      </label>
                      <p className="hint">
                        按实际时间间隔差分，不跨越数据缺口。选择生成后全部速度分量由位置重算，以
                        km/s
                        保存。速度为数值估计，端点使用单边差分；每个连续片段至少需要两个采样点。
                      </p>
                    </fieldset>
                  )}
                <details
                  className="import-reduction"
                  open={inspection.requires_reduction || undefined}
                >
                  <summary>
                    时间范围与分辨率
                    {inspection.requires_reduction
                      ? " · 超出容量，请先处理"
                      : selectionDirty
                        ? " · 设置已改变，请重新应用"
                        : inspection.selection
                          ? " · 已应用"
                          : "（可选）"}
                  </summary>
                  <p className="hint">
                    只处理导入副本，不修改源文件。时间范围包含起止时刻，按上方声明的{" "}
                    {metadata.time_scale} 解释；两个条件可同时使用。
                  </p>
                  <p className="hint">
                    时间列：{mapping.epoch || "请先映射时间列"}；首条预览：
                    {inspection.preview[0]?.values[mapping.epoch] || "—"}
                  </p>
                  <div className="form-grid">
                    <label>
                      起始时间（留空不限）
                      <input
                        aria-label="筛选起始时间"
                        type="datetime-local"
                        step="0.001"
                        value={rangeStart}
                        disabled={busy}
                        onChange={(e) => {
                          setRangeStart(e.target.value);
                          setSelectionDirty(true);
                          setReport(null);
                        }}
                      />
                    </label>
                    <label>
                      结束时间（留空不限）
                      <input
                        aria-label="筛选结束时间"
                        type="datetime-local"
                        step="0.001"
                        value={rangeEnd}
                        disabled={busy}
                        onChange={(e) => {
                          setRangeEnd(e.target.value);
                          setSelectionDirty(true);
                          setReport(null);
                        }}
                      />
                    </label>
                    <label>
                      目标采样间隔 / 秒
                      <input
                        aria-label="目标采样间隔"
                        type="number"
                        min="0.001"
                        step="any"
                        placeholder="留空保留原始分辨率，例如 3600 为一小时"
                        value={sampleInterval}
                        disabled={busy}
                        onChange={(e) => {
                          setSampleInterval(e.target.value);
                          setSelectionDirty(true);
                          setReport(null);
                        }}
                      />
                    </label>
                  </div>
                  <p className="hint">
                    降采样按时间分桶，每桶保留最早时刻的原始记录及同刻冲突记录，不插值或平均。仅设置间隔时按首条符合范围记录所在日期的零点对齐。
                  </p>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={applySelection}
                  >
                    应用范围与采样
                  </button>
                  {!inspection.requires_reduction && inspection.selection && (
                    <p className="hint">
                      处理后 {inspection.input_rows.toLocaleString()} 条，约{" "}
                      {((inspection.retained_bytes ?? 0) / 1048576).toFixed(2)}{" "}
                      MiB；原始行号保留。
                    </p>
                  )}
                </details>
                {reductionJob && (
                  <div className="reduction-progress">
                    <progress
                      aria-label="范围与采样处理进度"
                      max={100}
                      value={reductionPercent}
                    />
                    <span
                      className="reduction-count"
                      role="status"
                      title={
                        reductionJob.total_exact
                          ? "总条数已确认"
                          : "总条数可能为工作表估计值，扫描完成后校准"
                      }
                    >
                      已扫描 {reductionJob.scanned.toLocaleString()} 条 / 共{" "}
                      {reductionJob.total === null
                        ? "—"
                        : reductionJob.total.toLocaleString()}{" "}
                      条
                    </span>
                  </div>
                )}
                {processingMessage && (
                  <p className="hint" role="status">
                    {processingMessage}
                  </p>
                )}
                <h3>03 / 清洗决策</h3>
                <div className="checks">
                  <label>
                    <input
                      type="checkbox"
                      checked={decisions.deduplicate}
                      onChange={(e) =>
                        decision({ deduplicate: e.target.checked })
                      }
                    />
                    确认完全重复记录去重，并保留日志
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={decisions.sort}
                      onChange={(e) => decision({ sort: e.target.checked })}
                    />
                    允许按时间稳定排序
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={decisions.override_units}
                      onChange={(e) =>
                        decision({ override_units: e.target.checked })
                      }
                    />
                    确认以选择的单位覆盖表头单位
                  </label>
                </div>
                <label className="exclude">
                  明确排除的源表行号（含表头，逗号分隔）
                  <input
                    value={exclude}
                    placeholder="例如：12, 15"
                    onChange={(e) => {
                      setExclude(e.target.value);
                      setReport(null);
                    }}
                  />
                </label>
                {report && (
                  <div className="quality-report" aria-live="polite">
                    <h3>
                      {report.ok ? (
                        <Check size={16} />
                      ) : (
                        <AlertTriangle size={16} />
                      )}
                      预检结果 · {report.ok ? "可导入" : "需处理"}
                    </h3>
                    <div className="report-stats">
                      <span>
                        输入 <b>{String(report.stats.input_rows)}</b>
                      </span>
                      <span>
                        输出 <b>{String(report.stats.output_rows ?? "—")}</b>
                      </span>
                      <span>
                        双曲{" "}
                        <b>{String(report.stats.hyperbolic_rows ?? "—")}</b>
                      </span>
                      <span>
                        冲突 <b>{String(report.stats.conflict_groups ?? 0)}</b>
                      </span>
                    </div>
                    {report.issues.map((v, i) => (
                      <p className="warning" key={i}>
                        {v.message}
                        {v.source_rows.length > 0
                          ? ` · 行 ${v.source_rows.slice(0, 20).join(", ")}`
                          : ""}
                        {v.field ? ` · ${v.field}` : ""}
                      </p>
                    ))}
                    {report.conflicts.map((c) => (
                      <fieldset key={c.id}>
                        <legend>冲突：{c.epoch_utc}</legend>
                        {c.records.map((rec) => (
                          <label key={rec.source_rows[0]}>
                            <input
                              type="radio"
                              name={`conflict-${c.id}`}
                              checked={
                                decisions.conflict_choices[c.id] ===
                                rec.source_rows[0]
                              }
                              onChange={() => {
                                setDecisions((d) => ({
                                  ...d,
                                  conflict_choices: {
                                    ...d.conflict_choices,
                                    [c.id]: rec.source_rows[0],
                                  },
                                }));
                                setReport((r) => (r ? { ...r, ok: false } : r));
                              }}
                            />
                            <span>
                              保留行 {rec.source_rows.join("/")} ·{" "}
                              {rec.elements
                                ? `a=${rec.elements.a} km · e=${rec.elements.e} · ν=${rec.elements.true_anomaly}°`
                                : `位置=${rec.position_km.join(", ")} km · 速度=${rec.velocity_km_s?.join(", ") ?? "待差分生成"} km/s`}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    ))}
                    {report.warnings.map((w, i) => (
                      <p className="hint" key={i}>
                        {w}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </fieldset>
        </div>
        <footer>
          <span>
            {reductionActive
              ? cancelPending || reductionJob?.status === "cancelling"
                ? "正在取消处理…"
                : reductionJob?.phase === "counting"
                  ? "正在统计总条数…"
                  : reductionJob?.phase === "processing"
                    ? "正在整理处理结果…"
                    : "正在读取与筛选…"
              : busy
                ? "正在读取或处理数据，大文件可能需要一段时间…"
                : "源文件保持不变 · 数据仅在本机处理"}
          </span>
          <div>
            {reductionActive ? (
              <button
                onClick={cancelProcessing}
                disabled={
                  cancelPending || reductionJob?.status === "cancelling"
                }
              >
                {cancelPending || reductionJob?.status === "cancelling"
                  ? "正在取消…"
                  : "取消处理"}
              </button>
            ) : (
              <button onClick={close} disabled={busy}>
                取消
              </button>
            )}
            {!inspection ? (
              <button
                className="primary"
                onClick={inspect}
                disabled={!file || busy}
              >
                {worksheets.length ? "读取工作表" : "读取文件"}{" "}
                <ArrowRight size={15} />
              </button>
            ) : (
              <>
                <button
                  onClick={() => check()}
                  disabled={
                    busy || inspection.requires_reduction || selectionDirty
                  }
                >
                  运行预检
                </button>
                <button
                  className="primary"
                  onClick={() => check(true)}
                  disabled={
                    busy ||
                    inspection.requires_reduction ||
                    selectionDirty ||
                    !report?.ok
                  }
                >
                  添加到场景 <ArrowRight size={15} />
                </button>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
