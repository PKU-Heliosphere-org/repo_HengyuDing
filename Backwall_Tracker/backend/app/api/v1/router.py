from fastapi import APIRouter

from app.modules.health.router import router as health_router

router = APIRouter()
router.include_router(health_router)

# Feature routers are added here as their first real endpoints are implemented:
# auth, users, projects, tasks, today, meetings, imports, notifications, reports.

