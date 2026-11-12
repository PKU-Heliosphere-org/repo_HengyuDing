import { expect, test, type Page } from "@playwright/test";

async function addEarth(page: Page) {
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
  await expect(page.locator(".ephemeris-banner")).toHaveCount(0);
}

async function slider(page: Page, label: string, value: number) {
  await page.getByLabel(label, { exact: true }).evaluate((el, next) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function bluePixels(page: Page) {
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
}

test("cached playback retains real trails throughout the selected range without further ephemeris requests", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const catalog = await (await request.get("/api/v1/planets/catalog")).json();
  test.skip(!catalog.ready, "Local ephemeris missing");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await addEarth(page);
  await page.getByRole("checkbox", { name: "轨道", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "标签", exact: true }).uncheck();
  await page.getByRole("button", { name: "星空背景", exact: true }).click();
  await page.getByRole("button", { name: "参考平面", exact: true }).click();
  await page.getByLabel("标准视角").selectOption("top");
  const requests: { start_s: number; end_s: number; history: boolean }[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/planets/window")) requests.push(r.postDataJSON());
  });
  await page.getByLabel("启用缓存渲染", { exact: true }).check();
  const from = 30 * 86400,
    to = 200 * 86400;
  await slider(page, "缓存起点", from);
  await slider(page, "缓存终点", to);
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("缓存就绪 · 可播放所选范围")).toBeVisible({
    timeout: 60000,
  });
  expect(requests.some((r) => r.start_s <= from - 60 * 86400)).toBe(true);
  expect(requests.some((r) => r.end_s === to)).toBe(true);
  const before = requests.length;
  // Any request here would reveal accidental use of the live window hooks.
  await page.route("**/api/v1/planets/window", (route) => route.abort());
  for (const t of [from, (from + to) / 2, to]) {
    await slider(page, "时间游标", t);
    await expect(page.getByLabel("时间游标")).toHaveValue(String(t));
    // With orbit, labels, grid and stars off, these are real history pixels.
    await expect.poll(() => bluePixels(page)).toBeGreaterThan(120);
  }
  await page.getByLabel("播放倍率").selectOption("31557600");
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(() => bluePixels(page)).toBeGreaterThan(120);
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("时间游标")).toHaveValue(String(to));
  expect(requests).toHaveLength(before);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/cached-planet-trail.png" });
  await page.unroute("**/api/v1/planets/window");
  // Editing the range or trail duration must invalidate a completed cache.
  await slider(page, "缓存终点", to + 86400);
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("缓存就绪 · 可播放所选范围")).toBeVisible({
    timeout: 30000,
  });
  expect(requests.some((r) => r.end_s === to + 86400)).toBe(true);
  await page.getByLabel("尾迹时长").selectOption(String(365 * 86400));
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("缓存就绪 · 可播放所选范围")).toBeVisible({
    timeout: 30000,
  });
  expect(requests.some((r) => r.start_s <= from - 365 * 86400)).toBe(true);
  await page.getByLabel("启用缓存渲染", { exact: true }).uncheck();
  await expect(page.getByLabel("缓存时间范围", { exact: true })).toHaveCount(0);
});

test("cache failure can retry and disabling during preparation ignores late responses", async ({
  page,
  request,
}) => {
  const catalog = await (await request.get("/api/v1/planets/catalog")).json();
  test.skip(!catalog.ready, "Local ephemeris missing");
  await addEarth(page);
  await page.route("**/api/v1/planets/window", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "缓存测试失败" }),
    }),
  );
  await page.getByLabel("启用缓存渲染", { exact: true }).check();
  await expect(page.getByText("缓存测试失败", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/api/v1/planets/window");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const pending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route("**/api/v1/planets/window", async (route) => {
    entered();
    await held;
    await route
      .fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "过期响应" }),
      })
      .catch(() => {});
  });
  await page.getByRole("button", { name: "重新准备", exact: true }).click();
  await pending;
  await page.getByLabel("启用缓存渲染", { exact: true }).uncheck();
  release();
  await page.unroute("**/api/v1/planets/window");
  await page.getByLabel("启用缓存渲染", { exact: true }).check();
  await expect(page.getByText("缓存就绪 · 可播放所选范围")).toBeVisible({
    timeout: 40000,
  });
  await expect(page.getByText("过期响应", { exact: true })).toHaveCount(0);
});
