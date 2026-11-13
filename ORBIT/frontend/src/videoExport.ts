export type VideoAspect = "16:9" | "9:16" | "1:1";
export function videoSize(aspect: VideoAspect, resolution: number) {
  return aspect === "1:1"
    ? { width: resolution, height: resolution }
    : aspect === "16:9"
      ? { width: (resolution * 16) / 9, height: resolution }
      : { width: resolution, height: (resolution * 16) / 9 };
}
export function videoFrameTime(
  start: number,
  end: number,
  index: number,
  count: number,
) {
  return start + ((end - start) * index) / (count - 1);
}

export async function videoResponse(path: string, init: RequestInit) {
  const response = await fetch("/api/v1/video-exports" + path, init);
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ message: response.statusText }));
    throw new Error(body.message || "视频导出失败。");
  }
  return response;
}
