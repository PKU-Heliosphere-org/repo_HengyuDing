import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

async function inspect(page: Page, csv: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "导入数据", exact: true }).click();
  await page.getByLabel("选择CSV或XLSX").setInputFiles({
    name: "state.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "读取文件", exact: true }).click();
  await expect(page.getByLabel("数据类型")).toBeVisible();
}

test("both representations need a choice; selected vectors support editing and project restore", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await inspect(
    page,
    "epoch,a,e,i,raan,arg_periapsis,true_anomaly,X (km),Y (km),Z (km),VX (km/sec),VY (km/sec),VZ (km/sec)\n2026-01-01T00:00:00,8000,0,0,0,0,0,7000,0,0,0,7.5,0\n2026-01-01T00:01:00,8000,0,0,0,0,1,6980,450,0,-.48,7.49,0\n",
  );
  await expect(page.getByLabel("数据类型")).toHaveValue("");
  await page.getByRole("button", { name: "运行预检", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("两套字段");
  await page.getByLabel("数据类型").selectOption("cartesian");
  await page.getByLabel("中心天体", { exact: true }).selectOption("earth");
  await page.getByLabel("坐标系", { exact: true }).selectOption("ECLIPJ2000");
  await page.getByRole("button", { name: "运行预检", exact: true }).click();
  await expect(page.getByText("预检结果 · 可导入")).toBeVisible();
  const committed = page.waitForResponse((r) => r.url().endsWith("/commit"));
  await page.getByRole("button", { name: "添加到场景", exact: true }).click();
  const ds = await (await committed).json();
  expect(ds.samples[0].position_km).toEqual([7000, 0, 0]);
  expect(ds.samples[0].velocity_km_s).toEqual([0, 7.5, 0]);
  expect(ds.samples[0]).not.toHaveProperty("elements");
  await expect(page.locator(".elements")).toContainText("6,915");
  await page.getByRole("button", { name: "编辑参数", exact: true }).click();
  await expect(page.locator(".edit-panel")).toBeVisible();
  await page.getByRole("button", { name: "取消参数编辑", exact: true }).click();
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const target = path.resolve("test-results/state.orbit.json");
  await (await saving).saveAs(target);
  const project = JSON.parse(await fs.readFile(target, "utf8"));
  expect(project.datasets[0].import_request.input_type).toBe("cartesian");
  await page.reload();
  await page.locator('input[type=file][accept=".json"]').setInputFiles(target);
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  await expect(page.locator(".elements")).toContainText("6,915");
  expect(errors).toEqual([]);
});

test("missing velocity requires consent before finite differences can be imported", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await inspect(
    page,
    "epoch,x,y,z\n2026-01-01T00:00:00,7000,0,0\n2026-01-01T00:00:02,7000,4,0\n2026-01-01T00:00:05,7000,25,0\n",
  );
  await expect(page.getByLabel("数据类型")).toHaveValue("cartesian");
  await expect(
    page.getByRole("radio", { name: "差分生成速度", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "运行预检", exact: true }).click();
  await expect(
    page.getByText("缺少速度分量", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "添加到场景", exact: true }),
  ).toBeDisabled();
  await page.getByRole("radio", { name: "差分生成速度", exact: true }).check();
  await page.getByRole("button", { name: "运行预检", exact: true }).click();
  await expect(page.getByText("预检结果 · 可导入")).toBeVisible();
  await page.screenshot({ path: "test-results/state-velocity-consent.png" });
  const committed = page.waitForResponse((r) => r.url().endsWith("/commit"));
  await page.getByRole("button", { name: "添加到场景", exact: true }).click();
  const ds = await (await committed).json();
  expect(ds.velocity_source).toBe("finite_difference");
  expect(ds.samples[1].velocity_km_s[1]).toBeCloseTo(4, 6);
  expect(ds.samples[2].velocity_km_s[1]).toBeCloseTo(10, 6);
  await expect(page.getByLabel("对象光点大小")).toHaveValue("24");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
