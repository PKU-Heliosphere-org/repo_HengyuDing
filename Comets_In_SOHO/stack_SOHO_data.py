'''
Stack SOHO LASCO C3 images centered on a specified solar system object.
Hengyu Ding, 2025-12
'''

import os
import numpy as np
import matplotlib.pyplot as plt
import rasterio
from astropy.nddata import Cutout2D
from sunpy.coordinates.ephemeris import get_body_heliographic_stonyhurst, get_horizons_coord
from get_SOHO_data import generate_time_strings
import sunpy.map
from sunpy.time import parse_time
from datetime import datetime
from pathlib import Path

os.chdir(os.path.dirname(os.path.abspath(__file__)))

def get_body_FOVlocation(time, body_name, dir):
    # lasco_file = hvpy.save_file(hvpy.getJP2Image(parse_time(str(time)).datetime,
    #                                          hvpy.DataSource.LASCO_C3.value),
    #                         "./output/LASCO_C3_" + str(datetime.strptime(str(time), "%Y-%m-%d %H:%M").strftime("%Y-%m-%d %Hh%Mm")) + ".jp2", overwrite=True)
    lasco_file_path = str(dir) + "/Fixed_LASCO_C3_" + str(datetime.strptime(str(time), "%Y-%m-%d %H:%M").strftime("%Y-%m-%d %Hh%Mm")) + ".jp2"
    lasco_file = Path(lasco_file_path)
    lasco_map = sunpy.map.Map(lasco_file)
    # print(lasco_map.meta)

    soho = get_horizons_coord('SOHO', lasco_map.date)
    lasco_map.meta['HGLN_OBS'] = soho.lon.to('deg').value
    lasco_map.meta['HGLT_OBS'] = soho.lat.to('deg').value
    lasco_map.meta['DSUN_OBS'] = soho.radius.to('m').value
    BODY_NAME = get_body_heliographic_stonyhurst(
    body_name, lasco_map.date, observer=lasco_map.observer_coordinate)
    BODY_HPC = BODY_NAME.transform_to(lasco_map.coordinate_frame)
    print(lasco_map.observer_coordinate)
    x = BODY_HPC.Tx.value
    y = BODY_HPC.Ty.value

    return x, y # 返回以arcsec为单位的FOV位置


def load_jp2_image(jp2_path):
    """读取JP2图像数据并提升分辨率到4096x4096。

    实现说明：
    - 使用 `rasterio` 读取第一波段为 float32。
    - 为尽量保留细节与动态范围，先将图像线性归一化到 [0,1]，再映射到 uint8 空间进行高质量的 Lanczos 放大（Pillow 的 `Image.LANCZOS`）。
    - 放大后再反归一化回原始数据范围并返回 `float32` 数组。
    备注：此实现避免使用 `cv2`，从而降低与 `numpy` 版本冲突的风险。若需更高精度，可考虑安装并使用 `scipy` 或 `scikit-image` 的高阶插值。
    """
    from PIL import Image

    with rasterio.open(jp2_path) as src:
        img = src.read(1).astype(np.float32)  # 读取第一波段并转为浮点型

        # 记录原始最小/最大以便放大后反归一化（保留动态范围）
        minv = np.min(img)
        maxv = np.max(img)

        if maxv - minv > 0:
            img_norm = (img - minv) / (maxv - minv)  # 归一化到0-1
        else:
            img_norm = np.zeros_like(img, dtype=np.float32)

        # 将归一化图像映射到uint8以便Pillow高质量重采样（保留细节与速度的折中）
        img_uint8 = (img_norm * 255.0).round().astype(np.uint8)

        pil = Image.fromarray(img_uint8)
        pil_up = pil.resize((4096, 4096), resample=Image.LANCZOS)
        up_uint8 = np.array(pil_up)

        # 反归一化回原始数值范围并返回float32
        up_float = up_uint8.astype(np.float32) / 255.0
        up_float = up_float * (maxv - minv) + minv

        return up_float
        # return img


def crop_region(image, center_x, center_y, size):
    """以指定像素为中心裁剪size×size区域"""
    # 确保裁剪区域在图像范围内
    half_size = size // 2
    y_max, x_max = image.shape[:2]
    
    # 计算裁剪区域坐标（处理边缘情况）
    x_start = max(0, int(center_x - half_size))
    x_end = min(x_max, int(center_x + half_size))
    y_start = max(0, int(center_y - half_size))
    y_end = min(y_max, int(center_y + half_size))
    
    # 使用Cutout2D确保输出为size x size（边缘用边缘像素填充）
    cutout = Cutout2D(
        image,
        position=(center_x, center_y),
        size=size,
        mode='trim'  # 边缘填充方式：trim；还可以使用partial, strict
    )
    return cutout.data


def stack_images(cropped_regions, stack_mode='mean'):
    """对裁剪区域进行叠加（平均值或中位数）"""
    regions_array = np.array(cropped_regions)  # 转换为(n, 50, 50)数组
    
    if stack_mode == 'mean':
        return np.mean(regions_array, axis=0)
    elif stack_mode == 'median':
        return np.median(regions_array, axis=0)
    else:
        raise ValueError("Stack mode must be 'mean' or 'median'")


def normalize_image(image):
    """归一化图像到0-255范围（便于显示和保存）"""
    min_val = np.min(image)
    max_val = np.max(image)
    if max_val - min_val == 0:
        return np.zeros_like(image, dtype=np.uint8)
    return ((image - min_val) / (max_val - min_val) * 255).astype(np.uint8)

def save_result(image, output_path, title):
    """保存叠加结果为PNG图片"""
    plt.figure(figsize=(8, 8))
    plt.imshow(image, cmap='gray', origin='upper')
    plt.colorbar(label='brightness')
    plt.title(title)
    plt.tight_layout()
    # plt.plot(250, 250, marker='x', color='red')  # 标记中心位置
    plt.savefig(output_path, dpi=600)
    plt.close()


def main_stack(jp2_dir, center_x, center_y, size, output_dir='stack_results'):
    """主函数：处理流程控制"""
    # 创建输出目录
    os.makedirs(output_dir, exist_ok=True)
    
    # 获取所有JP2文件
    jp2_files = [f for f in os.listdir(jp2_dir) if f.lower().endswith('.jp2')]
    if not jp2_files:
        raise ValueError(f"No JP2 files found in directory {jp2_dir}")
    
    # 批量读取并裁剪
    cropped_regions = []
    for i, filename in enumerate(jp2_files):
        jp2_path = os.path.join(jp2_dir, filename)
        try:
            image = load_jp2_image(jp2_path)
            crop = crop_region(image, center_x[i], center_y[i], size)
            cropped_regions.append(crop)
            print(f"Processed {i+1}/{len(jp2_files)}: {filename}")
        except Exception as e:
            print(f"Failed to process {filename}: {str(e)}")
    
    if not cropped_regions:
        raise ValueError("No images were successfully processed, stacking cannot proceed.")
    
    # 执行两种模式叠加
    mean_stack = stack_images(cropped_regions, 'mean')
    median_stack = stack_images(cropped_regions, 'median')
    
    # 归一化并保存结果
    mean_norm = normalize_image(mean_stack)
    median_norm = normalize_image(median_stack)
    
    save_result(mean_norm, os.path.join(output_dir, 'mean_stack.png'), 
                f'mean ({len(cropped_regions)}frames)')
    save_result(median_norm, os.path.join(output_dir, 'median_stack.png'), 
                f'median ({len(cropped_regions)}frames)')
    
    print(f"Stacking complete! Results saved in {output_dir} directory.")


if __name__ == "__main__":
    # -------------------------- 参数配置 --------------------------
    JP2_DIR = "./test"  # 需要堆叠的JP2图像目录
    time_list = generate_time_strings("2025-10-17 00:00", "2025-10-18 00:00", 0.1) # 具体时间根据to_stack当中的时间范围调整！现在还没有那么自动化
    center_x = []
    center_y = []
    for time in time_list:
        x, y = get_body_FOVlocation(time, "C/2025 N1", "./SOHO_LASCO_C3_Data/Fixed")
        # 在python中，左上角为(0,0)，x向右增大，y向下增大。而现在获取的x,y是以中心为(0,0)，x向右增大，y向上增大。
        # 在1024x1024的尺寸下每一个像素对应56角秒。
        print(f"Time {time} coordinates: {x/3600}, {y/3600}")
        center_x.append(int(x*4/56)+2048) # 图片的像素坐标系：左上角为(0,0)，x向右增大，y向下增大
        center_y.append(int(-y*4/56)+2048)
        # print(center_x[-1], center_y[-1])

    # --------------------------------------------------------------    
    main_stack(JP2_DIR, center_x, center_y, size=200)