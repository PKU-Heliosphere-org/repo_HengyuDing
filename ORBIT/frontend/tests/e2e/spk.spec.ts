import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";

test("SPK target, invalid range recovery, trails, cache and portable project", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("本地服务已连接")).toBeVisible();
  await page
    .getByRole("button", { name: "导入 CSV / XLSX / BSP", exact: true })
    .click();
  await page
    .getByLabel("选择CSV、XLSX或BSP")
    .setInputFiles({
      name: "synthetic.bsp",
      mimeType: "application/octet-stream",
      buffer: execFileSync(
        path.resolve(
          process.platform === "win32"
            ? "../.venv/Scripts/python.exe"
            : "../.venv/bin/python",
        ),
        [path.resolve("tests/fixtures/make_spk.py")],
        { windowsHide: true },
      ),
    });
  await page.getByRole("button", { name: "读取文件", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "导入 SPK 星历" }),
  ).toBeVisible();
  await expect(page.getByLabel("SPK目标")).toContainText("1000001");
  await page.getByLabel("SPK对象名称").fill("Synthetic comet");
  await page.getByLabel("SPK结束时间TDB").fill("2026-02-01T00:00:00");
  await page.getByRole("button", { name: "采样并添加到场景" }).click();
  await expect(page.getByRole("alert")).toContainText("覆盖区间");
  await page.getByLabel("SPK结束时间TDB").fill("2026-01-06T00:00:00");
  await page.getByLabel("SPK输出参考系").selectOption("ECLIPJ2000");
  await page.getByRole("button", { name: "采样并添加到场景" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("已导入 121 个有效采样点")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "尾迹", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", { name: "启用缓存渲染", exact: true })
    .check();
  await expect(
    page.getByText("缓存就绪", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() => page.locator(".scene-readout time").textContent())
    .not.toBe("2025-12-31 23:58:50");
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const target = path.resolve("test-results/spk.orbit.json");
  await (await download).saveAs(target);
  const project = JSON.parse(await fs.readFile(target, "utf8"));
  expect(project.datasets[0].source_format).toBe("bsp");
  expect(project.datasets[0].import_request.spk.target_id).toBe(1000001);
  await page.reload();
  await page.locator('input[type=file][accept=".json"]').setInputFiles(target);
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  await expect(page.locator(".layer-row")).toHaveCount(1);
  await expect(
    page.getByRole("checkbox", { name: "尾迹", exact: true }),
  ).toBeChecked();
  await page.screenshot({ path: "test-results/spk-restored.png" });
  expect(errors).toEqual([]);
});
