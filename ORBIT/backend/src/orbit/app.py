import base64
import hashlib
import json
import math
import re
import time
import uuid
import threading
from pathlib import Path

from astropy.time import Time
import erfa
from datetime import datetime, timezone
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import __version__
from .importer import ImportProblem, read_table, validate, input_types
from .mechanics import conic
from .models import CENTERS, ImportRequest, ImportSelection, PreviewRequest, StrictModel
from .table_reader import MAX_SOURCE_BYTES
from .reduction_tasks import ReductionTask, ACTIVE
from . import planets

ROOT = Path(__file__).resolve().parents[3]
app = FastAPI(title="ORBIT", version=__version__)
imports: dict = {}
datasets: dict = {}
MAX_PROJECT_BYTES = 512 * 1024 * 1024


@app.exception_handler(ImportProblem)
async def import_error(_, exc):
    return JSONResponse(status_code=exc.status, content={"code": exc.code, "message": exc.message, "details": exc.details})


@app.exception_handler(RequestValidationError)
async def validation_error(_, exc):
    details = [{"field": ".".join(map(str, e["loc"])), "message": e["msg"], "source_rows": []} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"code": "invalid_request", "message": "请求参数无效", "details": details})


@app.middleware("http")
async def size_limit(request: Request, call_next):
    length = request.headers.get("content-length", "0")
    limit = MAX_SOURCE_BYTES if request.url.path == '/api/v1/imports/inspect' else MAX_PROJECT_BYTES
    if length.isdigit() and int(length) > limit+1024*1024:
        return JSONResponse(status_code=413, content={"code": "file_too_large", "message": f"请求超过 {limit//1024//1024} MiB"})
    return await call_next(request)


def get_entry(table, key):
    if key not in table:
        raise ImportProblem("记录已不存在；服务重启后请重新导入或打开项目", "not_found", status=404)
    return table[key]


def add_import(raw, filename, worksheet=None):
    now = time.monotonic()
    for key, entry in list(imports.items()):
        if now-entry["created"] > 3600 and not reduction_active(entry):
            imports.pop(key, None)
    if len(imports) >= 16:
        raise ImportProblem("待处理导入过多，请完成或取消已有导入", "capacity", status=409)
    parsed = read_table(raw, filename, worksheet, discover=True, allow_reduction=True)
    if parsed.get('requires_worksheet'):
        return {**parsed, 'filename':filename}
    key = str(uuid.uuid4())
    imports[key] = {"parsed": parsed, "raw": raw, "filename": filename, "created": now, 'task_lock':threading.RLock()}
    return import_inspection(key)


def import_inspection(key):
    entry = get_entry(imports, key)
    parsed = entry['parsed']
    return {"id": key, "filename": entry['filename'], "headers": parsed["headers"], "mapping": parsed["mapping"],
            'input_types':input_types(parsed['mapping']),
            "input_rows": len(parsed["rows"]), "preview": parsed["rows"][:5], "sha256": parsed["sha256"],
            **{k:parsed.get(k) for k in ['requires_reduction','source_input_rows','source_count_exact','source_scanned_rows','source_bytes','retained_bytes','selection']},
            'source_format':parsed['source_format'], 'worksheet':parsed['worksheet'], 'worksheets':parsed['worksheets']}


def public_dataset(ds):
    return {k: v for k, v in ds.items() if k not in {"source_base64", "import_request"}}


@app.get("/api/v1/health")
def health():
    return {"app": "ORBIT", "version": __version__, "schema_version": 2, "propagation": False}


@app.get("/api/v1/planets/catalog")
def planet_catalog():
    return planets.catalog()


@app.post("/api/v1/planets/window")
def planet_window(body: planets.WindowRequest):
    return planets.window(body)


@app.get("/api/v1/presets")
def presets():
    leaps = [{"utc_ms": datetime(int(row["year"]), int(row["month"]), 1, tzinfo=timezone.utc).timestamp()*1000,
              "offset": float(row["tai_utc"])} for row in erfa.leap_seconds.get() if row["year"] >= 1972]
    return {"centers": CENTERS, "frames": ["J2000", "ECLIPJ2000"], "reference_epoch": "J2000.0 (JD 2451545.0 TT)", "leap_seconds": leaps}


@app.get("/api/v1/examples/sample")
def sample():
    path = next((ROOT / "codex" / "examples").glob("*.csv"), None)
    if path is None:
        raise ImportProblem("未找到样例 CSV", "not_found", status=404)
    return FileResponse(path, media_type="text/csv", filename=path.name)


@app.post("/api/v1/imports/inspect")
async def inspect(file: UploadFile = File(...), worksheet: str | None = Form(None)):
    raw = await file.read(MAX_SOURCE_BYTES+1)
    return await run_in_threadpool(add_import, raw, Path(file.filename or "orbit.csv").name, worksheet)


@app.post('/api/v1/imports/{key}/reduce')
def reduce_import(key: str, body: ImportSelection):
    entry = get_entry(imports, key)
    with entry['task_lock']:
        if reduction_active(entry):
            raise ImportProblem('正在处理，请等待完成或先取消处理', 'reduction_busy', status=409)
        parsed = read_table(entry['raw'], entry['filename'], entry['parsed'].get('worksheet'),
                            selection=body, allow_reduction=True)
        entry['parsed'] = parsed
        return import_inspection(key)


def reduction_active(entry):
    job = entry.get('reduction_job')
    return job is not None and job.snapshot()['status'] in ACTIVE


@app.post('/api/v1/imports/{key}/reduction-jobs', status_code=202)
def start_reduction(key: str, body: ImportSelection):
    entry = get_entry(imports, key)
    with entry['task_lock']:
        if reduction_active(entry):
            raise ImportProblem('正在处理，请等待完成或先取消处理', 'reduction_busy', status=409)
        def publish(parsed):
            if imports.get(key) is not entry:
                from .table_reader import ReadCancelled
                raise ReadCancelled()
            entry['parsed'] = parsed
            return import_inspection(key)
        job = ReductionTask(entry, body, publish)
        entry['reduction_job'] = job
        initial = job.snapshot()
        job.start()
        return initial


def get_reduction(key, job_id):
    entry = get_entry(imports, key)
    job = entry.get('reduction_job')
    if job is None or job.id != job_id:
        raise ImportProblem('处理任务已不存在，请重新应用范围与采样', 'not_found', status=404)
    return job


@app.get('/api/v1/imports/{key}/reduction-jobs/{job_id}')
def reduction_progress(key: str, job_id: str):
    return get_reduction(key, job_id).snapshot()


@app.post('/api/v1/imports/{key}/reduction-jobs/{job_id}/cancel')
def cancel_reduction(key: str, job_id: str):
    return get_reduction(key, job_id).cancel()


@app.delete("/api/v1/imports/{key}")
def cancel_import(key: str):
    entry = imports.get(key)
    if entry:
        with entry['task_lock']:
            if entry.get('reduction_job'):
                entry['reduction_job'].cancel()
            imports.pop(key, None)
    return {"ok": True}


@app.post("/api/v1/imports/{key}/validate")
def validate_import(key: str, body: ImportRequest):
    entry = get_entry(imports, key)
    if reduction_active(entry):
        raise ImportProblem('正在处理，请等待完成或先取消处理', 'reduction_busy', status=409)
    return validate(entry["parsed"], body)[0]


@app.post("/api/v1/imports/{key}/commit")
def commit_import(key: str, body: ImportRequest):
    if len(datasets) >= 64:
        raise ImportProblem("数据集数量已达本次会话上限，请保存项目后重启", "capacity", status=409)
    entry = get_entry(imports, key)
    if reduction_active(entry):
        raise ImportProblem('正在处理，请等待完成或先取消处理', 'reduction_busy', status=409)
    report, ds = validate(entry["parsed"], body)
    if not report["ok"]:
        raise ImportProblem("请先处理预检中的问题", "unresolved_import", report["issues"])
    ds.update({"id": str(uuid.uuid4()), "filename": entry["filename"], "source_base64": base64.b64encode(entry["raw"]).decode("ascii")})
    ds.update(source_format=entry['parsed']['source_format'], worksheet=entry['parsed']['worksheet'])
    datasets[ds["id"]] = ds
    del imports[key]
    return public_dataset(ds)


@app.get("/api/v1/datasets/{key}/trajectory")
def trajectory(key: str):
    ds = get_entry(datasets, key)
    return {"reference_tai": ds["reference_tai"], "time_coordinate_scale": "TAI", "decimated": False,
            "times": [s["t"] for s in ds["samples"]], "positions_km": [s["position_km"] for s in ds["samples"]], "breaks": ds["breaks"]}


@app.get("/api/v1/datasets/{key}/samples")
def samples(key: str):
    return get_entry(datasets, key)["samples"]


@app.post("/api/v1/orbits/preview")
def preview(body: PreviewRequest):
    x = list(body.elements.model_dump().values())
    x[2:] = [math.radians(v) for v in x[2:]]
    try:
        result = conic(x, body.radius_km, body.metadata.mu_km3_s2)
    except (ValueError, OverflowError) as exc:
        raise ImportProblem(str(exc), "invalid_elements")
    result["request_version"] = body.request_version
    return result


class ExportRequest(StrictModel):
    dataset_ids: list[str]
    state: dict


def finite_json(value):
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (ValueError, TypeError):
        raise ImportProblem("项目包含非有限数值或不支持的数据")


def validate_project_state(state, dataset_map):
    ids = set(dataset_map)
    if not isinstance(state, dict) or not isinstance(state.get("layers"), list) or len(state["layers"]) > 128:
        raise ImportProblem("项目图层结构无效")
    layer_ids = set()
    has_planets = False
    coordinate_system = state.get("scene")
    if coordinate_system is None and dataset_map:
        origin = next(iter(dataset_map.values()))["metadata"]
        coordinate_system = {"center":origin["center"],"frame":origin["frame"]}
    if not isinstance(coordinate_system, dict) or coordinate_system.get("center") not in {"sun","earth"} or coordinate_system.get("frame") not in {"J2000","ECLIPJ2000"}:
        raise ImportProblem("项目场景中心或参考系无效")
    if any(ds["metadata"]["center"] != coordinate_system["center"] or ds["metadata"]["frame"] != coordinate_system["frame"] for ds in dataset_map.values()):
        raise ImportProblem("项目混合了不同中心或参考系")
    for layer in state["layers"]:
        if not isinstance(layer, dict) or not isinstance(layer.get("id"), str) or layer["id"] in layer_ids:
            raise ImportProblem("项目图层 ID 无效或重复")
        layer_ids.add(layer["id"])
        if layer.get("kind") != "planet" and layer.get("dataset_id") not in ids:
            raise ImportProblem("项目图层引用了不存在的数据集")
        if layer.get("kind") not in {"dataset", "hypothesis", "planet"}:
            raise ImportProblem("未知图层类型")
        if not isinstance(layer.get("name"), str) or not isinstance(layer.get("color"), str):
            raise ImportProblem("图层名称或颜色无效")
        if not 1 <= len(layer["name"]) <= 120 or not re.fullmatch(r"#[0-9a-fA-F]{6}", layer["color"]):
            raise ImportProblem("图层名称为空/过长，或颜色不是六位十六进制值")
        for flag in ["visible", "showTrack", "showTrail", "showLabel"]:
            if not isinstance(layer.get(flag), bool):
                raise ImportProblem("图层开关无效")
        for key, minimum, maximum in [("glowSize", 2, 48), ("lineWidth", 0.5, 8)]:
            if key in layer and (type(layer[key]) not in (int, float) or not math.isfinite(layer[key]) or not minimum <= layer[key] <= maximum):
                raise ImportProblem("图层光点大小或轨道线宽超出有效范围")
        if layer["kind"] == "planet":
            has_planets = True
            if layer.get("body_id") not in planets.BODIES:
                raise ImportProblem("未知行星")
            if "showMeridian" in layer and not isinstance(layer["showMeridian"],bool):
                raise ImportProblem("经线开关无效")
        if layer["kind"] == "hypothesis":
            try:
                req = PreviewRequest.model_validate(layer["hypothesis"])
                origin = dataset_map[layer["dataset_id"]]["metadata"]
                if req.metadata.center != origin["center"] or req.metadata.frame != origin["frame"]:
                    raise ImportProblem("假设图层的中心或参考系与源数据不一致")
                layer["curve"] = preview(req)
            except (ValueError, KeyError):
                raise ImportProblem("假设轨道输入无效")
    try:
        clock = state.get("clock", {})
        if not isinstance(clock.get("base_tai"), str):
            raise ValueError()
        Time(clock["base_tai"], format="isot", scale="tai")
        for field in ["time", "speed"]:
            if not isinstance(clock.get(field), (int, float)) or not math.isfinite(clock[field]):
                raise ValueError()
        if not 0 < clock["speed"] <= 1e12:
            raise ValueError()
        base = Time(clock["base_tai"], format="isot", scale="tai")
        lows = [(Time(ds["reference_tai"], scale="tai")-base).to_value('sec')+ds["samples"][0]["t"] for ds in dataset_map.values()]
        highs = [(Time(ds["reference_tai"], scale="tai")-base).to_value('sec')+ds["samples"][-1]["t"] for ds in dataset_map.values()]
        if has_planets:
            lows.append((Time(planets.MIN_UTC,scale="utc")-base).to_value("sec"))
            highs.append((Time(planets.MAX_UTC,scale="utc")-base).to_value("sec"))
        first, last = min(lows), max(highs)
        start, end = clock.get("start", first), clock.get("end", last)
        if not all(isinstance(v, (int,float)) and math.isfinite(v) for v in [start,end]):
            raise ValueError()
        if start < first-1e-3 or end > last+1e-3 or start > end or not start-1e-3 <= clock["time"] <= end+1e-3:
            raise ValueError()
    except (TypeError, ValueError):
        raise ImportProblem("项目时间状态无效")
    if state.get("selected") is not None and state.get("selected") not in layer_ids:
        raise ImportProblem("所选图层不存在")
    if not all(isinstance(state.get(key), bool) for key in ["axes","grid"]):
        raise ImportProblem("视图开关无效")
    if "stars" in state and not isinstance(state["stars"],bool):
        raise ImportProblem("星空开关无效")
    for key in ["radius_km","trail_s"]:
        value = state.get(key)
        if not isinstance(value, (int,float)) or not math.isfinite(value) or not 0 < value <= 1e16:
            raise ImportProblem("显示半径或尾迹时长无效")
    camera = state.get("camera")
    if camera is not None:
        try:
            for field in ["position_km","target_km","up"]:
                vector = camera[field]
                if not isinstance(vector,list) or len(vector)!=3 or not all(type(v) in (float,int) and math.isfinite(v) for v in vector):
                    raise ValueError()
            if math.dist(camera["position_km"],camera["target_km"]) < .000001 or math.hypot(*camera["up"]) < 1e-10:
                raise ValueError()
            if camera.get("follow_id") is not None and camera["follow_id"] not in layer_ids:
                raise ValueError()
        except (KeyError,TypeError,ValueError):
            raise ImportProblem("相机状态无效")
    finite_json(state)
    return state


@app.post("/api/v1/projects/export")
def export_project(body: ExportRequest):
    chosen = [get_entry(datasets, key) for key in dict.fromkeys(body.dataset_ids)]
    if not chosen and not any(l.get("kind")=="planet" for l in body.state.get("layers",[]) if isinstance(l,dict)):
        raise ImportProblem("项目至少需要一个数据集或行星图层")
    state = validate_project_state(body.state, {d["id"]:d for d in chosen})
    data = {"schema_version": 2, "app_version": __version__, "state": state,
            "datasets": [{"id": d["id"], "filename": d["filename"], "source_base64": d["source_base64"],
                          "source_sha256": d["source_sha256"], "import_request": d["import_request"],
                          'source_format':d.get('source_format','csv'), 'worksheet':d.get('worksheet')} for d in chosen]}
    encoded = finite_json(data).encode("utf-8")
    if len(encoded) > MAX_PROJECT_BYTES:
        raise ImportProblem("项目超过 512 MiB", "file_too_large", status=413)
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="project.orbit.json"'})


@app.post("/api/v1/projects/import")
async def import_project(file: UploadFile = File(...)):
    raw = await file.read(MAX_PROJECT_BYTES+1)
    if len(raw) > MAX_PROJECT_BYTES:
        raise ImportProblem("项目超过 512 MiB", "file_too_large", status=413)
    try:
        project = json.loads(raw)
        if project["schema_version"] not in {1,2}:
            raise ImportProblem("不支持的项目版本", "schema_version")
        if not isinstance(project["datasets"], list) or not 0 <= len(project["datasets"]) <= 64:
            raise ImportProblem("项目数据集过多或结构无效")
        rebuilt = {}
        for item in project["datasets"]:
            if not isinstance(item["id"], str) or item["id"] in rebuilt:
                raise ImportProblem("项目数据集 ID 重复或无效")
            source = base64.b64decode(item["source_base64"], validate=True)
            if hashlib.sha256(source).hexdigest() != item["source_sha256"]:
                raise ImportProblem("项目源文件校验失败")
            req = ImportRequest.model_validate(item["import_request"])
            parsed = await run_in_threadpool(read_table, source, str(item['filename']), item.get('worksheet'), selection=req.selection)
            if item.get('source_format', parsed['source_format']) != parsed['source_format']:
                raise ImportProblem("项目源文件格式与文件名不一致")
            report, ds = validate(parsed, req)
            if not report["ok"]:
                raise ImportProblem("项目数据未通过重新校验", details=report["issues"])
            ds.update({"id": item["id"], "filename": str(item["filename"]), "source_base64": item["source_base64"]})
            ds.update(source_format=parsed['source_format'], worksheet=parsed['worksheet'])
            rebuilt[ds["id"]] = ds
        state = validate_project_state(project["state"], rebuilt)
        centers = {(d["metadata"]["center"], d["metadata"]["frame"]) for d in rebuilt.values()}
        if len(centers) > 1:
            raise ImportProblem("项目混合了不同中心或参考系")
    except ImportProblem:
        raise
    except (ValueError, KeyError, TypeError, OverflowError, RecursionError):
        raise ImportProblem("项目文件结构或内容无效")
    # Replace this single-user workspace only after every dataset and state has passed.
    datasets.clear()
    datasets.update(rebuilt)
    return {"state": state, "datasets": [public_dataset(ds) for ds in rebuilt.values()]}


DIST = ROOT / "frontend" / "dist"
TEXTURES = ROOT / "textures"
if TEXTURES.is_dir():
    app.mount("/textures",StaticFiles(directory=TEXTURES),name="textures")
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
