# 后墙（Backwall Tracker）

面向空间探测载荷研制过程的项目进度与闭环助手。系统最终围绕“硬里程碑倒排、每日进展、延期风险、分层提醒、会议行动项、确认闭环”组织。

本次交付已经包含一个可操作的本地原型：

- 在“今日”主页面创建任务；
- 两步弹窗先填写任务名称、负责人、协作人、计划起止时间；
- 再逐行维护具体任务、负责人、计划完成时间和五态任务状态；
- 创建后立即显示任务名称、负责人、截止时间、具体任务及完成度；
- 可重新打开“维护任务”修改明细；
- 浏览器刷新后数据仍然保留；
- 桌面、手机和平板采用响应式布局。

详细架构见 [ref/framework_design.md](ref/framework_design.md)，原始需求见 [ref/user_demands.md](ref/user_demands.md)。

## 最快体验：只启动前端

当前任务原型使用浏览器 `localStorage` 保存数据，因此不需要先安装 PostgreSQL 或启动 Python 服务。

要求 Node.js `^20.19.0` 或 `>=22.12.0`。在项目根目录运行：

```powershell
Set-Location frontend
npm install
npm run dev
```

终端会显示访问地址，默认是 `http://localhost:5173`。打开后点击“创建任务”即可。

### 在手机上预览

1. 确保手机和电脑连接同一个 Wi-Fi；也可以让电脑连接手机热点。
2. 在电脑的 `frontend` 目录运行 `npm run dev`。
3. 查看终端输出中的 `Network` 地址，或在 Windows 中运行 `ipconfig` 查找当前 IPv4 地址。
4. 在手机浏览器访问 `http://电脑IPv4:5173/today`，不要使用 `localhost`。

例如电脑 IPv4 为 `192.168.1.20` 时，手机访问：

```text
http://192.168.1.20:5173/today
```

若电脑能打开而手机打不开，通常是 Windows 防火墙未允许 Node.js 的专用网络访问，或校园 Wi-Fi 启用了客户端隔离。优先使用同一手机热点测试；也可在 Windows 弹出的防火墙提示中仅勾选“专用网络”。电脑浏览器还可以用 Edge/Chrome 开发者工具的设备模拟功能快速检查常见手机尺寸。

使用流程：

1. 在“基本信息”填写任务名称、负责人、协作人、计划开始时间和计划完成时间。
2. 点击“下一步：具体任务”。
3. 逐行填写具体任务、该项负责人、计划完成时间与状态；用“添加一行”继续拆分。
4. 点击“创建任务”，主页面马上出现任务卡。
5. 点击卡片上的“维护任务”可继续修改；完成度按“状态为已闭环的具体任务数 ÷ 具体任务总数”计算。

> 当前数据只存在于当前浏览器、当前访问地址下。清除站点数据、使用无痕窗口或更换浏览器会丢失数据；它暂不支持跨设备、多用户同步，也不应用于保存附件或敏感材料。服务端持久化将在下一阶段接入。

## 同时启动 FastAPI 骨架（可选）

后端当前提供健康检查、配置、数据库迁移和外部服务适配边界，任务数据仍由前端本地保存。

先在项目根目录准备配置：

```powershell
Copy-Item .env.example .env
Set-Location backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

再另开终端启动前端。前端会自动探测后端：

- 健康检查：`http://localhost:8000/api/v1/health`
- OpenAPI 文档：`http://localhost:8000/docs`
- Web 页面：`http://localhost:5173`

## 项目目录

```text
Backwall_Tracker/
├─ backend/
│  ├─ app/                 FastAPI 模块化单体
│  ├─ alembic/             PostgreSQL 迁移入口
│  └─ tests/               后端测试
├─ frontend/
│  ├─ src/components/      页面公共组件和任务组件
│  ├─ src/repositories/    本地存储；后续替换为 HTTP
│  ├─ src/stores/          Pinia 状态
│  ├─ src/views/           今日、项目、导入、通知等页面
│  └─ package.json
├─ infra/nginx/            生产反向代理配置
├─ ref/                    需求与框架设计
├─ .env.example            后端与部署环境变量模板
└─ compose.yaml            PostgreSQL + API + Web 部署模板
```

## 容器部署模板

安装 Docker 的环境中，在项目根目录复制并修改配置后启动：

```bash
cp .env.example .env
docker compose up --build
```

默认 Web 入口为 `http://localhost:8080`，可用 `.env` 中的 `WEB_PORT` 调整。部署前必须：

- 将 `APP_ENV` 改为 `production`；
- 替换数据库密码和 `SECRET_KEY`；
- 限制校园网访问范围；
- 确认涉密材料只流向获准的内网 OCR/大模型服务。

## 检查与构建

```powershell
python -m compileall backend/app backend/tests
npm --prefix frontend run type-check
npm --prefix frontend run build
```

安装后端开发依赖后还可运行：

```powershell
python -m pytest backend/tests -p no:cacheprovider
```

本次已完成前端类型检查与生产构建，并完成 Python 源码编译检查。

## 当前边界与下一步

已经实现：

- Vue 3 + TypeScript + Vite + Element Plus 响应式应用；
- `TaskPlan + WorkItem` 任务聚合、本地持久化与损坏缓存防护；
- 新建/维护任务两步弹窗；
- 任务卡、明细展开、截止/逾期提示和完成度；
- FastAPI 健康检查、配置、SQLAlchemy/Alembic 基座；
- PostgreSQL、Nginx 和前后端容器模板；
- OCR、LLM、存储与通知 Provider 接口。

尚未实现：

- 真实用户登录和项目级权限；
- PostgreSQL 中的任务 CRUD 与多用户同步；
- 项目、硬里程碑、依赖和风险算法；
- 每日进展记录、附件、提醒与周报；
- 图片/PDF 的 OCR、大模型解析和人工核对。
