"""Conic geometry only. Angles at this module's boundary are radians."""
import math
import numpy as np

AU_KM = 149597870.7  # IAU 2012 exact definition


def validate_elements(x):
    a, e, inc, _, _, nu = x
    if not np.isfinite(x).all():
        raise ValueError("根数必须为有限数值")
    if e < 0 or not 0 <= inc <= math.pi:
        raise ValueError("偏心率必须非负，倾角须在 0°–180°")
    if abs(1-e) <= 1e-8:
        raise ValueError("过于接近抛物线，请使用状态向量或半通径表示")
    if a == 0 or (e < 1 and a < 0) or (e > 1 and a > 0):
        raise ValueError("椭圆需 a>0，双曲线需 a<0")
    p = a * (1-e) * (1+e)
    if p <= 0 or not math.isfinite(p):
        raise ValueError("半通径无效")
    if 1+e*math.cos(nu) <= 1e-10:
        raise ValueError("真近点角超出有效分支或过于接近渐近线")


def rotation(x):
    _, _, inc, node, arg, _ = x
    cO, sO, ci, si, cw, sw = math.cos(node), math.sin(node), math.cos(inc), math.sin(inc), math.cos(arg), math.sin(arg)
    return np.array([[cO*cw-sO*sw*ci, -cO*sw-sO*cw*ci, sO*si],
                     [sO*cw+cO*sw*ci, -sO*sw+cO*cw*ci, -cO*si],
                     [sw*si, cw*si, ci]])


def state(x, mu=None):
    validate_elements(x)
    a, e, _, _, _, nu = x
    p = a * (1-e) * (1+e)
    r = p / (1+e*math.cos(nu))
    q = rotation(x)
    pos = q @ np.array([r*math.cos(nu), r*math.sin(nu), 0.0])
    velocity = q @ (math.sqrt(mu/p)*np.array([-math.sin(nu), e+math.cos(nu), 0.0])) if mu else None
    if not np.isfinite(pos).all() or (velocity is not None and not np.isfinite(velocity).all()):
        raise ValueError("位置/速度计算溢出")
    return pos, velocity


def conic(x, radius_km, mu=None):
    pos, velocity = state(x, mu)
    a, e = x[:2]
    p = a * (1-e) * (1+e)
    periapsis = p/(1+e)
    full = e < 1 and a*(1+e) <= radius_km
    if periapsis > radius_km:
        angles = np.array([])
    elif full:
        angles = np.linspace(-math.pi, math.pi, 1025)
    elif e == 0:
        angles = np.array([])
    else:
        limit = math.acos(np.clip((p/radius_km-1)/e, -1, 1))
        # Smooth nonuniform density, with extra resolution around periapsis.
        u = np.linspace(-1, 1, 1025)
        angles = limit*np.sinh(2*u)/math.sinh(2)
    if len(angles):
        radii = p/(1+e*np.cos(angles))
        points = (rotation(x) @ np.array([radii*np.cos(angles), radii*np.sin(angles), np.zeros(len(angles))])).T.tolist()
    else:
        points = []
    return {"points": points, "closed": bool(full), "truncated": not full,
            "position_km": pos.tolist(), "distance_km": float(np.linalg.norm(pos)),
            "speed_km_s": float(np.linalg.norm(velocity)) if velocity is not None else None,
            "period_s": 2*math.pi*math.sqrt(a**3/mu) if e < 1 and mu else None,
            "periapsis_km": periapsis, "orbit_type": "ellipse" if e < 1 else "hyperbola",
            "warnings": ["接近抛物线，数值敏感"] if abs(1-e) < 1e-4 else []}
