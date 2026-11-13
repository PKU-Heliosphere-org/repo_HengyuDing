import { useEffect, useRef, useState } from "react";
import { api, download, post } from "./api";
import {
  videoFrameTime,
  videoResponse,
  videoSize,
  type VideoAspect,
} from "./videoExport";

type Props = {
  from: number;
  to: number;
  rangeLabel: string;
  canExport: boolean;
  onClose: () => void;
  onBegin: () => void;
  onEnd: () => void;
  onPreview: (width: number, height: number, overlay: boolean) => Promise<Blob>;
  onFrame: (
    time: number,
    width: number,
    height: number,
    overlay: boolean,
  ) => Promise<Blob>;
};

export function VideoExportDialog(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const abort = useRef<AbortController | null>(null);
  const job = useRef<string | null>(null);
  const [aspect, setAspect] = useState<VideoAspect>("16:9");
  const [resolution, setResolution] = useState(720);
  const [fps, setFps] = useState(30);
  const [seconds, setSeconds] = useState(10);
  const [overlay, setOverlay] = useState(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [capability, setCapability] = useState<{
    mp4: boolean;
    message: string;
  } | null>(null);
  const size = videoSize(aspect, resolution);
  const count = Math.round(seconds * fps);
  const valid =
    Number.isFinite(seconds) &&
    seconds >= 1 &&
    seconds <= 600 &&
    count <= 18000;
  useEffect(() => {
    dialog.current!.showModal();
    let current = true;
    void api<{ mp4: boolean; message: string }>("/video-exports/capabilities")
      .then((data) => {
        if (current) setCapability(data);
      })
      .catch((e: Error) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
      abort.current?.abort();
      if (job.current)
        void fetch(`/api/v1/video-exports/${job.current}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (running) return;
    let current = true,
      url = "";
    void latest.current
      .onPreview(size.width, size.height, overlay)
      .then((blob) => {
        if (!current) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      })
      .catch((e: Error) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [size.width, size.height, overlay, running]);
  async function exportVideo() {
    if (!props.canExport || !valid || !capability?.mp4) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setError("");
    setProgress(0);
    setStatus("正在准备视频…");
    props.onBegin();
    try {
      // Always receive the ID, even when cancelled while creating the job,
      // so an encoder cannot be left behind without a known cleanup handle.
      const created = await post<{ id: string }>("/video-exports", {
        ...size,
        fps,
        frames: count,
      });
      job.current = created.id;
      for (let i = 0; i < count; i++) {
        if (controller.signal.aborted)
          throw new DOMException("Cancelled", "AbortError");
        const blob = await props.onFrame(
          videoFrameTime(props.from, props.to, i, count),
          size.width,
          size.height,
          overlay,
        );
        await videoResponse(`/${created.id}/frames/${i}`, {
          method: "POST",
          body: blob,
          signal: controller.signal,
          headers: { "Content-Type": "image/png" },
        });
        setProgress(((i + 1) / count) * 0.98);
        setStatus(`正在生成视频帧 ${i + 1} / ${count}`);
      }
      setStatus("正在完成 MP4 编码…");
      const response = await videoResponse(`/${created.id}/finish`, {
        method: "POST",
        signal: controller.signal,
      });
      const blob = await response.blob();
      if (controller.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
      download(blob, "ORBIT-video.mp4");
      setProgress(1);
      setStatus("视频已生成，请保存 MP4 文件。");
    } catch (e) {
      if (controller.signal.aborted) {
        setStatus("已取消视频导出。");
        setProgress(0);
      } else {
        setError((e as Error).message);
        setStatus("");
      }
    } finally {
      if (job.current)
        await videoResponse(`/${job.current}`, { method: "DELETE" }).catch(
          () => {},
        );
      job.current = null;
      abort.current = null;
      props.onEnd();
      setRunning(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="video-export-dialog"
      aria-label="导出视频"
      onCancel={(e) => {
        e.preventDefault();
        if (running) abort.current?.abort();
        else props.onClose();
      }}
    >
      <header>
        <div>
          <span className="eyebrow">VIDEO EXPORT</span>
          <h2>导出视频</h2>
        </div>
        <button
          onClick={() => (running ? abort.current?.abort() : props.onClose())}
        >
          {running ? "取消导出" : "关闭"}
        </button>
      </header>
      <p className="video-source">缓存区间：{props.rangeLabel}</p>
      {!props.canExport && (
        <p className="video-warning">
          请先启用缓存渲染，选择时间范围并等待缓存就绪。
        </p>
      )}
      {capability && !capability.mp4 && (
        <p className="video-warning">{capability.message}</p>
      )}
      <div className="video-settings">
        <label>
          画幅比例
          <select
            aria-label="视频画幅比例"
            disabled={running}
            value={aspect}
            onChange={(e) => setAspect(e.target.value as VideoAspect)}
          >
            <option value="16:9">16:9 横屏</option>
            <option value="9:16">9:16 竖屏</option>
            <option value="1:1">1:1 方形</option>
          </select>
        </label>
        <label>
          分辨率
          <select
            aria-label="视频分辨率"
            disabled={running}
            value={resolution}
            onChange={(e) => setResolution(Number(e.target.value))}
          >
            <option value={720}>720p</option>
            <option value={1080}>1080p</option>
          </select>
        </label>
        <label>
          帧率
          <select
            aria-label="视频帧率"
            disabled={running}
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
          >
            {[24, 30, 60].map((value) => (
              <option key={value} value={value}>
                {value} fps
              </option>
            ))}
          </select>
        </label>
        <label>
          视频时长 / 秒
          <input
            aria-label="视频时长"
            disabled={running}
            type="number"
            min={1}
            max={Math.min(600, 18000 / fps)}
            step={1}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          />
        </label>
      </div>
      <label className="video-overlay">
        <input
          type="checkbox"
          checked={overlay}
          disabled={running}
          onChange={(e) => setOverlay(e.target.checked)}
        />
        显示时间与对象标签
      </label>
      <div
        className="video-preview"
        style={{
          aspectRatio: `${size.width}/${size.height}`,
          width: Math.min(680, (270 * size.width) / size.height),
        }}
      >
        {preview ? (
          <img src={preview} alt="视频画幅预览" />
        ) : (
          <span>正在生成画幅预览…</span>
        )}
      </div>
      <p className="video-note">
        {size.width} × {size.height} · MP4 / H.264 ·
        仅导出三维画面，侧栏和时间轴不会进入视频。视频时长决定所选区间的播放速度。
      </p>
      {running && (
        <progress aria-label="视频导出进度" max={1} value={progress} />
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {!valid && <p role="alert">时长需为 1–600 秒，且总帧数不超过 18000。</p>}
      <footer>
        <button
          disabled={running || !props.canExport || !capability?.mp4 || !valid}
          className="primary"
          onClick={() => void exportVideo()}
        >
          开始导出 MP4
        </button>
      </footer>
    </dialog>
  );
}
