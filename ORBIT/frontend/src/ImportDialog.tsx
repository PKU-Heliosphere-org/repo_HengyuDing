import { useState } from "react";
import { X, Upload, Check, AlertTriangle, ArrowRight } from "lucide-react";
import { api, post } from "./api";
import { defaultMetadata, elementFields, titles } from "./types";
import type { Dataset, Decisions, Inspection, Metadata, Report } from "./types";

type Props = {
  initialFile?: File;
  scene?: Metadata;
  onClose: () => void;
  onImport: (ds: Dataset) => void;
};
export function ImportDialog({ initialFile, scene, onClose, onImport }: Props) {
  const [file, setFile] = useState<File | undefined>(initialFile);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
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
  const [decisions, setDecisions] = useState<Decisions>({
    deduplicate: false,
    sort: false,
    exclude_rows: [],
    conflict_choices: {},
    override_units: false,
  });
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exclude, setExclude] = useState("");
  function updateMeta(patch: Partial<Metadata>) {
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
      const found = await api<Inspection>("/imports/inspect", {
        method: "POST",
        body: data,
      });
      setInspection(found);
      setMapping(found.mapping);
      setMetadata((m) => ({
        ...m,
        object_name: file.name.replace(/\.csv$/i, "").slice(0, 120),
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
        metadata,
        mapping: Object.fromEntries(
          Object.entries(mapping).filter(([, v]) => v),
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
  function close() {
    if (busy) return;
    if (inspection) void api(`/imports/${inspection.id}`, { method: "DELETE" });
    onClose();
  }
  function decision(patch: Partial<Decisions>) {
    setDecisions((d) => ({ ...d, ...patch }));
    setReport(null);
  }
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
          {!inspection ? (
            <>
              <p className="muted">
                CSV 轨道根数 · UTF-8 · 最多 100,000 行 / 20 MiB
              </p>
              <label className="file-drop">
                <Upload size={30} />
                <strong>{file?.name || "选择轨道根数文件"}</strong>
                <span>支持样例表头或规范字段名</span>
                <input
                  aria-label="选择CSV"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setFile(e.target.files?.[0])}
                />
              </label>
            </>
          ) : (
            <>
              <div className="file-summary">
                <Check size={17} />
                <strong>{inspection.filename}</strong>
                <span>{inspection.input_rows.toLocaleString()} 条原始记录</span>
              </div>
              <h3>01 / 数据解释</h3>
              <div className="form-grid">
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
                      updateMeta({ frame: e.target.value as Metadata["frame"] })
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
                  根数历元来源
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
                        length_unit: e.target.value as Metadata["length_unit"],
                      })
                    }
                  >
                    <option>km</option>
                    <option>AU</option>
                  </select>
                </label>
                <label>
                  输入角度
                  <select
                    value={metadata.angle_unit}
                    onChange={(e) =>
                      updateMeta({
                        angle_unit: e.target.value as Metadata["angle_unit"],
                      })
                    }
                  >
                    <option>deg</option>
                    <option>rad</option>
                  </select>
                </label>
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
                参考历元规定坐标轴方向；每行时间规定该行根数的历元。首版支持
                J2000 预设，不进行参考系转换或时间传播。
              </p>
              <h3>02 / 字段映射</h3>
              <div className="mapping-grid">
                {["epoch", ...elementFields, "mean_anomaly"].map((f) => (
                  <label key={f}>
                    {titles[f]}
                    {f === "mean_anomaly" ? "（可选）" : ""}
                    <select
                      aria-label={`映射${f}`}
                      value={mapping[f] || ""}
                      onChange={(e) => {
                        setMapping((m) => ({ ...m, [f]: e.target.value }));
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
                明确排除的 CSV 行号（含表头，逗号分隔）
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
                      双曲 <b>{String(report.stats.hyperbolic_rows ?? "—")}</b>
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
                            保留行 {rec.source_rows.join("/")} · a=
                            {rec.elements.a} km · e={rec.elements.e} · ν=
                            {rec.elements.true_anomaly}°
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
        </div>
        <footer>
          <span>
            {busy ? "正在检查数据…" : "源文件保持不变 · 数据仅在本机处理"}
          </span>
          <div>
            <button onClick={close} disabled={busy}>
              取消
            </button>
            {!inspection ? (
              <button
                className="primary"
                onClick={inspect}
                disabled={!file || busy}
              >
                读取文件 <ArrowRight size={15} />
              </button>
            ) : (
              <>
                <button onClick={() => check()} disabled={busy}>
                  运行预检
                </button>
                <button
                  className="primary"
                  onClick={() => check(true)}
                  disabled={busy || !report?.ok}
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
