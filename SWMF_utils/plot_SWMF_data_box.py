'''
Aim: To visualize SWMF 3d data with pyvista volume rendering.
Modified for GM Data
Revised 25/10/31 by DHY
'''

import os

import matplotlib.pyplot as plt
import numpy as np
import pyvista
from spacepy.pybats import IdlFile

pyvista.global_theme.allow_empty_mesh = True
os.chdir(os.path.dirname(__file__))
# from plot_SWMF_Bxyz import Trace_in_box
k_b = 1.38e-23

def Trace_in_box(data_box, src_radius=100, n_src_points=100):
    # r,lon,lat = np.array(data_shl['r']),np.deg2rad(np.array(data_shl['lon'])),np.deg2rad(np.array(data_shl['lat']))
    x, y, z = np.array(data_box['x']), np.array(data_box['y']), np.array(data_box['z'])
    Bx, By, Bz = np.array(data_box['Bx']), np.array(data_box['By']), np.array(data_box['Bz'])

    xv, yv, zv = np.meshgrid(x, y, z, indexing='ij')

    mesh = pyvista.StructuredGrid(xv, yv, zv)

    vectors = np.empty((mesh.n_points, 3))
    vectors[:, 0] = Bx.ravel(order='F')
    vectors[:, 1] = By.ravel(order='F')
    vectors[:, 2] = Bz.ravel(order='F')
    mesh['vectors'] = vectors
    streams = []

    stream, src = mesh.streamlines('vectors', return_source=True, source_radius=src_radius, n_points=n_src_points,
                                   progress_bar=True,
                                   integration_direction='both')
    streams.append(stream)

    p = pyvista.Plotter()
    earth = pyvista.Sphere(center=(0, 0, 0), radius=1)
    p.add_mesh(earth, color='cyan')
    p.add_mesh(stream.tube(radius=1),color='white')
    p.show_grid()
    p.show()

    return stream


if __name__ == '__main__':
    # %%
    os.chdir("D:/PKU Undergraduate/Research/JS_He/MHD_Simulation")
    data_path = './JupiterMHD/'
    file_type = 'box_all_3_'
    n_iter = 6325255
    n_time = 930000

    # filename = file_type + 'n' + str(int(n_iter)).zfill(8)
    filename = 'box_all_3_t00930000_n06325255'

    print('Reading file: '+data_path + filename + '.out')
    data_box = IdlFile(data_path + filename + '.out')
    var_list = list(data_box.keys())
    unit_list = data_box.meta['header'].split()[1:]
    print('Variables: ', var_list)
    print('Units: ', unit_list)
    x = data_box['x']
    y = data_box['y']
    z = data_box['z']
    dimensions = data_box['grid']
    dx = np.diff(x)
    dy = np.diff(y)
    dz = np.diff(z)
    is_uniform_grid = np.allclose(dx, dx[0], rtol=1e-6, atol=1e-10) and np.allclose(dy, dy[0], rtol=1e-6, atol=1e-10) and np.allclose(dz, dz[0], rtol=1e-6, atol=1e-10)
    print('Is uniform grid:', is_uniform_grid)
    spacing = (abs(x[1] - x[0]), abs(y[1] - y[0]), abs(z[1] - z[0]))
    origin = (x[0], y[0], z[0])
    print(origin)
    print(spacing)
    print(x)
    # %%

    data_rho = data_box['Rho']
    # data_p = data_box['p']
    # data_T = (data_p / 10) / k_b / (2 * data_rho * 1e6)
    # var_str = 'T [K]'
    # plot_data = data_T

    var_str = 'Rho [amu/cc]'
    plot_data = np.array(data_box['Rho'])
    plot_p = np.array(data_box['p'])
    # var_str = '|B| [nT]'
    # plot_data = np.sqrt(data_box['Bx']**2+data_box['By']**2+data_box['Bz']**2)*1e5
    cmin = plot_data.min()
    cmax = plot_data.max()
    print(cmin,cmax)

    # plot_data = np.log10(plot_data)

    box_grid = pyvista.ImageData(dimensions=(dimensions[0], dimensions[1], dimensions[2]), spacing=spacing,
                                   origin=origin)
    box_grid.point_data[var_str] = plot_data.ravel('F')
    box_grid.point_data['Rho'] = plot_data.ravel('F')
    box_grid.point_data['p'] = plot_p.ravel('F')
    
    # Add log-scale version (symmetric log to handle positive and negative values)
    rho_log = np.sign(plot_data) * np.log10(np.abs(plot_data) + 1e-20)
    box_grid.point_data['Rho_log'] = rho_log.ravel('F')

    # Interpolation dataset for orbit sampling.
    if is_uniform_grid:
        interp_grid = box_grid
    else:
        xv, yv, zv = np.meshgrid(x, y, z, indexing='ij')
        interp_grid = pyvista.StructuredGrid(xv, yv, zv)
        interp_grid.point_data['Rho'] = plot_data.ravel('F')
        interp_grid.point_data['p'] = plot_p.ravel('F')
    # %%
    # stream_outer = Trace_in_box(data_box,src_radius=70.,n_src_points=30)
    stream_inner = Trace_in_box(data_box,src_radius=20,n_src_points=100)
    # %%

    p = pyvista.Plotter()
    
    vol = p.add_volume(box_grid, cmap='jet',
                    #    opacity= [0.0, 0.01, 0.1, 0.5, 1.0],  # 不同的取值用不同的透明度
                        opacity='sigmoid_6',             # 使用预设的sigmoid函数来调整透明度
                       opacity_unit_distance=2,         # 调整整体的透明的程度
                       show_scalar_bar=False)           # 不显示colorbar（下面的slice会显示）
      

    # p.add_mesh(stream_outer.tube(radius=0.15), color='yellow')
    # p.add_mesh(stream_inner.tube(radius=0.15),color='white')

    slices = box_grid.slice_orthogonal(x=-50, y=0, z=0)
    p.add_mesh(slices, scalars='Rho_log', cmap='jet', show_edges=False,
               scalar_bar_args={
                   'vertical': True,
                   'position_x': 0.85,
                   'position_y': 0.1,
                   'width': 0.08,
                   'height': 0.8,
                   'title': 'Rho_log',
                   'color': 'white',
                   'label_font_size': 12
               }
               # clim=[-1.3e-7,-1e-7]
               # clim=[3e-11,3e-11]
               # clim=[0.00125,0.00126]
               # clim=[0.0,0.002]
               # clim=[7.5,8.6]
               # clim=[2.497,2.505]
               # clim=[2.504-0.0005,2.504+0.001],
               # clim=[0.00021,0.00028],
               # clim=[0.003,0.007]
               # clim=[-0.003,-0.001]
               # clim = [6.03,6.06]
               )
    p.set_background("black")
    p.add_title('Global Magnetosphere', color='white', font_size=12)
    p.add_axes(color='white', line_width=2)

    # Load and plot spacecraft orbit from CSV
    orbit_csv = os.path.join(data_path, 'orbit_points.csv')
    try:
        with open(orbit_csv, 'r') as f:
            lines = [line.strip() for line in f.readlines() if line.strip()]
        
        start_idx = 0
        if lines:
            first_parts = [p.strip() for p in lines[0].split(',')]
            try:
                float(first_parts[0])
            except (ValueError, IndexError):
                start_idx = 1
        
        orbit_points_3d = []
        for line in lines[start_idx:]:
            parts = [p.strip() for p in line.split(',')]  # Strip whitespace from each part
            if len(parts) < 4:
                continue
            try:
                # Only add if all parts can be converted to float
                orbit_points_3d.append([float(parts[1]), float(parts[2]), float(parts[3])])
            except (ValueError, IndexError) as e:
                print(f"Warning: Skipping invalid orbit line: {line} ({e})")
                continue
        
        if len(orbit_points_3d) > 0:
            orbit_points_3d = np.array(orbit_points_3d)
            # Plot only orbit sampling points.
            p.add_mesh(pyvista.PolyData(orbit_points_3d), color='darkred', point_size=4)

            # Every 100th orbit point: draw a vertical line to the xy-plane (z=0).
            for idx in range(0, len(orbit_points_3d), 100):
                x0, y0, z0 = orbit_points_3d[idx]
                vertical_line = pyvista.Line((x0, y0, z0), (x0, y0, 0.0))
                p.add_mesh(vertical_line, color='darkblue', line_width=2)
        else:
            print(f"Warning: No valid orbit points loaded from {orbit_csv}")
    except Exception as e:
        print(f"Warning: Could not load orbit from {orbit_csv}: {e}")

    earth = pyvista.Sphere(center=(0, 0, 0), radius=1)
    p.add_mesh(earth, color='cyan')

    p.show()
    # path = p.generate_orbital_path(n_points=36, shift=box_grid.length)
    # viewup = [0.5, 0.5, 1]

    # path = p.generate_orbital_path(factor=2.0, shift=box_grid.length, viewup=viewup, n_points=36)

    # p.open_movie("orbit.mov")
    # p.orbit_on_path(path, write_frames=True)
    # p.close()

# %%
    # vertices = box_grid.points
    # # triangles = box_grid.faces.reshape(-1, 4)
    # plot = go.Figure()
    # plot.add_trace(go.Volume(x=vertices[:, 0], y=vertices[:, 1], z=vertices[:, 2],
    #                          opacity=0.05,
    #                          value=plot_data.ravel('F'),
    #                          isomin=1e-4,
    #                          isomax=1e-2,
    #                          surface_count=16,
    #                          showscale=True,
    #                          ))

    # py.plot(plot)
    # p.export_html(data_path + 'sample.html')
    # p.show()
    # widget = p.to_pythreejs()

    # %% Plot Rho distribution along x-axis (nearest y=0, z=0 line)
    rho_raw = np.array(data_box['Rho'])
    if rho_raw.ndim == 3:
        rho_3d = rho_raw
    else:
        rho_3d = rho_raw.reshape((dimensions[0], dimensions[1], dimensions[2]), order='F')

    y0_idx = np.argmin(np.abs(y - 0.0))
    z0_idx = np.argmin(np.abs(z - 0.0))
    rho_x = rho_3d[:, y0_idx, z0_idx]

    print(f"Using line at y={y[y0_idx]:.3f}, z={z[z0_idx]:.3f}")

    plt.figure(figsize=(8, 5))
    plt.plot(x, rho_x, color='tab:blue', linewidth=2)
    plt.xlabel('x')
    plt.ylabel('Rho [amu/cc]')
    plt.title('Rho distribution along x-axis')
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.show()

    # %% Interpolate density along satellite orbit points from CSV
    # CSV format: 4 columns (header optional)
    # col0 = time/axis (string, no conversion), col1-3 = x,y,z (float).
    # Example:
    # t,x,y,z
    # 0.0,-100,0,0
    # 1.0,-90,2,1
    orbit_csv = os.path.join(data_path, 'orbit_points.csv')
    
    # Read file and parse manually to keep col0 as string
    with open(orbit_csv, 'r') as f:
        lines = [line.strip() for line in f.readlines() if line.strip()]
    
    # Auto-detect header: skip first line if first column is not a float
    start_idx = 0
    if lines:
        first_parts = [p.strip() for p in lines[0].split(',')]
        try:
            float(first_parts[0])
        except (ValueError, IndexError):
            start_idx = 1  # Skip header line
    
    # Parse data rows
    orbit_axis = []
    orbit_points = []
    for line in lines[start_idx:]:
        parts = [p.strip() for p in line.split(',')]  # Strip whitespace from each part
        if len(parts) < 4:
            continue
        try:
            # Only add if all parts can be converted to float (except first which is string)
            orbit_axis.append(parts[0])  # Keep as string
            orbit_points.append([float(parts[1]), float(parts[2]), float(parts[3])])
        except (ValueError, IndexError) as e:
            print(f"Warning: Skipping invalid orbit line: {line} ({e})")
            continue
    
    orbit_axis = np.array(orbit_axis)  # String array
    orbit_points = np.array(orbit_points)  # Float array
    
    if len(orbit_points) == 0:
        raise ValueError(f'No valid data rows in {orbit_csv}')
    
    print(f'Loaded orbit points from {orbit_csv}, count={len(orbit_points)}')

    orbit_poly = pyvista.PolyData(orbit_points)
    orbit_sampled = orbit_poly.sample(interp_grid)

    rho_orbit = np.array(orbit_sampled['Rho']) if 'Rho' in orbit_sampled.array_names else np.full(len(orbit_points), np.nan)
    p_orbit = np.array(orbit_sampled['p']) if 'p' in orbit_sampled.array_names else np.full(len(orbit_points), np.nan)
    valid = np.isfinite(rho_orbit)
    valid_p = np.isfinite(p_orbit)

    print('Orbit interpolation results (axis, x, y, z, Rho, p):')
    for i in range(len(orbit_points)):
        print(f"{i:03d}  {orbit_axis[i]:>10s}  {orbit_points[i,0]:10.4f}  {orbit_points[i,1]:10.4f}  {orbit_points[i,2]:10.4f}  {rho_orbit[i]:.6e}  {p_orbit[i]:.6e}")

    plt.figure(figsize=(8, 5))
    valid_indices = np.where(valid)[0]
    plt.plot(orbit_axis[valid], rho_orbit[valid], color='tab:red', marker='o', linewidth=1.8)
    
    # Set x-axis ticks to show every 100th point
    if len(valid_indices) > 0:
        tick_indices = valid_indices[::100]  # Every 100th point
        tick_labels = orbit_axis[tick_indices]
        plt.xticks(range(0, len(orbit_axis[valid]), 100), tick_labels, rotation=45)
    
    plt.xlabel('Time (UTC)')
    plt.ylabel('Rho [amu/cc]')
    plt.title('Rho interpolated along orbit')
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.show()

    # Plot p distribution along orbit
    plt.figure(figsize=(8, 5))
    valid_indices_p = np.where(valid_p)[0]
    plt.plot(orbit_axis[valid_p], p_orbit[valid_p], color='tab:purple', marker='o', linewidth=1.8)

    # Set x-axis ticks to show every 100th point
    if len(valid_indices_p) > 0:
        tick_indices_p = valid_indices_p[::100]  # Every 100th point
        tick_labels_p = orbit_axis[tick_indices_p]
        plt.xticks(range(0, len(orbit_axis[valid_p]), 100), tick_labels_p, rotation=45)

    plt.xlabel('Time (UTC)')
    plt.ylabel('p[nPa]')
    plt.title('Pressure p interpolated along orbit')
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.show()

