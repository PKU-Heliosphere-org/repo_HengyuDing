import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";

const AU = 149597870.7;
const host = (page: Page) => page.getByLabel("自由视角三维画布");
const camera = async (page: Page) =>
  JSON.parse((await host(page).getAttribute("data-camera"))!);
async function screen(page: Page, position: number[]) {
  const box = (await host(page).boundingBox())!;
  const state = await camera(page);
  const c = new PerspectiveCamera(
    state.fov ?? 34,
    box.width / box.height,
    1,
    1e13,
  );
  c.position.fromArray(state.position_km);
  c.up.fromArray(state.up);
  c.zoom = state.zoom ?? 1;
  c.lookAt(new Vector3().fromArray(state.target_km));
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  const p = new Vector3().fromArray(position).project(c);
  return {
    x: box.x + ((p.x + 1) * box.width) / 2,
    y: box.y + ((1 - p.y) * box.height) / 2,
  };
}
async function blank(page: Page) {
  const box = (await host(page).boundingBox())!;
  return { x: box.x + 60, y: box.y + box.height - 45 };
}
async function seek(page: Page, time: number) {
  await page.getByLabel("时间游标", { exact: true }).evaluate((el, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, time);
}
async function scene(page: Page, request: APIRequestContext, overlap = false) {
  const data = [];
  const positions = overlap
    ? [
        [AU, 0, 0],
        [0.75 * AU, 0, AU],
      ]
    : [
        [AU, 0, 0],
        [-AU, 0, 0],
      ];
  for (let i = 0; i < 2; i++) {
    const p = positions[i];
    const csv = `epoch,x,y,z,vx,vy,vz\n2026-01-01T00:00:00,${p.join(",")},0,20,0\n2026-01-11T00:00:00,${p[0]},${p[1] + AU * 0.1},${p[2]},0,20,0\n`;
    const found = await (
      await request.post("/api/v1/imports/inspect", {
        multipart: {
          file: {
            name: `synthetic-${i}.csv`,
            mimeType: "text/csv",
            buffer: Buffer.from(csv),
          },
        },
      })
    ).json();
    const response = await request.post(`/api/v1/imports/${found.id}/commit`, {
      data: {
        mapping: found.mapping,
        input_type: "cartesian",
        metadata: {
          object_name: `Body ${i}`,
          max_interpolation_gap_s: overlap ? 172800 : 1e7,
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    data.push(await response.json());
  }
  const project = await request.post("/api/v1/projects/export", {
    data: {
      dataset_ids: data.map((d) => d.id),
      state: {
        layers: data.map((d, i) => ({
          id: `body-${i}`,
          dataset_id: d.id,
          kind: "dataset",
          name: `Body ${i}`,
          color: "#69caca",
          visible: true,
          showTrack: false,
          showTrail: true,
          showLabel: false,
        })),
        selected: null,
        clock: {
          base_tai: data[0].reference_tai,
          time: 0,
          speed: 86400,
          start: 0,
          end: 864000,
        },
        axes: false,
        grid: false,
        stars: false,
        radius_km: 100 * AU,
        trail_s: 86400,
        scene: { center: "sun", frame: "J2000" },
        camera: {
          position_km: [0, 0, 4 * AU],
          target_km: [0, 0, 0],
          up: [0, 1, 0],
          follow_id: null,
        },
      },
    },
  });
  expect(project.ok()).toBeTruthy();
  await page.goto("/");
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: "synthetic.orbit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(await project.json())),
  });
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  await expect
    .poll(async () => (await camera(page)).position_km)
    .toEqual([0, 0, 4 * AU]);
  return positions;
}

test("canvas selection, counterclockwise ring, drag separation and independent follow cancellation", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const positions = await scene(page, request);
  const marker = page.locator(".body-selection");
  await expect(marker).toBeHidden();
  const a = await screen(page, positions[0]),
    b = await screen(page, positions[1]);
  const initial = await camera(page);
  await page.mouse.click(a.x + 7, a.y);
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute("data-layer-id", "body-0");
  await expect(page.locator(".layer-row.selected")).toContainText("Body 0");
  expect((await camera(page)).position_km).toEqual(initial.position_km);
  const bounds = (await marker.boundingBox())!;
  expect(Math.abs(bounds.x + bounds.width / 2 - a.x)).toBeLessThan(2);
  expect(Math.abs(bounds.y + bounds.height / 2 - a.y)).toBeLessThan(2);
  const animation = await marker.locator("svg").evaluate((el) => {
    const a = el.getAnimations()[0];
    return {
      frames: (a.effect as KeyframeEffect)
        .getKeyframes()
        .map((k) => k.transform),
      duration: a.effect!.getTiming().duration,
      transform: getComputedStyle(el).transform,
    };
  });
  expect(animation.frames).toEqual(["rotate(0deg)", "rotate(-360deg)"]);
  expect(animation.duration).toBe(8000);
  await expect
    .poll(() =>
      marker.locator("svg").evaluate((el) => getComputedStyle(el).transform),
    )
    .not.toBe(animation.transform);
  await page.screenshot({ path: "test-results/selection-ring.png" });
  // Right clicks and a drag starting on the other object cannot change selection.
  await page.mouse.click(b.x, b.y, { button: "right" });
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(b.x + 80, b.y + 35, { steps: 8 });
  await page.mouse.up();
  await expect(marker).toHaveAttribute("data-layer-id", "body-0");
  expect((await camera(page)).follow_id).toBeNull();
  const target = await screen(page, positions[1]);
  const beforeFollow = await camera(page);
  await page.mouse.dblclick(target.x, target.y);
  await expect.poll(async () => (await camera(page)).follow_id).toBe("body-1");
  await expect(marker).toHaveAttribute("data-layer-id", "body-1");
  const centered = await camera(page);
  const distance = (c: typeof centered) =>
    Math.hypot(
      ...c.position_km.map((v: number, i: number) => v - c.target_km[i]),
    );
  expect(Math.abs(distance(centered) - distance(beforeFollow))).toBeLessThan(
    1e-5,
  );
  expect(
    Math.hypot(
      ...centered.target_km.map((v: number, i: number) => v - positions[1][i]),
    ),
  ).toBeLessThan(1e-5);
  await seek(page, 86400);
  await expect
    .poll(async () => (await camera(page)).target_km[1])
    .toBeGreaterThan(1000000);
  const empty = await blank(page);
  await page.mouse.click(empty.x, empty.y);
  await expect(marker).toBeHidden();
  await expect(page.locator(".layer-row.selected")).toHaveCount(0);
  expect((await camera(page)).follow_id).toBe("body-1");
  const followed = await camera(page);
  await page.mouse.dblclick(empty.x, empty.y);
  await expect.poll(async () => (await camera(page)).follow_id).toBeNull();
  expect((await camera(page)).position_km).toEqual(followed.position_km);
  await page.locator(".layer-select").filter({ hasText: "Body 0" }).click();
  await expect(marker).toHaveAttribute("data-layer-id", "body-0");
  expect(errors).toEqual([]);
});

test("overlapping bodies choose the nearest, hidden and missing positions cannot be picked", async ({
  page,
  request,
}) => {
  const positions = await scene(page, request, true),
    marker = page.locator(".body-selection");
  const target = await screen(page, positions[0]);
  await page.mouse.click(target.x, target.y);
  await expect(marker).toHaveAttribute("data-layer-id", "body-1");
  await page.getByLabel("Body 1显隐", { exact: true }).click();
  await expect(marker).toBeHidden();
  await page.mouse.click(target.x, target.y);
  await expect(marker).toHaveAttribute("data-layer-id", "body-0");
  await page.getByLabel("Body 0显隐", { exact: true }).click();
  await page.mouse.click(target.x, target.y);
  await expect(page.locator(".layer-row.selected")).toHaveCount(0);
  await page.getByLabel("Body 0显隐", { exact: true }).click();
  await page.locator(".layer-select").filter({ hasText: "Body 0" }).click();
  await expect(marker).toBeVisible();
  await seek(page, 5 * 86400);
  await expect(marker).toBeHidden();
  await page.mouse.click(target.x, target.y);
  await expect(page.locator(".layer-row.selected")).toHaveCount(0);
});

test("planet surface can be picked away from the central glow without changing zoom", async ({
  page,
  request,
}) => {
  const catalog = await (await request.get("/api/v1/planets/catalog")).json();
  test.skip(!catalog.ready, "Local reference kernels missing");
  await page.goto("/");
  await page.getByText("本地服务已连接").waitFor();
  await page
    .getByRole("button", { name: "添加行星", exact: true })
    .first()
    .click();
  await page.getByLabel("行星初始日期").fill("2026-01-01T00:00:00");
  await page
    .getByRole("button", { name: "添加 1 个图层", exact: true })
    .click();
  await page.getByRole("button", { name: "聚焦表面", exact: true }).click();
  await expect(host(page)).toHaveAttribute("data-earth-lod", "surface");
  const box = (await host(page).boundingBox())!;
  const empty = await blank(page);
  await page.mouse.click(empty.x, empty.y);
  await expect(page.locator(".body-selection")).toBeHidden();
  const before = await camera(page);
  await page.mouse.click(
    box.x + box.width / 2 + box.height * 0.18,
    box.y + box.height / 2,
  );
  await expect(page.locator(".body-selection")).toBeVisible();
  await expect(page.locator(".layer-row.selected")).toContainText("地球");
  expect((await camera(page)).position_km).toEqual(before.position_km);
  const ring = (await page.locator(".body-selection").boundingBox())!;
  expect(ring.height).toBeGreaterThan(box.height * 0.7);
  await page.screenshot({ path: "test-results/selection-surface.png" });
});
