from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class ExtractedPage:
    page_number: int
    text: str
    confidence: float | None = None


class OCRProvider(Protocol):
    async def extract(self, source: Path) -> Sequence[ExtractedPage]:
        """Extract text without committing any business data."""


class LLMProvider(Protocol):
    async def structure(
        self,
        *,
        prompt: str,
        source_text: str,
        schema: dict[str, Any],
    ) -> dict[str, Any]:
        """Return a candidate structure that must pass human review."""


class StorageProvider(Protocol):
    async def save(
        self,
        *,
        stream: AsyncIterator[bytes],
        media_type: str,
        original_name: str,
    ) -> str:
        """Persist a stream and return an opaque storage key."""


class NotificationProvider(Protocol):
    async def send(
        self,
        *,
        recipient_ids: Sequence[str],
        title: str,
        body: str,
        dedupe_key: str,
    ) -> None:
        """Deliver one idempotent notification through a configured channel."""

