import csv
import hashlib
import io
import math
import re
import warnings
from collections import defaultdict
from contextlib import ExitStack
from datetime import date, datetime
from pathlib import Path
from zipfile import ZipFile, BadZipFile
from xml.etree.ElementTree import ParseError

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException

import numpy as np
from astropy.time import Time
from astropy.utils import iers

from .mechanics import AU_KM, state
from .models import FIELDS, ImportRequest

iers.conf.auto_download = False
MAX_BYTES = 20 * 1024 * 1024
MAX_ROWS = 100000
ALIASES = dict(zip(FIELDS, ["Time (UTCG)", "Semi-major Axis (km)", "Eccentricity", "Inclination (deg)",
                           "RAAN (deg)", "Arg of Perigee (deg)", "True Anomaly (deg)", "Mean Anomaly (deg)"]))
NUMERIC = FIELDS[1:]


class ImportProblem(Exception):
    def __init__(self, message, code="invalid_input", details=None, status=422):
        super().__init__(message)
        self.message, self.code, self.details, self.status = message, code, details or [], status


def read_csv(raw):
    if len(raw) > MAX_BYTES:
        raise ImportProblem("CSV 超过 20 MiB", "file_too_large", status=413)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ImportProblem("请将 CSV 转为 UTF-8 编码")
    if "\x00" in text:
        raise ImportProblem("文件包含空字节，不是有效文本 CSV")
    try:
        reader = csv.reader(io.StringIO(text, newline=""), strict=True)
        headers = [s.strip() for s in next(reader)]
        if not headers or len(set(headers)) != len(headers):
            raise ImportProblem("表头为空或存在重复列名")
        rows, empty = [], 0
        for row in reader:
            line = reader.line_num
            if not row or all(not x.strip() for x in row):
                empty += 1
                continue
            if len(row) != len(headers):
                raise ImportProblem("CSV 列数不一致", details=[{"source_rows": [line]}])
            rows.append({"source_row": line, "values": dict(zip(headers, [x.strip() for x in row]))})
            if len(rows) > MAX_ROWS:
                raise ImportProblem("CSV 超过 100,000 行", "too_many_rows", status=413)
        if not rows:
            raise ImportProblem("CSV 没有数据行")
        mapping = {field: field if field in headers else alias for field, alias in ALIASES.items() if field in headers or alias in headers}
        return {"headers": headers, "rows": rows, "empty_rows": empty, "mapping": mapping,
                "sha256": hashlib.sha256(raw).hexdigest()}
    except (csv.Error, StopIteration) as exc:
        raise ImportProblem("无法解析 CSV：" + str(exc))


def read_table(raw, filename, worksheet=None, discover=False):
    suffix = Path(filename).suffix.lower()
    if suffix == '.xlsx':
        return read_xlsx(raw, worksheet, discover)
    if suffix not in {'.csv', ''}:
        raise ImportProblem("仅支持 CSV 和 XLSX 文件；旧版 XLS 请先另存为 XLSX")
    if worksheet is not None:
        raise ImportProblem("CSV 不包含工作表")
    return {**read_csv(raw), 'source_format': 'csv', 'worksheet': None, 'worksheets': []}


def read_xlsx(raw, worksheet=None, discover=False):
    if len(raw) > MAX_BYTES:
        raise ImportProblem("XLSX 超过 20 MiB", "file_too_large", status=413)
    try:
        with ZipFile(io.BytesIO(raw)) as archive:
            members = archive.infolist()
            if len(members) > 10000 or sum(item.file_size for item in members) > 100*1024*1024:
                raise ImportProblem("XLSX 解压内容超过读取上限，请精简工作簿", "file_too_large", status=413)
        with ExitStack() as resources:
            workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=False, keep_links=False)
            resources.callback(workbook.close)
            names = [sheet.title for sheet in workbook.worksheets]
            if not names:
                raise ImportProblem("XLSX 没有可读取的工作表")
            if worksheet is None:
                if len(names) > 1:
                    if discover:
                        return {'requires_worksheet': True, 'worksheets': names, 'source_format': 'xlsx'}
                    raise ImportProblem("XLSX 含多个工作表，请明确选择工作表")
                worksheet = names[0]
            if not isinstance(worksheet, str) or worksheet not in names:
                raise ImportProblem("所选 XLSX 工作表不存在")
            sheet = workbook[worksheet]
            if (sheet.max_column or 0) > 256 or (sheet.max_row or 0) > MAX_ROWS+1001:
                raise ImportProblem("工作表最多支持 256 列、100,000 条数据，请移除多余行列", "too_many_rows", status=413)
            cached = load_workbook(io.BytesIO(raw), read_only=True, data_only=True, keep_links=False)
            resources.callback(cached.close)
            sheet.reset_dimensions()
            cached[worksheet].reset_dimensions()
            headers, rows, empty, formula_count = None, [], 0, 0
            for line, (cells, values) in enumerate(zip(sheet.iter_rows(), cached[worksheet].iter_rows()), 1):
                if len(cells) > 256:
                    raise ImportProblem("工作表超过 256 列", "too_many_columns", status=413)
                if line > MAX_ROWS+1001:
                    raise ImportProblem("工作表物理行数超过读取上限", "too_many_rows", status=413)
                strings = []
                for cell, cached_cell in zip(cells, values):
                    value = cell.value
                    if cell.data_type == 'f':
                        formula_count += 1
                        value = cached_cell.value
                        if value is None:
                            raise ImportProblem(f"工作表 {worksheet} 的 {cell.coordinate} 公式没有缓存结果；请在 Excel 中重新计算并保存，或粘贴为值", details=[{'source_rows':[line]}])
                    if cell.data_type == 'e' or cached_cell.data_type == 'e':
                        raise ImportProblem(f"工作表 {worksheet} 的 {cell.coordinate} 包含 Excel 错误值", details=[{'source_rows':[line]}])
                    if isinstance(value, datetime):
                        value = value.isoformat()
                    elif isinstance(value, date):
                        value = value.isoformat()+'T00:00:00'
                    strings.append('' if value is None else str(value).strip())
                if not any(strings):
                    empty += 1
                    continue
                if headers is None:
                    while strings and not strings[-1]:
                        strings.pop()
                    headers = strings
                    if any(not s for s in headers) or len(set(headers)) != len(headers):
                        raise ImportProblem("工作表表头为空或存在重复列名", details=[{'source_rows':[line]}])
                    continue
                if any(strings[len(headers):]):
                    raise ImportProblem("工作表存在没有表头的数据列", details=[{'source_rows':[line]}])
                strings = (strings+['']*len(headers))[:len(headers)]
                rows.append({'source_row': line, 'values': dict(zip(headers, strings))})
                if len(rows) > MAX_ROWS:
                    raise ImportProblem("XLSX 超过 100,000 条数据", "too_many_rows", status=413)
            if not headers or not rows:
                raise ImportProblem(f"工作表 {worksheet} 没有数据行")
            mapping = {field: field if field in headers else alias for field, alias in ALIASES.items() if field in headers or alias in headers}
            notes = [f"使用 {formula_count} 个 Excel 公式缓存结果，未重新计算公式；请确认源文件已重新计算并保存。"] if formula_count else []
            return {'headers':headers, 'rows':rows, 'empty_rows':empty, 'mapping':mapping,
                    'sha256':hashlib.sha256(raw).hexdigest(), 'source_format':'xlsx', 'worksheet':worksheet,
                    'worksheets':names, 'warnings':notes, 'audit':[f"XLSX 工作表：{worksheet}"]}
    except ImportProblem:
        raise
    except (BadZipFile, ValueError, KeyError, OSError, TypeError, EOFError, ParseError, InvalidFileException) as exc:
        raise ImportProblem("无法读取 XLSX；请确认文件完整、未加密，并可由 Excel 正常打开", "invalid_workbook") from exc


def epoch_string(value, scale):
    s = value.strip()
    slash = re.fullmatch(r"(\d{4})/(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?", s)
    if slash:
        y, mo, d, h, mi, sec = slash.groups()
        s = f"{y}-{int(mo):02d}-{int(d):02d}T{int(h):02d}:{mi}:{sec or '00'}"
    else:
        s = s.replace(" ", "T")
    if s.endswith("Z"):
        if scale != "UTC":
            raise ValueError("Z 只可用于 UTC；TT/TDB 请移除 Z 并声明时间体系")
        s = s[:-1]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?", s):
        raise ValueError("时间须为 ISO 8601 或 YYYY/M/D H:mm，时区偏移请先转换为 UTC")
    if len(s) == 16:
        s += ":00"
    return s


def validate(parsed, request: ImportRequest):
    meta, mapping, decisions = request.metadata, request.mapping, request.decisions
    problems, notes, warnings_list = [], list(parsed.get('audit', [])), list(parsed.get('warnings', []))

    def issue(message, rows=None, field=None):
        problems.append({"message": message, "source_rows": rows or [], "field": field})

    required = NUMERIC[:6] + (["epoch"] if meta.epoch_mode == "per_row" else [])
    for field in required:
        if not mapping.get(field) or mapping[field] not in parsed["headers"]:
            issue("缺少必需列映射", field=field)
    used = [v for k, v in mapping.items() if v and k in FIELDS]
    if len(set(used)) != len(used):
        issue("一个源列不能映射到多个字段")
    if any(k not in FIELDS or (v and v not in parsed["headers"]) for k, v in mapping.items()):
        issue("存在未知的字段或源列映射")
    if meta.epoch_mode == "single" and (len(parsed["rows"]) != 1 or mapping.get("epoch")):
        issue("单历元模式只适用于一条记录且未映射时间列的文件")
    for field, column in mapping.items():
        if not column:
            continue
        mismatch = (field == "a" and "(km)" in column and meta.length_unit != "km") or (field in NUMERIC[2:] and "(deg)" in column and meta.angle_unit != "deg")
        if mismatch and not decisions.override_units:
            issue("选择的单位与表头不同；如确定需覆盖，请显式确认", field=field)
    if problems:
        return {"ok": False, "issues": problems, "warnings": [], "conflicts": [], "stats": {"input_rows": len(parsed["rows"])}}, None

    exclusions = set(decisions.exclude_rows)
    source_rows = {r["source_row"] for r in parsed["rows"]}
    if exclusions-source_rows:
        issue("排除行中包含不存在的行号", sorted(exclusions-source_rows))
    converted, times = [], []
    anomaly_mismatch, hyperbolic_mean = [], []
    for row in parsed["rows"]:
        line, values = row["source_row"], row["values"]
        if line in exclusions:
            continue
        try:
            raw_numbers = {f: float(values[mapping[f]]) for f in NUMERIC if mapping.get(f)}
            if not all(math.isfinite(v) for v in raw_numbers.values()):
                raise ValueError("根数不可包含 NaN 或 Infinity")
            a = raw_numbers["a"] * (AU_KM if meta.length_unit == "AU" else 1)
            factor = math.pi/180 if meta.angle_unit == "deg" else 1
            x = [a, raw_numbers["e"], *[raw_numbers[f]*factor for f in NUMERIC[2:6]]]
            position, velocity = state(x, meta.mu_km3_s2)
            epoch = epoch_string(values[mapping["epoch"]] if meta.epoch_mode == "per_row" else meta.single_epoch, meta.time_scale)
            elements = dict(zip(NUMERIC[:6], [a, x[1], *[math.degrees(v) for v in x[2:]]]))
            for f in ["raan", "arg_periapsis", "true_anomaly"]:
                elements[f] %= 360
            if "mean_anomaly" in raw_numbers:
                if x[1] < 1:
                    E = 2*math.atan2(math.sqrt(1-x[1])*math.sin(x[5]/2), math.sqrt(1+x[1])*math.cos(x[5]/2))
                    delta = E-x[1]*math.sin(E)-raw_numbers["mean_anomaly"]*factor
                    if abs(math.atan2(math.sin(delta),math.cos(delta))) > math.radians(.5):
                        anomaly_mismatch.append(line)
                else:
                    hyperbolic_mean.append(line)
            if abs(1-x[1]) < 1e-4:
                warnings_list.append(f"行 {line} 接近抛物线，数值敏感")
            converted.append({"source_rows": [line], "elements": elements, "position_km": position.tolist(),
                              "speed_km_s": float(np.linalg.norm(velocity)), "raw_numbers": raw_numbers})
            times.append(epoch)
        except (ValueError, OverflowError, KeyError) as exc:
            issue(str(exc), [line])
    if not converted:
        issue("没有可用记录")
        return {"ok": False, "issues": problems, "warnings": [], "conflicts": [], "stats": {"input_rows": len(parsed["rows"])}}, None

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        try:
            epochs = Time(times, format="isot", scale=meta.time_scale.lower(), precision=9)
            tai = epochs.tai
            utc = epochs.utc
            if np.any(utc.jd < 2441317.5):
                issue("首版时间轴支持 1972-01-01 起的历元；更早 UTC 需不同的时差模型", field="epoch")
            reference = tai[0]
            seconds = (tai-reference).to_value("sec")
            tai_strings, utc_strings = tai.isot.tolist(), utc.isot.tolist()
        except ValueError:
            for rec, value in zip(converted, times):
                try:
                    Time(value, format="isot", scale=meta.time_scale.lower())
                except ValueError:
                    issue("历元不是有效的公历时间", rec["source_rows"], "epoch")
            return {"ok": False, "issues": problems, "warnings": [], "conflicts": [], "stats": {"input_rows": len(parsed["rows"])}}, None
        if caught:
            warnings_list.append("时间库提示：包含未来或闰秒表覆盖范围外的日期；UTC 转换使用当前随库附带的闰秒表，不预测未来闰秒。")
    groups = defaultdict(list)
    for rec, sec, key, label in zip(converted, seconds, tai_strings, utc_strings):
        rec.update({"t": float(sec), "epoch_utc": label+"Z", "epoch_tai": key})
        groups[key].append(rec)
    unique, conflicts, duplicate_groups = [], [], []
    for key, recs in groups.items():
        # Separate identical raw mapped values even if another record at this epoch conflicts.
        classes = []
        for rec in recs:
            previous = next((v for v in classes if v["raw_numbers"] == rec["raw_numbers"]), None)
            if previous is None:
                classes.append(rec)
            else:
                previous["source_rows"].extend(rec["source_rows"])
        for rec in classes:
            if len(rec["source_rows"]) > 1:
                duplicate_groups.append(rec["source_rows"][:])
        if len(classes) > 1:
            group_id = str(min(r for rec in classes for r in rec["source_rows"]))
            choice = decisions.conflict_choices.get(group_id)
            candidate = next((r for r in classes if choice in r["source_rows"]), None)
            conflicts.append({"id": group_id, "epoch_utc": classes[0]["epoch_utc"],
                              "records": [{"source_rows": r["source_rows"], "elements": r["elements"]} for r in classes], "resolved": candidate is not None})
            if candidate is None:
                issue("同一时刻有冲突记录，请选择保留项或排除整组", [r for rec in classes for r in rec["source_rows"]])
                continue
            unique.append(candidate)
            notes.append(f"冲突组 {group_id}：保留源行 {choice}")
        else:
            unique.append(classes[0])
    if duplicate_groups and not decisions.deduplicate:
        issue("存在完全重复记录，请确认去重", [r for group in duplicate_groups for r in group])
    unordered = any(b["t"] < a["t"] for a, b in zip(unique, unique[1:]))
    if unordered and not decisions.sort:
        issue("时间乱序，请确认稳定排序")
    unique.sort(key=lambda r: r["t"])
    steps = np.diff([r["t"] for r in unique])
    breaks = [i+1 for i, dt in enumerate(steps) if dt > meta.max_interpolation_gap_s]
    stats = {"input_rows": len(parsed["rows"]), "valid_rows": len(converted), "output_rows": len(unique),
             "excluded_rows": len(exclusions), "empty_rows": parsed["empty_rows"], "hyperbolic_rows": sum(r["elements"]["e"]>1 for r in converted),
             "duplicate_groups": duplicate_groups, "conflict_groups": len(conflicts), "unordered": unordered,
             "start_utc": unique[0]["epoch_utc"] if unique else None, "end_utc": unique[-1]["epoch_utc"] if unique else None,
             "max_step_s": float(max(steps)) if len(steps) else 0, "gap_count": len(breaks)}
    if meta.metadata_status == "provisional":
        warnings_list.append("元数据按用户暂用假设解释，参考平面仍待核实。")
    if anomaly_mismatch:
        warnings_list.append(f"{len(anomaly_mismatch)} 行的真/平近点角与椭圆关系相差超过 0.5°（例如源行 {anomaly_mismatch[:10]}）；位置仍以真近点角为准。")
    if hyperbolic_mean:
        warnings_list.append("双曲记录含平近点角，导出约定未核实，不按椭圆周期角解释或替代真近点角。")
    report = {"ok": not problems, "issues": problems, "warnings": list(dict.fromkeys(warnings_list)), "conflicts": conflicts, "stats": stats}
    if problems:
        return report, None
    notes += [f"完全重复去重：{group}" for group in duplicate_groups]
    notes += [f"明确排除源行：{sorted(exclusions)}"] if exclusions else []
    if unordered:
        notes.append("按历元稳定排序")
    dataset = {"metadata": meta.model_dump(), "reference_tai": str(reference.isot), "time_coordinate_scale": "TAI",
               "samples": unique, "breaks": breaks, "stats": stats, "warnings": report["warnings"], "audit": notes,
               "source_sha256": parsed["sha256"], "import_request": request.model_dump()}
    return report, dataset
