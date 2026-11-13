import { test, expect, type Page } from "@playwright/test";
import { cameraAt } from "../../src/cameraKeyframes";
import type { CameraKeyframe, CameraState } from "../../src/types";
import fs from "node:fs/promises";
import path from "node:path";

async function seek(page: Page, t: number) {
  await page.getByLabel("时间游标", { exact: true }).evaluate((el, next) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, String(next));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, t);
}
async function camera(page: Page): Promise<CameraState> {
  return JSON.parse(
    (await page.getByLabel("自由视角三维画布").getAttribute("data-camera"))!,
  );
}
async function save(page: Page, name: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const file = path.resolve(`test-results/${name}.orbit.json`);
  await (await pending).saveAs(file);
  return { file, project: JSON.parse(await fs.readFile(file, "utf8")) };
}

test("camera keys record manual views, interpolate during seeking and playback, drag, delete and survive projects", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const AU = 149597870.7;
  const csv = `epoch,a,e,i,raan,arg_periapsis,true_anomaly\n2026-01-01T00:00:00Z,${AU},0,0,0,0,0\n2026-01-02T00:00:00Z,${AU},0,0,0,0,90\n`;
  const inspection = await (
    await request.post("/api/v1/imports/inspect", {
      multipart: {
        file: {
          name: "camera.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(csv),
        },
      },
    })
  ).json();
  const ds = await (
    await request.post(`/api/v1/imports/${inspection.id}/commit`, {
      data: {
        mapping: inspection.mapping,
        metadata: { center: "sun", frame: "ECLIPJ2000" },
      },
    })
  ).json();
  const exported = await request.post("/api/v1/projects/export", {
    data: {
      dataset_ids: [ds.id],
      state: {
        layers: [
          {
            id: "arc",
            dataset_id: ds.id,
            kind: "dataset",
            name: "Camera test",
            color: "#69caca",
            visible: true,
            showTrack: true,
            showTrail: true,
            showLabel: false,
          },
        ],
        selected: "arc",
        clock: {
          base_tai: ds.reference_tai,
          time: 0,
          start: 0,
          end: 86400,
          speed: 86400,
        },
        scene: { center: "sun", frame: "ECLIPJ2000" },
        axes: false,
        grid: true,
        stars: false,
        radius_km: 100 * AU,
        trail_s: 86400,
        camera: {
          position_km: [0, 0, 4 * AU],
          target_km: [0, 0, 0],
          up: [0, 1, 0],
          follow_id: null,
        },
      },
    },
  });
  expect(exported.ok()).toBeTruthy();
  await page.goto("/");
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: "legacy.orbit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(await exported.json())),
  });
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  const enabled = page.getByRole("checkbox", {
    name: "视角关键帧",
    exact: true,
  });
  await expect(enabled).toBeDisabled();
  await page.getByLabel("启用缓存渲染", { exact: true }).check();
  await expect(page.getByText("缓存就绪 · 可播放所选范围")).toBeVisible();
  await enabled.check();
  await page.getByRole("button", { name: "添加关键帧", exact: true }).click();
  await seek(page, 86400);
  await page.getByLabel("标准视角").selectOption("side");
  await page.getByRole("button", { name: "向右滚转15度", exact: true }).click();
  const canvas = page.locator("canvas");
  const rect = (await canvas.boundingBox())!;
  const beforeZoom = await camera(page);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, -200);
  await expect
    .poll(async () => (await camera(page)).position_km)
    .not.toEqual(beforeZoom.position_km);
  // Right-button translation must be captured too.
  await page.mouse.down({ button: "right" });
  await page.mouse.move(
    rect.x + rect.width / 2 + 30,
    rect.y + rect.height / 2 + 15,
    { steps: 5 },
  );
  await page.mouse.up({ button: "right" });
  await page.getByRole("button", { name: "添加关键帧", exact: true }).click();
  await expect(page.locator(".camera-keyframe")).toHaveCount(2);
  const { file, project } = await save(page, "camera-keyframes");
  const keys: CameraKeyframe[] = project.state.camera_keyframes;
  expect(keys.map((k) => k.time)).toEqual([0, 86400]);
  expect(keys[1].camera.target_km).not.toEqual(keys[0].camera.target_km);
  expect(keys[1].camera.position_km).not.toEqual(keys[0].camera.position_km);
  expect(keys[1].camera.up).not.toEqual(keys[0].camera.up);
  expect(keys[1].camera.fov).toBe(34);
  expect(keys[1].camera.zoom).toBe(1);
  await seek(page, 43200);
  const expected = cameraAt(keys, 43200)!;
  await expect
    .poll(async () => {
      const c = await camera(page);
      return Math.hypot(
        ...c.position_km.map((v, i) => (v - expected.position_km[i]) / AU),
      );
    })
    .toBeLessThan(1e-7);
  await page.screenshot({ path: "test-results/camera-keyframe-midpoint.png" });
  await seek(page, 0);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("时间游标", { exact: true })).toHaveValue(
    "86400",
  );
  await expect
    .poll(async () => {
      const c = await camera(page);
      return Math.hypot(
        ...c.target_km.map((v, i) => v - keys[1].camera.target_km[i]),
      );
    })
    .toBeLessThan(1e-5);
  // Updating an existing timestamp must not append a third key.
  await page.getByRole("button", { name: "向右滚转15度", exact: true }).click();
  await page.getByRole("button", { name: "更新关键帧", exact: true }).click();
  await expect(page.locator(".camera-keyframe")).toHaveCount(2);
  page.on("dialog", (d) => d.accept());
  await page.locator('input[type=file][accept=".json"]').setInputFiles(file);
  await expect(page.getByText("项目已恢复，采样位置已重新计算")).toBeVisible();
  await expect(enabled).toBeDisabled();
  await page.getByLabel("启用缓存渲染", { exact: true }).check();
  await expect(page.getByText("缓存就绪 · 可播放所选范围")).toBeVisible();
  await expect(enabled).toBeChecked();
  const second = page.getByRole("button", {
    name: "视角关键帧 2",
    exact: true,
  });
  const keyRect = (await second.boundingBox())!;
  const trackRect = (await page
    .getByLabel("视角关键帧时间轨道", { exact: true })
    .boundingBox())!;
  await page.mouse.move(
    keyRect.x + keyRect.width / 2,
    keyRect.y + keyRect.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    keyRect.x + keyRect.width / 2 - trackRect.width / 4,
    keyRect.y + keyRect.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await second.getAttribute("data-keyframe-time")))
    .toBeLessThan(70000);
  await second.focus();
  await second.press("Delete");
  await expect(page.locator(".camera-keyframe")).toHaveCount(1);
  await page.getByLabel("启用缓存渲染", { exact: true }).uncheck();
  await expect(enabled).toBeDisabled();
  await expect(enabled).not.toBeChecked();
  await expect(page.getByLabel("视角关键帧轨道", { exact: true })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});
