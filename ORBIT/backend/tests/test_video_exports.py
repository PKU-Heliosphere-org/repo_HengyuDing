import json
import shutil
import struct
import subprocess
import zlib

from fastapi.testclient import TestClient
import pytest

from orbit.app import app
from orbit import video_exports as video


def png(width=64, height=64, color=(255,0,0)):
    def chunk(name, data):
        return struct.pack('>I',len(data))+name+data+struct.pack('>I',zlib.crc32(name+data))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+bytes(color)*width)*height))+chunk(b'IEND',b'')


@pytest.fixture
def client():
    if not video.encoder():
        pytest.skip('Local H.264 FFmpeg missing')
    with TestClient(app) as session:
        yield session


def create(client, **kwargs):
    result=client.post('/api/v1/video-exports',json={'width':64,'height':64,'fps':24,'frames':24,**kwargs})
    assert result.status_code==201
    return result.json()['id']


def test_encodes_real_mp4_with_exact_size_rate_frame_count_and_duration(client):
    key=create(client)
    for index in range(24):
        response=client.post(f'/api/v1/video-exports/{key}/frames/{index}',content=png(color=(255,0,0) if index<12 else (0,0,255)))
        assert response.status_code==200
    response=client.post(f'/api/v1/video-exports/{key}/finish')
    assert response.status_code==200 and response.headers['content-type']=='video/mp4'
    assert response.content[4:8]==b'ftyp' and b'avc1' in response.content
    probe=shutil.which('ffprobe')
    if probe:
        info=json.loads(subprocess.check_output([probe,'-v','error','-show_streams','-of','json',str(video.JOBS[key].output)],creationflags=video.FLAGS))['streams'][0]
        assert (info['width'],info['height'],info['r_frame_rate'],int(info['nb_frames']))==(64,64,'24/1',24)
        assert float(info['duration'])==pytest.approx(1,abs=0.001)
    directory=video.JOBS[key].path
    assert client.delete(f'/api/v1/video-exports/{key}').status_code==204
    assert not directory.exists() and key not in video.JOBS


def test_rejects_incomplete_wrong_order_or_size_and_cancel_releases_encoder(client):
    key=create(client)
    job=video.JOBS[key]
    assert client.post(f'/api/v1/video-exports/{key}/finish').status_code==409
    assert client.post(f'/api/v1/video-exports/{key}/frames/1',content=png()).status_code==409
    assert client.post(f'/api/v1/video-exports/{key}/frames/0',content=png(128,64)).status_code==422
    assert client.post(f'/api/v1/video-exports/{key}/frames/0',content=b'not a PNG').status_code==422
    assert client.post(f'/api/v1/video-exports/{key}/frames/0',content=png()).status_code==200
    assert client.delete(f'/api/v1/video-exports/{key}').status_code==204
    assert job.process.poll() is not None and not job.path.exists()
    assert client.delete(f'/api/v1/video-exports/{key}').status_code==204


@pytest.mark.parametrize('settings',[{'width':65},{'height':63},{'fps':25},{'frames':18001},{'width':1920,'height':1920}])
def test_rejects_unsupported_export_settings(client,settings):
    response=client.post('/api/v1/video-exports',json={'width':64,'height':64,'fps':24,'frames':24,**settings})
    assert response.status_code==422


def test_missing_encoder_returns_actionable_error(monkeypatch):
    monkeypatch.setattr(video,'encoder',lambda:None)
    with TestClient(app) as session:
        assert session.get('/api/v1/video-exports/capabilities').json()['mp4'] is False
        response=session.post('/api/v1/video-exports',json={'width':64,'height':64,'fps':24,'frames':24})
        assert response.status_code==503 and response.json()['code']=='video_encoder_missing'
