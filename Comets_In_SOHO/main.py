'''
Main code for: 
(1) Get SOHO LASCO C3 images (jp2 format) from Helioviewer API
(2) Mark the position of a given solar system object on the images
(3) Stack the given images to make a final image with better SNR
Hengyu Ding, 2025-12
'''

### My Modules ###
from get_SOHO_data import generate_time_strings, get_SOHO_data_with_body_mark
from north_up_and_center_sun import north_up_and_center_sun
from stack_SOHO_data import main_stack, get_body_FOVlocation

### Standard Modules ###
from sunpy.coordinates.ephemeris import get_horizons_coord
import sunpy.map
from rich.progress import Progress
from datetime import datetime
from pathlib import Path
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    ### User Settings ###
    output_path = './SOHO_LASCO_C3_Data'
    if os.path.exists(output_path) is False:
        os.makedirs(output_path)
    start_time = "2025-10-17 00:00"
    end_time = "2025-10-18 00:00"
    time_interval_hours = 0.5
    body_name = "C/2025 N1"  # Comet 3I/ATLAS
    ###########################

    time_list = generate_time_strings(start_time, end_time, time_interval_hours)

    # Step 1: Download SOHO LASCO C3 images and mark the solar system object
    with Progress() as progress:
        task = progress.add_task("Downloading SOHO LASCO C3 data from Helioviewer...", total=len(time_list))
        for time in time_list:
            get_SOHO_data_with_body_mark(time, body_name, output_path)
            progress.update(task, advance=1)

    # Step 2: Reproject images to have north up and Sun centered
    with Progress() as progress:
        task = progress.add_task("Reprojecting images to north up and Sun centered...", total=len(time_list))
        for time in time_list:
            lasco_file_path = output_path + "/LASCO_C3_" + str(datetime.strptime(str(time), "%Y-%m-%d %H:%M").strftime("%Y-%m-%d %Hh%Mm")) + ".jp2"
            lasco_file = Path(lasco_file_path)
            lasco_map = sunpy.map.Map(lasco_file)  # Read JP2
            soho = get_horizons_coord('SOHO', lasco_map.date)
            lasco_map.meta['HGLN_OBS'] = soho.lon.to('deg').value
            lasco_map.meta['HGLT_OBS'] = soho.lat.to('deg').value
            lasco_map.meta['DSUN_OBS'] = soho.radius.to('m').value

            m_fixed = north_up_and_center_sun(lasco_map)

            if not os.path.exists(output_path + "/Fixed"):
                os.makedirs(output_path + "/Fixed")
            output_path_fixed = output_path + "/Fixed/Fixed_LASCO_C3_" + str(datetime.strptime(str(time), "%Y-%m-%d %H:%M").strftime("%Y-%m-%d %Hh%Mm")) + ".jp2"
            m_fixed.save(output_path_fixed, filetype='jp2')
            progress.update(task, advance=1)

    # Step 3: Stack images centered on the solar system object
    center_x = []
    center_y = []
    with Progress() as progress:
        task = progress.add_task(f"Calculating {body_name} positions...", total=len(time_list))
        for time in time_list:
            x, y = get_body_FOVlocation(time, body_name, output_path + "/Fixed")
            center_x.append(int(x * 4/56) + 2048)
            center_y.append(int(- y * 4/56) + 2048)
            progress.update(task, advance=1)
    main_stack(output_path + "/Fixed", center_x, center_y, size=200)
    


