"""Generate artificial SPK data in a private temporary directory for browser tests."""
from pathlib import Path
from tempfile import TemporaryDirectory
import sys

import numpy as np
import spiceypy as spice
from astropy.time import Time

cache = Path(__file__).resolve().parents[3] / '.cache' / 'spk-test'
cache.mkdir(parents=True, exist_ok=True)
with TemporaryDirectory(dir=cache) as directory:
    path = Path(directory) / 'synthetic.bsp'
    first = float((Time('2026-01-01', scale='tdb').jd-2451545)*86400)
    times = first + np.arange(6)*86400
    states = np.array([[150000000, float(i)*2000000, 1000000, 0, 2000000/86400, 0] for i in range(6)])
    handle = spice.spkopn(str(path), 'ARTIFICIAL TEST DATA', 0)
    try:
        spice.spkw09(handle, 1000001, 10, 'J2000', float(times[0]), float(times[-1]), 'SYNTHETIC', 1, len(times), states, times)
    finally:
        spice.spkcls(handle)
    sys.stdout.buffer.write(path.read_bytes())
