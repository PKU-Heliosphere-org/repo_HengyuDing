import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

test("xlsx worksheet selection, row conflicts and portable project", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "导入数据", exact: true }).click();
  await page
    .getByLabel("选择CSV或XLSX")
    .setInputFiles(path.resolve("tests/fixtures/ephemeris.xlsx"));
  await page.getByRole("button", { name: "读取文件", exact: true }).click();
  await expect(page.getByLabel("XLSX工作表")).toBeVisible();
  await page.getByLabel("XLSX工作表").selectOption("轨道数据");
  await page.getByRole("button", { name: "读取工作表", exact: true }).click();
  await expect(page.locator(".file-summary")).toContainText("轨道数据");
  await expect(page.locator(".file-summary")).toContainText("4 条原始记录");
  await page.getByRole("button", { name: "更换工作表", exact: true }).click();
  await expect(page.getByLabel("XLSX工作表")).toHaveValue("轨道数据");
  await page.getByRole("button", { name: "读取工作表", exact: true }).click();
  await page.getByRole("button", { name: "运行预检", exact: true }).click();
  await expect(
    page.getByText("同一时刻有冲突记录", { exact: false }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "保留行 6", exact: false }).check();
  await page.getByRole("button", { name: "运行预检", exact: true }).click();
  await expect(page.getByText("预检结果 · 可导入")).toBeVisible();
  await page.screenshot({ path: "test-results/xlsx-preflight.png" });
  await page.getByRole("button", { name: "添加到场景", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("已导入 3 个有效采样点")).toBeVisible();
  await expect(page.locator(".scene-readout time")).toHaveText(
    "2026-01-01 00:00:00",
  );
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() => page.locator(".scene-readout time").textContent())
    .not.toBe("2026-01-01 00:00:00");
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const glow = page.getByLabel("对象光点大小");
  await expect(glow).toHaveValue("24");
  await page.getByRole("checkbox", { name: "轨道", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "尾迹", exact: true }).uncheck();
  const glowPixels = async () => {
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
          pixels[i + 1] > 70 &&
          pixels[i + 2] > 70 &&
          pixels[i + 1] > pixels[i] * 1.3
        )
          count++;
      return count;
    });
  };
  await glow.focus();
  await glow.press("Home");
  const small = await glowPixels();
  await glow.press("End");
  await expect(glow).toHaveValue("48");
  expect(await glowPixels()).toBeGreaterThan(small + 30);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const target = path.resolve("test-results/xlsx.orbit.json");
  await (await saved).saveAs(target);
  const project = JSON.parse(await fs.readFile(target, "utf8"));
  expect(project.state.layers[0].glowSize).toBe(48);
  expect(project.datasets[0]).toMatchObject({
    filename: "ephemeris.xlsx",
    source_format: "xlsx",
    worksheet: "轨道数据",
  });
  await page.reload();
  await page.locator('input[type=file][accept=".json"]').setInputFiles(target);
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  await expect(page.locator(".layer-row")).toHaveCount(1);
  await expect(page.getByLabel("对象光点大小")).toHaveValue("48");
  await expect(page.locator(".scene-readout time")).not.toHaveText("—");
  await page.screenshot({ path: "test-results/xlsx-restored.png" });
  expect(errors).toEqual([]);
});

test("broken workbook error can be corrected by choosing a CSV", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "导入数据", exact: true }).click();
  await page.getByLabel("选择CSV或XLSX").setInputFiles({
    name: "broken.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("not a workbook"),
  });
  await page.getByRole("button", { name: "读取文件", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("无法读取 XLSX");
  await page.getByLabel("选择CSV或XLSX").setInputFiles({
    name: "valid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "epoch,a,e,i,raan,arg_periapsis,true_anomaly\n2026-01-01T00:00:00Z,7000,0,0,0,0,0\n",
    ),
  });
  await page.getByRole("button", { name: "读取文件", exact: true }).click();
  await page.getByRole("button", { name: "运行预检", exact: true }).click();
  await expect(page.getByText("预检结果 · 可导入")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "添加到场景", exact: true }).click();
  await expect(page.getByLabel("对象光点大小")).toHaveValue("24");
});
