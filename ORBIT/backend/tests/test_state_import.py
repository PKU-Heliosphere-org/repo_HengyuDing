import io
import json
from datetime import datetime, timedelta

import numpy as np
import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from orbit.app import app, datasets, imports
from orbit.importer import read_table, validate, input_types
from orbit.models import ImportRequest


def run(text, **options):
    parsed = read_table(text.encode(), 'state.csv')
    request = ImportRequest(metadata=options.pop('metadata', {'center':'earth'}), mapping=parsed['mapping'], **options)
    return validate(parsed, request)


def position_csv(times=(0, 2, 5), velocity=False):
    header = 'epoch,x,y,z' + (',vx,vy,vz' if velocity else '') + '\n'
    return header + '\n'.join(
        f'{(datetime(2026,1,1)+timedelta(seconds=t)).isoformat()},7000,{t*t},0' + (f',0,{2*t},0' if velocity else '')
        for t in times) + '\n'


def test_both_representations_require_choice_and_ignore_unused_numeric_columns():
    text = 't,a,e,i,om,w,ta,Position X (km),Y (km),Z (km),VX (km/sec),VY (km/sec),VZ (km/sec)\n2026-01-01T00:00:00,8000,0,0,0,0,0,7000,0,0,0,7.5,0\n'
    parsed = read_table(text.encode(), 'both.csv')
    assert input_types(parsed['mapping']) == ['elements', 'cartesian']
    report, _ = run(text)
    assert not report['ok'] and any(i['field']=='input_type' for i in report['issues'])
    report, ds = run(text, input_type='cartesian')
    assert report['ok']
    assert ds['samples'][0]['position_km'] == [7000,0,0]
    assert ds['samples'][0]['velocity_km_s'] == [0,7.5,0]
    report, ds = run(text, input_type='elements')
    assert report['ok']
    np.testing.assert_allclose(ds['samples'][0]['position_km'], [8000,0,0])
    assert 'elements' not in ds['samples'][0] and 'raw_numbers' not in ds['samples'][0]


def test_missing_velocity_needs_explicit_consent_and_nonuniform_difference_is_quadratic_exact():
    text = position_csv()
    report, _ = run(text)
    assert not report['ok'] and any('缺少速度' in i['message'] for i in report['issues'])
    report, ds = run(text, velocity_source='finite_difference')
    assert report['ok']
    np.testing.assert_allclose([s['velocity_km_s'] for s in ds['samples']], [[0,0,0],[0,4,0],[0,10,0]], atol=1e-7)
    assert ds['velocity_source'] == 'finite_difference'
    assert any('差分' in s for s in ds['audit']) and any('估计' in s for s in ds['warnings'])


def test_difference_uses_tai_across_leap_second():
    text = 'epoch,x,y,z\n2016-12-31T23:59:59,7000,0,0\n2016-12-31T23:59:60,7000,2,0\n2017-01-01T00:00:00,7000,4,0\n'
    report, ds = run(text, velocity_source='finite_difference')
    assert report['ok']
    np.testing.assert_allclose([s['velocity_km_s'] for s in ds['samples']], [[0,2,0]]*3, atol=1e-7)


def test_difference_does_not_cross_gaps_and_singleton_is_rejected():
    meta = {'center':'earth', 'max_interpolation_gap_s':10}
    report, ds = run(position_csv((0,2,100,103)), metadata=meta, velocity_source='finite_difference')
    assert report['ok'] and ds['breaks']==[2]
    np.testing.assert_allclose([s['velocity_km_s'][1] for s in ds['samples']], [2,2,203,203], atol=1e-7)
    report, ds = run(position_csv((0,2,100)), metadata=meta, velocity_source='finite_difference')
    assert not report['ok'] and ds is None
    assert any('一个采样点' in i['message'] for i in report['issues'])
    assert not run(position_csv((0,)), velocity_source='finite_difference')[0]['ok']


def test_difference_after_explicit_sort_duplicate_and_conflict_resolution():
    text = 'epoch,x,y,z\n2026-01-01T00:00:02,7000,4,0\n2026-01-01T00:00:00,7000,0,0\n2026-01-01T00:00:00,7000,0,0\n2026-01-01T00:00:02,7000,999,0\n2026-01-01T00:00:05,7000,25,0\n'
    report, _ = run(text, velocity_source='finite_difference')
    assert not report['ok'] and report['conflicts'][0]['records'][0]['elements'] is None
    report, ds = run(text, velocity_source='finite_difference', decisions={'sort':True, 'deduplicate':True, 'conflict_choices':{'2':2}})
    assert report['ok']
    np.testing.assert_allclose([s['velocity_km_s'][1] for s in ds['samples']], [0,4,10], atol=1e-7)
    assert ds['samples'][0]['source_rows']==[3,4]


@pytest.mark.parametrize('speed_unit,factor', [('km/s',1),('m/s',.001),('AU/day',149597870.7/86400),('AU/s',149597870.7)])
def test_cartesian_units_are_independent_of_position_unit(speed_unit, factor):
    text = 'epoch,x,y,z,vx,vy,vz\n2026-01-01T00:00:00,7000000,0,0,0,2,0\n'
    report, ds = run(text, metadata={'center':'earth','length_unit':'m','speed_unit':speed_unit})
    assert report['ok']
    assert ds['samples'][0]['position_km']==[7000,0,0]
    np.testing.assert_allclose(ds['samples'][0]['velocity_km_s'], [0,2*factor,0])


def test_header_units_partial_velocity_and_nonfinite_values_are_not_silently_accepted():
    text = position_csv(velocity=True).replace('vx,vy,vz', 'VX (m/s),VY (m/s),VZ (m/s)')
    assert not run(text)[0]['ok']
    assert run(text, metadata={'center':'earth','speed_unit':'m/s'})[0]['ok']
    assert not run(position_csv(velocity=True).replace('7000,', 'nan,', 1))[0]['ok']
    assert not run('epoch,x,y,z,vx\n2026-01-01T00:00:00,7000,0,0,1\n')[0]['ok']


def test_unit_suffix_aliases_and_ambiguous_headers():
    text = 'time,x_km,y_km,z_km,vx_m_s,vy_m_s,vz_m_s\n2026-01-01T00:00:00,7000,0,0,0,7500,0\n'
    assert not run(text)[0]['ok']
    report, ds = run(text, metadata={'center':'earth','speed_unit':'m/s'})
    assert report['ok'] and ds['samples'][0]['velocity_km_s']==[0,7.5,0]
    parsed = read_table(b'epoch,Position X (km),Position X (m),y,z\n2026-01-01T00:00:00,1,2,0,0\n','ambiguous.csv')
    assert 'x' not in parsed['mapping']


@pytest.mark.parametrize('differentiate', [False, True])
def test_xlsx_api_and_project_roundtrip_rebuilds_identical_vectors(differentiate):
    datasets.clear(); imports.clear()
    client = TestClient(app)
    book = Workbook()
    sheet = book.active
    sheet.append(['epoch','x','y','z'] + ([] if differentiate else ['vx','vy','vz']))
    for t in [0,2,5]:
        sheet.append([datetime(2026,1,1)+timedelta(seconds=t),7000,t*t,0]+([] if differentiate else [0,2*t,0]))
    content = io.BytesIO(); book.save(content)
    inspected = client.post('/api/v1/imports/inspect', files={'file':('state.xlsx',content.getvalue())}).json()
    assert inspected['input_types']==['cartesian']
    body = {'metadata':{'center':'earth','frame':'ECLIPJ2000'}, 'mapping':inspected['mapping'], 'velocity_source':'finite_difference' if differentiate else 'provided'}
    committed = client.post('/api/v1/imports/'+inspected['id']+'/commit', json=body)
    assert committed.status_code==200, committed.text
    ds = committed.json()
    layer = {'id':'l', 'dataset_id':ds['id'],'kind':'dataset','name':'state','color':'#69caca','visible':True,'showTrack':True,'showTrail':True,'showLabel':True}
    state = {'layers':[layer], 'selected':'l', 'clock':{'base_tai':ds['reference_tai'],'time':0,'speed':60},'axes':False,'grid':True,'radius_km':1e8,'trail_s':86400}
    project = client.post('/api/v1/projects/export',json={'dataset_ids':[ds['id']], 'state':state}).json()
    stored = project['datasets'][0]['import_request']
    assert stored['input_type']=='cartesian' and stored['velocity_source']==body['velocity_source']
    opened = client.post('/api/v1/projects/import',files={'file':('state.orbit.json',json.dumps(project).encode())})
    assert opened.status_code==200, opened.text
    assert opened.json()['datasets'][0]['samples']==ds['samples']
    datasets.clear(); imports.clear()
