import { expect, test } from "@playwright/test";

test("trail taper follows glow size and timeline resizing preserves usable layout", async ({
  page,
  request,
}) => {
  const AU = 149597870.7;
  let csv = "epoch,a,e,i,raan,arg_periapsis,true_anomaly\n";
  for (let i = 0; i <= 60; i++) {
    const epoch = new Date(
      Date.UTC(2026, 0, 1) + i * 86400000 + (i >= 30 ? 3 * 86400000 : 0),
    ).toISOString();
    csv += `${epoch},${AU},0,0,0,0,${20 + i * 2 + (i >= 30 ? 20 : 0)}\n`;
  }
  const inspected = await (
    await request.post("/api/v1/imports/inspect", {
      multipart: {
        file: {
          name: "synthetic-circular-arc.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(csv),
        },
      },
    })
  ).json();
  const committed = await request.post(
    `/api/v1/imports/${inspected.id}/commit`,
    {
      data: {
        metadata: {
          object_name: "平滑度检查",
          center: "earth",
          frame: "ECLIPJ2000",
          max_interpolation_gap_s: 2 * 86400,
        },
        mapping: inspected.mapping,
      },
    },
  );
  expect(committed.ok()).toBeTruthy();
  const ds = await committed.json();
  expect(ds.breaks).toContain(30);
  const state = {
    layers: [
      {
        id: "arc",
        dataset_id: ds.id,
        kind: "dataset",
        name: "平滑度检查",
        color: "#69caca",
        visible: true,
        showTrack: false,
        showTrail: true,
        showLabel: false,
        lineWidth: 1,
        glowSize: 24,
      },
    ],
    selected: "arc",
    scene: { center: "earth", frame: "ECLIPJ2000" },
    clock: {
      base_tai: ds.reference_tai,
      start: 0,
      end: ds.samples.at(-1).t,
      time: ds.samples.at(-1).t,
      speed: 3600,
    },
    axes: false,
    grid: false,
    stars: false,
    radius_km: 3 * AU,
    trail_s: 60 * 86400,
    camera: {
      position_km: [0, 0, 4 * AU],
      target_km: [0, 0, 0],
      up: [0, 1, 0],
      follow_id: null,
    },
  };
  const project = await (
    await request.post("/api/v1/projects/export", {
      data: { dataset_ids: [ds.id], state },
    })
  ).json();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: "smooth.orbit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  await page.waitForTimeout(500);
  const widths = async () =>
    page.evaluate(() => {
      const canvas = document.querySelector("canvas")!;
      const gl = canvas.getContext("webgl2")!;
      const data = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(
        0,
        0,
        canvas.width,
        canvas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data,
      );
      const radius = canvas.height / (2 * Math.tan((17 * Math.PI) / 180)) / 4;
      return [40, 60, 140, 89].map((angle) => {
        const theta = (angle * Math.PI) / 180;
        let count = 0;
        for (let offset = -30; offset <= 30; offset++) {
          const x = Math.round(
            canvas.width / 2 + (radius + offset) * Math.cos(theta),
          );
          const y = Math.round(
            canvas.height / 2 + (radius + offset) * Math.sin(theta),
          );
          const i = (y * canvas.width + x) * 4;
          if (data[i + 1] > 55 && data[i + 1] > data[i] * 1.3) count++;
        }
        return count;
      });
    });
  const normal = await widths();
  expect(normal[2]).toBeGreaterThan(7);
  expect(normal[2]).toBeGreaterThan(normal[1] + 3);
  expect(normal[1]).toBeGreaterThan(normal[0]);
  expect(normal[3]).toBe(0); // Missing samples remain a real gap.
  await page.getByRole("button", { name: "参考平面", exact: true }).click();
  await page.waitForTimeout(250);
  // A coplanar reference ring must not leave a dark slit in the trail.
  const centerGreen = await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const gl = canvas.getContext("webgl2")!;
    const radius = canvas.height / (2 * Math.tan((17 * Math.PI) / 180)) / 4;
    const theta = (140 * Math.PI) / 180;
    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.round(canvas.width / 2 + radius * Math.cos(theta)),
      Math.round(canvas.height / 2 + radius * Math.sin(theta)),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );
    return pixel[1];
  });
  expect(centerGreen).toBeGreaterThan(120);
  await page.getByRole("button", { name: "参考平面", exact: true }).click();
  const glow = page.getByLabel("对象光点大小");
  await glow.focus();
  await glow.press("End");
  await expect(glow).toHaveValue("48");
  await page.waitForTimeout(250);
  expect((await widths())[2]).toBeGreaterThan(normal[2] * 1.6);
  // The orbit-width control must no longer change the trail's width.
  const large = await widths();
  await page.getByLabel("轨道线宽", { exact: true }).focus();
  await page.getByLabel("轨道线宽", { exact: true }).press("End");
  await page.waitForTimeout(250);
  expect(await widths()).toEqual(large);
  await page.getByLabel("尾迹时长").selectOption(String(86400));
  await page.waitForTimeout(250);
  expect((await widths()).slice(0, 3)).toEqual([0, 0, 0]);
  await page.getByLabel("尾迹时长").selectOption(String(60 * 86400));

  const separator = page.getByRole("separator", { name: "调整时间轴高度" });
  const timeline = page.getByRole("region", { name: "时间轴", exact: true });
  const canvas = page.locator("canvas");
  const before = (await timeline.boundingBox())!;
  const canvasBefore = (await canvas.boundingBox())!;
  const handle = (await separator.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 115, {
    steps: 10,
  });
  await page.mouse.up();
  const expanded = (await timeline.boundingBox())!;
  expect(expanded.height).toBeGreaterThan(before.height + 110);
  // WebGL's canvas size follows the layout through ResizeObserver.
  await expect
    .poll(async () => (await canvas.boundingBox())!.height)
    .toBeCloseTo(canvasBefore.height - expanded.height + before.height, 0);
  const transport = (await page.locator(".transport").boundingBox())!;
  expect(transport.y + transport.height).toBeLessThan(
    expanded.y + expanded.height,
  );
  await page.screenshot({ path: "test-results/timeline-tapered-trail.png" });
  await separator.focus();
  await separator.press("End");
  expect((await canvas.boundingBox())!.height).toBeGreaterThanOrEqual(250);
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect(separator).toHaveAttribute("aria-valuemin", "155");
  await expect
    .poll(async () => (await canvas.boundingBox())!.height)
    .toBeGreaterThanOrEqual(250);
  await separator.press("Home");
  await expect
    .poll(async () => (await timeline.boundingBox())!.height)
    .toBe(155);
  await separator.press("ArrowUp");
  await expect
    .poll(async () => (await timeline.boundingBox())!.height)
    .toBe(175);
  await separator.dblclick();
  await expect
    .poll(async () => (await timeline.boundingBox())!.height)
    .toBe(155);
  expect(errors).toEqual([]);
});
