'''
Get SOHO LASCO C3 FOV data for a given date range & Mark a specific solar system body, ephemeris retrived from JPL Horizons.
Hengyu Ding, 2025-11
'''
import os
import hvpy
import matplotlib.pyplot as plt
import sunpy.map
from sunpy.coordinates.ephemeris import get_body_heliographic_stonyhurst, get_horizons_coord
# [IMPORTANT] Before running this code, make sure you have revised get_body_heliographic_stonyhurst function. See details in the README.md file.
from astropy import units as u
from sunpy.time import parse_time
from datetime import datetime, timedelta
from rich.progress import Progress
from astropy.coordinates import solar_system_ephemeris
solar_system_ephemeris.set('de430')


os.chdir(os.path.dirname(os.path.abspath(__file__)))

def generate_time_strings(start, end, interval_hours):
    start_dt = datetime.strptime(start, "%Y-%m-%d %H:%M")
    end_dt = datetime.strptime(end, "%Y-%m-%d %H:%M")
    delta = timedelta(hours=interval_hours)
    result = []
    current = start_dt
    while current <= end_dt:
        result.append(current.strftime("%Y-%m-%d %H:%M"))
        current += delta
    return result

def get_SOHO_data_with_body_mark(time, body_name, output_path='./SOHO_LASCO_C3_Data'):
    lasco_file = hvpy.save_file(hvpy.getJP2Image(parse_time(str(time)).datetime,
                                             hvpy.DataSource.LASCO_C3.value),
                            output_path + "/LASCO_C3_" + str(datetime.strptime(str(time), "%Y-%m-%d %H:%M").strftime("%Y-%m-%d %Hh%Mm")) + ".jp2", overwrite=True)
    lasco_map = sunpy.map.Map(lasco_file)

    soho = get_horizons_coord('SOHO', lasco_map.date)

    lasco_map.meta['HGLN_OBS'] = soho.lon.to('deg').value
    lasco_map.meta['HGLT_OBS'] = soho.lat.to('deg').value
    lasco_map.meta['DSUN_OBS'] = soho.radius.to('m').value

    BODY_NAME = get_body_heliographic_stonyhurst(
    body_name, lasco_map.date, observer=lasco_map.observer_coordinate)
    BODY_HPC = BODY_NAME.transform_to(lasco_map.coordinate_frame)
    print(f"{body_name} HPC coordinates at {lasco_map.date}: {BODY_HPC.Tx}, {BODY_HPC.Ty}")

    fig = plt.figure()
    ax = fig.add_subplot(projection=lasco_map)

    # Let's tweak the axis to show in degrees instead of arcsec
    lon, lat = ax.coords
    lon.set_major_formatter('d.dd')
    lat.set_major_formatter('d.dd')

    ax.plot_coord(BODY_HPC, 's', color='white', fillstyle='none', markersize=12, label=str(body_name))
    lasco_map.plot(axes=ax)
    time_file_name = datetime.strptime(str(time), "%Y-%m-%d %H:%M").strftime("%Y%m%dT%H%M%S")
    plt.savefig(output_path + '/3I_in_SOHO_FOV_' + time_file_name + '.png', dpi=600)
    # plt.show()

if __name__ == "__main__":
    '''
    User settings:
    - output directory to save downloaded SOHO LASCO C3 data and marked images
    - time range to download SOHO LASCO C3 data (YYYY-MM-DD HH:MM format)
    - solar system body name to mark in the images
    '''
    ### User Settings ###
    output_path = './SOHO_LASCO_C3_Data'
    if os.path.exists(output_path) is False:
        os.makedirs(output_path)
    
    start_time = "2025-10-17 00:00"
    end_time = "2025-10-26 00:00"
    time_interval_hours = 1  # e.g., every 1 hours
    body_name = "C/2025 N1"
    ######################
    
    time_list = generate_time_strings(start_time, end_time, time_interval_hours)

    with Progress() as progress:
        task = progress.add_task("Downloading SOHO LASCO C3 data...", total=len(time_list))
        for time in time_list:
            get_SOHO_data_with_body_mark(time, body_name)
            progress.update(task, advance=1)