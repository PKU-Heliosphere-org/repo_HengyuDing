import math
import re
import warnings
from collections import defaultdict

import numpy as np
from astropy.time import Time
from astropy.utils import iers

from .mechanics import AU_KM, state
from .models import FIELDS, STATE_FIELDS, ImportRequest

iers.conf.auto_download = False
MAX_BYTES = 20 * 1024 * 1024
MAX_ROWS = 100000
NUMERIC = FIELDS[1:]


def detect_mapping(headers):
    """Only unambiguous header aliases; never infer axes or units from numbers."""
    aliases = {
        'epoch': ['epoch', 't', 'time', 'time (utcg)', 'datetime', 'utc'],
        'a': ['a', 'semi-major axis'], 'e': ['e', 'eccentricity'],
        'i': ['i', 'inclination'], 'raan': ['raan', 'om', 'omega', 'ascending node'],
        'arg_periapsis': ['arg_periapsis', 'w', 'arg of perigee', 'argument of periapsis'],
        'true_anomaly': ['true_anomaly', 'ta', 'true anomaly'],
        'mean_anomaly': ['mean_anomaly', 'ma', 'mean anomaly'],
    }
    for axis in 'xyz':
        aliases[axis] = [axis, 'position '+axis, 'position_'+axis, axis+' position']
        aliases['v'+axis] = ['v'+axis, 'v_'+axis, 'velocity '+axis, 'velocity_'+axis, axis+' velocity', axis+'dot']
    def normalize(s):
        s = re.sub(r'\([^)]*\)|\[[^]]*\]', '', s.lower()).strip()
        s = re.sub(r'_(?:km|m|au)(?:_(?:s|day))?$|_(?:deg|rad)$', '', s)
        return re.sub(r'\s+', ' ', s)
    result = {}
    for field, names in aliases.items():
        exact = [h for h in headers if h.lower() == field]
        candidates = exact or [h for h in headers if normalize(h) in names]
        if len(candidates) == 1:
            result[field] = candidates[0]
    return result


def input_types(mapping):
    return (["elements"] if all(mapping.get(f) for f in NUMERIC[:6]) else []) + (
        ["cartesian"] if all(mapping.get(f) for f in STATE_FIELDS[:3]) else [])


def header_unit(column):
    match = re.search(r'[\[(]\s*(km/sec|km/s|m/sec|m/s|au/day|au/s|km|au|m|deg|rad)\s*[\])]', column.lower())
    if match:
        return match.group(1).replace('/sec', '/s')
    suffix = re.search(r'_(km_s|m_s|au_day|au_s|km|m|au|deg|rad)$', column.lower())
    return suffix.group(1).replace('_', '/') if suffix else None


class ImportProblem(Exception):
    def __init__(self, message, code="invalid_input", details=None, status=422):
        super().__init__(message)
        self.message, self.code, self.details, self.status = message, code, details or [], status


def read_csv(raw):
    return read_table(raw, 'orbit.csv')


def read_table(raw, filename, worksheet=None, discover=False, selection=None, allow_reduction=False,
               progress=None, cancelled=None):
    from .table_reader import read
    return read(raw, filename, worksheet, discover, selection, allow_reduction, progress, cancelled)


def read_xlsx(raw, worksheet=None, discover=False):
    return read_table(raw, 'orbit.xlsx', worksheet, discover)


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

    if parsed.get('requires_reduction'):
        return {'ok':False, 'issues':[{'message':'超过导入容量，请先选择时间范围或降低采样频率并应用处理', 'source_rows':[]}],
                'warnings':[], 'conflicts':[], 'stats':{'input_rows':parsed.get('source_input_rows')}}, None
    selection = parsed.get('selection')
    if selection and (mapping.get('epoch') != selection['epoch_column'] or meta.time_scale != selection['time_scale']):
        issue('时间列或时间体系已改变，请重新应用时间范围和采样设置')
    if request.selection is not None and request.selection.model_dump() != selection:
        issue('导入筛选设置与实际处理结果不同，请重新应用处理')

    candidates = input_types(mapping)
    kind = request.input_type or (candidates[0] if len(candidates) == 1 else 'elements')
    if request.input_type is None and len(candidates) > 1:
        issue("同时存在六根数和空间坐标，请选择使用的数据类型", field='input_type')
    generate = kind == 'cartesian' and request.velocity_source == 'finite_difference'
    active = NUMERIC if kind == 'elements' else (STATE_FIELDS[:3] if generate else STATE_FIELDS)
    required = (NUMERIC[:6] if kind == 'elements' else active) + (["epoch"] if meta.epoch_mode == "per_row" else [])
    for field in required:
        if not mapping.get(field) or mapping[field] not in parsed["headers"]:
            issue("缺少速度分量；请补充映射，或明确选择差分生成速度" if field in STATE_FIELDS[3:] else "缺少必需列映射", field=field)
    used = [v for k, v in mapping.items() if v and k in [*active, 'epoch']]
    if len(set(used)) != len(used):
        issue("一个源列不能映射到多个字段")
    if any(k not in [*FIELDS, *STATE_FIELDS] or (v and v not in parsed["headers"]) for k, v in mapping.items()):
        issue("存在未知的字段或源列映射")
    if meta.epoch_mode == "single" and (len(parsed["rows"]) != 1 or mapping.get("epoch")):
        issue("单历元模式只适用于一条记录且未映射时间列的文件")
    for field, column in mapping.items():
        if not column or field not in active:
            continue
        unit = header_unit(column)
        expected = meta.speed_unit if field in STATE_FIELDS[3:] else (
            meta.length_unit.lower() if field in ['a', *STATE_FIELDS[:3]] else meta.angle_unit)
        mismatch = unit is not None and field != 'e' and unit != expected.lower()
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
            raw_numbers = {f: float(values[mapping[f]]) for f in active if mapping.get(f)}
            if not all(math.isfinite(v) for v in raw_numbers.values()):
                raise ValueError("输入数值不可包含 NaN 或 Infinity")
            length_factor = {'km': 1, 'm': .001, 'AU': AU_KM}[meta.length_unit]
            elements = None
            if kind == 'elements':
                a = raw_numbers["a"] * length_factor
                factor = math.pi/180 if meta.angle_unit == "deg" else 1
                x = [a, raw_numbers["e"], *[raw_numbers[f]*factor for f in NUMERIC[2:6]]]
                position, velocity = state(x, meta.mu_km3_s2)
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
            else:
                position = np.array([raw_numbers[f]*length_factor for f in STATE_FIELDS[:3]])
                speed_factor = {'km/s':1, 'm/s':.001, 'AU/day':AU_KM/86400, 'AU/s':AU_KM}[meta.speed_unit]
                velocity = None if generate else np.array([raw_numbers[f]*speed_factor for f in STATE_FIELDS[3:]])
                if not np.isfinite(position).all() or (velocity is not None and not np.isfinite(velocity).all()):
                    raise ValueError("位置或速度单位换算溢出")
            epoch = epoch_string(values[mapping["epoch"]] if meta.epoch_mode == "per_row" else meta.single_epoch, meta.time_scale)
            converted.append({"source_rows": [line], "elements": elements, "position_km": position.tolist(),
                              "velocity_km_s": None if velocity is None else velocity.tolist(), "raw_numbers": raw_numbers})
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
                              "records": [{k:r[k] for k in ['source_rows', 'elements', 'position_km', 'velocity_km_s']} for r in classes], "resolved": candidate is not None})
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
    if generate and not problems:
        boundaries = [0, *breaks, len(unique)]
        for left, right in zip(boundaries, boundaries[1:]):
            segment = unique[left:right]
            if len(segment) < 2:
                issue("连续片段只有一个采样点，无法差分生成速度；请补充速度或调整数据缺口设置", segment[0]['source_rows'])
                continue
            positions = np.array([s['position_km'] for s in segment])
            clock = np.array([s['t'] for s in segment])
            with np.errstate(over='ignore', invalid='ignore', divide='ignore'):
                velocities = np.gradient(positions, clock, axis=0, edge_order=2 if len(segment) >= 3 else 1)
            if not np.isfinite(velocities).all():
                issue("差分速度计算溢出，请检查采样间隔和坐标数值")
                continue
            for rec, velocity in zip(segment, velocities):
                rec['velocity_km_s'] = velocity.tolist()
        notes.append("用户明确选择差分生成速度：按 TAI 实际秒数，非等间隔三点差分，端点单边差分；两点片段使用割线，不跨越数据缺口。")
        warnings_list.append("速度由位置数值差分估计，误差取决于采样间隔和位置精度，不等同于原始星历速度；未进行轨道传播。")
    def hyperbolic(rec):
        r = np.linalg.norm(rec['position_km'])
        v = rec['velocity_km_s']
        return bool(v is not None and r > 0 and float(np.dot(v, v))*r > 2*meta.mu_km3_s2)
    stats = {"input_rows": len(parsed["rows"]), "valid_rows": len(converted), "output_rows": len(unique),
             "excluded_rows": len(exclusions), "empty_rows": parsed["empty_rows"], "hyperbolic_rows": sum(hyperbolic(r) for r in converted),
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
    samples = [{k:v for k,v in rec.items() if k not in {'elements', 'raw_numbers'}} for rec in unique]
    resolved_request = request.model_dump()
    resolved_request['input_type'] = kind
    resolved_request['selection'] = selection
    dataset = {"metadata": meta.model_dump(), "reference_tai": str(reference.isot), "time_coordinate_scale": "TAI",
               "samples": samples, "breaks": breaks, "stats": stats, "warnings": report["warnings"], "audit": notes,
               "input_type":kind, "velocity_source":request.velocity_source if kind == 'cartesian' else 'elements',
               "source_sha256": parsed["sha256"], "import_request": resolved_request}
    return report, dataset
