"""Fixed-rate MP4 encoding from browser-rendered PNG frames; local FFmpeg only."""
import functools
from contextlib import asynccontextmanager
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import threading
import time
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import Field, model_validator
from starlette.concurrency import run_in_threadpool

from .importer import ImportProblem
from .models import StrictModel

ROOT = Path(__file__).resolve().parents[3]
CACHE = ROOT / ".cache" / "video-export"
MAX_FRAME_BYTES = 16 * 1024 * 1024
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
LOCK = threading.RLock()
JOBS = {}


@asynccontextmanager
async def lifespan(app):
    yield
    with LOCK:
        jobs = list(JOBS.values())
        JOBS.clear()
    for job in jobs:
        await run_in_threadpool(job.cancel)


router = APIRouter(prefix="/api/v1/video-exports", lifespan=lifespan)


@functools.lru_cache(maxsize=1)
def encoder():
    binary = shutil.which("ffmpeg")
    if not binary:
        return None
    try:
        result = subprocess.run([binary, "-hide_banner", "-encoders"], capture_output=True,
                                timeout=5, creationflags=FLAGS)
        return binary if result.returncode == 0 and b"libx264" in result.stdout else None
    except (OSError, subprocess.TimeoutExpired):
        return None


class VideoSettings(StrictModel):
    width: int = Field(ge=64, le=1920, strict=True)
    height: int = Field(ge=64, le=1920, strict=True)
    fps: int = Field(ge=24, le=60, strict=True)
    frames: int = Field(ge=2, le=18000, strict=True)

    @model_validator(mode="after")
    def dimensions(self):
        if self.width % 2 or self.height % 2 or self.width*self.height > 1920*1080 or self.fps not in {24,30,60}:
            raise ValueError("视频尺寸必须为偶数、至多 1920×1080 像素，帧率为 24/30/60")
        return self


class VideoJob:
    def __init__(self, settings):
        self.id = uuid.uuid4().hex
        self.settings = settings
        self.lock = threading.RLock()
        self.touched = time.monotonic()
        self.count = 0
        self.cancelled = False
        self.finishing = False
        CACHE.mkdir(parents=True, exist_ok=True)
        self.path = Path(tempfile.mkdtemp(prefix="video-", dir=CACHE)).resolve()
        self.output = self.path / "ORBIT-video.mp4"
        self.log = (self.path / "encoder.log").open("wb")
        try:
            self.process = subprocess.Popen([
                encoder(), "-hide_banner", "-loglevel", "error", "-y",
                "-f", "image2pipe", "-framerate", str(settings.fps), "-vcodec", "png", "-i", "pipe:0",
                "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(self.output),
            ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=self.log, creationflags=FLAGS)
        except OSError as exc:
            self.log.close()
            self.cleanup_path()
            raise ImportProblem("无法启动本地视频编码器", "video_encoder", status=503) from exc

    def cleanup_path(self):
        # Only delete a directory created by this module, never a supplied path.
        if self.path.parent == CACHE.resolve() and self.path.name.startswith("video-"):
            shutil.rmtree(self.path, ignore_errors=True)

    def add(self, index, data):
        with self.lock:
            if self.cancelled or self.finishing:
                raise ImportProblem("视频任务已结束或取消", "video_state", status=409)
            if index != self.count or index >= self.settings.frames:
                raise ImportProblem("视频帧次序不正确", "video_frame_order", status=409)
            if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
                raise ImportProblem("视频帧必须是 PNG", "video_frame")
            if struct.unpack(">II", data[16:24]) != (self.settings.width, self.settings.height):
                raise ImportProblem("视频帧尺寸与导出设置不一致", "video_dimensions")
            try:
                self.process.stdin.write(data)
                self.process.stdin.flush()
            except (OSError, ValueError) as exc:
                raise ImportProblem("视频编码器已停止，请取消后重试", "video_encoder") from exc
            self.count += 1
            self.touched = time.monotonic()
            return {"frames": self.count, "total": self.settings.frames}

    def finish(self):
        with self.lock:
            if self.cancelled or self.finishing or self.count != self.settings.frames:
                raise ImportProblem("视频帧尚未完整提交或任务已结束", "video_state", status=409)
            self.finishing = True
            self.touched = time.monotonic()
            try:
                self.process.stdin.close()
            except (OSError, ValueError) as exc:
                raise ImportProblem("视频编码器已停止，请重试", "video_encoder") from exc
        try:
            code = self.process.wait(timeout=180)
        except subprocess.TimeoutExpired as exc:
            self.cancel()
            raise ImportProblem("视频编码超时，请缩短视频后重试", "video_timeout") from exc
        if self.cancelled or code or not self.output.exists() or not self.output.stat().st_size:
            raise ImportProblem("视频编码失败或已取消，请重试", "video_encoder")
        self.touched = time.monotonic()
        return self.output

    def cancel(self):
        # Kill first, so cancellation can interrupt a blocked pipe write.
        self.cancelled = True
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=10)
        with self.lock:
            try:
                self.process.stdin.close()
            except (OSError, ValueError):
                pass
            self.log.close()
            self.cleanup_path()


def get_job(job_id):
    with LOCK:
        job = JOBS.get(job_id)
    if job is None:
        raise ImportProblem("视频任务不存在", "video_missing", status=404)
    return job


@router.get("/capabilities")
def capabilities():
    return {"mp4": encoder() is not None, "max_frames": 18000,
            "message": "" if encoder() else "未找到支持 H.264 的 FFmpeg，请安装到 PATH 后重启 ORBIT。"}


@router.post("", status_code=201)
def create(settings: VideoSettings):
    if not encoder():
        raise ImportProblem("未找到支持 H.264 的 FFmpeg，请安装到 PATH 后重启 ORBIT。", "video_encoder_missing", status=503)
    with LOCK:
        for key, job in list(JOBS.items()):
            if time.monotonic()-job.touched > 3600:
                job.cancel()
                del JOBS[key]
        if len(JOBS) >= 2:
            raise ImportProblem("已有视频导出任务，请先完成或取消", "video_busy", status=409)
        job = VideoJob(settings)
        JOBS[job.id] = job
    return {"id": job.id}


@router.post("/{job_id}/frames/{index}")
async def frame(job_id: str, index: int, request: Request):
    job = get_job(job_id)
    data = bytearray()
    async for chunk in request.stream():
        if len(data)+len(chunk) > MAX_FRAME_BYTES:
            raise ImportProblem("单帧超过 16 MiB", "video_frame_size", status=413)
        data.extend(chunk)
    return await run_in_threadpool(job.add, index, data)


@router.post("/{job_id}/finish")
def finish(job_id: str):
    output = get_job(job_id).finish()
    return FileResponse(output, media_type="video/mp4", filename="ORBIT-video.mp4")


@router.delete("/{job_id}", status_code=204)
def cancel(job_id: str):
    with LOCK:
        job = JOBS.pop(job_id, None)
    if job:
        job.cancel()
