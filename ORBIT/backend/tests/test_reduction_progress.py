import threading
import time

import pytest
from fastapi.testclient import TestClient

from orbit import importer
from orbit.app import app, imports, datasets
from orbit.models import ImportSelection
from orbit.table_reader import ReadCancelled
from orbit.reduction_tasks import SLOTS

CSV = ('epoch,x,y,z,vx,vy,vz\n'+''.join(
    f'2026-01-01T00:0{i}:00,7000,{i},0,0,1,0\n' for i in range(6))).encode()
BODY = {'epoch_column':'epoch','interval_s':120}


@pytest.fixture(autouse=True)
def clean():
    imports.clear(); datasets.clear()
    yield
    for entry in list(imports.values()):
        if entry.get('reduction_job'):
            entry['reduction_job'].cancel()
    imports.clear(); datasets.clear()


def stage(client):
    return client.post('/api/v1/imports/inspect',files={'file':('source.csv',CSV)}).json()


def wait_job(client, path, states=('completed','cancelled','failed')):
    deadline = time.monotonic()+5
    while time.monotonic()<deadline:
        response=client.get(path)
        assert response.status_code==200,response.text
        job=response.json()
        if job['status'] in states:
            return job
        threading.Event().wait(.01)
    pytest.fail('Task did not reach expected state')


def test_reader_reports_exact_csv_total_progress_and_honors_cancellation():
    raw=('epoch,x,y,z,vx,vy,vz\n'+''.join(
        f'2026-01-01T00:{i//60:02d}:{i%60:02d},7000,0,0,0,1,0\n' for i in range(2000))).encode()
    updates=[]
    importer.read_table(raw,'source.csv',selection=ImportSelection(**BODY),progress=lambda *args:updates.append(args))
    assert updates[0][3]=='counting'
    reading=[v for v in updates if v[3]=='reading']
    assert reading[0]==(0,2000,True,'reading')
    assert any(v[0]>=1024 for v in reading)
    assert updates[-1]==(2000,2000,True,'processing')
    cancel=threading.Event()
    def stop(scanned,*_):
        if scanned>=1024:
            cancel.set()
    with pytest.raises(ReadCancelled):
        importer.read_table(raw,'source.csv',selection=ImportSelection(**BODY),progress=stop,cancelled=cancel.is_set)


def test_background_success_and_late_cancel_do_not_roll_back_completed_result():
    client=TestClient(app)
    inspected=stage(client); key=inspected['id']
    started=client.post(f'/api/v1/imports/{key}/reduction-jobs',json=BODY)
    assert started.status_code==202
    path=f"/api/v1/imports/{key}/reduction-jobs/{started.json()['id']}"
    final=wait_job(client,path)
    assert final['status']=='completed' and final['scanned']==final['total']==6
    assert final['total_exact'] and final['result']['input_rows']==3
    assert client.post(path+'/cancel').json()['status']=='completed'
    assert imports[key]['parsed']['selection']['interval_s']==120
    assert imports[key]['raw']==CSV


def test_cancel_between_computation_and_publish_keeps_last_applied_result_and_allows_retry(monkeypatch):
    client=TestClient(app)
    inspected=stage(client); key=inspected['id']
    client.post(f'/api/v1/imports/{key}/reduce',json={**BODY,'end':'2026-01-01T00:02:00'})
    original=imports[key]['parsed']
    real_read=importer.read_table
    ready,release=threading.Event(),threading.Event()
    def held(*args,**kwargs):
        progress=kwargs.pop('progress')
        kwargs.pop('cancelled')
        parsed=real_read(*args,**kwargs)
        progress(2,6,True,'processing')
        ready.set()
        assert release.wait(5)
        return parsed  # Deliberately ignores cancellation: publication must still be guarded.
    monkeypatch.setattr(importer,'read_table',held)
    try:
        started=client.post(f'/api/v1/imports/{key}/reduction-jobs',json=BODY).json()
        assert ready.wait(3)
        path=f"/api/v1/imports/{key}/reduction-jobs/{started['id']}"
        progress=client.get(path).json()
        assert progress['status']=='running' and progress['scanned']==2
        assert client.post(f'/api/v1/imports/{key}/reduction-jobs',json=BODY).status_code==409
        body={'metadata':{},'mapping':inspected['mapping']}
        assert client.post(f'/api/v1/imports/{key}/commit',json=body).status_code==409
        assert client.post(f'/api/v1/imports/{key}/validate',json=body).status_code==409
        assert client.post(f'/api/v1/imports/{key}/reduce',json=BODY).status_code==409
        assert client.post(path+'/cancel').json()['status']=='cancelling'
        release.set()
        assert wait_job(client,path)['status']=='cancelled'
        assert imports[key]['parsed'] is original and imports[key]['raw']==CSV
    finally:
        release.set()
    monkeypatch.setattr(importer,'read_table',real_read)
    new=client.post(f'/api/v1/imports/{key}/reduction-jobs',json=BODY).json()
    final=wait_job(client,f"/api/v1/imports/{key}/reduction-jobs/{new['id']}")
    assert final['status']=='completed' and final['result']['input_rows']==3


def test_deleting_import_cancels_in_flight_job_without_publishing(monkeypatch):
    client=TestClient(app)
    key=stage(client)['id']
    ready=threading.Event()
    def held(*args,**kwargs):
        ready.set()
        deadline=time.monotonic()+5
        while not kwargs['cancelled']() and time.monotonic()<deadline:
            threading.Event().wait(.005)
        raise ReadCancelled()
    monkeypatch.setattr(importer,'read_table',held)
    client.post(f'/api/v1/imports/{key}/reduction-jobs',json=BODY)
    assert ready.wait(3)
    task=imports[key]['reduction_job']
    assert client.delete(f'/api/v1/imports/{key}').status_code==200
    deadline=time.monotonic()+3
    while task.snapshot()['status']!='cancelled' and time.monotonic()<deadline:
        threading.Event().wait(.01)
    assert key not in imports and task.snapshot()['status']=='cancelled'


def test_failure_keeps_source_and_previous_result_and_wrong_task_is_not_found():
    client=TestClient(app)
    key=stage(client)['id']; before=imports[key]['parsed']
    started=client.post(f'/api/v1/imports/{key}/reduction-jobs',json={**BODY,'start':'not-a-date'}).json()
    path=f"/api/v1/imports/{key}/reduction-jobs/{started['id']}"
    final=wait_job(client,path)
    assert final['status']=='failed' and '时间无效' in final['error']['message']
    assert imports[key]['parsed'] is before and imports[key]['raw']==CSV
    assert client.get(f'/api/v1/imports/{key}/reduction-jobs/wrong').status_code==404


def test_queued_task_can_be_cancelled_before_a_worker_slot_opens():
    client=TestClient(app)
    key=stage(client)['id']; before=imports[key]['parsed']
    held=0
    try:
        for _ in range(2):
            assert SLOTS.acquire(timeout=2)
            held+=1
        started=client.post(f'/api/v1/imports/{key}/reduction-jobs',json=BODY).json()
        path=f"/api/v1/imports/{key}/reduction-jobs/{started['id']}"
        assert client.get(path).json()['status']=='queued'
        client.post(path+'/cancel')
        assert wait_job(client,path)['status']=='cancelled'
        assert imports[key]['parsed'] is before
    finally:
        for _ in range(held):
            SLOTS.release()


def test_xlsx_total_estimate_is_corrected_after_skipping_blank_rows():
    from io import BytesIO
    from openpyxl import Workbook
    book=Workbook(); sheet=book.active
    sheet.append(['epoch','x','y','z','vx','vy','vz'])
    sheet.append(['2026-01-01T00:00:00',7000,0,0,0,1,0])
    sheet.append([])
    sheet.append(['2026-01-01T00:01:00',7000,1,0,0,1,0])
    stream=BytesIO(); book.save(stream)
    updates=[]
    importer.read_table(stream.getvalue(),'source.xlsx',selection=ImportSelection(**BODY),progress=lambda *args:updates.append(args))
    assert updates[0]==(0,3,False,'reading')
    assert updates[-1]==(2,2,True,'processing')
