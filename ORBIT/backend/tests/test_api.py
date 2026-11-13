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


def camera_project():
    ds = import_data()
    camera = {'position_km':[0,0,40000],'target_km':[0,0,0],'up':[0,1,0],'follow_id':None,'fov':34,'zoom':1}
    state = {'layers':[{'id':'l','dataset_id':ds['id'],'kind':'dataset','name':'camera','color':'#69caca','visible':True,'showTrack':True,'showTrail':True,'showLabel':True}],
             'selected':'l','clock':{'base_tai':ds['reference_tai'],'time':0,'speed':60},'axes':False,'grid':True,'radius_km':1e8,'trail_s':86400,
             'camera':camera,'camera_keyframes_enabled':True,'camera_keyframes':[{'id':'a','time':0,'camera':deepcopy(camera)},{'id':'b','time':60,'camera':deepcopy(camera)}]}
    result = client.post('/api/v1/projects/export',json={'dataset_ids':[ds['id']],'state':state})
    assert result.status_code == 200
    return result.json()


def test_camera_keyframes_roundtrip_preserves_full_optical_state():
    project = camera_project()
    project['state']['camera_keyframes'][1]['camera']['zoom'] = 2
    project['state']['camera_keyframes'][1]['camera']['fov'] = 50
    response = client.post('/api/v1/projects/import',files={'file':('camera.json',json.dumps(project).encode())})
    assert response.status_code == 200
    assert response.json()['state']['camera_keyframes'] == project['state']['camera_keyframes']
    assert response.json()['state']['camera_keyframes_enabled'] is True


@pytest.mark.parametrize('bad', ['duplicate_id','duplicate_time','unordered','bad_vector','zero_distance','parallel_up','bad_zoom','bad_fov','bad_enabled','too_many'])
def test_invalid_camera_keys_do_not_replace_current_workspace(bad):
    project = camera_project()
    state = project['state']
    keys = state['camera_keyframes']
    if bad == 'duplicate_id': keys[1]['id'] = keys[0]['id']
    elif bad == 'duplicate_time': keys[1]['time'] = keys[0]['time']
    elif bad == 'unordered': keys.reverse()
    elif bad == 'bad_vector': keys[0]['camera']['up'] = [1,2]
    elif bad == 'zero_distance': keys[0]['camera']['position_km'] = [0,0,0]
    elif bad == 'parallel_up': keys[0]['camera']['up'] = [0,0,1]
    elif bad == 'bad_zoom': keys[0]['camera']['zoom'] = 0
    elif bad == 'bad_fov': keys[0]['camera']['fov'] = 180
    elif bad == 'bad_enabled': state['camera_keyframes_enabled'] = 'yes'
    elif bad == 'too_many': state['camera_keyframes'] = keys * 501
    before = set(datasets)
    response = client.post('/api/v1/projects/import',files={'file':('invalid-camera.json',json.dumps(project).encode())})
    assert response.status_code == 422
    assert set(datasets) == before
