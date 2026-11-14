import { useState } from "react";
import { X } from "lucide-react";
import { post } from "./api";
import type { Dataset, SceneSystem } from "./types";

export type SpkInspection = {
  id: string;
  filename: string;
  source_format: "bsp";
  targets: {
    id: number;
    name: string;
    coverage: {
      start_tdb: string;
      end_tdb: string;
      start_utc: string;
      end_utc: string;
    }[];
    segments: { center_id: number; frame: string; type: number }[];
  }[];
};

export function SpkImportDialog({
  info,
  scene,
  onClose,
  onBack,
  onImport,
}: {
  info: SpkInspection;
  scene?: SceneSystem;
  onClose: () => void;
  onBack: () => void;
  onImport: (dataset: Dataset) => void;
}) {
  const [targetId, setTargetId] = useState(info.targets[0].id);
  const target = info.targets.find((t) => t.id === targetId)!;
  const [interval, setInterval] = useState(0);
  const [name, setName] = useState(target.name);
  const [start, setStart] = useState(target.coverage[0].start_tdb);
  const [end, setEnd] = useState(target.coverage[0].end_tdb);
  const [step, setStep] = useState(3600);
  const [system, setSystem] = useState<SceneSystem>(
    scene || { center: "sun", frame: "J2000" },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function choose(target: SpkInspection["targets"][number], index: number) {
    setTargetId(target.id);
    setInterval(index);
    setName(target.name);
    setStart(target.coverage[index].start_tdb);
    setEnd(target.coverage[index].end_tdb);
    setError("");
  }
  return (
    <div className="modal-backdrop">
      <section
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="导入 SPK 星历"
      >
        <header>
          <div>
            <span className="eyebrow">JPL HORIZONS / SPK</span>
            <h2>导入小天体 SPK</h2>
          </div>
          <button aria-label="关闭导入" disabled={busy} onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="dialog-body">
          <fieldset className="import-fields" disabled={busy}>
            <div className="file-summary">
              <strong>{info.filename}</strong>
              <span>二进制 SPK · {info.targets.length} 个目标</span>
            </div>
            <div className="form-grid">
              <label>
                目标
                <select
                  aria-label="SPK目标"
                  value={targetId}
                  onChange={(e) =>
                    choose(
                      info.targets.find(
                        (t) => t.id === Number(e.target.value),
                      )!,
                      0,
                    )
                  }
                >
                  {info.targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                对象名称
                <input
                  aria-label="SPK对象名称"
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                场景中心
                <select
                  aria-label="SPK场景中心"
                  disabled={!!scene}
                  value={system.center}
                  onChange={(e) =>
                    setSystem((s) => ({
                      ...s,
                      center: e.target.value as SceneSystem["center"],
                    }))
                  }
                >
                  <option value="sun">太阳中心</option>
                  <option value="earth">地球中心</option>
                </select>
              </label>
              <label>
                输出参考系
                <select
                  aria-label="SPK输出参考系"
                  disabled={!!scene}
                  value={system.frame}
                  onChange={(e) =>
                    setSystem((s) => ({
                      ...s,
                      frame: e.target.value as SceneSystem["frame"],
                    }))
                  }
                >
                  <option value="J2000">J2000 · 赤道面</option>
                  <option value="ECLIPJ2000">ECLIPJ2000 · 黄道面</option>
                </select>
              </label>
              <label className="wide">
                连续覆盖区间
                <select
                  aria-label="SPK覆盖区间"
                  value={interval}
                  onChange={(e) => choose(target, Number(e.target.value))}
                >
                  {target.coverage.map((c, i) => (
                    <option key={i} value={i}>
                      {c.start_utc} — {c.end_utc} UTC
                    </option>
                  ))}
                </select>
              </label>
              <label>
                开始时间 / TDB
                <input
                  aria-label="SPK开始时间TDB"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                结束时间 / TDB
                <input
                  aria-label="SPK结束时间TDB"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <label>
                采样间隔 / 秒
                <input
                  aria-label="SPK采样间隔"
                  type="number"
                  min={1}
                  max={86400}
                  value={step}
                  onChange={(e) => setStep(Number(e.target.value))}
                />
              </label>
            </div>
            <p className="hint">
              原始分段：
              {target.segments
                .map(
                  (s) =>
                    `中心 ${s.center_id} / ${s.frame} / SPK type ${s.type}`,
                )
                .filter((s, i, a) => a.indexOf(s) === i)
                .join("；")}
            </p>
            <p className="hint">
              直接读取 SPICE
              几何位置与速度，无光行时或像差修正。按所选间隔采样后回放，支持尾迹、缓存和视频；采样点之间使用显示插值，最多
              100,000 点，不在覆盖区间外推算。
            </p>
            <p className="hint">
              日心 Horizons SPK 可直接读取；地心等中心转换需本地
              DE440s，与源文件采用的行星星历可能略有差异。原文件随项目保存，仅在本地处理。
            </p>
            {scene && <p className="hint">输出使用现有场景中心及参考系。</p>}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {busy && <p role="status">正在读取并采样 SPK 星历…</p>}
          </fieldset>
        </div>
        <footer>
          <button disabled={busy} onClick={onBack}>
            更换文件
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              !name.trim() ||
              !Number.isFinite(step) ||
              step < 1 ||
              step > 86400
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                onImport(
                  await post<Dataset>(`/imports/${info.id}/spk/commit`, {
                    target_id: targetId,
                    object_name: name.trim(),
                    ...system,
                    start_tdb: start,
                    end_tdb: end,
                    step_s: step,
                  }),
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在采样…" : "采样并添加到场景"}
          </button>
        </footer>
      </section>
    </div>
  );
}
