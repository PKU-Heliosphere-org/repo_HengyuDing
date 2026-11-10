import json
import math
import numpy as np
import pytest
import spiceypy as spice
from astropy import units as u
from astropy.coordinates import CartesianRepresentation, GCRS, ITRS
from astropy.time import Time
from fastapi.testclient import TestClient

from orbit import planets
from orbit.app import app
from orbit.planets import WindowRequest, earth_attitudes, window


@pytest.fixture
def kernels():
    if not planets.kernels_ready():
        pytest.skip('Run scripts/fetch_ephemeris.py to install the offline reference kernels')


def quaternion_matrix(q):
    return spice.q2m([q[3],q[0],q[1],q[2]])


def request_at(epoch='2025-01-01T12:00:00',**kwargs):
    return WindowRequest(reference_tai=Time(epoch,scale='utc').tai.isot,body_ids=['earth','mars'],start_s=0,end_s=21600,**kwargs)


def test_frame_and_origin_are_applied_to_both_position_and_orientation(kernels):
    r=window(request_at())
    ecl=window(request_at(frame='ECLIPJ2000'))
    geocentric=window(request_at(center='earth'))
    f=spice.pxform('J2000','ECLIPJ2000',0)
    for key in ['earth','mars']:
        np.testing.assert_allclose(np.asarray(r['bodies'][key]['positions_km'])@f.T,ecl['bodies'][key]['positions_km'],atol=1e-6)
        for q,rq in zip(r['bodies'][key]['quaternions'],ecl['bodies'][key]['quaternions']):
            np.testing.assert_allclose(f@quaternion_matrix(q),quaternion_matrix(rq),atol=1e-12)
    np.testing.assert_allclose(geocentric['bodies']['earth']['positions_km'],0,atol=1e-10)
    np.testing.assert_allclose(np.asarray(r['bodies']['mars']['positions_km'])-np.asarray(r['bodies']['earth']['positions_km']),geocentric['bodies']['mars']['positions_km'],atol=1e-6)
    np.testing.assert_allclose(geocentric['sun_positions_km'],-np.asarray(r['bodies']['earth']['positions_km']),atol=1e-6)


def test_earth_prime_meridian_matches_independent_astropy_frame_transform():
    epochs=Time(['2025-01-01T12:00:00'],scale='utc')
    matrix,quality,eop=earth_attitudes(epochs)
    expected=ITRS(CartesianRepresentation(6378*u.km,0*u.km,0*u.km),obstime=epochs).transform_to(GCRS(obstime=epochs))
    np.testing.assert_allclose(matrix[0]@np.array([6378,0,0]),expected.cartesian.xyz.to_value(u.km)[:,0],atol=1e-7)
    assert quality==['observed'] and abs(eop['dut1_s'][0])<1
    assert np.linalg.det(matrix[0])==pytest.approx(1,abs=1e-12)


def test_future_earth_fallback_is_explicit_and_rotates_at_sidereal_rate():
    epochs=Time(['2041-01-01T00:00:00','2041-01-01T06:00:00'],scale='utc')
    with pytest.warns(Warning):
        matrix,quality,eop=earth_attitudes(epochs)
    assert quality==['approximate','approximate'] and eop['dut1_s']==[0,0] and eop['xp_rad']==[0,0]
    x0,x1,pole=matrix[0][:,0],matrix[1][:,0],matrix[0][:,2]
    angle=math.degrees(math.atan2(np.dot(np.cross(x0,x1),pole),np.dot(x0,x1)))
    assert angle==pytest.approx(360*21600/86164.0905,abs=.001)


def test_all_planet_attitudes_are_proper_rotations(kernels):
    req=request_at();req.body_ids=list(planets.BODIES)
    result=window(req)
    for body in result['bodies'].values():
        assert np.isfinite(body['positions_km']).all() and min(body['radii_km'])>0
        for q in body['quaternions']:
            assert np.linalg.norm(q)==pytest.approx(1)
            assert np.linalg.det(quaternion_matrix(q))==pytest.approx(1)


def test_missing_kernel_and_range_errors_are_actionable(monkeypatch,tmp_path):
    monkeypatch.setattr(planets,'KERNEL_DIR',tmp_path)
    client=TestClient(app)
    assert not client.get('/api/v1/planets/catalog').json()['ready']
    r=client.post('/api/v1/planets/window',json=request_at().model_dump())
    assert r.status_code==503 and r.json()['code']=='ephemeris_missing'
    with pytest.raises(ValueError):
        WindowRequest(reference_tai='2026-01-01T00:00:00',body_ids=['earth'],start_s=0,end_s=121*86400)


def test_planet_only_project_and_camera_roundtrip_without_csv():
    client=TestClient(app)
    layer={'id':'planet-earth','kind':'planet','body_id':'earth','name':'地球','color':'#72b8ed','visible':True,'showTrack':False,'showTrail':False,'showLabel':True,'showMeridian':True}
    state={'layers':[layer],'selected':'planet-earth','clock':{'base_tai':'2028-01-30T12:00:37','time':0,'speed':3600,'start':0,'end':86400},'axes':True,'grid':False,'radius_km':1e8,'trail_s':86400,'scene':{'center':'sun','frame':'J2000'},'stars':True,'camera':{'position_km':[1e8,2e8,10000],'target_km':[1e8,2e8,0],'up':[0,0,1],'follow_id':'planet-earth'}}
    response=client.post('/api/v1/projects/export',json={'dataset_ids':[],'state':state})
    assert response.status_code==200
    project=response.json();assert project['schema_version']==2 and project['datasets']==[]
    restored=client.post('/api/v1/projects/import',files={'file':('planet.orbit.json',json.dumps(project).encode())})
    assert restored.status_code==200 and restored.json()['state']==state
    project['state']['camera']['position_km']=project['state']['camera']['target_km'][:]
    assert client.post('/api/v1/projects/import',files={'file':('bad-camera.json',json.dumps(project).encode())}).status_code==422
