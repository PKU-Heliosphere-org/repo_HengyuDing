import json
from copy import deepcopy
from fastapi.testclient import TestClient
import pytest

from orbit.app import app, datasets, imports

client=TestClient(app)
CSV=b'epoch,a,e,i,raan,arg_periapsis,true_anomaly\n2026-01-01T00:00:00Z,7000,0,0,0,0,0\n2026-01-01T00:01:00Z,7000,0,0,0,0,1\n'


@pytest.fixture(autouse=True)
def clean():
    datasets.clear(); imports.clear()
    yield
    datasets.clear(); imports.clear()


def import_data():
    inspected=client.post('/api/v1/imports/inspect',files={'file':('orbit.csv',CSV,'text/csv')}).json()
    body={'metadata':{},'mapping':inspected['mapping']}
    assert client.post(f"/api/v1/imports/{inspected['id']}/validate",json=body).json()['ok']
    response=client.post(f"/api/v1/imports/{inspected['id']}/commit",json=body)
    assert response.status_code==200
    return response.json()


def test_project_roundtrip_recomputes_and_preserves_provenance():
    ds=import_data()
    layer={'id':'layer-1','dataset_id':ds['id'],'kind':'dataset','name':'test','color':'#69caca','visible':True,'showTrack':True,'showTrail':True,'showLabel':True}
    state={'layers':[layer],'selected':'layer-1','clock':{'base_tai':ds['reference_tai'],'time':30,'speed':60},'axes':False,'grid':True,'radius_km':1e8,'trail_s':86400}
    result=client.post('/api/v1/projects/export',json={'dataset_ids':[ds['id']],'state':state})
    assert result.status_code==200
    project=result.json(); datasets.clear()
    restored=client.post('/api/v1/projects/import',files={'file':('test.orbit.json',json.dumps(project).encode())})
    assert restored.status_code==200
    actual=restored.json()
    assert actual['state']==state
    assert actual['datasets'][0]['samples']==ds['samples']
    assert actual['datasets'][0]['metadata']['metadata_status']=='provisional'
    legacy=deepcopy(project)
    req=legacy['datasets'][0]['import_request']
    req.pop('input_type'); req.pop('velocity_source'); req['metadata'].pop('speed_unit')
    old=client.post('/api/v1/projects/import',files={'file':('legacy.json',json.dumps(legacy).encode())})
    assert old.status_code==200 and old.json()['datasets'][0]['samples']==ds['samples']
    tampered=deepcopy(project); tampered['datasets'][0]['source_sha256']='bad'
    assert client.post('/api/v1/projects/import',files={'file':('bad.json',json.dumps(tampered).encode())}).status_code==422
    assert len(datasets)==1  # failed open must not destroy the valid workspace
    invalid_view=deepcopy(project); invalid_view['state']['radius_km']=-1
    assert client.post('/api/v1/projects/import',files={'file':('bad-view.json',json.dumps(invalid_view).encode())}).status_code==422
    invalid_time=deepcopy(project); invalid_time['state']['clock']['time']=999999999
    assert client.post('/api/v1/projects/import',files={'file':('bad-clock.json',json.dumps(invalid_time).encode())}).status_code==422


def test_structured_errors_and_no_nonfinite_preview():
    assert client.get('/api/v1/health').json()['propagation'] is False
    assert client.get('/api/v1/datasets/missing/samples').status_code==404
    bad={'elements':{'a':7000,'e':1,'i':0,'raan':0,'arg_periapsis':0,'true_anomaly':0},'metadata':{},'radius_km':100000}
    response=client.post('/api/v1/orbits/preview',json=bad)
    assert response.status_code==422 and response.json()['code']=='invalid_elements'
    bad['elements']['e']=0
    assert client.post('/api/v1/orbits/preview',json=bad).json()['closed'] is True
