from datetime import UTC, datetime

from fastapi import APIRouter

from app.core.config import get_settings
from app.modules.health.schemas import HealthResponse

router = APIRouter(prefix="/health", tags=["system"])


@router.get("", response_model=HealthResponse, summary="服务健康检查")
async def health_check() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        status="ok",
        name=settings.APP_NAME,
        version=settings.APP_VERSION,
        environment=settings.APP_ENV,
        checked_at=datetime.now(UTC),
    )

