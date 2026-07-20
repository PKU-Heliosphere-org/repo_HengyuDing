import glob
import os

import imageio.v2 as imageio
import matplotlib.pyplot as plt
import numpy as np
from scipy.interpolate import griddata
from spacepy.pybats import IdlFile

os.chdir("D:/PKU Undergraduate/Research/JS_He/MHD_Simulation")

data_path = './JupiterMHD/Test14-50000steady+200physical/200h/IO2(200h)_plane/'
file_name = 'z=0_var_1'
# n_iters = np.linspace(100, 5000, 50)

file_list = glob.glob(data_path + file_name + '_*.out')
full_file_name = [s[len(data_path):] for s in file_list]


axes_str = 'xyz'
cut_str = file_name[0]
axis1_str = axes_str.replace(cut_str,'')[0]
axis2_str = axes_str.replace(cut_str,'')[1]
print('Read data '+cut_str+'=0, plot on '+axis1_str+'O'+axis2_str+' plane...')

# test_data = IdlFile(data_path + '' + file_name + '_n' +  str(int(1000)).zfill(8) + '.out')
test_data = IdlFile(str(file_list[1]))
var_list = list(test_data.keys())
unit_list = test_data.meta['header'].split()[1:]
print('Variables: ', var_list)
print('Units: ', unit_list)
print('Supported derived variables: Btot [nT], U [km/s], SwU [km/s], HpU [km/s], H2OpU [km/s]')
# Check grid type
print('\nGrid information:')
print('Grid array content: ', test_data['grid'])
print('Grid shape: ', test_data['grid'].shape if hasattr(test_data['grid'], 'shape') else type(test_data['grid']))
if 'connectivity' in test_data.keys():
    print('Connectivity info available')
if 'x' in test_data.keys():
    print(f'Number of grid points: {len(test_data["x"])}')
# Print all available keys to understand data structure
print('\nAll available data keys:')
all_keys = list(test_data.keys())
for key in all_keys[:20]:  # Print first 20 keys
    print(f'  {key}: {test_data[key].shape if hasattr(test_data[key], "shape") else type(test_data[key])}')

plot_var = input('Input Plot Var: ', )
# plot_var = 'SwRho'
is_derived= False
if plot_var in var_list:
    plot_ind = var_list.index(plot_var)
    plot_unit = unit_list[plot_ind]
    plot_var_min = test_data[plot_var].min()
    plot_var_max = test_data[plot_var].max()
else:
    if plot_var == 'Btot':
        plot_unit = 'nT'
        # plot_var_min = 2.765
        # plot_var_max = 2.777
        is_derived = True
    elif plot_var == 'SwU':
        plot_unit= 'km/s'
        plot_var_min = np.nanmin(np.sqrt(test_data['SwUx']**2+test_data['SwUy']**2+test_data['SwUz']**2))
        plot_var_max = np.nanmax(np.sqrt(test_data['SwUx']**2+test_data['SwUy']**2+test_data['SwUz']**2))
        is_derived = True
    elif plot_var == 'HpU':
        plot_unit = 'km/s'
        plot_var_min = np.nanmin(np.sqrt(test_data['HpUx'] ** 2 + test_data['HpUy'] ** 2 + test_data['HpUz'] ** 2))
        plot_var_max = np.nanmax(np.sqrt(test_data['HpUx'] ** 2 + test_data['HpUy'] ** 2 + test_data['HpUz'] ** 2))
        is_derived = True
    elif plot_var == 'H2OpU':
        plot_unit = 'km/s'
        plot_var_min = np.nanmin(np.sqrt(test_data['H2OpUx'] ** 2 + test_data['H2OpUy'] ** 2 + test_data['H2OpUz'] ** 2))
        plot_var_max = np.nanmax(np.sqrt(test_data['H2OpUx'] ** 2 + test_data['H2OpUy'] ** 2 + test_data['H2OpUz'] ** 2))
        is_derived = True
    elif plot_var == 'U':
        plot_unit = 'km/s'
        plot_var_min = np.nanmin(np.sqrt(test_data['ux'] ** 2 + test_data['uy'] ** 2 + test_data['uz'] ** 2))
        plot_var_max = np.nanmax(np.sqrt(test_data['ux'] ** 2 + test_data['uy'] ** 2 + test_data['uz'] ** 2))
        is_derived = True

print('Plot variable '+plot_var+', unit: '+plot_unit+'...')

is_log = input('Log data?(y/n): ',)
if is_log=='y' or is_log=='Y':
    is_log = True
else:
    is_log = False
do_plot_Blines = input('Plot magnetic field lines?(y/n): ',)
if do_plot_Blines=='y' or do_plot_Blines=='Y':
    do_plot_Blines = True
else:    
    do_plot_Blines = False

do_plot_cells = input('Plot cell boundaries?(y/n): ',)
if do_plot_cells=='y' or do_plot_cells=='Y':
    do_plot_cells = True
else:    
    do_plot_cells = False

if is_log:
    if not os.path.exists(data_path + 'log10_' + plot_var + '_viz/'):
        os.mkdir(data_path + 'log10_' + plot_var + '_viz/')
else:
    if not os.path.exists(data_path + plot_var + '_viz/'):
        os.mkdir(data_path + plot_var + '_viz/')

if not os.path.exists(data_path  + 'movies/'):
    os.mkdir(data_path  + 'movies/')

frames = []

# Plot window and shape controls.
# Keep equal data-unit length using ax.set_aspect('equal'),
# and make the figure flatter by reducing fig_height.
xlim = (-300, 100)
ylim = (-150, 150)
# xlim = (-30,30)
# ylim = (-30,30)
fig_height = 4.2
data_ratio = (xlim[1] - xlim[0]) / (ylim[1] - ylim[0])
fig_width = fig_height * data_ratio + 1.4

# for n_iter in n_iters:
for i in range(len(file_list)):

    # file_str = file_name + '_n' + str(int(n_iter)).zfill(8)
    data_2d = IdlFile(file_list[i])
    print(str(i)+' grid num: ',data_2d['grid'])
    fig, ax = plt.subplots(figsize=(fig_width, fig_height))

    if is_derived:
        if plot_var=='Btot':
            plot_data = np.sqrt(data_2d['bx']**2+data_2d['by']**2+data_2d['bz']**2)
            plot_var_min = plot_data.min()
            plot_var_max = plot_data.max()
        elif plot_var=='U':
            plot_data = np.sqrt(data_2d['ux']**2+data_2d['uy']**2+data_2d['uz']**2)
        elif plot_var=='SwU':
            plot_data = np.sqrt(data_2d['SwUx']**2+data_2d['SwUy']**2+data_2d['SwUz']**2)
        elif plot_var=='HpU':
            plot_data = np.sqrt(data_2d['HpUx']**2+data_2d['HpUy']**2+data_2d['HpUz']**2)
        elif plot_var=='H2OpU':
            plot_data = np.sqrt(data_2d['H2OpUx']**2+data_2d['H2OpUy']**2+data_2d['H2OpUz']**2)
    
    if plot_var == 'ux':
        plot_data = data_2d[plot_var]
        plot_var_min = -400
        plot_var_max = 400
    
    else:
        plot_data = data_2d[plot_var]
        plot_var_min = data_2d[plot_var].min()
        plot_var_max = data_2d[plot_var].max()

    if is_log:
        plot_var_min = np.log10(plot_var_min)
        plot_var_max = np.log10(plot_var_max)

    levels = np.linspace(plot_var_min, plot_var_max, 500)

    if not is_log:
        # tpc = ax.tripcolor(data_2d[axis1_str], data_2d[axis2_str], np.array(plot_data))
        tpc = ax.tricontourf(data_2d[axis1_str], data_2d[axis2_str], np.array(plot_data), levels=levels, extend='both')
        # tpc = ax.tripcolor(data_2d[axis1_str], data_2d[axis2_str], np.array(plot_data), shading='flat')
        # tpc = ax.tricontour(data_2d[axis1_str], data_2d[axis2_str], np.array(plot_data), levels=levels)
        # plt.clabel(tpc, inline=True, fontsize=8, fmt="%.2f")  # 在等高线上标注数值
        # plt.title(plot_var + ' [' + plot_unit + '] (n' + str(int(n_iters[i])).zfill(8) + ')')
        plt.title(plot_var + ' [' + plot_unit + '] (' + full_file_name[i] + ')')
    else:
        # tpc = ax.tripcolor(data_2d[axis1_str], data_2d[axis2_str], np.log10(np.array(plot_data)))
        tpc = ax.tricontourf(data_2d[axis1_str], data_2d[axis2_str], np.log10(np.array(plot_data)), levels=levels, extend='both')
        # tpc = ax.tripcolor(data_2d[axis1_str], data_2d[axis2_str], np.log10(np.array(plot_data)), shading='flat')
        # tpc = ax.tricontour(data_2d[axis1_str], data_2d[axis2_str], np.log10(np.array(plot_data)), levels=levels)
        # plt.clabel(tpc, inline=True, fontsize=8, fmt="%.2f")  # 在等高线上标注数值
        # plt.title('log10('+plot_var + ') [' + plot_unit + '] (n' + str(int(n_iters[i])).zfill(8) + ')')
        plt.title('log10('+plot_var + ') [' + plot_unit + '] (' + full_file_name[i] + ')')
    # plt.scatter(data_2d['x'],data_2d['y'],s=1.)
    plt.colorbar(tpc)
    tpc.set_clim(plot_var_min, plot_var_max)
    # tpc.set_cmap('jet')
    tpc.set_cmap('coolwarm') 
    ax.set_xlim(*xlim)
    ax.set_ylim(*ylim)
    ax.set_aspect('equal', adjustable='box')
    # plt.xlim(-50, 50)
    # plt.ylim(-50, 50)
    plt.xlabel(axis1_str+'['+unit_list[1]+']')
    plt.ylabel(axis2_str+'['+unit_list[2]+']')

    # Plot magnetic field lines.
    # if plot_var!='Btot':
    if do_plot_Blines:
        x = data_2d[axis1_str]
        y = data_2d[axis2_str]
        bx = data_2d['bx']
        by = data_2d['bz']
        xi = np.linspace(x.min(), x.max(), 500)
        yi = np.linspace(y.min(), y.max(), 500)
        X, Y = np.meshgrid(xi, yi)
        BX = griddata((x, y), bx, (X, Y), method='linear')
        BY = griddata((x, y), by, (X, Y), method='linear')
        
        ax.streamplot(X, Y, BX, BY, color='white', linewidth=0.2, density=2, arrowsize=0.5, arrowstyle='->', broken_streamlines=False)
    
    # Plot grid points (cell centers).
    if do_plot_cells:
        x = data_2d[axis1_str]
        y = data_2d[axis2_str]
        ax.scatter(x, y, s=1, c='black', alpha=0.5, edgecolors='none')

    if is_log:
        plt.savefig(data_path + 'log10_' + plot_var + '_viz/' +  full_file_name[i] + '.png', dpi=300)
        # plt.show()
        plt.close()
        frames.append(imageio.imread(data_path + 'log10_' + plot_var + '_viz/' + full_file_name[i] + '.png'))
    else:
        plt.savefig(data_path + plot_var + '_viz/' +  full_file_name[i] + '.png', dpi=300)
        # plt.show()
        plt.close()
        frames.append(imageio.imread(data_path + plot_var + '_viz/' + full_file_name[i] + '.png'))

print('Done with plot, generating movie...')
if is_log:
    imageio.mimsave(data_path  + 'movies/' + 'log10_' + plot_var + '_' + full_file_name[i] + '.gif', frames, fps=4)
    imageio.mimsave(data_path  + 'movies/' + 'log10_' + plot_var + '_' + full_file_name[i] + '.mp4', frames, fps=12)
    print('Plots in '+data_path + 'log10_' + plot_var + '_viz/' +' and movies in '+data_path  + 'movies/')
else:
    imageio.mimsave(data_path  + 'movies/' + plot_var + '_' + full_file_name[i] + '.gif', frames, fps=4)
    imageio.mimsave(data_path  + 'movies/' + plot_var + '_' + full_file_name[i] + '.mp4', frames, fps=12)
    print('Plots in '+data_path + plot_var + '_viz/' +' and movies in '+data_path  + 'movies/')


