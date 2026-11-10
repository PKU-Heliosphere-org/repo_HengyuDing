import math
import numpy as np
import pytest
import spiceypy as spice

from orbit.mechanics import conic, state


def test_circular_cardinal_and_inclined_axes():
    np.testing.assert_allclose(state([7000,0,0,0,0,0])[0], [7000,0,0], atol=1e-9)
    np.testing.assert_allclose(state([7000,0,0,0,0,math.pi/2])[0], [0,7000,0], atol=1e-9)
    np.testing.assert_allclose(state([7000,0,math.pi/2,0,0,math.pi/2])[0], [0,0,7000], atol=1e-9)
    np.testing.assert_allclose(state([7000,0,math.pi,0,0,math.pi/2])[0], [0,-7000,0], atol=1e-9)


@pytest.mark.parametrize("a,e,nu", [(14000,.4,1.2),(-50000,1.4,-.7),(14000,.4,5.8),(-50000,1.4,6.1)])
def test_crosscheck_with_independent_spice_conics(a,e,nu):
    """SPICE receives mean anomaly; compare its state at exactly the same epoch (no propagation)."""
    inc,node,arg = .4,1.1,.7
    if e < 1:
        E = 2*math.atan2(math.sqrt(1-e)*math.sin(nu/2),math.sqrt(1+e)*math.cos(nu/2))
        M = E-e*math.sin(E)
    else:
        signed = (nu+math.pi)%(2*math.pi)-math.pi
        H = 2*math.atanh(math.sqrt((e-1)/(e+1))*math.tan(signed/2))
        M = e*math.sinh(H)-H
    mu=398600.435507
    expected=spice.conics([a*(1-e),e,inc,node,arg,M,0,mu],0)
    p,v=state([a,e,inc,node,arg,nu],mu)
    np.testing.assert_allclose(p,expected[:3],atol=1e-6,rtol=1e-10)
    np.testing.assert_allclose(v,expected[3:],atol=1e-10,rtol=1e-10)


@pytest.mark.parametrize("x", [[7000,1,0,0,0,0], [7000,1.1,0,0,0,0], [-7000,.5,0,0,0,0], [-7000,2,0,0,0,math.pi], [7000,0,4,0,0,0], [math.nan,0,0,0,0,0]])
def test_invalid_elements_rejected(x):
    with pytest.raises(ValueError): state(x)


def test_open_conic_truncated_without_false_closing_segment():
    curve=conic([-20000,1.4,.2,.4,.1,0],100000,398600)
    assert not curve['closed'] and curve['truncated'] and curve['period_s'] is None
    radii=np.linalg.norm(curve['points'],axis=1)
    assert max(radii) <= 100000*(1+1e-12)
    assert not np.allclose(curve['points'][0],curve['points'][-1])
    assert conic([7000,0,0,0,0,0],10000)['closed']
    assert conic([7000,.2,0,0,0,0],100)['points'] == []
