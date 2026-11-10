from pathlib import Path
import numpy as np
import pytest

from orbit.importer import ImportProblem, read_csv, validate
from orbit.models import Decisions, ImportRequest, Metadata

HEADER="epoch,a,e,i,raan,arg_periapsis,true_anomaly\n"


def run_csv(text, meta=None, **decisions):
    parsed=read_csv(text.encode())
    return validate(parsed, ImportRequest(metadata=meta or Metadata(),mapping=parsed['mapping'],decisions=Decisions(**decisions)))


def test_actual_sample_precheck_and_explicit_conflict_resolution():
    source=next((Path(__file__).parents[2]/'codex'/'examples').glob('*.csv'), None)
    if source is None:
        pytest.skip('本地参考样例未随仓库提供')
    raw=source.read_bytes(); parsed=read_csv(raw)
    req=ImportRequest(metadata=Metadata(),mapping=parsed['mapping'])
    report,_=validate(parsed,req)
    assert not report['ok'] and report['stats']['input_rows']==8734
    assert report['stats']['hyperbolic_rows']==4
    assert report['stats']['duplicate_groups']==[[424,425],[930,931]]
    assert [r['source_rows'] for r in report['conflicts'][0]['records']]==[[814],[815]]
    req.decisions=Decisions(deduplicate=True,conflict_choices={'814':815})
    report,ds=validate(parsed,req)
    assert report['ok'] and len(ds['samples'])==8731
    assert all(b['t']>a['t'] for a,b in zip(ds['samples'],ds['samples'][1:]))
    assert ds['metadata']['metadata_status']=='provisional'
    assert source.read_bytes()==raw


def test_leap_second_uses_continuous_tai_and_utc_labels():
    text=HEADER+'2016-12-31T23:59:59Z,7000,0,0,0,0,0\n2016-12-31T23:59:60Z,7000,0,0,0,0,1\n2017-01-01T00:00:00Z,7000,0,0,0,0,2\n'
    report,ds=run_csv(text)
    assert report['ok']
    np.testing.assert_allclose([s['t'] for s in ds['samples']],[0,1,2],atol=1e-8)
    assert ':60.' in ds['samples'][1]['epoch_utc']


def test_tdb_and_utc_describe_same_instant():
    from astropy.time import Time
    t=Time('2026-01-01T00:00:00',scale='utc',precision=9)
    _,a=run_csv(HEADER+'2026-01-01T00:00:00Z,7000,0,0,0,0,0\n')
    _,b=run_csv(HEADER+str(t.tdb.isot)+',7000,0,0,0,0,0\n', Metadata(time_scale='TDB'))
    assert abs((Time(a['reference_tai'],scale='tai')-Time(b['reference_tai'],scale='tai')).to_value('sec'))<1e-6
    report,_=run_csv(HEADER+'2026-01-01T00:00:00Z,7000,0,0,0,0,0\n',Metadata(time_scale='TDB'))
    assert not report['ok']


def test_sort_gaps_and_invalid_row_exclusion_are_explicit():
    text=HEADER+'2026-01-05T00:00:00Z,7000,0,0,0,0,0\n2026-01-01T00:00:00Z,7000,0,0,0,0,0\n2026-01-02T00:00:00Z,nan,0,0,0,0,0\n'
    report,_=run_csv(text)
    assert not report['ok']
    report,ds=run_csv(text,sort=True,exclude_rows=[4])
    assert report['ok'] and ds['breaks']==[1]
    assert len(ds['audit'])==2


def test_units_and_single_epoch():
    text='a,e,i,raan,arg_periapsis,true_anomaly\n1,0,0,0,0,1.5707963267948966\n'
    report,ds=run_csv(text,Metadata(epoch_mode='single',single_epoch='2026-01-01T00:00:00',length_unit='AU',angle_unit='rad'))
    assert report['ok']
    np.testing.assert_allclose(ds['samples'][0]['position_km'],[0,149597870.7,0],atol=1e-6)
    bad=HEADER+'2026-02-31T00:00:00Z,7000,0,0,0,0,0\n'
    assert not run_csv(bad)[0]['ok']


def test_wrong_encoding_and_missing_anomaly():
    with pytest.raises(ImportProblem): read_csv(b'\xff\xfe')
    assert not run_csv('epoch,a,e,i,raan,arg_periapsis,mean_anomaly\n2026-01-01T00:00:00Z,7000,0,0,0,0,0\n')[0]['ok']


def test_conflicting_anomalies_warn_but_true_anomaly_remains_authoritative():
    text=HEADER.rstrip()+',mean_anomaly\n2026-01-01T00:00:00Z,7000,0,0,0,0,0,180\n'
    report,ds=run_csv(text)
    assert report['ok'] and any('0.5' in warning for warning in report['warnings'])
    np.testing.assert_allclose(ds['samples'][0]['position_km'],[7000,0,0])
