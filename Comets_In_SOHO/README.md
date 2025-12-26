# Comet_in_SOHO
This python program is developed by Hengyu Ding. It provides a pipeline to download SOHO LASCO C3 image data for a specific time range, find and stack images centered on a given solar system small body (e.g. a comet). 

The code is mainly designed for quick analysis of faint moving targets in SOHO LASCO C3 coronagraph data.


## Features
- Download SOHO LASCO C3 coronagraph image data from Helioviewer for a specific time range.
- Locate the target small body using JPL ephemeris.
- Reproject images into Heliographic Stonyhurst coordinates, where solar north is up and the sun is at the center of the image.
- Center images on the target and stack them for a better SNR.

## Requirements
- python >=3.8
- numpy
- matplotlib
- astropy
- sunpy
- poliastro
- hvpy
- rasterio
- rich

you can install these dependencies via:

``` bash
pip install numpy matplotlib astropy sunpy poliastro hvpy rasterio rich
```

**IMPORTANT**：After installing all the dependencies, you need to **edit a function**.

Open `get_SOHO_data.py`, find:
```python
from sunpy.coordinates.ephemeris import get_body_heliographic_stonyhurst, get_horizons_coord
```
Press ctrl, then click `get_body_heliographic_stonyhurst` to enter `ephemeris.py`.

**Add: `from poliastro.ephem import Ephem`** at the beginning of the `ephemeris.py`.

**Commented out: `body_icrs = get_body_barycentric(body, emitted_time)`**.

**Add: `body_icrs = Ephem.from_horizons(body, emitted_time)._coordinates[0].without_differentials()`**.

This allows us to use JPL ephemeris.


## Usage

You can excecute the pipeline by simply running `main.py`. 

The components: `get_SOHO_data.py`, `north_up_and_center_sun.py` and `stack_SOHO_data.py` can also be run individually.

You can customize the user setting by editing `main.py`:
``` python
 ### User Settings ###
    output_path = './SOHO_LASCO_C3_Data'
    if os.path.exists(output_path) is False:
        os.makedirs(output_path)
    start_time = "2025-10-17 00:00"
    end_time = "2025-10-18 00:00"
    time_interval_hours = 0.5
    body_name = "C/2025 N1"  # Comet 3I/ATLAS
    ###########################
```



