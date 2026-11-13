import { utcLabel } from "./time";
import type { Leap } from "./types";

export function RenderCachePanel({
  enabled,
  onEnabled,
  start,
  end,
  from,
  to,
  onRange,
  base,
  leaps,
  ready,
  progress,
  error,
  onRetry,
  disabled,
  keyframesEnabled,
  onKeyframesEnabled,
}: {
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  start: number;
  end: number;
  from: number;
  to: number;
  onRange: (from: number, to: number) => void;
  base: string;
  leaps: Leap[];
  ready: boolean;
  progress: number;
  error: string;
  onRetry: () => void;
  disabled: boolean;
  keyframesEnabled: boolean;
  onKeyframesEnabled: (enabled: boolean) => void;
}) {
  const label = (time: number) =>
    base && leaps.length
      ? utcLabel(base, time, leaps)
          .replace("T", " ")
          .replace(/\.\d+Z$/, " UTC")
      : "—";
  const span = Math.max(1, end - start);
  const gap = Math.min(60, span);
  return (
    <section className="render-cache-panel" aria-label="缓存渲染">
      <div className="render-cache-heading">
        <label>
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled && !enabled}
            onChange={(e) => onEnabled(e.target.checked)}
          />
          启用缓存渲染
        </label>
        <label
          className={!enabled ? "disabled" : ""}
          title="启用缓存渲染后可记录和播放相机关键帧"
        >
          <input
            type="checkbox"
            checked={enabled && keyframesEnabled}
            disabled={!enabled}
            onChange={(e) => onKeyframesEnabled(e.target.checked)}
          />
          视角关键帧
        </label>
        {enabled && (
          <span role="status" className={error ? "cache-error" : ""}>
            {error ||
              (ready
                ? "缓存就绪 · 可播放所选范围"
                : `正在准备位置与尾迹缓存… ${Math.floor(progress * 100)}%`)}
          </span>
        )}
        {enabled && error && <button onClick={onRetry}>重新准备</button>}
      </div>
      {enabled && (
        <>
          <div className="cache-range-labels">
            <span>起：{label(from)}</span>
            <span>止：{label(to)}</span>
          </div>
          <div
            className="cache-range-slider"
            role="group"
            aria-label="缓存时间范围"
          >
            <div className="cache-range-track" />
            <div
              className="cache-range-selection"
              style={{
                left: `${(100 * (from - start)) / span}%`,
                width: `${(100 * (to - from)) / span}%`,
              }}
            />
            <input
              type="range"
              aria-label="缓存起点"
              min={start}
              max={Math.max(start + 1, end)}
              step="any"
              value={from}
              onChange={(e) =>
                onRange(Math.min(Number(e.target.value), to - gap), to)
              }
            />
            <input
              type="range"
              aria-label="缓存终点"
              min={start}
              max={Math.max(start + 1, end)}
              step="any"
              value={to}
              onChange={(e) =>
                onRange(from, Math.max(Number(e.target.value), from + gap))
              }
            />
          </div>
          <progress
            aria-label="缓存准备进度"
            max={1}
            value={ready ? 1 : progress}
          />
        </>
      )}
    </section>
  );
}
