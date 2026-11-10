import { useEffect, useRef, useState } from "react";
import { post } from "./api";
import { utcInputSeconds } from "./time";
import type {
  BodyId,
  Leap,
  PlanetCatalog,
  PlanetWindow,
  SceneSystem,
} from "./types";

export function usePlanetWindow(
  ids: BodyId[],
  system: SceneSystem,
  base: string,
  time: number,
  speed: number,
  leaps: Leap[],
  catalog: PlanetCatalog | null,
) {
  const [data, setData] = useState<PlanetWindow | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const request = useRef({ version: 0, pending: false, key: "", failed: "" });
  const key = [
    base,
    system.center,
    system.frame,
    [...ids].sort().join(","),
  ].join("|");
  const storedKey = useRef("");
  useEffect(() => {
    const state = request.current;
    if (state.key !== key) {
      state.version++;
      state.pending = false;
      state.key = key;
      state.failed = "";
      setData(null);
      setError("");
      storedKey.current = "";
    }
    if (!ids.length || !base || !catalog || !leaps.length) {
      setLoading(false);
      return;
    }
    const minimum = utcInputSeconds(
        catalog.min_utc.replace(/Z$/, ""),
        base,
        leaps,
      ),
      maximum = utcInputSeconds(catalog.max_utc.replace(/Z$/, ""), base, leaps);
    const valid = storedKey.current === key && data;
    const span = Math.max(4 * 86400, Math.min(120 * 86400, speed * 20));
    const margin = Math.min(span * 0.15, Math.max(3600, speed * 4));
    const covered =
      valid && time >= data.times[0] && time <= data.times.at(-1)!;
    const nearEdge =
      covered &&
      ((time > data.times.at(-1)! - margin &&
        data.times.at(-1)! < maximum - 1) ||
        (time < data.times[0] + margin && data.times[0] > minimum + 1));
    const failureKey = key + "|" + Math.floor(time / 3600);
    if (state.pending || state.failed === failureKey || (covered && !nearEdge))
      return;
    if (time < minimum || time > maximum) {
      setError("当前时间超出本地行星星历覆盖范围（1972–2150 年）。");
      return;
    }
    const start = Math.max(
      minimum,
      Math.floor((time - span * 0.3) / 3600) * 3600,
    );
    const end = Math.min(maximum, start + span);
    const version = ++state.version;
    state.pending = true;
    setLoading(true);
    void post<PlanetWindow>("/planets/window", {
      body_ids: ids,
      center: system.center,
      frame: system.frame,
      reference_tai: base,
      start_s: start,
      end_s: end,
      step_s: 3600,
    })
      .then((next) => {
        if (version !== request.current.version) return;
        storedKey.current = key;
        setData(next);
        setError("");
      })
      .catch((e) => {
        if (version === request.current.version) {
          state.failed = failureKey;
          setError(e.message);
        }
      })
      .finally(() => {
        if (version === request.current.version) {
          state.pending = false;
          setLoading(false);
        }
      });
  }, [key, time, speed, data, leaps, catalog]);
  return { data: storedKey.current === key ? data : null, loading, error };
}
