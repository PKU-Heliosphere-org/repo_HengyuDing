"""Read uploaded SPK kernels under the shared CSPICE lock; unload and remove after use."""
from contextlib import contextmanager
import hashlib
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from typing import Literal

import numpy as np
import spiceypy as spice
from astropy.time import Time
from pydantic import Field

from . import planets
from .importer import ImportProblem, read_table, validate
from .models import ImportRequest, Metadata, StrictModel
from .table_reader import MAX_SOURCE_BYTES

ROOT = Path(__file__).resolve().parents[3]


class SpkRequest(StrictModel):
    target_id: int
    object_name: str = Field(min_length=1, max_length=120)
    center: Literal['sun', 'earth'] = 'sun'
    frame: Literal['J2000', 'ECLIPJ2000'] = 'J2000'
    start_tdb: str = Field(max_length=40)
    end_tdb: str = Field(max_length=40)
    step_s: float = Field(default=3600, ge=1, le=86400)


@contextmanager
def kernel_file(raw):
    if not raw or len(raw) > MAX_SOURCE_BYTES:
        raise ImportProblem('SPK 文件为空或超过 200 MiB', 'file_too_large')
    cache = ROOT / '.cache' / 'spk-import'
    cache.mkdir(parents=True, exist_ok=True)
    with planets.LOCK, TemporaryDirectory(dir=cache) as directory:
        path = Path(directory) / 'source.bsp'
        path.write_bytes(raw)
        try:
            if spice.getfat(str(path)) != ('DAF', 'SPK'):
                raise ImportProblem('文件不是有效的二进制 SPK 星历', 'invalid_spk')
            yield str(path)
        except spice.utils.exceptions.SpiceyError as exc:
            raise ImportProblem('无法读取 SPK 星历；请检查文件、覆盖范围和所需参考内核。' +
                                str(getattr(exc, 'short', '')), 'spk_error') from exc


def et_time(et):
    return Time(2451545.0, float(et) / 86400, format='jd', scale='tdb', precision=9)


def inspect_path(path):
    handle = spice.dafopr(path)
    segments, names = [], {}
    try:
        spice.dafbfs(handle)
        while spice.daffna():
            bounds, values = spice.dafus(spice.dafgs(), 2, 6)
            target, center, frame, kind = map(int, values[:4])
            segments.append({'target_id': target, 'center_id': center, 'frame_id': frame,
                             'frame': spice.frmnam(frame) or str(frame), 'type': kind})
            if len(segments) > 10000:
                raise ImportProblem('SPK 分段过多（最多 10000）', 'capacity')
        # Display names only; comments are data, never instructions or executable content.
        pending = None
        for _ in range(100):
            count, lines, done = spice.dafec(handle, 100, 1024)
            for line in lines[:count]:
                if line.startswith('Target body'):
                    pending = line.split(':', 1)[-1].split('{', 1)[0].strip()[:120]
                if line.startswith('Target SPK ID') and pending:
                    match = re.search(r':\s*(-?\d+)', line)
                    if match:
                        names[int(match[1])] = pending
                        pending = None
            if done:
                break
    finally:
        spice.dafcls(handle)
    targets = []
    ids = list(spice.spkobj(path))
    if not ids or len(ids) > 64:
        raise ImportProblem('SPK 无目标或超过 64 个目标', 'invalid_spk')
    for target in ids:
        target = int(target)
        coverage = spice.spkcov(path, target)
        intervals = []
        for i in range(spice.wncard(coverage)):
            first, last = spice.wnfetd(coverage, i)
            intervals.append({'start_et': first, 'end_et': last,
                              'start_tdb': str(et_time(first).isot), 'end_tdb': str(et_time(last).isot),
                              'start_utc': str(et_time(first).utc.isot), 'end_utc': str(et_time(last).utc.isot)})
        targets.append({'id': target, 'name': names.get(target, f'SPK {target}'),
                        'coverage': intervals, 'segments': [s for s in segments if s['target_id'] == target]})
    return {'source_format': 'bsp', 'targets': targets, 'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest()}


def inspect(raw):
    with kernel_file(raw) as path:
        return inspect_path(path)


def build_dataset(raw, request: SpkRequest):
    with kernel_file(raw) as path:
        info = inspect_path(path)
        target = next((t for t in info['targets'] if t['id'] == request.target_id), None)
        if target is None:
            raise ImportProblem('所选目标不在 SPK 文件中', 'spk_target')
        try:
            start = Time(request.start_tdb, format='isot', scale='tdb', precision=9)
            end = Time(request.end_tdb, format='isot', scale='tdb', precision=9)
            first, last = float(planets.tai_seconds(start)), float(planets.tai_seconds(end))
        except ValueError as exc:
            raise ImportProblem('请填写有效的 TDB 起止时间', 'spk_range') from exc
        if last <= first:
            raise ImportProblem('结束时间必须晚于开始时间', 'spk_range')
        intervals = target['coverage']
        # Require one continuous coverage interval; never bridge missing ephemerides.
        interval = next((i for i in intervals if first >= i['start_et']-1e-6 and last <= i['end_et']+1e-6), None)
        if interval is None:
            raise ImportProblem('导入范围必须位于同一个 SPK 连续覆盖区间内', 'spk_range')
        first, last = max(first, interval['start_et']), min(last, interval['end_et'])
        count = int(np.ceil((last-first)/request.step_s))+1
        if count > 100000:
            raise ImportProblem('采样超过 100000 点，请缩小时间范围或增大采样间隔', 'capacity')
        if any(s['type'] in {102, 103, 120} for s in target['segments']):
            raise ImportProblem('暂不支持 TCB 时间体系的 SPK，请使用 Horizons TDB SPK', 'spk_time_scale')
        observer = 10 if request.center == 'sun' else 399
        if request.target_id == observer:
            raise ImportProblem('目标与场景中心相同，请选择其他中心', 'spk_target')
        # Standard Horizons small-body kernels are heliocentric: no planetary kernel is needed
        # for a heliocentric output. Other origins require an explicit reference ephemeris.
        if any(s['center_id'] != observer for s in target['segments']):
            planets.load_kernels()
        et = np.linspace(first, last, count)
        handle = spice.spklef(path)
        try:
            states = np.array([spice.spkez(request.target_id, float(t), request.frame, 'NONE', observer)[0] for t in et])
        finally:
            spice.spkuef(handle)
        if not np.isfinite(states).all():
            raise ImportProblem('SPK 产生了非有限状态向量', 'spk_error')
        epochs = Time(2451545.0, et/86400, format='jd', scale='tdb', precision=9).isot
        lines = ['epoch,x,y,z,vx,vy,vz']
        lines.extend(str(epoch)+','+','.join(format(float(v), '.17g') for v in state)
                     for epoch, state in zip(epochs, states))
        parsed = read_table(('\n'.join(lines)+'\n').encode(), 'spk-samples.csv')
        metadata = Metadata(object_name=request.object_name, center=request.center, frame=request.frame,
                            time_scale='TDB', metadata_status='verified',
                            metadata_notes='SPK/SPICE 几何状态；NONE（无光行时与像差）。输出中心及参考系经显式选择。',
                            max_interpolation_gap_s=request.step_s*1.01)
        req = ImportRequest(metadata=metadata, mapping={k:k for k in ['epoch','x','y','z','vx','vy','vz']}, input_type='cartesian')
        report, dataset = validate(parsed, req)
        if not report['ok']:
            raise ImportProblem('SPK 采样未通过校验', 'invalid_spk', report['issues'])
        dataset.update(source_format='bsp', worksheet=None, source_sha256=info['sha256'],
                       import_request={'spk': request.model_dump()}, spk={'target_id':request.target_id, 'segments':target['segments'],
                       'start_tdb':request.start_tdb, 'end_tdb':request.end_tdb, 'step_s':request.step_s})
        dataset['audit'].append(f'SPK 目标 {request.target_id}；SPICE NONE；{request.center}/{request.frame}；TDB 采样 {count} 点，最大间隔 {request.step_s:g} 秒。')
        dataset['audit'].append('SPK 无表格源行；采样记录中的 source_rows 为生成采样表的序号。')
        dataset['warnings'].append('SPK 已按所选间隔采样；播放时在采样点之间做显示插值，不代表每帧重新计算 SPICE。')
        if observer != 10 or any(s['center_id'] != 10 for s in target['segments']):
            dataset['warnings'].append('中心转换使用本地 DE440s；若源 SPK 基于其他行星星历，其差异会保留。')
        return dataset
