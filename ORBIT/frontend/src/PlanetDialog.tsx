import { useState } from "react";
import { Check, Globe2, X } from "lucide-react";
import type { BodyId, PlanetCatalog, SceneSystem } from "./types";

export function PlanetDialog({
  catalog,
  existing,
  scene,
  onClose,
  onAdd,
  busy,
}: {
  catalog: PlanetCatalog | null;
  existing: BodyId[];
  scene: SceneSystem | null;
  onClose: () => void;
  onAdd: (ids: BodyId[], system: SceneSystem, utc: string) => Promise<void>;
  busy: boolean;
}) {
  const [chosen, setChosen] = useState<BodyId[]>(
    existing.includes("earth") ? [] : ["earth"],
  );
  const [system, setSystem] = useState<SceneSystem>(
    scene || { center: "sun", frame: "J2000" },
  );
  const [epoch, setEpoch] = useState(new Date().toISOString().slice(0, 19));
  const [error, setError] = useState("");
  return (
    <div className="modal-backdrop">
      <section
        className="planet-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="添加行星图层"
      >
        <header>
          <div>
            <span className="eyebrow">SOLAR SYSTEM / LOCAL EPHEMERIS</span>
            <h2>添加行星图层</h2>
          </div>
          <button aria-label="关闭行星选择" onClick={onClose} disabled={busy}>
            <X size={20} />
          </button>
        </header>
        <div className="dialog-body">
          <p className="muted">
            独立管理每颗行星，位置随全局时间更新。远景为彩色光点，聚焦后查看真实尺寸的纹理表面。
          </p>
          <div className="planet-picker">
            {catalog?.bodies.map((body) => (
              <button
                key={body.id}
                disabled={existing.includes(body.id) || busy}
                aria-pressed={chosen.includes(body.id)}
                aria-label={`选择${body.name}`}
                className={chosen.includes(body.id) ? "chosen" : ""}
                onClick={() =>
                  setChosen((ids) =>
                    ids.includes(body.id)
                      ? ids.filter((id) => id !== body.id)
                      : [...ids, body.id],
                  )
                }
              >
                <span
                  className="planet-mini"
                  style={{
                    backgroundImage: `url(/textures/${body.texture})`,
                    boxShadow: `0 0 18px ${body.color}25`,
                  }}
                />
                <span>
                  <strong>{body.name}</strong>
                  <small>{body.id.toUpperCase()}</small>
                </span>
                {existing.includes(body.id) ? (
                  <small>已添加</small>
                ) : chosen.includes(body.id) ? (
                  <Check size={15} />
                ) : (
                  <PlusIcon />
                )}
              </button>
            ))}
          </div>
          {!scene && (
            <div className="form-grid">
              <label>
                场景中心
                <select
                  aria-label="行星场景中心"
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
                参考系
                <select
                  aria-label="行星参考系"
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
                初始日期 / UTC
                <input
                  aria-label="行星初始日期"
                  type="datetime-local"
                  step="1"
                  value={epoch}
                  onChange={(e) => setEpoch(e.target.value)}
                />
              </label>
            </div>
          )}
          {scene && (
            <p className="hint">
              使用现有场景：{scene.center === "sun" ? "日心" : "地心"} /{" "}
              {scene.frame}，与轨迹共用时间轴。
            </p>
          )}
          <p className="hint">
            星历：JPL DE440s · 支持 1972–2150 年 ·
            本地离线读取。火星及外行星采用行星系统质心近似中心；地球超出定向数据覆盖时明确标注近似姿态。
          </p>
          {catalog && !catalog.ready && (
            <p className="error">
              本地星历尚未准备好，请先运行安装脚本下载星历。
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
        <footer>
          <span>{busy ? "正在准备星历…" : "不改写 CSV，也不传播导入轨道"}</span>
          <button
            className="primary"
            disabled={busy || !chosen.length || !catalog?.ready}
            onClick={async () => {
              setError("");
              try {
                await onAdd(chosen, system, epoch);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Globe2 size={15} />
            添加 {chosen.length || ""} 个图层
          </button>
        </footer>
      </section>
    </div>
  );
}
function PlusIcon() {
  return <span className="picker-plus">+</span>;
}
