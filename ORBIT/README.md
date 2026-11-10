# ORBIT

Orbit Rendering & Basic Interaction Toolkit：轨道数据可视化与交互分析工具。

当前版本 **v0.2**。采用本地 Python/FastAPI + NumPy/Astropy/SPICE 后端、React/TypeScript + Three.js 界面，支持 CSV 轨迹回放、自由三维视角和八大行星图层。

## 启动

在 PowerShell 中进入 `ORBIT/`：

```powershell
.\scripts\start.ps1
```

访问 <http://127.0.0.1:8765>。按 Ctrl+C 停止；停止前请保存项目文件。可加 `-OpenBrowser` 打开浏览器，或 `-Port 8877` 更换端口。升级后请先保存原会话，再重启服务加载新版后端。

新环境需要 Python 3.11+、Node.js 22.13+ 和支持 WebGL2 的桌面浏览器：

```powershell
.\scripts\setup.ps1
.\scripts\start.ps1
```

安装会下载依赖和约 33 MB 的 JPL/NAIF 星历；之后可离线运行。Python 环境位于 `.venv/`，前端依赖位于 `frontend/node_modules/`。若已有 v0.1 环境，可运行：

```powershell
.\.venv\Scripts\python.exe -m pip install -e ".\backend[test]"
.\.venv\Scripts\python.exe scripts\fetch_ephemeris.py
Set-Location frontend
npm ci
npm run build
Set-Location ..
```

若本机策略禁止 PowerShell 脚本，可从 `ORBIT/` 直接启动：

```powershell
.\.venv\Scripts\python.exe -m uvicorn orbit.app:app --host 127.0.0.1 --port 8765
```

## 行星和视角

1. 点击“添加行星”，选择八大行星中的一个或多个。空场景可设置太阳/地球中心、J2000 赤道系/J2000 黄道系及初始 UTC；已有场景沿用其中心和参考系。
2. 远处显示对应颜色的发光点；靠近时平滑切换为真实尺寸的纹理球体。选择行星后点击“聚焦表面”可直接观察近景。土星包含环。
3. 鼠标左键拖动可自由旋转、翻越极点并倒置画面；滚轮缩放，右键拖动平移。工具栏提供标准视角、恢复总览、聚焦、跟随和左右滚转。
4. 聚焦行星后会跟随其位置，保持当前观察方向；播放时间和调整窗口尺寸不会重置视角。可关闭跟随，或切换总览。
5. 地球使用昼夜两张纹理，可开启零度经线；日照方向、自转和经线与全局时间同步。其他行星使用连续的明暗过渡。可选星空背景。
6. 图层可独立显隐、改名、改色和开关标签。行星的“轨迹”显示当前缓存时间窗口内的路径，并非完整轨道。

行星尺寸和空间距离使用真实比例；发光点属于远距离可见性增强。近景太阳光为几何方向，未模拟食、折射、大气散射、云层或地形。

## CSV 和项目

1. 导入 UTF-8 CSV，或使用本地“打开样例”。指定列映射、对象名、中心天体、参考系、历元来源、时间体系和单位。
2. 运行预检，处理重复项和冲突行，再添加到场景。预检与选行不会修改原 CSV。
3. 时间轴可回放、拖动、跳转采样；空格播放/暂停。“密切轨道”显示所选采样的圆锥曲线，“编辑参数”产生独立静态假设图层。
4. “保存项目”下载 `.orbit.json`，包括 CSV 内容、清洗决策、图层、时间、视角和跟随状态。“打开项目”可在服务重启后恢复。也支持仅含行星的项目和 PNG 导出。

v0.2 写入项目格式 2，兼容读取 v0.1 格式 1。星历和纹理不嵌入项目文件，接收项目的机器需先完成本地安装。

CSV 对象仍只回放采样数据、进行显示插值和静态圆锥曲线计算，**不进行轨道时间传播**；不在不同中心或参考系的 CSV 之间自动转换。超过允许插值间隔或数据覆盖范围时不外推。

本地参考样例按用户确认采用太阳中心、暂按 J2000 赤道面，保留待核实标记。样例的冲突行选择只是导入决策，并非物理正确性判断。

## 数据模型与精度

- 本地使用 JPL `de440s.bsp` 和 NAIF `pck00011.tpc`，存于 `data/ephemeris/`；下载脚本生成来源和 SHA-256 清单。运行期间不访问星历网络服务。重新下载可单独执行 `scripts/fetch_ephemeris.py`。
- 行星支持 1972-01-01 至 2150-01-01 UTC。位置为同一时刻的几何位置，不含光行时和像差修正。水星、金星和地球使用行星中心；火星、木星、土星、天王星和海王星使用对应系统质心近似行星中心，界面有说明。
- 后端按至多一小时采样返回位置、速度和姿态；前端使用三次 Hermite 位置插值、四元数 SLERP 姿态插值，不在缓存窗口外外推。快速播放时会预取，缓冲未就绪时等待。
- 地球使用 IAU 2006/2000A 与本地 IERS 的 UT1、极移计算姿态，区分观测值、预测值和近似值。超出覆盖时采用 UT1≈UTC、极移为零，界面显示精度限制；未来 UTC 使用当前已知闰秒表。
- 其他行星使用 PCK 中的 IAU 名义定向模型，属于可视化近似。地球纹理中央对应零度经线，东经方向、极轴和太阳光照使用同一姿态变换。
- 时间内部使用连续 TAI 秒；坐标参考历元与数据历元分开显示。高精度测绘、任务导航和长期地球定向预测需更精细的数据与模型。

数据来源：[JPL 星历](https://ssd.jpl.nasa.gov/planets/eph_export.html)、[NAIF PCK](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc)、[Astropy IERS](https://docs.astropy.org/en/stable/utils/iers.html)。纹理由用户提供于 `textures/`。

## 检查与开发

```powershell
.\scripts\check.ps1
```

浏览器检查需先在另一终端启动独立测试服务，再执行：

```powershell
.\scripts\check.ps1 -Browser -Port 8877
```

测试服务的端口需与参数一致；首次浏览器检查下载 Chromium 到 `.cache/`。性能检查会导入合成数据，建议只对独立测试服务运行：

```powershell
Set-Location frontend
$env:ORBIT_TEST_URL = 'http://127.0.0.1:8877'
node tests/benchmark.mjs --hardware
```

省略 `--hardware` 使用 SwiftShader。开发时在 `ORBIT/` 启动后端，在 `frontend/` 运行 `npm run dev`；API 文档位于 `/docs`。依赖锁定见 `frontend/package-lock.json`、`backend/requirements-lock.txt`。

全部开发文件位于 `ORBIT/`。缓存、星历下载、VS Code 配置、虚拟环境和 `codex/` 由本目录 `.gitignore` 排除。参考样例在 `codex/examples/`，不随新克隆提供；依赖参考样例的测试在缺文件时跳过。

本地 Codex 文档（已按要求排除 Git）：

- [需求与技术路线](codex/codex_requirement/codex_requirement.md)
- [数据、计算与接口规范](codex/codex_requirement/data_and_computation.md)
- [v0.1 实现记录](codex/codex_requirement/implementation_v0.1.md)
- [v0.2 实现与验证](codex/codex_requirement/implementation_v0.2.md)
