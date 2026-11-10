import type { Dataset, Leap, Sample, Vec3 } from "./types";
// Date is used only as a Gregorian calendar encoder here; input is explicitly TAI.
export const calendarSeconds = (tai: string) => Date.parse(tai + "Z") / 1000;
export const offsetSeconds = (dataset: Dataset, base: string) =>
  calendarSeconds(dataset.reference_tai) - calendarSeconds(base);
export function sampleAt(samples: Sample[], t: number, maxGap: number) {
  if (
    !samples.length ||
    t < samples[0].t - 1e-6 ||
    t > samples.at(-1)!.t + 1e-6
  )
    return null;
  let lo = 0,
    hi = samples.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (samples[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const right = samples[lo],
    left = samples[Math.max(0, lo - 1)];
  if (Math.abs(t - right.t) < 1e-6)
    return {
      position: right.position_km,
      sample: right,
      interpolated: false,
      index: lo,
    };
  if (right.t - left.t > maxGap) return null;
  const alpha = (t - left.t) / (right.t - left.t);
  const position = left.position_km.map(
    (v, i) => v + alpha * (right.position_km[i] - v),
  ) as Vec3;
  return {
    position,
    sample: alpha <= 0.5 ? left : right,
    interpolated: true,
    index: alpha <= 0.5 ? lo - 1 : lo,
  };
}
export function utcLabel(base: string, t: number, leaps: Leap[]): string {
  if (!base || !leaps.length) return "—";
  const taiMs = (calendarSeconds(base) + t) * 1000;
  let offset = leaps[0].offset;
  for (const leap of leaps) {
    const effective = leap.utc_ms + leap.offset * 1000;
    if (
      leap.offset > offset &&
      taiMs >= effective - 1000 &&
      taiMs < effective
    ) {
      const day = new Date(leap.utc_ms - 1000).toISOString().slice(0, 17);
      return (
        day +
        "60." +
        String(Math.floor(taiMs - effective + 1000)).padStart(3, "0") +
        "Z"
      );
    }
    if (taiMs < effective) break;
    offset = leap.offset;
  }
  const ms = taiMs - offset * 1000;
  return Number.isFinite(ms) && Math.abs(ms) < 8.64e15
    ? new Date(ms).toISOString()
    : "—";
}
export function utcInputSeconds(value: string, base: string, leaps: Leap[]) {
  const ms = Date.parse(value + "Z");
  if (!Number.isFinite(ms)) return NaN;
  let offset = leaps[0]?.offset ?? 37;
  for (const leap of leaps) {
    if (ms < leap.utc_ms) break;
    offset = leap.offset;
  }
  return ms / 1000 + offset - calendarSeconds(base);
}
