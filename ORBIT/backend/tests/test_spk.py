"""Synthetic kernels exercise SPICE isolation, transformations, coverage and project restore."""
import json

import numpy as np
import pytest
import spiceypy as spice
from astropy.time import Time
from fastapi.testclient import TestClient

from orbit.app import app, datasets, imports
from orbit import planets, spk_import

client = TestClient(app)


@pytest.fixture
def kernel(tmp_path):
    path = tmp_path / 'synthetic.bsp'
    first = float((Time('2026-01-01', scale='tdb').jd-2451545)*86400)
    times = first + np.arange(6)*86400
    states = np.array([[150000000, float(i)*2000000, 1000000, 0, 2000000/86400, 0] for i in range(6)])
    with planets.LOCK:
        handle = spice.spkopn(str(path), 'ARTIFICIAL TEST DATA', 0)
        try:
            spice.spkw09(handle, 1000001, 10, 'J2000', times[0], times[-1], 'TEST', 1, len(times), states, times)
            for a,b in [(0,1),(3,5)]:
                spice.spkw09(handle, 1000002, 10, 'J2000', times[a], times[b], 'GAPPED', 1, b-a+1, states[a:b+1], times[a:b+1])
        finally:
            spice.spkcls(handle)
    yield path, first, states
    datasets.clear()
    imports.clear()


def upload(path):
    response = client.post('/api/v1/imports/inspect', files={'file': ('synthetic.BSP', path.read_bytes())})
    assert response.status_code == 200, response.text
    return response.json()


def request():
    return {'target_id':1000001, 'object_name':'Synthetic comet', 'center':'sun', 'frame':'J2000',
            'start_tdb':'2026-01-01T00:00:00', 'end_tdb':'2026-01-06T00:00:00', 'step_s':3600}


def test_inspection_states_and_kernel_isolation(kernel):
    path, first, states = kernel
    with planets.LOCK:
        before = spice.ktotal('SPK')
    info = upload(path)
    assert info['source_format'] == 'bsp'
    assert [t['id'] for t in info['targets']] == [1000001,1000002]
    assert len(info['targets'][1]['coverage']) == 2
    result = client.post(f"/api/v1/imports/{info['id']}/spk/commit", json=request())
    assert result.status_code == 200, result.text
    ds = result.json()
    assert len(ds['samples']) == 121
    assert ds['breaks'] == []
    assert ds['metadata']['time_scale'] == 'TDB'
    assert ds['metadata']['metadata_status'] == 'verified'
    assert ds['samples'][0]['epoch_utc'].startswith('2025-12-31T23:58:50')
    np.testing.assert_allclose(ds['samples'][24]['position_km'], states[1,:3], atol=1e-5)
    np.testing.assert_allclose(ds['samples'][24]['velocity_km_s'], states[1,3:], atol=1e-10)
    with planets.LOCK:
        assert spice.ktotal('SPK') == before
        with pytest.raises(spice.utils.exceptions.SpiceyError):
            spice.spkez(1000001, first, 'J2000', 'NONE', 10)
    assert not list((spk_import.ROOT / '.cache/spk-import').iterdir())


def test_explicit_ecliptic_rotation(kernel):
    path, first, states = kernel
    body = request(); body['frame'] = 'ECLIPJ2000'
    ds = spk_import.build_dataset(path.read_bytes(), spk_import.SpkRequest(**body))
    with planets.LOCK:
        rotation = spice.pxform('J2000', 'ECLIPJ2000', first)
    np.testing.assert_allclose(ds['samples'][0]['position_km'], rotation @ states[0,:3], atol=1e-6)
    np.testing.assert_allclose(ds['samples'][0]['velocity_km_s'], rotation @ states[0,3:], atol=1e-10)


@pytest.mark.skipif(not planets.kernels_ready(), reason='local reference kernels unavailable')
def test_geocentric_translation(kernel):
    path, first, states = kernel
    body = request(); body['center'] = 'earth'
    ds = spk_import.build_dataset(path.read_bytes(), spk_import.SpkRequest(**body))
    with planets.LOCK:
        earth = spice.spkez(399, first, 'J2000', 'NONE', 10)[0]
    np.testing.assert_allclose(ds['samples'][0]['position_km'], states[0,:3]-earth[:3], atol=1e-6)
    np.testing.assert_allclose(ds['samples'][0]['velocity_km_s'], states[0,3:]-earth[3:], atol=1e-10)


@pytest.mark.parametrize('patch,code', [
    ({'target_id':123}, 'spk_target'),
    ({'target_id':1000002}, 'spk_range'),
    ({'start_tdb':'2025-12-31T00:00:00'}, 'spk_range'),
    ({'end_tdb':'2026-01-01T00:00:00'}, 'spk_range'),
    ({'start_tdb':'invalid'}, 'spk_range'),
    ({'step_s':1}, 'capacity'),
])
def test_bad_selections_are_recoverable(kernel, patch, code):
    info = upload(kernel[0]); body = request(); body.update(patch)
    route = f"/api/v1/imports/{info['id']}/spk/commit"
    response = client.post(route, json=body)
    assert response.status_code == 422, response.text
    assert response.json()['code'] == code
    assert info['id'] in imports
    assert client.post(route, json=request()).status_code == 200


def test_spk_project_roundtrip_and_tamper_is_atomic(kernel):
    info = upload(kernel[0])
    ds = client.post(f"/api/v1/imports/{info['id']}/spk/commit", json=request()).json()
    state = {'layers':[{'id':'s','dataset_id':ds['id'],'kind':'dataset','name':'comet','color':'#69caca','visible':True,'showTrack':True,'showTrail':True,'showLabel':True}],
             'selected':'s','clock':{'base_tai':ds['reference_tai'],'time':3600,'speed':60},'axes':False,'grid':True,'radius_km':1e8,'trail_s':86400}
    exported = client.post('/api/v1/projects/export', json={'dataset_ids':[ds['id']],'state':state})
    assert exported.status_code == 200, exported.text
    project = exported.json()
    assert project['datasets'][0]['source_format'] == 'bsp'
    response = client.post('/api/v1/projects/import', files={'file':('spk.orbit.json', json.dumps(project).encode())})
    assert response.status_code == 200, response.text
    assert response.json()['datasets'][0]['samples'] == ds['samples']
    project['datasets'][0]['import_request']['spk']['target_id'] = 123
    assert client.post('/api/v1/projects/import', files={'file':('bad.json', json.dumps(project).encode())}).status_code == 422
    assert datasets[ds['id']]['samples'] == ds['samples']


def test_invalid_file_and_wrong_api_route(kernel):
    response = client.post('/api/v1/imports/inspect', files={'file':('bad.bsp', b'not a kernel')})
    assert response.status_code == 422
    info = upload(kernel[0])
    response = client.post(f"/api/v1/imports/{info['id']}/validate", json={'metadata':{},'mapping':{}})
    assert response.status_code == 422
    assert response.json()['code'] == 'invalid_request'
    assert client.delete(f"/api/v1/imports/{info['id']}").status_code == 200
