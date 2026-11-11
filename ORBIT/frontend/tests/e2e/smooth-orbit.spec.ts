import { expect, test } from "@playwright/test";

test("wide orbit joins have uniform brightness and preserve missing-data gaps", async ({
  page,
  request,
}) => {
  const AU = 149597870.7;
  let csv = "epoch,a,e,i,raan,arg_periapsis,true_anomaly\n";
  for (let i = 0; i <= 60; i++) {
    const epoch = new Date(
      Date.UTC(2026, 0, 1) + i * 60000 + (i >= 30 ? 3 * 86400000 : 0),
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
        showTrack: true,
        showTrail: false,
        showLabel: false,
        lineWidth: 8,
      },
    ],
    selected: "arc",
    scene: { center: "earth", frame: "ECLIPJ2000" },
    clock: {
      base_tai: ds.reference_tai,
      start: 0,
      end: ds.samples.at(-1).t,
      time: 0,
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
  const pixels = await page.evaluate(() => {
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
    const sample = (angle: number, mid = false) => {
      const theta = (angle * Math.PI) / 180;
      const scale = mid ? Math.cos(Math.PI / 180) : 1;
      const x = Math.round(canvas.width / 2 + radius * scale * Math.cos(theta));
      const y = Math.round(
        canvas.height / 2 + radius * scale * Math.sin(theta),
      );
      return data[(y * canvas.width + x) * 4 + 1];
    };
    return {
      joins: Array.from({ length: 19 }, (_, i) => sample(30 + i * 2)),
      spans: Array.from({ length: 19 }, (_, i) => sample(31 + i * 2, true)),
      gap: sample(89),
    };
  });
  expect(Math.min(...pixels.spans)).toBeGreaterThan(60);
  // Semi-transparent overlapping caps previously made joins ~35% brighter.
  expect(Math.max(...pixels.joins) - Math.min(...pixels.spans)).toBeLessThan(8);
  expect(pixels.gap).toBeLessThan(25);
  const hud = page.getByLabel("场景读数");
  const readout = await hud.innerText();
  expect(readout.indexOf("模拟时间")).toBeLessThan(readout.indexOf("地球中心"));
  expect(readout.indexOf("地球中心")).toBeLessThan(readout.indexOf("中心距离"));
  expect(readout.indexOf("中心距离")).toBeLessThan(
    readout.indexOf("源采样密切速度"),
  );
  await expect(hud.locator(".scene-reference")).toHaveText(
    "地球中心 · ECLIPJ2000",
  );
  expect((await hud.boundingBox())!.height).toBeLessThan(130);
  await expect(
    page.getByText("行星采用真实半径", { exact: false }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/smooth-orbit.png" });
  expect(errors).toEqual([]);
});
