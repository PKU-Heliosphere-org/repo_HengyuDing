from datetime import datetime
from io import BytesIO
import json
from zipfile import ZipFile
from xml.etree import ElementTree as ET

import numpy as np
from openpyxl import Workbook
from openpyxl.utils.datetime import CALENDAR_MAC_1904
from fastapi.testclient import TestClient
import pytest

from orbit.app import app, imports, datasets
from orbit import importer
from orbit.importer import ImportProblem, read_csv, read_table, validate
from orbit.models import ImportRequest

HEADERS = ['epoch','a','e','i','raan','arg_periapsis','true_anomaly']


@pytest.fixture(autouse=True)
def clean_workspace():
    imports.clear(); datasets.clear()
    yield
    imports.clear(); datasets.clear()


def workbook_bytes(multi=False, mac=False, leading=False):
    book=Workbook()
    if mac:
        book.epoch=CALENDAR_MAC_1904
    sheet=book.active
    sheet.title='轨道数据'
    if leading:
        sheet.append([])
    sheet.append(HEADERS)
    sheet.append([datetime(2026,1,1),7000,0.1,30,10,20,0])
    sheet.append(['2026-01-01T00:01:00Z',7000,0.1,30,10,20,10])
    if multi:
        book.create_sheet('空表',0)
    out=BytesIO();book.save(out);book.close()
    return out.getvalue()


def rewrite_sheet(raw, transform):
    result=BytesIO()
    with ZipFile(BytesIO(raw)) as old, ZipFile(result,'w') as new:
        for name in old.namelist():
            content=old.read(name)
            if name=='xl/worksheets/sheet1.xml':
                root=ET.fromstring(content)
                transform(root)
                content=ET.tostring(root)
            new.writestr(name,content)
    return result.getvalue()


@pytest.mark.parametrize('mac',[False,True])
def test_native_excel_dates_and_numbers_match_csv_and_preserve_sheet_rows(mac):
    parsed=read_table(workbook_bytes(mac=mac,leading=True),'orbit.XLSX')
    assert parsed['worksheet']=='轨道数据' and parsed['source_format']=='xlsx'
    assert [r['source_row'] for r in parsed['rows']]==[3,4]
    csv=read_csv(b'epoch,a,e,i,raan,arg_periapsis,true_anomaly\n2026-01-01T00:00:00,7000,0.1,30,10,20,0\n2026-01-01T00:01:00Z,7000,0.1,30,10,20,10\n')
    req=ImportRequest(metadata={},mapping=parsed['mapping'])
    report,actual=validate(parsed,req)
    _,expected=validate(csv,req)
    assert report['ok']
    np.testing.assert_allclose([s['position_km'] for s in actual['samples']],[s['position_km'] for s in expected['samples']],atol=1e-10)
    assert [s['t'] for s in actual['samples']]==[s['t'] for s in expected['samples']]


def test_workbook_discovery_does_not_allocate_an_import_and_empty_first_sheet_is_selectable():
    client=TestClient(app)
    raw=workbook_bytes(multi=True)
    existing=set(imports)
    choice=client.post('/api/v1/imports/inspect',files={'file':('two.xlsx',raw)}).json()
    assert choice['requires_worksheet'] and choice['worksheets']==['空表','轨道数据']
    assert set(imports)==existing and 'id' not in choice
    selected=client.post('/api/v1/imports/inspect',files={'file':('two.xlsx',raw)},data={'worksheet':'轨道数据'}).json()
    assert selected['input_rows']==2 and selected['worksheet']=='轨道数据'
    assert client.post('/api/v1/imports/inspect',files={'file':('two.xlsx',raw)},data={'worksheet':'不存在'}).status_code==422
    client.delete('/api/v1/imports/'+selected['id'])


def test_xlsx_project_roundtrip_preserves_original_workbook_and_sheet():
    client=TestClient(app)
    raw=workbook_bytes(multi=True)
    inspected=client.post('/api/v1/imports/inspect',files={'file':('orbit.xlsx',raw)},data={'worksheet':'轨道数据'}).json()
    ds=client.post('/api/v1/imports/'+inspected['id']+'/commit',json={'metadata':{},'mapping':inspected['mapping']}).json()
    state={'layers':[{'id':'layer','dataset_id':ds['id'],'kind':'dataset','name':'Excel轨道','color':'#69caca','visible':True,'showTrack':True,'showTrail':True,'showLabel':True}],
           'selected':'layer','clock':{'base_tai':ds['reference_tai'],'time':0,'start':0,'end':60,'speed':1},'axes':False,'grid':True,'radius_km':1e8,'trail_s':86400}
    project=client.post('/api/v1/projects/export',json={'dataset_ids':[ds['id']],'state':state}).json()
    assert project['datasets'][0]['source_format']=='xlsx' and project['datasets'][0]['worksheet']=='轨道数据'
    restored=client.post('/api/v1/projects/import',files={'file':('orbit.orbit.json',json.dumps(project).encode())})
    assert restored.status_code==200
    assert restored.json()['datasets'][0]['samples']==ds['samples']
    assert restored.json()['datasets'][0]['source_sha256']==ds['source_sha256']
    project['datasets'][0]['worksheet']='不存在'
    assert client.post('/api/v1/projects/import',files={'file':('bad.json',json.dumps(project).encode())}).status_code==422


def test_formulas_require_cached_values_and_expose_cache_warning():
    raw=workbook_bytes()
    ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    def formula(root, cache):
        cell=root.find('.//m:c[@r="B2"]',ns)
        ET.SubElement(cell,'{'+ns['m']+'}f').text='7000'
        cell.find('m:v',ns).text=cache
    uncached=rewrite_sheet(raw,lambda root:formula(root,None))
    with pytest.raises(ImportProblem,match='B2.*公式没有缓存'):
        read_table(uncached,'formula.xlsx')
    cached=rewrite_sheet(raw,lambda root:formula(root,'7000'))
    parsed=read_table(cached,'formula.xlsx')
    report,_=validate(parsed,ImportRequest(metadata={},mapping=parsed['mapping']))
    assert report['ok'] and any('公式缓存' in s for s in report['warnings'])


def test_wrong_dimension_metadata_does_not_truncate_real_rows():
    raw=rewrite_sheet(workbook_bytes(),lambda root:root.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}dimension').set('ref','A1'))
    assert len(read_table(raw,'orbit.xlsx')['rows'])==2


def test_corrupt_and_unsupported_files_report_errors_instead_of_server_failures():
    client=TestClient(app)
    assert client.post('/api/v1/imports/inspect',files={'file':('bad.xlsx',b'not-a-workbook')}).status_code==422
    assert client.post('/api/v1/imports/inspect',files={'file':('old.xls',b'old-format')}).status_code==422
    def damage(root):
        root.find('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c[@r="B1"]/{http://schemas.openxmlformats.org/spreadsheetml/2006/main}is/{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t').text='epoch'
    with pytest.raises(ImportProblem,match='重复列名'):
        read_table(rewrite_sheet(workbook_bytes(),damage),'duplicate.xlsx')


def test_workbook_row_limit_is_applied_after_reading(monkeypatch):
    monkeypatch.setattr(importer,'MAX_ROWS',1)
    with pytest.raises(ImportProblem) as caught:
        read_table(workbook_bytes(),'large.xlsx')
    assert caught.value.status==413
