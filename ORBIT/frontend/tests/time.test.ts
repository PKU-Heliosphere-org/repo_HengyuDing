import { describe, expect, it } from "vitest";
import { sampleAt, utcLabel } from "../src/time";
import type { Sample } from "../src/types";

const sample = (t: number, x: number) =>
  ({
    t,
    position_km: [x, 0, 0],
    source_rows: [2],
    epoch_utc: "",
    epoch_tai: "",
    speed_km_s: 0,
    elements: {
      a: 7000,
      e: 0,
      i: 0,
      raan: 0,
      arg_periapsis: 0,
      true_anomaly: 0,
    },
  }) as Sample;
describe("sample playback without propagation", () => {
  const samples = [sample(0, 0), sample(10, 100), sample(100, 200)];
  it("interpolates by actual time rather than row index", () => {
    const at = sampleAt(samples, 5, 20)!;
    expect(at.position).toEqual([50, 0, 0]);
    expect(at.interpolated).toBe(true);
    expect(at.sample).toBe(samples[0]);
  });
  it("hides gaps and out-of-range positions while preserving exact samples", () => {
    expect(sampleAt(samples, 30, 20)).toBeNull();
    expect(sampleAt(samples, -1, 20)).toBeNull();
    expect(sampleAt(samples, 101, 20)).toBeNull();
    expect(sampleAt(samples, 100, 20)?.position).toEqual([200, 0, 0]);
  });
  it("handles a single epoch without propagating", () => {
    expect(sampleAt([sample(0, 1)], 0, 20)?.interpolated).toBe(false);
    expect(sampleAt([sample(0, 1)], 1, 20)).toBeNull();
  });
});
describe("TAI to UTC presentation", () => {
  const leaps = [
    { utc_ms: Date.UTC(2015, 6, 1), offset: 36 },
    { utc_ms: Date.UTC(2017, 0, 1), offset: 37 },
  ];
  it("renders the leap second and the following midnight explicitly", () => {
    const base = "2017-01-01T00:00:35.000";
    expect(utcLabel(base, 0, leaps)).toBe("2016-12-31T23:59:59.000Z");
    expect(utcLabel(base, 1, leaps)).toBe("2016-12-31T23:59:60.000Z");
    expect(utcLabel(base, 2, leaps)).toBe("2017-01-01T00:00:00.000Z");
  });
});
