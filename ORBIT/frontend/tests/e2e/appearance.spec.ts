import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

test("layer appearance changes rendered pixels and survives project restore", async ({
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
  expect(
    await page
      .locator(".app-header")
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBe(31);
  await expect(page.getByText("轨道分析工作台", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "添加行星", exact: true })
    .first()
    .click();
  await page.getByLabel("行星初始日期").fill("2028-01-30T12:00:00");
  await page
    .getByRole("button", { name: "添加 1 个图层", exact: true })
    .click();
  await expect(page.getByLabel("自由视角三维画布")).toHaveAttribute(
    "data-earth-lod",
    "glow",
  );
  const bluePixels = async () => {
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const canvas = document.querySelector("canvas")!;
      const gl = canvas.getContext("webgl2")!;
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
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
  const glow = page.getByLabel("行星光点大小");
  await expect(glow).toHaveValue("24");
  await expect(page.getByLabel("轨道线宽", { exact: true })).toHaveValue("3");
  await expect(
    page.locator(".planet-inspector .layer-style input[type=checkbox]"),
  ).toHaveCount(3);
  await glow.focus();
  await glow.press("Home");
  const small = await bluePixels();
  await glow.press("End");
  await expect(glow).toHaveValue("48");
  expect(await bluePixels()).toBeGreaterThan(small + 30);
  await glow.press("Home");
  await page.getByRole("checkbox", { name: "轨道", exact: true }).check();
  const width = page.getByLabel("轨道线宽", { exact: true });
  await width.focus();
  await width.press("Home");
  const thin = await bluePixels();
  await width.press("End");
  await expect(width).toHaveValue("8");
  expect(await bluePixels()).toBeGreaterThan(thin + 30);
  const saveEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const projectPath = path.resolve("test-results/appearance.orbit.json");
  await (await saveEvent).saveAs(projectPath);
  const project = JSON.parse(await fs.readFile(projectPath, "utf8"));
  expect(project.state.layers[0].glowSize).toBe(2);
  expect(project.state.layers[0].lineWidth).toBe(8);
  await page.reload();
  await page
    .locator('input[type=file][accept=".json"]')
    .setInputFiles(projectPath);
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  await expect(page.getByLabel("行星光点大小")).toHaveValue("2");
  await expect(page.getByLabel("轨道线宽", { exact: true })).toHaveValue("8");
  await page.getByLabel("行星光点大小").focus();
  await page.getByLabel("行星光点大小").press("End");
  await page.screenshot({ path: "test-results/appearance.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(
    await page
      .locator(".app-header")
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBe(27);
  expect(errors).toEqual([]);
});
