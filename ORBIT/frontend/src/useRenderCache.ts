import { useEffect, useState } from "react";
import { api } from "./api";
import { utcInputSeconds } from "./time";
import type {
  BodyId,
  Leap,
  PlanetCatalog,
  PlanetWindow,
  SceneSystem,
} from "./types";

const HOUR = 3600;
// Bound memory use before starting a large in-memory cache.
const MAX_BODY_SAMPLES = 500_000;

export function cacheSegments(
  start: number,
  end: number,
  history: number,
  minimum: number,
) {
  const segments: { start: number; end: number; step: number }[] = [];
  const append = (from: number, to: number, step: number) => {
    while (from < to) {
      const next = Math.min(to, from + Math.min(100 * 86400, 2400 * step));
      segments.push({ start: from, end: next, step });
      from = next;
    }
  };
  append(Math.max(minimum, start - history), start, 6 * HOUR);
  append(start, end, HOUR);
  return segments;
}

// Adjacent responses share an endpoint. Keep it once, preserving ordered times.
export function appendWindow(target: PlanetWindow, next: PlanetWindow) {
  const offset = next.times[0] === target.times.at(-1) ? 1 : 0;
  const append = <T>(a: T[], b: T[]) => {
    for (let i = offset; i < b.length; i++) a.push(b[i]);
  };
  append(target.times, next.times);
  append(target.sun_positions_km, next.sun_positions_km);
  append(target.sun_velocities_km_s, next.sun_velocities_km_s);
  for (const id of Object.keys(target.bodies) as BodyId[]) {
    const body = target.bodies[id]!,
      addition = next.bodies[id]!;
    append(body.positions_km, addition.positions_km);
    append(body.velocities_km_s, addition.velocities_km_s);
    append(body.quaternions, addition.quaternions);
    append(body.orientation_quality, addition.orientation_quality);
  }
  target.warnings = [...new Set([...target.warnings, ...next.warnings])];
}

export function useRenderCache(
  enabled: boolean,
  ids: BodyId[],
  system: SceneSystem,
  base: string,
  start: number,
  end: number,
  history: number,
  leaps: Leap[],
  catalog: PlanetCatalog | null,
) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([
    enabled,
    [...ids].sort(),
    system.center,
    system.frame,
    base,
    start,
    end,
    history,
    attempt,
  ]);
  const [result, setResult] = useState<{
    key: string;
    data: PlanetWindow | null;
    completed: number;
    total: number;
    ready: boolean;
    error: string;
  }>({ key: "", data: null, completed: 0, total: 0, ready: false, error: "" });
  useEffect(() => {
    if (!enabled || !base || end <= start) {
      setResult({
        key,
        data: null,
        completed: 0,
        total: 0,
        ready: false,
        error: "",
      });
      return;
    }
    if (ids.length && (!catalog || !leaps.length)) return;
    const controller = new AbortController();
    let cancelled = false;
    setResult({
      key,
      data: null,
      completed: 0,
      total: 0,
      ready: false,
      error: "",
    });
    // Avoid computing intermediate ranges while a handle is being dragged.
    const timer = window.setTimeout(() => {
      void (async () => {
        if (!ids.length) {
          setResult({
            key,
            data: null,
            completed: 1,
            total: 1,
            ready: true,
            error: "",
          });
          return;
        }
        const minimum = utcInputSeconds(
          catalog!.min_utc.replace(/Z$/, ""),
          base,
          leaps,
        );
        const maximum = utcInputSeconds(
          catalog!.max_utc.replace(/Z$/, ""),
          base,
          leaps,
        );
        if (start < minimum || end > maximum)
          throw new Error("缓存范围超出本地行星星历覆盖，请缩小时间范围。");
        const segments = cacheSegments(start, end, history, minimum);
        const samples = segments.reduce(
          (n, s) => n + Math.ceil((s.end - s.start) / s.step) + 1,
          0,
        );
        if (samples * ids.length > MAX_BODY_SAMPLES)
          throw new Error(
            "所选范围过大，请缩短缓存时间范围或减少行星数量（缓存上限为 50 万个行星采样）。",
          );
        const total = segments.length;
        let merged: PlanetWindow | null = null;
        for (let i = 0; i < total; i++) {
          if (cancelled) return;
          setResult({
            key,
            data: null,
            completed: i,
            total,
            ready: false,
            error: "",
          });
          const part = segments[i];
          const next = await api<PlanetWindow>("/planets/window", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              body_ids: ids,
              center: system.center,
              frame: system.frame,
              reference_tai: base,
              start_s: part.start,
              end_s: part.end,
              step_s: part.step,
              history: part.step > HOUR,
            }),
          });
          if (cancelled) return;
          if (merged) appendWindow(merged, next);
          else merged = next;
        }
        if (!cancelled)
          setResult({
            key,
            data: merged,
            completed: total,
            total,
            ready: true,
            error: "",
          });
      })().catch((e: Error) => {
        if (!cancelled)
          setResult({
            key,
            data: null,
            completed: 0,
            total: 0,
            ready: false,
            error: e.message,
          });
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, catalog, leaps]);
  const current = result.key === key;
  return {
    data: current ? result.data : null,
    ready: enabled && current && result.ready,
    error: current ? result.error : "",
    progress: current && result.total ? result.completed / result.total : 0,
    retry: () => setAttempt((n) => n + 1),
  };
}
