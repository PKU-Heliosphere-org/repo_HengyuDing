import { expect, test } from "@playwright/test";

test("cancelling while total is unknown stops the indeterminate bar", async ({
  page,
}) => {
  let cancelled = false;
  const snapshot = () => ({
    id: "counting-job",
    status: cancelled ? "cancelled" : "running",
    phase: "counting",
    scanned: 0,
    total: null,
    total_exact: false,
    result: null,
    error: null,
  });
  await page.route("**/api/v1/imports/*/reduction-jobs", (route) =>
    route.fulfill({ status: 202, json: snapshot() }),
  );
  await page.route("**/api/v1/imports/*/reduction-jobs/counting-job", (route) =>
    route.fulfill({ json: snapshot() }),
  );
  await page.route(
    "**/api/v1/imports/*/reduction-jobs/counting-job/cancel",
    (route) => {
      cancelled = true;
      return route.fulfill({ json: snapshot() });
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "导入数据", exact: true }).click();
  await page
    .getByLabel("选择CSV、XLSX或BSP")
    .setInputFiles({
      name: "count.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "epoch,x,y,z,vx,vy,vz\n2026-01-01T00:00:00,7000,0,0,0,1,0\n",
      ),
    });
  await page.getByRole("button", { name: "读取文件", exact: true }).click();
  await page.locator(".import-reduction summary").click();
  await page
    .getByRole("button", { name: "应用范围与采样", exact: true })
    .click();
  const bar = page.getByRole("progressbar", { name: "范围与采样处理进度" });
  await expect(bar).toBeVisible();
  await expect(bar).not.toHaveAttribute("value");
  await expect(page.locator(".reduction-count")).toHaveText(
    "已扫描 0 条 / 共 — 条",
  );
  await page.getByRole("button", { name: "取消处理", exact: true }).click();
  await expect(
    page.getByText("已取消处理，上传副本和筛选设置已保留，可调整后重试。"),
  ).toBeVisible();
  await expect(bar).toHaveAttribute("value", "0");
});

test("progress stays below 100 until completion; cancel keeps settings and retry succeeds", async ({
  page,
}) => {
  const csv =
    "epoch,x,y,z,vx,vy,vz\n" +
    Array.from(
      { length: 6 },
      (_, i) => `2026-01-01T00:0${i}:00,7000,${i},0,0,1,0\n`,
    ).join("");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let started = false,
    cancelled = false,
    polls = 0;
  const snapshot = (status: string, scanned: number) => ({
    id: "ui-progress",
    status,
    phase: scanned === 10000 ? "processing" : "reading",
    scanned,
    total: 10000,
    total_exact: true,
    result: null,
    error: null,
  });
  // Hold the first task at the last scan stage to test the completion/cancel boundary deterministically.
  // Subsequent attempts use the real server; backend tests cover cooperative stop and atomic publication.
  await page.route("**/api/v1/imports/*/reduction-jobs", async (route) => {
    if (started) return route.continue();
    started = true;
    await route.fulfill({ status: 202, json: snapshot("queued", 0) });
  });
  await page.route(
    "**/api/v1/imports/*/reduction-jobs/ui-progress",
    async (route) => {
      polls++;
      await route.fulfill({
        json: snapshot(
          cancelled ? "cancelled" : "running",
          polls === 1 ? 3000 : 10000,
        ),
      });
    },
  );
  await page.route(
    "**/api/v1/imports/*/reduction-jobs/ui-progress/cancel",
    async (route) => {
      cancelled = true;
      await route.fulfill({ json: snapshot("cancelling", 10000) });
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "导入数据", exact: true }).click();
  await page.getByLabel("选择CSV、XLSX或BSP").setInputFiles({
    name: "progress.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "读取文件", exact: true }).click();
  await page.locator(".import-reduction summary").click();
  await page.getByLabel("目标采样间隔").fill("120");
  await page
    .getByRole("button", { name: "应用范围与采样", exact: true })
    .click();
  const progress = page.getByRole("progressbar", {
    name: "范围与采样处理进度",
  });
  await expect(progress).toBeVisible();
  await expect(page.locator(".reduction-count")).toHaveText(
    "已扫描 10,000 条 / 共 10,000 条",
  );
  await expect(progress).toHaveAttribute("value", "99");
  await expect(page.getByLabel("目标采样间隔")).toBeDisabled();
  const bar = await progress.boundingBox(),
    counter = await page.locator(".reduction-count").boundingBox();
  expect(bar!.x + bar!.width).toBeLessThan(counter!.x);
  await page.screenshot({ path: "test-results/reduction-progress.png" });
  await page.getByRole("button", { name: "取消处理", exact: true }).click();
  await expect(
    page.getByText("已取消处理，上传副本和筛选设置已保留，可调整后重试。"),
  ).toBeVisible();
  await expect(page.getByLabel("目标采样间隔")).toHaveValue("120");
  await expect(page.getByLabel("目标采样间隔")).toBeEnabled();
  await expect(page.locator(".file-summary")).toContainText("6 条原始记录");
  await page.getByLabel("目标采样间隔").fill("240");
  await page
    .getByRole("button", { name: "应用范围与采样", exact: true })
    .click();
  await expect(page.locator(".file-summary")).toContainText("2 条保留记录");
  await expect(progress).toHaveAttribute("value", "100");
  await expect(page.locator(".reduction-count")).toHaveText(
    "已扫描 6 条 / 共 6 条",
  );
  expect(errors).toEqual([]);
});
