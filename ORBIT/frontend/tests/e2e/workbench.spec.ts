import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

test("sample import, explicit conflict, playback, hypothesis and portable project", async ({
  page,
}) => {
  test.skip(
    !existsSync(path.resolve("../codex/examples/参考星历表_Sat_ELEMENTS.csv")),
    "本地参考样例未随仓库提供",
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("本地服务已连接")).toBeVisible();
  await page.getByRole("button", { name: "打开样例" }).click();
  await page.getByRole("button", { name: "读取文件" }).click();
  await expect(
    page.getByRole("dialog", { name: "导入轨道数据" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "运行预检" }).click();
  await expect(page.getByText("预检结果 · 需处理")).toBeVisible();
  await expect(
    page.getByText("同一时刻有冲突记录", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("确认完全重复记录去重，并保留日志").check();
  await page.getByRole("button", { name: "运行预检" }).click();
  await page.getByRole("radio", { name: "保留行 815", exact: false }).check();
  await page.getByRole("button", { name: "运行预检" }).click();
  await expect(page.getByText("预检结果 · 可导入")).toBeVisible();
  await page.getByRole("button", { name: "添加到场景" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("已导入 8,731 个有效采样点")).toBeVisible();
  await expect(page.getByText("参考系为暂用假设")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await page.screenshot({ path: "test-results/orbit-v0.1-workbench.png" });
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("button", { name: "编辑参数", exact: true }).click();
  await page.getByLabel("编辑e", { exact: true }).fill("0.8");
  // Current sample can be hyperbolic; use a positive a for this elliptic hypothesis.
  await page.getByLabel("编辑a", { exact: true }).fill("240000000");
  await page.getByRole("button", { name: "计算预览", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "另存假设图层" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "另存假设图层" }).click();
  await expect(page.getByText("假设轨道 · 静态")).toBeVisible();
  const pngEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PNG" }).click();
  const png = await pngEvent;
  expect(png.suggestedFilename()).toBe("ORBIT-scene.png");
  const saveEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目" }).click();
  const saved = await saveEvent;
  const projectPath = path.resolve("test-results/roundtrip.orbit.json");
  await saved.saveAs(projectPath);
  const content = JSON.parse(await fs.readFile(projectPath, "utf8"));
  expect(content.schema_version).toBe(2);
  expect(content.state.layers).toHaveLength(2);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "新建工作台" }).click();
  await expect(page.getByText("尚未添加对象")).toBeVisible();
  await page
    .locator('input[type=file][accept=".json"]')
    .setInputFiles(projectPath);
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  await expect(page.getByText("假设轨道 · 静态")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/orbit-v0.1-1280.png" });
  expect(errors).toEqual([]);
});

test("incompatible center cannot be silently overlaid", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "导入 CSV / XLSX", exact: true }).click();
  const csv =
    "epoch,a,e,i,raan,arg_periapsis,true_anomaly\n2026-01-01T00:00:00Z,7000,0.1,30,10,20,0\n";
  await page.getByLabel("选择CSV或XLSX").setInputFiles({
    name: "one.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "读取文件" }).click();
  await page.getByRole("button", { name: "运行预检" }).click();
  await page.getByRole("button", { name: "添加到场景" }).click();
  await page.getByRole("button", { name: "导入数据", exact: true }).click();
  await page.getByLabel("选择CSV或XLSX").setInputFiles({
    name: "two.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "读取文件" }).click();
  await page.getByLabel("中心天体", { exact: true }).selectOption("earth");
  await page.getByRole("button", { name: "运行预检" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "当前场景中心或参考系不同",
  );
});
