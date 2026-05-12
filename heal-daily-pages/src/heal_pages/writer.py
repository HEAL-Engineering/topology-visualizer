"""daily_pages writer plumbing.

V0 lands the entry point + the Pydantic metadata contract. Extractors land
in V1+; until then `write_daily_page()` is callable but only with empty
extractor outputs (used by tests).

Idempotency model:
  - The caller passes the per-source `data_signature` map (sha256 of each
    source's records for that day).
  - The writer compares against the existing row's `data_signature`. Only
    sources whose hash changed need their slice + dependent text/embedding
    recomputed. V0 implements this as a full upsert; the per-source diffing
    optimization lands in V1 alongside the wearable extractor.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .config import TEMPLATE_VERSION, WHEEL_WEIGHTS_VERSION
from .models import DailyPage, DailyPageQuarantine
from .redact import RedactionResult


# ─────────────────────── Metadata Pydantic contract ─────────────────────────
class WheelScores(BaseModel):
    physical: float = 0.0
    emotional: float = 0.0
    intellectual: float = 0.0
    social: float = 0.0
    spiritual: float = 0.0
    occupational: float = 0.0
    financial: float = 0.0
    environmental: float = 0.0


class SourcePresence(BaseModel):
    wearable: bool = False
    financial: bool = False
    email: bool = False
    messages: bool = False


class RedactionStats(BaseModel):
    entities_found: int = 0
    types: list[str] = Field(default_factory=list)


class DailyPageMetadata(BaseModel):
    """JSONB shape for `daily_pages.metadata`. Validated at write time."""

    wheel_scores: WheelScores = Field(default_factory=WheelScores)
    wheel_contributions: dict[Literal["wearable", "financial", "email", "messages"], dict[str, float]] = Field(
        default_factory=dict
    )
    wheel_weights_version: int = WHEEL_WEIGHTS_VERSION
    source_presence: SourcePresence = Field(default_factory=SourcePresence)
    trajectory_warm: bool = False
    tags: list[str] = Field(default_factory=list)
    template_version: str = TEMPLATE_VERSION
    embedding_model_version: str | None = None
    presidio_version: str | None = None
    redaction_stats: RedactionStats = Field(default_factory=RedactionStats)
    errors: list[dict[str, Any]] = Field(default_factory=list)


# ─────────────────────── Writer ─────────────────────────────────────────────
def write_daily_page(
    session: Session,
    *,
    user_id: UUID,
    day: date,
    page_text: str,
    redaction: RedactionResult,
    metadata: DailyPageMetadata,
    data_signature: dict[str, str],
    base_features: list[float] | None = None,
    trajectory_features: list[float] | None = None,
    text_embed: list[float] | None = None,
) -> Literal["written", "quarantined"]:
    """Upsert a daily_pages row, or route to quarantine if redaction flagged.

    Returns 'written' if the row landed in `daily_pages`, 'quarantined' if
    the post-validator caught missed PII and the row went to
    `daily_pages_quarantine` instead.

    Caller must have already redacted `page_text` via `redact.redact()` and
    passed the resulting `RedactionResult`. The writer trusts that contract.
    """
    if redaction.quarantine:
        session.add(
            DailyPageQuarantine(
                user_id=user_id,
                date=day,
                raw_redacted_text=redaction.text,
                validator_findings={
                    "patterns_matched": redaction.validator_findings,
                    "presidio_version": redaction.presidio_version,
                },
            )
        )
        return "quarantined"

    # Stamp redaction stats into metadata before write.
    metadata.redaction_stats = RedactionStats(
        entities_found=redaction.entities_found,
        types=redaction.types,
    )
    metadata.presidio_version = redaction.presidio_version

    metadata_json = metadata.model_dump(mode="json")

    stmt = pg_insert(DailyPage).values(
        user_id=user_id,
        date=day,
        base_features=base_features,
        trajectory_features=trajectory_features,
        text_embed=text_embed,
        page_text=page_text,
        data_signature=data_signature,
        metadata_=metadata_json,
    )
    # NB: `metadata` is the DB column name; the ORM exposes it as `metadata_`
    # to avoid clashing with `DeclarativeBase.metadata`. `stmt.excluded` is
    # indexed by COLUMN names, so we use ["metadata"], not `.metadata_`.
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_id", "date"],
        set_={
            "base_features": stmt.excluded.base_features,
            "trajectory_features": stmt.excluded.trajectory_features,
            "text_embed": stmt.excluded.text_embed,
            "page_text": stmt.excluded.page_text,
            "data_signature": stmt.excluded.data_signature,
            "metadata": stmt.excluded["metadata"],
        },
    )
    session.execute(stmt)
    return "written"


def get_existing_signature(
    session: Session, user_id: UUID, day: date
) -> dict[str, str] | None:
    """Return the stored `data_signature` for (user, day), or None if no row."""
    row = session.execute(
        select(DailyPage.data_signature).where(
            DailyPage.user_id == user_id, DailyPage.date == day
        )
    ).scalar_one_or_none()
    return row
