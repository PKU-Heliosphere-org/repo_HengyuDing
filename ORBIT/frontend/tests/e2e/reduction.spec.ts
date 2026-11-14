import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

test("oversized row count can be retried, cropped, resampled and restored without changing source", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = Date.UTC(2026, 0, 1);
  const csv =
    "epoch,x,y,z,vx,vy,vz\n" +
    Array.from(
      { length: 100005 },
      (_, i) =>
        `${new Date(base + i * 1000).toISOString()},7000,${i},0,0,1,0\n`,
    ).join("");
  await page.goto("/");
  await page.getByRole("button", { name: "导入数据", exact: true }).click();
  await page
    .getByLabel("选择CSV、XLSX或BSP")
    .setInputFiles({
      name: "large.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await page.getByRole("button", { name: "读取文件", exact: true }).click();
  await expect(page.locator(".import-reduction summary")).toContainText(
    "超出容量",
  );
  await expect(
    page.getByRole("button", { name: "运行预检", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("中心天体", { exact: true }).selectOption("earth");
  await page.getByLabel("目标采样间隔").fill("1");
  await page
    .getByRole("button", { name: "应用范围与采样", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("处理后仍超过");
  await page.getByLabel("目标采样间隔").fill("");
  await page.getByLabel("筛选起始时间").fill("2026-01-01T00:00:00");
  await page.getByLabel("筛选结束时间").fill("2026-01-01T00:00:04");
  await page
    .getByRole("button", { name: "应用范围与采样", exact: true })
    .click();
  await expect(page.locator(".file-summary")).toContainText("5 条保留记录");
  await page.locator(".import-reduction summary").click();
  await page.getByLabel("筛选结束时间").fill("");
  await page.getByLabel("目标采样间隔").fill("10");
  await expect(
    page.getByRole("button", { name: "运行预检", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "应用范围与采样", exact: true })
    .click();
  await expect(page.locator(".file-summary")).toContainText(
    "10,001 条保留记录",
  );
  await page.locator(".import-reduction summary").click();
  await page.screenshot({ path: "test-results/import-reduction.png" });
  await page.getByRole("button", { name: "运行预检", exact: true }).click();
  await expect(page.getByText("预检结果 · 可导入")).toBeVisible();
  const committed = page.waitForResponse((r) => r.url().endsWith("/commit"));
  await page.getByRole("button", { name: "添加到场景", exact: true }).click();
  const ds = await (await committed).json();
  expect(ds.samples).toHaveLength(10001);
  expect(ds.samples[1].source_rows).toEqual([12]);
  expect(ds.samples[1].position_km).toEqual([7000, 10, 0]);
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const target = path.resolve("test-results/reduced.orbit.json");
  await (await save).saveAs(target);
  const project = JSON.parse(await fs.readFile(target, "utf8"));
  expect(
    Buffer.from(project.datasets[0].source_base64, "base64").toString(),
  ).toBe(csv);
  expect(project.datasets[0].import_request.selection.interval_s).toBe(10);
  await page.reload();
  await page.locator('input[type=file][accept=".json"]').setInputFiles(target);
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  await expect(page.locator(".layer-row")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("files above 20 MiB offer time selection instead of upload rejection", async ({
  page,
}) => {
  test.setTimeout(120000);
  const notes = "n".repeat(1024);
  const csv =
    "epoch,x,y,z,vx,vy,vz,notes\n" +
    Array.from(
      { length: 21000 },
      (_, i) =>
        `${new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()},7000,${i},0,0,1,0,${notes}\n`,
    ).join("");
  expect(Buffer.byteLength(csv)).toBeGreaterThan(20 * 1024 * 1024);
  await page.goto("/");
  await page.getByRole("button", { name: "导入数据", exact: true }).click();
  await page
    .getByLabel("选择CSV、XLSX或BSP")
    .setInputFiles({
      name: "over-20MiB.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await page.getByRole("button", { name: "读取文件", exact: true }).click();
  await expect(page.locator(".import-reduction summary")).toContainText(
    "超出容量",
  );
  await page.getByLabel("筛选结束时间").fill("2026-01-01T00:00:01");
  await page
    .getByRole("button", { name: "应用范围与采样", exact: true })
    .click();
  await expect(page.locator(".file-summary")).toContainText("2 条保留记录");
  await page.getByRole("button", { name: "运行预检", exact: true }).click();
  await expect(page.getByText("预检结果 · 可导入")).toBeVisible();
  await page.getByRole("button", { name: "添加到场景", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
