import { Crosshair, Move3D, Settings2 } from "lucide-react";
import { LayerAppearance } from "./LayerAppearance";
import type { Layer, PlanetInfo, PlanetState, SceneSystem } from "./types";
export function PlanetInspector({
  layer,
  info,
  state,
  system,
  following,
  patch,
  focus,
  follow,
}: {
  layer: Layer;
  info?: PlanetInfo;
  state?: PlanetState;
  system: SceneSystem;
  following: boolean;
  patch: (value: Partial<Layer>) => void;
  focus: () => void;
  follow: () => void;
}) {
  const quality = state?.quality;
  return (
    <div className="properties planet-inspector">
      <div className="properties-heading">
        <span>
          <Settings2 size={14} />
          行星属性
        </span>
        <span className="planet-type">DE440s</span>
      </div>
      <div className="property-body">
        <label className="name-field">
          名称
          <input
            maxLength={120}
            value={layer.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <div className="layer-style">
          <label>
            颜色
            <input
              aria-label="行星光点颜色"
              type="color"
              value={layer.color}
              onChange={(e) => patch({ color: e.target.value })}
            />
          </label>
          {(["showTrack", "showTrail", "showLabel"] as const).map((key, i) => (
            <label
              key={key}
              title={
                [
                  "当前时刻的日心密切椭圆；地心场景中平移显示",
                  "过去时段的真实星历路径，时长由底部尾迹菜单设置",
                  "显示行星名称",
                ][i]
              }
            >
              <input
                type="checkbox"
                checked={layer[key]}
                onChange={(e) => patch({ [key]: e.target.checked })}
              />
              {["轨道", "尾迹", "标签"][i]}
            </label>
          ))}
        </div>
        <LayerAppearance layer={layer} patch={patch} />
        <div className="metadata-line">
          <span>{system.center === "sun" ? "太阳中心" : "地球中心"}</span>
          <span>{system.frame}</span>
        </div>
        <div className="planet-view-actions">
          <button
            className="primary"
            disabled={!state || !layer.visible}
            onClick={focus}
          >
            <Crosshair size={14} />
            聚焦表面
          </button>
          <button
            className={"quiet " + (following ? "following" : "")}
            disabled={!state || !layer.visible}
            onClick={follow}
          >
            <Move3D size={14} />
            {following ? "停止跟随" : "跟随对象"}
          </button>
        </div>
        <p className="hint">
          拖拽自由旋转 · 滚轮缩放 ·
          右键平移。聚焦会同时跟随平移，自转仍相对惯性空间显示。
        </p>
        <div className="planet-options">
          {layer.body_id === "earth" && (
            <label>
              <input
                type="checkbox"
                checked={!!layer.showMeridian}
                onChange={(e) => patch({ showMeridian: e.target.checked })}
              />
              显示 0° 经线
            </label>
          )}
        </div>
        <div className="section-label">
          天体与姿态 <span>{state ? "已就绪" : "读取中"}</span>
        </div>
        <dl className="elements">
          <div>
            <dt>赤道半径</dt>
            <dd>
              {(state?.radii[0] || info?.radii_km[0] || 0).toLocaleString()}
              <small>km</small>
            </dd>
          </div>
          <div>
            <dt>极半径</dt>
            <dd>
              {(state?.radii[2] || info?.radii_km[2] || 0).toLocaleString()}
              <small>km</small>
            </dd>
          </div>
          <div>
            <dt>尺寸比例</dt>
            <dd>真实半径</dd>
          </div>
          <div>
            <dt>位置来源</dt>
            <dd>JPL DE440s</dd>
          </div>
        </dl>
        {layer.body_id === "earth" ? (
          <>
            <div
              className={
                "earth-quality " +
                (quality === "approximate" ? "approximate" : "")
              }
              data-testid="earth-quality"
            >
              <i />
              {!quality
                ? "正在读取地球定向"
                : quality === "approximate"
                  ? "近似姿态 · IERS 范围外"
                  : quality === "predicted"
                    ? "IERS 预测姿态"
                    : "IERS 实测姿态"}
            </div>
            <p className="hint">
              {quality === "approximate"
                ? "当前时刻缺少地球定向数据，采用 UT1≈UTC、极移为零；零度经线为近似方向。"
                : "按 IAU 2006/2000A 与 IERS 地球定向计算零度经线。"}{" "}
              日侧使用 day 纹理，夜侧使用 night 纹理，晨昏线平滑混合。
            </p>
          </>
        ) : (
          <p className="hint">
            表面采用 IAU 参考自转模型，受光方向随太阳位置更新。
            {layer.body_id === "saturn" ? "包含有透明度的土星环。" : ""}
          </p>
        )}
        {info?.position_reference === "system_barycenter" && (
          <p className="hint">
            位置采用行星系统质心作为中心近似，未加载卫星系统专用星历。
          </p>
        )}
      </div>
    </div>
  );
}
