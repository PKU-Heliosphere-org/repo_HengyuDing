'''
Rotate and reproject hvpy/Helioviewer LASCO JP2 Maps to have North up and Sun centered.
In preparation for image stacking.
Hengyu Ding, 2025-12
'''

import astropy.units as u
from astropy.coordinates import SkyCoord
import matplotlib.pyplot as plt
import os
import sunpy.map
from sunpy.coordinates import frames
from sunpy.map.header_helper import make_fitswcs_header
from datetime import datetime
from pathlib import Path
from sunpy.coordinates.ephemeris import get_horizons_coord
from get_SOHO_data import generate_time_strings

os.chdir(os.path.dirname(os.path.abspath(__file__)))

def north_up_and_center_sun(lasco_map, out_shape=None):
    """
    Rotate hvpy/Helioviewer LASCO JP2 Map:
    1) Rotate so that solar north is up
    2) Reproject to a WCS where the Sun center is at the image center and (0,0) is the reference point
    Return: processed SunPy Map
    """
    # ---------- 0) Output shape ----------
    if out_shape is None:  # If output image shape is not specified
        out_shape = lasco_map.data.shape  # (ny, nx) Use the original image shape as output shape

    # ---------- 1) Rotate to "north up" ----------
    # recenter=True will also adjust the reference pixel during rotation to avoid Sun center drift
    m_rot = lasco_map.rotate(recenter=True)  # Rotate image so solar north is up and recenter

    # ---------- 2) Build target WCS: Sun center at image center ----------
    ny, nx = out_shape  # Get output image height and width (pixels)
    # Pixel scale (preferably from map.scale; LASCO C3 is usually ~56 arcsec/pix)
    scale = u.Quantity([m_rot.scale.axis1, m_rot.scale.axis2])  # (xscale, yscale), get pixel scale after rotation

    # Target reference coordinate: Sun center (0,0) in Helioprojective
    # obstime/observer must inherit from original image, otherwise coordinates will be inconsistent
    ref_coord = SkyCoord(  # Construct celestial coordinate for Sun center (0,0), using rotated image's time and observer
        0 * u.arcsec, 0 * u.arcsec,
        frame=frames.Helioprojective,
        obstime=m_rot.date,
        observer=m_rot.observer_coordinate
    )

    # Target WCS header: put ref_coord at image center pixel
    out_header = make_fitswcs_header(  # Build new WCS header so Sun center (0,0) is at output image center pixel
        data=m_rot.data,
        coordinate=ref_coord,
        reference_pixel=(nx/2, ny/2) * u.pixel,  # Image center pixel as reference pixel
        scale=scale
    )

    # ---------- 3) Reproject to target WCS (the real "centered + north up" step) ----------
    m_out = m_rot.reproject_to(out_header)  # Reproject rotated image to new WCS, achieving Sun centered and north up

    return m_out  # Return the processed SunPy Map

 # -----------------------------
 # Example run: process all images in the to_stack folder
 # -----------------------------
if __name__ == "__main__":
    time_list = generate_time_strings("2025-10-17 00:00", "2025-10-18 00:00", 0.1)
    for time in time_list:
        lasco_file_path = "./test/to_stack/LASCO_C3_" + str(datetime.strptime(str(time), "%Y-%m-%d %H:%M").strftime("%Y-%m-%d %Hh%Mm")) + ".jp2"
        lasco_file = Path(lasco_file_path)
        lasco_map = sunpy.map.Map(lasco_file)  # Read JP2
        soho = get_horizons_coord('SOHO', lasco_map.date)
        lasco_map.meta['HGLN_OBS'] = soho.lon.to('deg').value
        lasco_map.meta['HGLT_OBS'] = soho.lat.to('deg').value
        lasco_map.meta['DSUN_OBS'] = soho.radius.to('m').value

        m_fixed = north_up_and_center_sun(lasco_map)

        output_path = "./test/Fixed_LASCO_C3_" + str(datetime.strptime(str(time), "%Y-%m-%d %H:%M").strftime("%Y-%m-%d %Hh%Mm")) + ".jp2"
        m_fixed.save(output_path, filetype='jp2')

    # Visualization check
    def show_map(m, title=""):
        fig = plt.figure(figsize=(6, 6))
        ax = fig.add_subplot(projection=m)
        m.plot(axes=ax)
        ax.grid(ls="--")  # Draw solar coordinate grid to check if north is up
        ax.set_title(title)
        plt.show()

    # show_map(lasco_map, "Original (JP2)")
    # show_map(m_fixed, "North Up & Sun Centered")
