"""Offline geometric ephemerides and body attitudes, not propagation of CSV objects."""
from functools import lru_cache
from pathlib import Path
from threading import RLock
from typing import Literal
import warnings

import erfa
import numpy as np
import spiceypy as spice
from astropy import units as u
from astropy.time import Time
from astropy.utils import iers
from pydantic import Field, model_validator

from .importer import ImportProblem
from .models import StrictModel

ROOT = Path(__file__).resolve().parents[3]
KERNEL_DIR = ROOT / "data" / "ephemeris"
LOCK = RLock()  # CSPICE has a process-wide kernel/error pool; never call it concurrently.
iers.conf.auto_download = False
BodyId = Literal["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"]
BODIES = {
    "mercury": ("水星", 199, 199, "#b9b5ac", [2439.7,2439.7,2439.7]),
    "venus": ("金星", 299, 299, "#ead39e", [6051.8,6051.8,6051.8]),
    "earth": ("地球", 399, 399, "#72b8ed", [6378.1366,6378.1366,6356.7519]),
    "mars": ("火星", 4, 499, "#dd8c64", [3396.19,3396.19,3376.2]),
    "jupiter": ("木星", 5, 599, "#dfb795", [71492,71492,66854]),
    "saturn": ("土星", 6, 699, "#e3cf9f", [60268,60268,54364]),
    "uranus": ("天王星", 7, 799, "#92dedb", [25559,25559,24973]),
    "neptune": ("海王星", 8, 899, "#678fe3", [24764,24764,24341]),
}
MIN_UTC = "1972-01-01T00:00:00"
MAX_UTC = "2150-01-01T00:00:00"


class WindowRequest(StrictModel):
    body_ids: list[BodyId] = Field(min_length=1, max_length=8)
    center: Literal["sun", "earth"] = "sun"
    frame: Literal["J2000", "ECLIPJ2000"] = "J2000"
    reference_tai: str = Field(max_length=40)
    start_s: float
    end_s: float
    step_s: float = Field(default=3600, ge=60, le=3600)

    @model_validator(mode="after")
    def bounded_window(self):
        if self.end_s <= self.start_s or self.end_s-self.start_s > 120*86400 or (self.end_s-self.start_s)/self.step_s > 3000:
            raise ValueError("星历窗口需为正，至多 120 天、3,001 个采样点")
        if len(set(self.body_ids)) != len(self.body_ids):
            raise ValueError("行星不能重复")
        return self


def kernels_ready():
    return all((KERNEL_DIR/name).is_file() for name in ["de440s.bsp","pck00011.tpc"])


def load_kernels():
    if not kernels_ready():
        raise ImportProblem("本地星历尚未准备好。请运行 .venv/Scripts/python.exe scripts/fetch_ephemeris.py", "ephemeris_missing", status=503)
    for name in ["de440s.bsp","pck00011.tpc"]:
        path = str(KERNEL_DIR/name)
        # kinfo raises when absent, so enumerate the tiny pool instead.
        files = {spice.kdata(i,"ALL")[0] for i in range(spice.ktotal("ALL"))}
        if path not in files:
            spice.furnsh(path)


def catalog():
    return {"ready": kernels_ready(), "ephemeris": "JPL DE440s", "orientation": "NAIF pck00011 / IAU; Earth: IERS + IAU 2006/2000A",
            "min_utc": MIN_UTC+"Z", "max_utc": MAX_UTC+"Z",
            "bodies": [{"id": key, "name": row[0], "color": row[3], "radii_km": row[4],
                        "texture": "earth_day.jpg" if key=="earth" else key+".jpg",
                        "position_reference": "planet_center" if key in {"mercury","venus","earth"} else "system_barycenter"} for key,row in BODIES.items()]}


@lru_cache(maxsize=1)
def eop_table():
    return iers.IERS_Auto.open()


def earth_attitudes(times: Time):
    """ITRS -> GCRS/ICRF axes. Use UT1=UTC and zero polar motion ONLY outside EOP coverage."""
    table = eop_table()
    utc, tt = times.utc, times.tt
    dut1, quality_t = table.ut1_utc(utc, return_status=True)
    xp, yp, quality_p = table.pm_xy(utc, return_status=True)
    valid = (quality_t >= 0) & (quality_p >= 0)
    dut1_s = np.where(valid, dut1.to_value(u.s), 0.)
    xp_rad = np.where(valid, xp.to_value(u.rad), 0.)
    yp_rad = np.where(valid, yp.to_value(u.rad), 0.)
    ut11, ut12 = erfa.utcut1(utc.jd1, utc.jd2, dut1_s)
    matrices = np.swapaxes(erfa.c2t06a(tt.jd1, tt.jd2, ut11, ut12, xp_rad, yp_rad), -1, -2)
    predicted = (quality_t == iers.FROM_IERS_A_PREDICTION) | (quality_p == iers.FROM_IERS_A_PREDICTION)
    quality = np.where(~valid, "approximate", np.where(predicted,"predicted","observed")).tolist()
    return matrices, quality, {"dut1_s":dut1_s.tolist(),"xp_rad":xp_rad.tolist(),"yp_rad":yp_rad.tolist()}


def tai_seconds(times):
    tdb = times.tdb
    return ((tdb.jd1-2451545.0)+tdb.jd2)*86400


def window(request: WindowRequest):
    with LOCK, warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        try:
            load_kernels()
            reference = Time(request.reference_tai, format="isot", scale="tai", precision=9)
            seconds = np.linspace(request.start_s, request.end_s, int(np.ceil((request.end_s-request.start_s)/request.step_s))+1)
            times = reference + seconds*u.s
            if times[0] < Time(MIN_UTC,scale="utc") or times[-1] > Time(MAX_UTC,scale="utc"):
                raise ImportProblem("行星星历支持 1972-01-01 至 2150-01-01 UTC", "ephemeris_range")
            et = tai_seconds(times)
            transform = np.eye(3) if request.frame=="J2000" else spice.pxform("J2000","ECLIPJ2000",float(et[0]))
            observer = "10" if request.center=="sun" else "399"
            sun = np.array([spice.spkezr("10",float(t),"J2000","NONE",observer)[0] for t in et])
            sun_pos = sun[:,:3] @ transform.T
            results, earth_quality = {}, []
            for key in request.body_ids:
                _, target, orientation_id, _, _ = BODIES[key]
                states = np.array([spice.spkezr(str(target),float(t),"J2000","NONE",observer)[0] for t in et])
                if key=="earth":
                    matrices, earth_quality, eop = earth_attitudes(times)
                    matrices = transform @ matrices
                else:
                    matrices = np.array([transform @ spice.pxform("IAU_"+key.upper(),"J2000",float(t)) for t in et])
                quaternions = []
                for m in matrices:
                    q = spice.m2q(m)
                    quaternions.append([float(q[1]),float(q[2]),float(q[3]),float(q[0])])
                radii = spice.bodvrd(str(orientation_id),"RADII",3)[1].tolist()
                results[key] = {"positions_km":(states[:,:3] @ transform.T).tolist(), "velocities_km_s":(states[:,3:] @ transform.T).tolist(),
                                "quaternions":quaternions,"radii_km":radii,
                                "orientation_quality":earth_quality if key=="earth" else ["iau_nominal"]*len(seconds)}
                if key=="earth":
                    results[key]["eop"] = eop
            notes = []
            if "approximate" in earth_quality:
                notes.append("地球定向：超出 IERS 覆盖，采用 UT1≈UTC、极移=0；零度经线为近似方向。")
            if "predicted" in earth_quality:
                notes.append("地球定向使用 IERS 预测值，精度随预报距离变化。")
            if caught:
                notes.append("未来 UTC 使用当前闰秒表，不预测尚未公布的闰秒。")
            return {"reference_tai":request.reference_tai,"times":seconds.tolist(),"bodies":results,"sun_positions_km":sun_pos.tolist(),
                    "sun_velocities_km_s":(sun[:,3:] @ transform.T).tolist(),"center":request.center,"frame":request.frame,
                    "ephemeris":"DE440s", "warnings":notes}
        except ImportProblem:
            raise
        except (ValueError, spice.utils.exceptions.SpiceyError) as exc:
            raise ImportProblem("星历/姿态计算失败："+str(exc).splitlines()[0],"ephemeris_error")
