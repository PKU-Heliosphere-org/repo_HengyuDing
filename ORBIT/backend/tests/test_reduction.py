import base64
import hashlib
import io
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from orbit import importer, table_reader
from orbit.app import app, imports, datasets
from orbit.models import ImportRequest, ImportSelection

HEADER = 'epoch,x,y,z,vx,vy,vz\n'
CSV = (HEADER + ''.join(f'2026-01-01T00:0{i}:00,7000,{i},0,0,1,0\n' for i in range(6))).encode()


@pytest.fixture(autouse=True)
def clean():
    imports.clear(); datasets.clear()
    yield
    imports.clear(); datasets.clear()


def selection(**kwargs):
    return ImportSelection(epoch_column='epoch', **kwargs)


def test_row_overflow_stages_then_range_and_interval_can_be_combined(monkeypatch):
    monkeypatch.setattr(importer, 'MAX_ROWS', 2)
    initial = importer.read_table(CSV, 'data.csv', allow_reduction=True)
    assert initial['requires_reduction']
    report, ds = importer.validate(initial, ImportRequest(metadata={},mapping=initial['mapping']))
    assert not report['ok'] and ds is None
    chosen = selection(start='2026-01-01T00:01:00', end='2026-01-01T00:05:00', interval_s=180)
    parsed = importer.read_table(CSV, 'data.csv', selection=chosen)
    assert not parsed['requires_reduction'] and parsed['source_input_rows']==6
    assert [r['source_row'] for r in parsed['rows']]==[3,6]
    assert [r['values']['y'] for r in parsed['rows']]==['1','4']
    assert parsed['sha256']==hashlib.sha256(CSV).hexdigest()
    assert any('原文件未修改' in a for a in parsed['audit'])


def test_size_overflow_and_normalized_result_byte_limit(monkeypatch):
    monkeypatch.setattr(importer,'MAX_BYTES',200)
    assert len(CSV)>200
    initial = importer.read_table(CSV,'large.csv',allow_reduction=True)
    assert initial['requires_reduction']
    parsed = importer.read_table(CSV,'large.csv',selection=selection(end='2026-01-01T00:01:00'))
    assert len(parsed['rows'])==2 and parsed['retained_bytes']<=200
    assert not parsed['requires_reduction']
    too_many = importer.read_table(CSV,'large.csv',selection=selection(),allow_reduction=True)
    assert too_many['requires_reduction']


def test_unsorted_buckets_keep_earliest_and_all_conflicting_records_at_that_time():
    raw = (HEADER+'2026-01-01T00:50:00,7000,50,0,0,1,0\n'
           '2026-01-01T00:10:00,7000,10,0,0,1,0\n'
           '2026-01-01T00:10:00,7000,11,0,0,1,0\n'
           '2026-01-01T01:05:00,7000,65,0,0,1,0\n').encode()
    parsed = importer.read_table(raw,'data.csv',selection=selection(interval_s=3600))
    assert [r['source_row'] for r in parsed['rows']]==[3,4,5]
    report, _ = importer.validate(parsed,ImportRequest(metadata={},mapping=parsed['mapping']))
    assert not report['ok'] and report['stats']['conflict_groups']==1


def test_range_is_inclusive_and_uses_declared_time_scale_and_leap_seconds():
    raw = (HEADER+'2016-12-31T23:59:59,7000,0,0,0,1,0\n'
           '2016-12-31T23:59:60,7000,1,0,0,1,0\n'
           '2017-01-01T00:00:00,7000,2,0,0,1,0\n').encode()
    parsed = importer.read_table(raw,'leap.csv',selection=selection(start='2016-12-31T23:59:60',end='2017-01-01T00:00:00'))
    assert [r['source_row'] for r in parsed['rows']]==[3,4]
    parsed = importer.read_table(CSV,'tt.csv',selection=selection(time_scale='TT',start='2026-01-01T00:01:00',end='2026-01-01T00:01:00'))
    assert len(parsed['rows'])==1
    request = ImportRequest(metadata={'time_scale':'UTC'},mapping=parsed['mapping'])
    assert not importer.validate(parsed,request)[0]['ok']


def test_invalid_or_empty_ranges_and_invalid_time_column_remain_correctable():
    with pytest.raises(importer.ImportProblem, match='起始时间'):
        importer.read_table(CSV,'data.csv',selection=selection(start='2026-02-01T00:00:00',end='2026-01-01T00:00:00'))
    with pytest.raises(importer.ImportProblem, match='没有数据'):
        importer.read_table(CSV,'data.csv',selection=selection(start='2027-01-01T00:00:00'))
    with pytest.raises(importer.ImportProblem, match='时间列不存在'):
        importer.read_table(CSV,'data.csv',selection=ImportSelection(epoch_column='missing'))
    with pytest.raises(importer.ImportProblem, match='时间无法解析'):
        importer.read_table(CSV.replace(b'00:02:00',b'garbage'),'data.csv',selection=selection(interval_s=120))


def test_xlsx_dates_filter_without_modifying_source_bytes_and_preserve_physical_rows(monkeypatch, tmp_path):
    book=Workbook()
    sheet=book.active
    sheet.append([])
    sheet.append(['epoch','x','y','z','vx','vy','vz'])
    from datetime import datetime
    for i in range(6):
        sheet.append([datetime(2026,1,1,0,i),7000,i,0,0,1,0])
    stream=io.BytesIO(); book.save(stream)
    raw=stream.getvalue()
    original=tmp_path/'original.xlsx'; original.write_bytes(raw)
    before=hashlib.sha256(original.read_bytes()).hexdigest()
    monkeypatch.setattr(importer,'MAX_ROWS',2)
    initial=importer.read_table(raw,'data.xlsx',allow_reduction=True)
    assert initial['requires_reduction']
    parsed=importer.read_table(raw,'data.xlsx',selection=selection(interval_s=180))
    assert [r['source_row'] for r in parsed['rows']]==[3,6]
    assert original.read_bytes()==raw and hashlib.sha256(original.read_bytes()).hexdigest()==before


def test_api_retry_starts_from_original_and_portable_project_repeats_selection(monkeypatch):
    monkeypatch.setattr(importer,'MAX_ROWS',2)
    client=TestClient(app)
    inspected=client.post('/api/v1/imports/inspect',files={'file':('source.csv',CSV)}).json()
    assert inspected['requires_reduction']
    key=inspected['id']
    body={'metadata':{'center':'earth'},'mapping':inspected['mapping']}
    assert client.post(f'/api/v1/imports/{key}/commit',json=body).status_code==422
    # First reduction is insufficient; the user can retry without uploading again.
    insufficient=client.post(f'/api/v1/imports/{key}/reduce',json=selection(interval_s=60).model_dump()).json()
    assert insufficient['requires_reduction']
    applied=client.post(f'/api/v1/imports/{key}/reduce',json=selection(interval_s=180).model_dump()).json()
    assert not applied['requires_reduction'] and applied['input_rows']==2
    # A wider, different range must recover data not present in the preceding result.
    applied=client.post(f'/api/v1/imports/{key}/reduce',json=selection(start='2026-01-01T00:04:00').model_dump()).json()
    assert [r['source_row'] for r in applied['preview']]==[6,7]
    body['selection']=applied['selection']
    response=client.post(f'/api/v1/imports/{key}/commit',json=body)
    assert response.status_code==200, response.text
    ds=response.json()
    assert ds['samples'][0]['source_rows']==[6]
    layer={'id':'l','dataset_id':ds['id'],'kind':'dataset','name':'filtered','color':'#69caca','visible':True,'showTrack':True,'showTrail':True,'showLabel':True}
    state={'layers':[layer],'selected':'l','clock':{'base_tai':ds['reference_tai'],'time':0,'speed':60},'axes':False,'grid':True,'radius_km':1e8,'trail_s':86400}
    exported=client.post('/api/v1/projects/export',json={'dataset_ids':[ds['id']],'state':state})
    assert exported.status_code==200
    project=exported.json()
    assert base64.b64decode(project['datasets'][0]['source_base64'])==CSV
    restored=client.post('/api/v1/projects/import',files={'file':('filtered.orbit.json',json.dumps(project).encode())})
    assert restored.status_code==200,restored.text
    assert restored.json()['datasets'][0]['samples']==ds['samples']


def test_source_resource_limits_are_separate_from_result_limits(monkeypatch):
    monkeypatch.setattr(table_reader,'MAX_SOURCE_BYTES',10)
    with pytest.raises(importer.ImportProblem,match='源文件超过'):
        importer.read_table(CSV,'large.csv',allow_reduction=True)
