// Optional, local-only benchmark: node tests/benchmark.mjs (running API required).
import path from "node:path";
import fs from "node:fs/promises";
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve("../.cache/ms-playwright");
const { chromium } = await import("@playwright/test");
const origin = process.env.ORBIT_TEST_URL || "http://127.0.0.1:8765";
const hardware = process.argv.includes("--hardware");
async function json(url, options = {}) {
  const r = await fetch(origin + "/api/v1" + url, options);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
const loaded = [];
const timings = [];
for (let object = 0; object < 5; object++) {
  let csv = "epoch,a,e,i,raan,arg_periapsis,true_anomaly\n";
  for (let i = 0; i < 10000; i++)
    csv += `${new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString()},${1.2e8 + object * 3e7},0.2,${object * 12},${object * 36},10,${(i * 0.036 + object * 10) % 360}\n`;
  const form = new FormData();
  form.append("file", new File([csv], `synthetic-${object}.csv`));
  const inspected = await json("/imports/inspect", {
    method: "POST",
    body: form,
  });
  const before = performance.now();
  const dataset = await json(`/imports/${inspected.id}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metadata: {
        object_name: `合成对象 ${object + 1}`,
        metadata_status: "verified",
        metadata_notes: "人工采样用于性能测试，不是内置星历",
      },
      mapping: inspected.mapping,
    }),
  });
  timings.push(performance.now() - before);
  loaded.push(dataset);
}
const colors = ["#69caca", "#eebf78", "#9d9be9", "#e88eaa", "#8cbd87"];
const state = {
  layers: loaded.map((d, i) => ({
    id: `bench-${i}`,
    dataset_id: d.id,
    kind: "dataset",
    name: d.metadata.object_name,
    color: colors[i],
    visible: true,
    showTrack: true,
    showTrail: true,
    showLabel: true,
  })),
  selected: "bench-0",
  clock: {
    base_tai: loaded[0].reference_tai,
    time: 180000,
    speed: 3600,
    start: 0,
    end: 599940,
  },
  axes: true,
  grid: true,
  radius_km: 4e8,
  trail_s: 86400 * 60,
};
const project = await json("/projects/export", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ dataset_ids: loaded.map((d) => d.id), state }),
});
const browser = await chromium.launch({
  channel: "chromium",
  args: hardware
    ? []
    : [
        "--enable-webgl",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(origin);
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: "benchmark.orbit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByText("项目已恢复，采样位置已重新计算").waitFor();
  await page.evaluate(() => {
    window.orbitFrames = [];
    const original = WebGL2RenderingContext.prototype.clear;
    WebGL2RenderingContext.prototype.clear = function (mask) {
      window.orbitFrames.push(performance.now());
      return original.call(this, mask);
    };
  });
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForTimeout(6000);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const result = await page.evaluate(() => {
    const t = window.orbitFrames;
    const delta = t
      .slice(1)
      .map((v, i) => v - t[i])
      .filter((v) => v > 1)
      .sort((a, b) => a - b);
    const context = document.querySelector("canvas").getContext("webgl2");
    const ext = context?.getExtension("WEBGL_debug_renderer_info");
    return {
      rendered_frames: t.length,
      median_frame_ms: delta[Math.floor(delta.length / 2)],
      average_fps: ((t.length - 1) * 1000) / (t.at(-1) - t[0]),
      renderer: ext
        ? context.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : "unknown",
      user_agent: navigator.userAgent,
    };
  });
  result.commit_ms = timings;
  result.objects = 5;
  result.points_per_object = 10000;
  result.viewport = "1440x900";
  result.synthetic = true;
  result.requested_renderer = hardware ? "browser default" : "SwiftShader";
  const beforePreview = performance.now();
  await json("/orbits/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      elements: loaded[0].samples[0].elements,
      metadata: loaded[0].metadata,
      radius_km: 4e8,
    }),
  });
  result.preview_ms = performance.now() - beforePreview;
  await fs.mkdir("test-results", { recursive: true });
  await fs.writeFile(
    hardware
      ? "test-results/benchmark-hardware.json"
      : "test-results/benchmark.json",
    JSON.stringify(result, null, 2),
  );
  await page.screenshot({ path: "test-results/orbit-five-objects.png" });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
