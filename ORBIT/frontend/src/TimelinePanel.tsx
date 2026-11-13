import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export function TimelinePanel({
  children,
  extraHeight = 0,
}: {
  children: ReactNode;
  extraHeight?: number;
}) {
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [bounds, setBounds] = useState({ min: 174, max: 500 });
  useLayoutEffect(() => {
    const el = panel.current!;
    const parent = el.parentElement!;
    const cachePanel = parent.querySelector(".render-cache-panel");
    const observer = new ResizeObserver(() => {
      const min =
        (window.innerHeight <= 780
          ? 155
          : window.innerWidth >= 1600
            ? 190
            : 174) + extraHeight;
      const max = Math.max(
        min,
        parent.clientHeight -
          250 -
          (cachePanel?.getBoundingClientRect().height ?? 0),
      );
      setBounds({ min, max });
      setHeight((value) =>
        value === null ? null : Math.max(min, Math.min(max, value)),
      );
    });
    observer.observe(parent);
    if (cachePanel) observer.observe(cachePanel);
    return () => observer.disconnect();
  }, [extraHeight]);
  const clamp = (value: number) =>
    Math.max(bounds.min, Math.min(bounds.max, value));
  return (
    <section
      ref={panel}
      className="timeline resizable-timeline"
      aria-label="时间轴"
      style={{ height: height ?? bounds.min, minHeight: bounds.min }}
    >
      <div
        className="timeline-resizer"
        role="separator"
        tabIndex={0}
        aria-label="调整时间轴高度"
        aria-orientation="horizontal"
        aria-valuemin={bounds.min}
        aria-valuemax={bounds.max}
        aria-valuenow={Math.round(height ?? bounds.min)}
        title="上下拖动调整时间轴高度；双击恢复默认高度"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = {
            y: event.clientY,
            height: panel.current!.getBoundingClientRect().height,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (drag.current)
            setHeight(
              clamp(drag.current.height + drag.current.y - event.clientY),
            );
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={() => setHeight(null)}
        onKeyDown={(event) => {
          const current = panel.current!.getBoundingClientRect().height;
          if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            setHeight(
              event.key === "Home"
                ? bounds.min
                : event.key === "End"
                  ? bounds.max
                  : clamp(current + (event.key === "ArrowUp" ? 20 : -20)),
            );
          }
        }}
      />
      {children}
    </section>
  );
}
