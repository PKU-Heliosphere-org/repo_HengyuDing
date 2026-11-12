import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

test("planet closed orbit and historical trail are independent and portable", async ({
  page,
  request,
}) => {
  const catalog = await (await request.get("/api/v1/planets/catalog")).json();
  test.skip(!catalog.ready, "Local ephemeris missing");
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
  await page.getByLabel("行星参考系").selectOption("ECLIPJ2000");
  await page.getByLabel("行星初始日期").fill("2028-01-30T12:00:00");
  await page
    .getByRole("button", { name: "添加 1 个图层", exact: true })
    .click();
  await expect(page.getByLabel("自由视角三维画布")).toHaveAttribute(
    "data-earth-lod",
    "glow",
  );
  await page.getByLabel("标准视角").selectOption("top");
  await expect(
    page.getByLabel("场景读数").locator(".scene-reference"),
  ).toHaveText("太阳中心 · ECLIPJ2000");
  const track = page.getByRole("checkbox", { name: "轨道", exact: true });
  const trail = page.getByRole("checkbox", { name: "尾迹", exact: true });
  await expect(track).toBeChecked();
  await expect(trail).toBeChecked();
  await trail.uncheck();
  const countBlue = async () => {
    await page.waitForTimeout(250);
    return page.evaluate(() => {
      const canvas = document.querySelector("canvas")!;
      const gl = canvas.getContext("webgl2")!,
        pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(
        0,
        0,
        canvas.width,
        canvas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          pixels[i + 2] > 80 &&
          pixels[i + 2] > pixels[i] * 1.25 &&
          pixels[i + 1] > 45
        )
          count++;
      return count;
    });
  };
  const fullOrbit = await countBlue();
  await page.screenshot({ path: "test-results/planet-closed-orbit.png" });
  await track.uncheck();
  expect(await countBlue()).toBeLessThan(fullOrbit - 100);
  const historyResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/planets/window") &&
      !!r.request().postDataJSON()?.history,
  );
  await trail.check();
  expect((await historyResponse).ok()).toBeTruthy();
  await expect(page.locator(".ephemeris-banner")).toHaveCount(0);
  const yearResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/planets/window") &&
      !!r.request().postDataJSON()?.history,
  );
  await page.getByLabel("尾迹时长").selectOption(String(365 * 86400));
  const year = await yearResponse;
  expect(year.ok()).toBeTruthy();
  const data = await year.json();
  expect(data.times.at(-1) - data.times[0]).toBeGreaterThanOrEqual(365 * 86400);
  await expect(page.locator(".ephemeris-banner")).toHaveCount(0);
  const yearPixels = await countBlue();
  await page.screenshot({ path: "test-results/planet-year-tail.png" });
  const dayResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/planets/window") &&
      !!r.request().postDataJSON()?.history,
  );
  await page.getByLabel("尾迹时长").selectOption(String(86400));
  expect((await dayResponse).ok()).toBeTruthy();
  await expect(page.locator(".ephemeris-banner")).toHaveCount(0);
  expect(await countBlue()).toBeLessThan(yearPixels - 200);
  await page.screenshot({ path: "test-results/planet-day-tail.png" });
  const before = await page.locator(".scene-readout time").textContent();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() => page.locator(".scene-readout time").textContent())
    .not.toBe(before);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const savedEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const projectPath = path.resolve("test-results/planet-trail.orbit.json");
  await (await savedEvent).saveAs(projectPath);
  const project = JSON.parse(await fs.readFile(projectPath, "utf8"));
  expect(project.state.layers[0]).toMatchObject({
    showTrack: false,
    showTrail: true,
    showLabel: true,
    glowSize: 6,
    lineWidth: 1,
  });
  await page.reload();
  await page
    .locator('input[type=file][accept=".json"]')
    .setInputFiles(projectPath);
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  await expect(trail).toBeChecked();
  await expect(track).not.toBeChecked();
  await expect(page.getByLabel("行星光点大小")).toHaveValue("6");
  await expect(page.getByLabel("轨道线宽", { exact: true })).toHaveValue("1");
  expect(errors).toEqual([]);
});
