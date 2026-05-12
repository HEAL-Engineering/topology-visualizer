"""SourceAdapter — the integration seam.

This is the **only** boundary at which the system reads source data. The V0
fixture adapter in `fixture.py` reads JSON files; a future heal-api adapter
will implement the same Protocol pulling from heal-api's `dedup_*` tables.

Design intent: nothing in the writer / extractors / redactor imports from
heal-api. The heal-api adapter, when written, lives in a single sibling
file (e.g. `sources/heal_api.py`) and is the entire integration cost.

The payload is intentionally generic — `records: list[dict]` carries
source-specific shapes that the per-source extractor (V1+) will validate.
Putting per-source typing at the protocol level here would couple the
boundary to extractor internals.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Literal, Protocol, runtime_checkable
from uuid import UUID

from pydantic import BaseModel, Field

SourceName = Literal["wearable", "financial", "email", "messages"]
ALL_SOURCES: tuple[SourceName, ...] = ("wearable", "financial", "email", "messages")


class SourceDayPayload(BaseModel):
    """One day of records from a single source for a single user.

    `day` is always UTC. `records` is the raw per-source list of dicts;
    the per-source extractor knows how to parse it into features + text.
    """

    user_id: UUID
    day: date
    source: SourceName
    records: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


@runtime_checkable
class SourceAdapter(Protocol):
    """Protocol that any source backend must implement.

    Implementations:
      - `fixture.FixtureSourceAdapter`  (V0; reads from JSON files)
      - `heal_api.HealApiSourceAdapter` (post-MVP; reads from heal-api DB)
    """

    source_name: SourceName

    def list_dates(self, user_id: UUID) -> list[date]:
        """Return all UTC dates this adapter has data for, ascending."""
        ...

    def fetch_day(self, user_id: UUID, day: date) -> SourceDayPayload:
        """Return the day's payload. Empty `records` if no data exists."""
        ...

    def signature(self, user_id: UUID, day: date) -> str:
        """Stable content hash of this day's data for idempotency.

        The writer compares this to `daily_pages.data_signature[source]`;
        only recomputes the source's slice + dependent text/embeddings if
        the signature changed.
        """
        ...
