"""V0 fixture-backed SourceAdapter.

Reads a JSON file with shape:

{
  "user_id": "<uuid>",
  "days": {
    "2026-04-01": {
       "wearable":  [...source records...],
       "financial": [...],
       "email":     [...],
       "messages":  [...]
    },
    "2026-04-02": { ... }
  }
}

One adapter instance is bound to one source name; instantiate four to expose
all sources. Mirrors the future heal-api adapter shape (one adapter per
source) so V1+ extractors can stay source-isolated.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Any
from uuid import UUID

from .base import SourceDayPayload, SourceName


class FixtureSourceAdapter:
    """Reads source data for one source from a JSON fixture file."""

    source_name: SourceName

    def __init__(self, source_name: SourceName, fixture_path: Path) -> None:
        self.source_name = source_name
        self._fixture_path = fixture_path
        self._raw: dict[str, Any] = json.loads(fixture_path.read_text())
        self._user_id = UUID(self._raw["user_id"])
        self._days: dict[str, dict[str, list[dict[str, Any]]]] = self._raw.get("days", {})

    def list_dates(self, user_id: UUID) -> list[date]:
        if user_id != self._user_id:
            return []
        return sorted(date.fromisoformat(d) for d in self._days)

    def fetch_day(self, user_id: UUID, day: date) -> SourceDayPayload:
        if user_id != self._user_id:
            return SourceDayPayload(user_id=user_id, day=day, source=self.source_name)
        records = self._days.get(day.isoformat(), {}).get(self.source_name, [])
        return SourceDayPayload(
            user_id=user_id,
            day=day,
            source=self.source_name,
            records=records,
        )

    def signature(self, user_id: UUID, day: date) -> str:
        payload = self.fetch_day(user_id, day)
        canonical = json.dumps(
            payload.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(canonical.encode()).hexdigest()
