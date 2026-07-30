import httpx
import pytest

from app.main import app


@pytest.mark.asyncio
async def test_health_check() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/v1/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["name"] == "后墙 Backwall Tracker"
    assert payload["version"] == "0.1.0"
