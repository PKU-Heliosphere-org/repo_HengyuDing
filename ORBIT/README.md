# ORBIT

Orbit Rendering & Basic Interaction Toolkit：轨道数据可视化与交互分析工具。

当前版本：**v0.1 本地可运行初版**。使用 Python/FastAPI + NumPy/Astropy 后端，React/TypeScript + Three.js 前端。

- [需求与技术路线基线](codex/codex_requirement/codex_requirement.md)
- [数据、计算与接口规范](codex/codex_requirement/data_and_computation.md)
- [样例与视觉参考评审](codex/codex_requirement/reference_review/sample_review.md)
- [实现、测试结果与已知限制](codex/codex_requirement/implementation_v0.1.md)

以上 Codex 文档和参考材料集中在本地 `codex/`，已排除出 Git，不随新克隆提供。没有本地样例时可直接导入自己的 CSV，依赖原始参考样例的测试会跳过。

## 启动

本工作区已安装依赖并构建前端。在 PowerShell 中进入 `ORBIT/` 后运行：

```powershell
.\scripts\start.ps1
```

打开 <http://127.0.0.1:8765>。按 Ctrl+C 停止服务；服务停止前请将需要保留的会话保存为项目文件。启动脚本不会自动弹出窗口，可加 `-OpenBrowser` 打开浏览器，或 `-Port 8877` 更换端口。

新环境需要 Python 3.11+、Node.js 22.13+、支持 WebGL2 的桌面浏览器，先安装和构建一次：

```powershell
.\scripts\setup.ps1
.\scripts\start.ps1
```

安装需要联网，之后核心功能可离线运行。Python 安装在 `ORBIT/.venv/`，前端依赖在 `ORBIT/frontend/node_modules/`，缓存和构建产物不入版本控制。若本机 PowerShell 策略禁止本地脚本，可直接从 `ORBIT/` 执行：

```powershell
.\.venv\Scripts\python.exe -m uvicorn orbit.app:app --host 127.0.0.1 --port 8765
```

## 第一次使用

1. 点击“打开样例”，再点击“读取文件”；或自行导入 UTF-8 CSV。
2. 设置对象名称、中心天体、参考系、历元来源、时间体系和单位。默认不推断文件所代表的中心与坐标。
3. 点击“运行预检”。样例需明确勾选完全重复去重，并在行 814/815 的冲突组中选择保留项，或修正数据后重新导入；选行后再次预检。
4. 点击“添加到场景”。在左侧选择对象，通过底部时间轴回放、拖动或跳到采样点；空格播放/暂停。
5. “密切轨道”显示所选采样的圆锥曲线；“编辑参数”生成独立静态预览，可另存为假设图层。
6. “保存项目”下载 `.orbit.json`，包含原 CSV、元数据、清洗决策、图层和场景状态；“打开项目”可在服务重启后恢复，无须原 CSV 仍在原位置。

样例采用太阳中心，**暂按 J2000 赤道面**，保留待核实标记。冲突选行只影响本次导入，不修改原 CSV。测试中选择行 815 只是测试决策，不是对该行物理正确性的判断。

## 功能与边界

- CSV 预检、显式列映射、中心/参考系/历元/单位设置、完全重复去重和冲突选行。
- 多对象图层、颜色/显隐/轨迹/尾迹/标签、固定相机、坐标轴与参考平面。
- 椭圆与双曲几何、采样位置回放、线性显示插值、缺测区段断线。
- 静态密切/假设轨道、项目保存恢复、PNG 场景输出。
- **不内置行星星历，不含时间传播**；不跨中心或参考系自动变换。首版没有自由相机、关键帧或视频导出。
- 时间轴支持 1972 年起的数据；未来 UTC 使用现有闰秒表，保留告警。根数源历元与坐标参考历元分开显示。
- 超过最大显示插值间隔或数据覆盖范围时，不外推位置。标记视觉尺寸经过放大，距离为线性比例。

## 检查与开发

```powershell
.\scripts\check.ps1
```

浏览器检查需先在另一个终端启动服务，再执行 `scripts/check.ps1 -Browser`；首次会下载测试用 Chromium 到 `ORBIT/.cache/`。浏览器测试使用 8765 端口。可选性能检查：在 `frontend/` 运行 `node tests/benchmark.mjs`，它会在当前本地会话中加载 5 个合成对象，建议使用独立测试服务。

性能脚本默认强制 SwiftShader 软件渲染；加 `--hardware` 使用浏览器默认渲染路径，结果中记录实际显卡。当前硬件加速约 56 FPS，软件模式约 15 FPS，详见实现记录。

开发时可在 `ORBIT/` 启动后端，在 `frontend/` 运行 `npm run dev`，按 Vite 输出的本地地址访问。构建后通过单服务运行；API 文档位于 `/docs`。前端依赖由 `package-lock.json` 锁定，Python 已验证依赖见 `backend/requirements-lock.txt`。

所有开发文件位于本目录及其子目录。原始参考材料位于 `codex/examples/`，Codex 文档位于 `codex/codex_requirement/`，文件内容保留。初始空目录与 `config.py` 暂留，实际代码位于 `backend/src/orbit/` 与 `frontend/src/`。缓存、VS Code 配置、虚拟环境和 Codex 资料由本目录的 `.gitignore` 排除。
