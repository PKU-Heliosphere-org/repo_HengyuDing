import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

async function scene(page: Page, request: APIRequestContext) {
  const AU = 149597870.7;
  const csv = `epoch,a,e,i,raan,arg_periapsis,true_anomaly\n2026-01-01T00:00:00Z,${AU},0,0,0,0,0\n2026-01-02T00:00:00Z,${AU},0,0,0,0,90\n`;
  const inspection = await (
    await request.post("/api/v1/imports/inspect", {
      multipart: {
        file: {
          name: "video.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(csv),
        },
      },
    })
  ).json();
  const ds = await (
    await request.post(`/api/v1/imports/${inspection.id}/commit`, {
      data: {
        mapping: inspection.mapping,
        metadata: { center: "sun", frame: "ECLIPJ2000" },
      },
    })
  ).json();
  const camera = {
    position_km: [0, 0, 8 * AU],
    target_km: [0, 0, 0],
    up: [0, 1, 0],
    follow_id: null,
    fov: 34,
    zoom: 1,
  };
  const project = await (
    await request.post("/api/v1/projects/export", {
      data: {
        dataset_ids: [ds.id],
        state: {
          layers: [
            {
              id: "arc",
              dataset_id: ds.id,
              kind: "dataset",
              name: "Video test",
              color: "#69caca",
              visible: true,
              showTrack: true,
              showTrail: true,
              showLabel: true,
            },
          ],
          selected: "arc",
          clock: {
            base_tai: ds.reference_tai,
            time: 43200,
            start: 0,
            end: 86400,
            speed: 86400,
          },
          scene: { center: "sun", frame: "ECLIPJ2000" },
          axes: false,
          grid: true,
          stars: false,
          radius_km: 100 * AU,
          trail_s: 86400,
          camera,
          camera_keyframes_enabled: true,
          camera_keyframes: [
            { id: "a", time: 0, camera },
            {
              id: "b",
              time: 86400,
              camera: { ...camera, position_km: [3 * AU, 0, 8 * AU] },
            },
          ],
        },
      },
    })
  ).json();
  await page.goto("/");
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: "video.orbit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  await page.getByLabel("启用缓存渲染", { exact: true }).check();
  await expect(page.getByText("缓存就绪 · 可播放所选范围")).toBeVisible();
}

test("fixed portrait MP4 follows cached keyframes, restores the scene and can cancel cleanly", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  test.skip(
    !(await (await request.get("/api/v1/video-exports/capabilities")).json())
      .mp4,
    "Local H.264 FFmpeg missing",
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await scene(page, request);
  const before = JSON.parse(
    (await page.getByLabel("自由视角三维画布").getAttribute("data-camera"))!,
  );
  await page.getByRole("button", { name: "导出视频", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出视频", exact: true });
  await page.getByLabel("视频画幅比例").selectOption("9:16");
  await page.getByLabel("视频帧率").selectOption("24");
  await page.getByLabel("视频时长").fill("1");
  const image = page.getByAltText("视频画幅预览");
  await expect
    .poll(() =>
      image.evaluate((img) => [
        (img as HTMLImageElement).naturalWidth,
        (img as HTMLImageElement).naturalHeight,
      ]),
    )
    .toEqual([720, 1280]);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect
    .poll(() =>
      image.evaluate((img) => [
        (img as HTMLImageElement).naturalWidth,
        (img as HTMLImageElement).naturalHeight,
      ]),
    )
    .toEqual([720, 1280]);
  await page.screenshot({ path: "test-results/video-portrait-settings.png" });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "开始导出 MP4", exact: true }).click();
  const file = path.resolve("test-results/video-portrait.mp4");
  await (await download).saveAs(file);
  await expect(page.getByText("视频已生成，请保存 MP4 文件。")).toBeVisible();
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-of", "json", file],
      { encoding: "utf8", windowsHide: true },
    ),
  ).streams[0];
  expect([
    probe.width,
    probe.height,
    probe.r_frame_rate,
    Number(probe.nb_frames),
  ]).toEqual([720, 1280, "24/1", 24]);
  expect(Number(probe.duration)).toBeCloseTo(1, 3);
  const hashes = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-f", "framemd5", "-"],
    { encoding: "utf8", windowsHide: true },
  )
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"));
  expect(hashes).toHaveLength(24);
  expect(hashes[0].split(",").at(-1)).not.toEqual(
    hashes.at(-1)!.split(",").at(-1),
  );
  // Export must not leave the playhead or camera at its final frame.
  await expect
    .poll(() => page.getByLabel("时间游标", { exact: true }).inputValue())
    .toBe("43200");
  await expect
    .poll(async () => {
      const c = JSON.parse(
        (await page
          .getByLabel("自由视角三维画布")
          .getAttribute("data-camera"))!,
      );
      return Math.hypot(
        ...c.position_km.map(
          (v: number, i: number) => v - before.position_km[i],
        ),
      );
    })
    .toBeLessThan(1e-5);
  let entered!: () => void, release!: () => void;
  const pending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/video-exports/*/frames/0", async (route) => {
    entered();
    await gate;
    await route.continue().catch(() => {});
  });
  await page.getByRole("button", { name: "开始导出 MP4", exact: true }).click();
  await pending;
  await dialog.getByRole("button", { name: "取消导出", exact: true }).click();
  release();
  await expect(page.getByText("已取消视频导出。")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始导出 MP4", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() => page.getByLabel("时间游标", { exact: true }).inputValue())
    .toBe("43200");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await fs.stat(file)).size).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test("missing video encoder disables export with instructions", async ({
  page,
  request,
}) => {
  await scene(page, request);
  await page.route("**/api/v1/video-exports/capabilities", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mp4: false,
        message: "未找到 FFmpeg，请安装到 PATH 后重启 ORBIT。",
      }),
    }),
  );
  await page.getByRole("button", { name: "导出视频", exact: true }).click();
  await expect(
    page.getByText("未找到 FFmpeg，请安装到 PATH 后重启 ORBIT。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始导出 MP4", exact: true }),
  ).toBeDisabled();
});

test("real cached planet surface and follow camera export at fixed landscape size", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  test.skip(
    !(await (await request.get("/api/v1/video-exports/capabilities")).json())
      .mp4,
    "Local H.264 FFmpeg missing",
  );
  test.skip(
    !(await (await request.get("/api/v1/planets/catalog")).json()).ready,
    "Local ephemeris missing",
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.getByText("本地服务已连接").waitFor();
  await page
    .getByRole("button", { name: "添加行星", exact: true })
    .first()
    .click();
  await page.getByLabel("行星初始日期").fill("2028-01-30T12:00:00");
  await page
    .getByRole("button", { name: "添加 1 个图层", exact: true })
    .click();
  await page.getByLabel("回放终点").fill("2028-03-01T12:00:00");
  await page.getByLabel("启用缓存渲染", { exact: true }).check();
  await expect(page.getByText("缓存就绪 · 可播放所选范围")).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "聚焦表面", exact: true }).click();
  await expect(page.getByLabel("自由视角三维画布")).toHaveAttribute(
    "data-earth-lod",
    "surface",
  );
  const source = JSON.parse(
    (await page.getByLabel("自由视角三维画布").getAttribute("data-camera"))!,
  );
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/planets/window")) requests++;
  });
  await page.getByRole("button", { name: "导出视频", exact: true }).click();
  await page.getByLabel("视频帧率").selectOption("24");
  await page.getByLabel("视频时长").fill("1");
  await expect
    .poll(() =>
      page
        .getByAltText("视频画幅预览")
        .evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBe(1280);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "开始导出 MP4", exact: true }).click();
  const file = path.resolve("test-results/video-earth-landscape.mp4");
  await (await pending).saveAs(file);
  await expect(page.getByText("视频已生成，请保存 MP4 文件。")).toBeVisible();
  const info = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-of", "json", file],
      { encoding: "utf8", windowsHide: true },
    ),
  ).streams[0];
  expect([info.width, info.height, Number(info.nb_frames)]).toEqual([
    1280, 720, 24,
  ]);
  await page
    .getByRole("dialog", { name: "导出视频", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect
    .poll(async () => {
      const c = JSON.parse(
        (await page
          .getByLabel("自由视角三维画布")
          .getAttribute("data-camera"))!,
      );
      return Math.hypot(
        ...c.position_km.map(
          (v: number, i: number) => v - source.position_km[i],
        ),
      );
    })
    .toBeLessThan(1);
  expect(requests).toBe(0);
  expect(errors).toEqual([]);
});
