import { expect, it } from "vitest";
import { videoFrameTime, videoSize } from "../src/videoExport";

it("uses fixed even export dimensions independently of the workspace", () => {
  expect(videoSize("16:9", 1080)).toEqual({ width: 1920, height: 1080 });
  expect(videoSize("9:16", 1080)).toEqual({ width: 1080, height: 1920 });
  expect(videoSize("1:1", 720)).toEqual({ width: 720, height: 720 });
});
it("samples both selected endpoints at deterministic frame indices", () => {
  expect(videoFrameTime(100, 1100, 0, 301)).toBe(100);
  expect(videoFrameTime(100, 1100, 150, 301)).toBe(600);
  expect(videoFrameTime(100, 1100, 300, 301)).toBe(1100);
});
