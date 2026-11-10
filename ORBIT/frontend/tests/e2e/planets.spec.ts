import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

test("planet layers, real surface LOD, free camera and future orientation warning", async ({
  page,
  request,
}) => {
  const catalog = await (await request.get("/api/v1/planets/catalog")).json();
  test.skip(!catalog.ready, "Local ephemeris kernels are not installed");
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
  await page.getByRole("button", { name: "选择土星" }).click();
  await page
    .getByRole("button", { name: "添加 2 个图层", exact: true })
    .click();
  await expect(page.getByTestId("earth-quality")).toContainText("近似姿态");
  const canvas = page.getByLabel("自由视角三维画布");
  await expect(canvas).toHaveAttribute("data-earth-lod", "glow");
  await page.getByRole("button", { name: "聚焦表面", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-earth-lod", "surface");
  await page.waitForTimeout(700);
  await page.screenshot({ path: "test-results/v02-earth.png" });
  const before = JSON.parse((await canvas.getAttribute("data-camera"))!);
  await page.getByRole("button", { name: "向右滚转15度" }).click();
  await expect
    .poll(
      async () => JSON.parse((await canvas.getAttribute("data-camera"))!).up,
    )
    .not.toEqual(before.up);
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.6,
    bounds!.y + bounds!.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.72,
    bounds!.y + bounds!.height * 0.57,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = JSON.parse((await canvas.getAttribute("data-camera"))!);
  expect(after.position_km).not.toEqual(before.position_km);
  await page.getByLabel("播放倍率").selectOption("3600");
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-earth-lod", "surface");
  // A resize changes aspect only, preserving the user's camera.
  await page.waitForTimeout(400);
  const preResize = JSON.parse((await canvas.getAttribute("data-camera"))!);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);
  const postResize = JSON.parse((await canvas.getAttribute("data-camera"))!);
  expect(postResize.position_km).toEqual(preResize.position_km);
  await page.locator(".layer-select").filter({ hasText: "土星" }).click();
  await page.getByRole("button", { name: "聚焦表面", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-saturn-lod", "surface");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/v02-saturn.png" });
  const saveEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目" }).click();
  const saved = await saveEvent;
  const projectPath = path.resolve("test-results/v02-planet.orbit.json");
  await saved.saveAs(projectPath);
  const project = JSON.parse(await fs.readFile(projectPath, "utf8"));
  expect(project.schema_version).toBe(2);
  expect(project.datasets).toEqual([]);
  expect(project.state.camera.follow_id).toBe(project.state.selected);
  await page.reload();
  await page.getByText("本地服务已连接").waitFor();
  await page
    .locator('input[type=file][accept=".json"]')
    .setInputFiles(projectPath);
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-saturn-lod", "surface");
  const restored = JSON.parse((await canvas.getAttribute("data-camera"))!);
  expect(
    Math.hypot(
      ...restored.position_km.map(
        (v: number, i: number) => v - project.state.camera.position_km[i],
      ),
    ),
  ).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test("earth day and night surfaces use the solar direction at the same epoch", async ({
  page,
  request,
}) => {
  const catalog = await (await request.get("/api/v1/planets/catalog")).json();
  test.skip(!catalog.ready, "Local kernels missing");
  const epoch = "2028-01-30T12:00:37.000";
  const result = await (
    await request.post("/api/v1/planets/window", {
      data: {
        body_ids: ["earth"],
        reference_tai: epoch,
        start_s: 0,
        end_s: 3600,
      },
    })
  ).json();
  const earth = result.bodies.earth,
    p = earth.positions_km[0] as number[],
    sun = result.sun_positions_km[0] as number[];
  const direction = sun.map((v, i) => v - p[i]);
  const norm = Math.hypot(...direction);
  const radius = earth.radii_km[0];
  const brightness: number[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  for (const [index, sign] of [1, -1].entries()) {
    const state = {
      layers: [
        {
          id: "earth-test",
          kind: "planet",
          body_id: "earth",
          name: "地球",
          color: "#72b8ed",
          visible: true,
          showTrack: false,
          showTrail: false,
          showLabel: true,
          showMeridian: false,
        },
      ],
      selected: "earth-test",
      clock: { base_tai: epoch, time: 0, speed: 3600, start: 0, end: 86400 },
      axes: false,
      grid: false,
      radius_km: 1e8,
      trail_s: 86400,
      scene: { center: "sun", frame: "J2000" },
      stars: false,
      camera: {
        position_km: p.map(
          (v, i) => v + ((sign * direction[i]) / norm) * radius * 4,
        ),
        target_km: p,
        up: [0, 0, 1],
        follow_id: "earth-test",
      },
    };
    await page.goto("/");
    await page.getByText("本地服务已连接").waitFor();
    await page
      .locator('input[type=file][accept=".json"]')
      .setInputFiles({
        name: "phase.orbit.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            schema_version: 2,
            app_version: "0.2.0",
            datasets: [],
            state,
          }),
        ),
      });
    await expect(page.getByLabel("自由视角三维画布")).toHaveAttribute(
      "data-earth-lod",
      "surface",
    );
    await page.waitForTimeout(400);
    brightness.push(
      await page.evaluate(() => {
        const canvas = document.querySelector("canvas")!;
        const gl = canvas.getContext("webgl2")!;
        const pixels = new Uint8Array(40 * 40 * 4);
        gl.readPixels(
          Math.floor(canvas.width / 2) - 20,
          Math.floor(canvas.height / 2) - 20,
          40,
          40,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 4)
          sum +=
            0.2126 * pixels[i] +
            0.7152 * pixels[i + 1] +
            0.0722 * pixels[i + 2];
        return sum / 1600;
      }),
    );
    await page.screenshot({
      path:
        "test-results/v02-earth-" + (index === 0 ? "day" : "night") + ".png",
    });
  }
  expect(brightness[0]).toBeGreaterThan(brightness[1] * 2);
  expect(brightness[0]).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});

test("all eight planets can be added as independent layers", async ({
  page,
  request,
}) => {
  const catalog = await (await request.get("/api/v1/planets/catalog")).json();
  test.skip(!catalog.ready, "Local kernels missing");
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
  for (const body of catalog.bodies)
    if (body.id !== "earth")
      await page
        .getByRole("button", { name: "选择" + body.name, exact: true })
        .click();
  await page
    .getByRole("button", { name: "添加 8 个图层", exact: true })
    .click();
  const canvas = page.getByLabel("自由视角三维画布");
  await expect(canvas).toHaveAttribute("data-neptune-lod", "glow");
  await expect(page.locator(".layer-row")).toHaveCount(8);
  await page.getByLabel("标准视角").selectOption("top");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/v02-eight-planets.png" });
  await page.locator(".layer-select").filter({ hasText: "木星" }).click();
  await page.getByRole("button", { name: "聚焦表面", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-jupiter-lod", "surface");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/v02-jupiter.png" });
  expect(errors).toEqual([]);
});
