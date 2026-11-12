"""Bounded table reading and opt-in time selection; source bytes are read-only."""
import csv
import hashlib
import io
import math
from contextlib import contextmanager, ExitStack
from datetime import date, datetime
from pathlib import Path
from zipfile import ZipFile, BadZipFile
from xml.etree.ElementTree import ParseError

import numpy as np
from astropy.time import Time
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException

from . import importer
from .models import ImportSelection

MAX_SOURCE_BYTES = 200 * 1024 * 1024
MAX_SOURCE_ROWS = 1_000_000
MAX_UNPACKED_BYTES = 512 * 1024 * 1024
CHUNK_ROWS = 4096


class ReadCancelled(Exception):
    pass


def check_cancelled(cancelled):
    if cancelled is not None and cancelled():
        raise ReadCancelled()


@contextmanager
def source_rows(raw, filename, worksheet, discover, cancelled=None):
    check_cancelled(cancelled)
    suffix = Path(filename).suffix.lower()
    if suffix not in {'.csv', '.xlsx', ''}:
        raise importer.ImportProblem('仅支持 CSV 和 XLSX 文件；旧版 XLS 请先另存为 XLSX')
    if suffix != '.xlsx':
        if worksheet is not None:
            raise importer.ImportProblem('CSV 不包含工作表')
        if b'\x00' in raw:
            raise importer.ImportProblem('文件包含空字节，不是有效文本 CSV')
        with io.TextIOWrapper(io.BytesIO(raw), encoding='utf-8-sig', newline='') as stream:
            reader = csv.reader(stream, strict=True)
            def csv_rows():
                for row in reader:
                    yield reader.line_num, [value.strip() for value in row]
            yield {'source_format':'csv', 'worksheet':None, 'worksheets':[], 'estimated_rows':None}, csv_rows()
        return
    with ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(e.file_size for e in entries) > MAX_UNPACKED_BYTES:
            raise importer.ImportProblem('XLSX 解压内容超过 512 MiB 源文件处理上限', 'file_too_large', status=413)
    with ExitStack() as resources:
        book = load_workbook(io.BytesIO(raw), read_only=True, data_only=False, keep_links=False)
        resources.callback(book.close)
        names = [s.title for s in book.worksheets]
        if not names:
            raise importer.ImportProblem('XLSX 没有可读取的工作表')
        if worksheet is None:
            if len(names) > 1:
                if discover:
                    yield {'requires_worksheet':True, 'worksheets':names, 'source_format':'xlsx'}, iter(())
                    return
                raise importer.ImportProblem('XLSX 含多个工作表，请明确选择工作表')
            worksheet = names[0]
        if worksheet not in names:
            raise importer.ImportProblem('所选 XLSX 工作表不存在')
        sheet = book[worksheet]
        if (sheet.max_column or 0) > 256:
            raise importer.ImportProblem('工作表超过 256 列', 'too_many_columns', status=413)
        estimated = max(0, sheet.max_row-1) if sheet.max_row else None
        sheet.reset_dimensions()
        info = {'source_format':'xlsx', 'worksheet':worksheet, 'worksheets':names,
                'estimated_rows':estimated, 'formula_count':0}
        def excel_rows():
            cached_rows = None
            for line, cells in enumerate(sheet.iter_rows(), 1):
                if len(cells) > 256:
                    raise importer.ImportProblem('工作表超过 256 列', 'too_many_columns', status=413)
                if line > 1_050_000:
                    raise importer.ImportProblem('工作表物理行数超过源文件处理上限', 'too_many_rows', status=413)
                if cached_rows is None and any(c.data_type == 'f' for c in cells):
                    cached = load_workbook(io.BytesIO(raw), read_only=True, data_only=True, keep_links=False)
                    resources.callback(cached.close)
                    cached[worksheet].reset_dimensions()
                    cached_rows = iter(cached[worksheet].iter_rows())
                    for _ in range(line):
                        if _ % 128 == 0:
                            check_cancelled(cancelled)
                        cache = next(cached_rows, ())
                elif cached_rows is not None:
                    cache = next(cached_rows, ())
                else:
                    cache = cells
                strings = []
                for cell, saved in zip(cells, cache):
                    value = cell.value
                    if cell.data_type == 'f':
                        info['formula_count'] += 1
                        value = saved.value
                        if value is None:
                            raise importer.ImportProblem(f'工作表 {worksheet} 的 {cell.coordinate} 公式没有缓存结果；请在 Excel 中重新计算并保存，或粘贴为值', details=[{'source_rows':[line]}])
                    if cell.data_type == 'e' or saved.data_type == 'e':
                        raise importer.ImportProblem(f'工作表 {worksheet} 的 {cell.coordinate} 包含 Excel 错误值', details=[{'source_rows':[line]}])
                    if isinstance(value, datetime):
                        value = value.isoformat()
                    elif isinstance(value, date):
                        value = value.isoformat()+'T00:00:00'
                    strings.append('' if value is None else str(value).strip())
                yield line, strings
        yield info, excel_rows()


class SelectedRows:
    def __init__(self, headers, selection):
        self.headers, self.selection = headers, selection
        self.rows, self.buckets = [], {}
        self.count, self.bytes, self.overflow = 0, self.row_bytes(headers), False
        self.preview = []
        self.anchor = None
        self.lower = self.bound(selection.start) if selection and selection.start else None
        self.upper = self.bound(selection.end) if selection and selection.end else None
        if self.lower is not None and self.upper is not None and self.lower > self.upper:
            raise importer.ImportProblem('起始时间不能晚于结束时间')
        if selection and selection.epoch_column not in headers:
            raise importer.ImportProblem('筛选时间列不存在，请选择正确的时间列')

    def bound(self, value):
        try:
            return Time(importer.epoch_string(value, self.selection.time_scale), format='isot', scale=self.selection.time_scale.lower())
        except ValueError as exc:
            raise importer.ImportProblem('筛选时间无效：'+str(exc)) from exc

    @staticmethod
    def row_bytes(values):
        stream = io.StringIO(newline='')
        csv.writer(stream).writerow(values)
        return len(stream.getvalue().encode('utf-8'))

    def append(self, row, bucket=None, clock=None):
        if self.overflow:
            return
        size = self.row_bytes(row['values'].values())
        if bucket is not None:
            previous = self.buckets.get(bucket)
            if previous is not None:
                if clock > previous[0]+1e-7:
                    return
                if clock < previous[0]-1e-7:
                    self.count -= len(previous[1])
                    self.bytes -= previous[2]
                    previous = None
            if previous is None:
                self.buckets[bucket] = [clock, [row], size]
            else:
                previous[1].append(row)
                previous[2] += size
        else:
            self.rows.append(row)
        self.count += 1
        self.bytes += size
        if len(self.preview) < 5:
            self.preview.append(row)
        if self.count > importer.MAX_ROWS or self.bytes > importer.MAX_BYTES:
            self.overflow = True
            self.rows.clear()
            self.buckets.clear()

    def feed(self, batch):
        if not self.selection:
            for row in batch:
                self.append(row)
            return
        values = [row['values'][self.selection.epoch_column] for row in batch]
        try:
            strings = [importer.epoch_string(v, self.selection.time_scale) for v in values]
            times = Time(strings, format='isot', scale=self.selection.time_scale.lower(), precision=9)
        except ValueError as exc:
            for row, value in zip(batch, values):
                try:
                    self.bound(value)
                except importer.ImportProblem as problem:
                    raise importer.ImportProblem('筛选所需时间无法解析，请修正时间列或原始数据副本：'+problem.message,
                                                 details=[{'source_rows':[row['source_row']]}]) from exc
            raise importer.ImportProblem('筛选时间无法解析') from exc
        mask = np.ones(len(batch), dtype=bool)
        if self.lower is not None:
            mask &= times >= self.lower
        if self.upper is not None:
            mask &= times <= self.upper
        selected = np.flatnonzero(mask)
        if not len(selected):
            return
        if self.selection.interval_s and self.anchor is None:
            # Align to requested start, otherwise midnight in the declared time scale.
            self.anchor = self.lower if self.lower is not None else self.bound(strings[int(selected[0])][:10]+'T00:00:00')
        clocks = (times.tai-self.anchor.tai).to_value('sec') if self.anchor is not None else None
        for index in selected:
            clock = float(clocks[index]) if clocks is not None else None
            bucket = math.floor((clock+1e-7)/self.selection.interval_s) if clocks is not None else None
            self.append(batch[index], bucket, clock)

    def result(self):
        if self.overflow:
            return self.preview
        if self.selection and self.selection.interval_s:
            return sorted([r for _, rows, _ in self.buckets.values() for r in rows], key=lambda r:r['source_row'])
        return self.rows


def read(raw, filename, worksheet=None, discover=False, selection=None, allow_reduction=False,
         progress=None, cancelled=None):
    check_cancelled(cancelled)
    if len(raw) > MAX_SOURCE_BYTES:
        raise importer.ImportProblem('源文件超过 200 MiB 处理上限', 'file_too_large', status=413)
    if selection is not None and not isinstance(selection, ImportSelection):
        selection = ImportSelection.model_validate(selection)
    oversized = len(raw) > importer.MAX_BYTES
    if oversized and not allow_reduction and selection is None:
        raise importer.ImportProblem('文件超过 20 MiB，请先选择时间范围或降低采样频率', 'file_too_large', status=413)
    try:
        counted_total = None
        if progress and Path(filename).suffix.lower() in {'.csv', ''}:
            progress(0, None, False, 'counting')
            # CSV has no worksheet dimension. Count logical, nonempty records accurately.
            counted_total = -1
            with source_rows(raw, filename, worksheet, False, cancelled) as (_, counter):
                for _, values in counter:
                    check_cancelled(cancelled)
                    if values and any(values):
                        counted_total += 1
                        if counted_total > MAX_SOURCE_ROWS:
                            raise importer.ImportProblem('源文件超过 1,000,000 条数据处理上限', 'too_many_rows', status=413)
        with source_rows(raw, filename, worksheet, discover, cancelled) as (info, iterator):
            if info.get('requires_worksheet'):
                return info
            pending = oversized and selection is None
            if allow_reduction and selection is None and (info.get('estimated_rows') or 0) > importer.MAX_ROWS:
                pending = True
            headers, batch, empty, total, complete = None, [], 0, 0, True
            collector = None
            expected = counted_total if counted_total is not None else info.get('estimated_rows')
            if progress:
                progress(0, expected, counted_total is not None, 'reading')
            for line, values in iterator:
                check_cancelled(cancelled)
                if not values or not any(values):
                    empty += 1
                    continue
                if headers is None:
                    if info['source_format'] == 'xlsx':
                        while values and not values[-1]:
                            values.pop()
                    headers = values
                    if any(not value for value in headers) or len(set(headers)) != len(headers):
                        raise importer.ImportProblem('表头为空或存在重复列名', details=[{'source_rows':[line]}])
                    collector = SelectedRows(headers, selection)
                    continue
                if info['source_format'] == 'csv' and len(values) != len(headers):
                    raise importer.ImportProblem('CSV 列数不一致', details=[{'source_rows':[line]}])
                if any(values[len(headers):]):
                    raise importer.ImportProblem('工作表存在没有表头的数据列', details=[{'source_rows':[line]}])
                values = (values+['']*len(headers))[:len(headers)]
                total += 1
                if progress and total % 1024 == 0:
                    progress(total, max(expected, total) if expected is not None else None,
                             counted_total is not None, 'reading')
                if total > MAX_SOURCE_ROWS:
                    raise importer.ImportProblem('源文件超过 1,000,000 条数据处理上限', 'too_many_rows', status=413)
                row = {'source_row':line, 'values':dict(zip(headers, values))}
                if pending:
                    collector.append(row)
                    if total >= 5:
                        complete = False
                        break
                else:
                    batch.append(row)
                    if len(batch) >= CHUNK_ROWS:
                        collector.feed(batch)
                        batch = []
                        if collector.overflow and selection is None and allow_reduction:
                            pending, complete = True, False
                            break
                        if collector.overflow and not allow_reduction:
                            raise importer.ImportProblem('导入结果超过 100,000 条或 20 MiB，请缩短时间范围或增大采样间隔', 'too_many_rows', status=413)
            if headers is None or not total:
                raise importer.ImportProblem('文件没有数据行')
            if batch:
                check_cancelled(cancelled)
                collector.feed(batch)
            check_cancelled(cancelled)
            if progress:
                progress(total, total if complete else expected, complete, 'processing')
            pending = pending or collector.overflow
            if pending and not allow_reduction:
                raise importer.ImportProblem('导入结果超过 100,000 条或 20 MiB，请缩短时间范围或增大采样间隔', 'too_many_rows', status=413)
            rows = collector.result()
            if not rows and not pending:
                raise importer.ImportProblem('所选时间范围内没有数据，请调整范围')
            notes = [f"XLSX 工作表：{info['worksheet']}"] if info['source_format']=='xlsx' else []
            warning = []
            if info.get('formula_count'):
                warning.append(f"使用 {info['formula_count']} 个 Excel 公式缓存结果，未重新计算公式；请确认源文件已重新计算并保存。")
            if selection and not pending:
                notes.append(f"导入副本筛选：原始 {total} 条，保留 {len(rows)} 条；时间列 {selection.epoch_column}，{selection.time_scale}，范围 [{selection.start or '不限'}, {selection.end or '不限'}]，采样间隔 {selection.interval_s or '原始'} s；原文件未修改。")
                if selection.interval_s:
                    warning.append('已降低时间分辨率：每个时间桶保留最早时刻的原始记录及其同刻冲突记录，不插值或平均；未指定起点时按首条符合范围记录所在日期的零点对齐。')
            check_cancelled(cancelled)
            return {**info, 'headers':headers, 'rows':rows, 'mapping':importer.detect_mapping(headers),
                    'empty_rows':empty, 'sha256':hashlib.sha256(raw).hexdigest(),
                    'requires_reduction':pending, 'source_input_rows':total if complete else info.get('estimated_rows'),
                    'source_count_exact':complete, 'source_scanned_rows':total, 'retained_bytes':collector.bytes,
                    'source_bytes':len(raw), 'selection':selection.model_dump() if selection else None,
                    'warnings':warning, 'audit':notes}
    except UnicodeDecodeError as exc:
        raise importer.ImportProblem('请将 CSV 转为 UTF-8 编码') from exc
    except (csv.Error, BadZipFile, ValueError, KeyError, OSError, TypeError, EOFError, ParseError, InvalidFileException) as exc:
        raise importer.ImportProblem('无法读取 XLSX 或 CSV；请确认文件完整、未加密且内容有效', 'invalid_workbook') from exc
