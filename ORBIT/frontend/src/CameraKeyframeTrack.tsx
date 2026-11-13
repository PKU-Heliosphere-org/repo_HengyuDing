import { useRef } from "react";
import type { CameraKeyframe, Leap } from "./types";
import { utcLabel } from "./time";
import { KEYFRAME_EPSILON, MAX_CAMERA_KEYFRAMES } from "./cameraKeyframes";

export function CameraKeyframeTrack({
  keys,
  selected,
  time,
  start,
  end,
  from,
  to,
  base,
  leaps,
  disabled,
  onAdd,
  onSelect,
  onMove,
  onDelete,
  onSeek,
}: {
  keys: CameraKeyframe[];
  selected: string | null;
  time: number;
  start: number;
  end: number;
  from: number;
  to: number;
  base: string;
  leaps: Leap[];
  disabled: boolean;
  onAdd: (time: number) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, time: number) => void;
  onDelete: () => void;
  onSeek: (time: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    x: number;
    time: number;
    moved: boolean;
  } | null>(null);
  const span = Math.max(0.001, end - start);
  const clamp = (t: number) => Math.max(from, Math.min(to, t));
  const current = keys.find((k) => Math.abs(k.time - time) < KEYFRAME_EPSILON);
  const visible = keys.filter((k) => k.time >= start && k.time <= end);
  const previous = keys
    .filter((k) => k.time < time - KEYFRAME_EPSILON && k.time >= from)
    .at(-1);
  const next = keys.find(
    (k) => k.time > time + KEYFRAME_EPSILON && k.time <= to,
  );
  return (
    <div className="camera-keyframes" aria-label="视角关键帧轨道">
      <div className="camera-keyframe-tools">
        <strong>视角关键帧</strong>
        <button
          disabled={disabled || !previous}
          onClick={() => previous && onSelect(previous.id)}
          aria-label="前一视角关键帧"
        >
          ◀
        </button>
        <button
          disabled={
            disabled || (!current && keys.length >= MAX_CAMERA_KEYFRAMES)
          }
          onClick={() => onAdd(time)}
        >
          {current ? "更新关键帧" : "添加关键帧"}
        </button>
        <button
          disabled={disabled || !next}
          onClick={() => next && onSelect(next.id)}
          aria-label="后一视角关键帧"
        >
          ▶
        </button>
        <button disabled={disabled || !selected} onClick={onDelete}>
          删除关键帧
        </button>
        <span>{keys.length} 帧 · 双击轨道添加，拖动菱形调整时间</span>
      </div>
      <div
        className="camera-keyframe-track"
        ref={track}
        role="group"
        aria-label="视角关键帧时间轨道"
        onClick={(e) => {
          if (!disabled && e.target === e.currentTarget) {
            const rect = e.currentTarget.getBoundingClientRect();
            onSeek(
              clamp(start + ((e.clientX - rect.left) / rect.width) * span),
            );
          }
        }}
        onDoubleClick={(e) => {
          if (!disabled && e.target === e.currentTarget) {
            const rect = e.currentTarget.getBoundingClientRect();
            onAdd(clamp(start + ((e.clientX - rect.left) / rect.width) * span));
          }
        }}
      >
        <i
          className="camera-keyframe-cursor"
          style={{ left: `${(100 * (time - start)) / span}%` }}
        />
        {visible.map((key, i) => (
          <button
            key={key.id}
            type="button"
            disabled={disabled}
            className={`camera-keyframe ${selected === key.id ? "selected" : ""} ${key.time < from || key.time > to ? "outside" : ""}`}
            style={{ left: `${(100 * (key.time - start)) / span}%` }}
            aria-label={`视角关键帧 ${i + 1}`}
            aria-pressed={selected === key.id}
            data-keyframe-time={key.time}
            onFocus={() => onSelect(key.id)}
            title={
              utcLabel(base, key.time, leaps).replace("T", " ") +
              " · 拖动修改时间；Delete 删除"
            }
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              onSelect(key.id);
              drag.current = {
                id: key.id,
                x: e.clientX,
                time: key.time,
                moved: false,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== key.id) return;
              const dx = e.clientX - d.x;
              if (Math.abs(dx) > 3) d.moved = true;
              if (d.moved)
                onMove(
                  d.id,
                  clamp(d.time + (dx / track.current!.clientWidth) * span),
                );
            }}
            onPointerUp={(e) => {
              drag.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(key.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (["Delete", "Backspace"].includes(e.key)) {
                e.preventDefault();
                onDelete();
              } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                onMove(
                  key.id,
                  clamp(
                    key.time +
                      (e.key === "ArrowLeft" ? -1 : 1) *
                        (e.shiftKey ? 3600 : 60),
                  ),
                );
              }
            }}
          >
            <span>◆</span>
          </button>
        ))}
      </div>
    </div>
  );
}
