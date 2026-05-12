"""SQLAlchemy ORM models matching the v3 schema.

These declare the tables used by the writer. The actual DDL — including
HNSW indexes, GIN indexes, GENERATED columns, and CHECK constraints —
lives in the alembic migration (`alembic/versions/001_initial_schema.py`),
because pgvector's index ops and Postgres-specific features don't round-trip
cleanly through SQLAlchemy reflection.

Treat the migration as the source of truth for DDL; treat this file as
the source of truth for ORM-level access. They must stay in sync.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import BASE_FEATURES_DIM, TEXT_EMBED_DIM, TRAJECTORY_FEATURES_DIM


class Base(DeclarativeBase):
    pass


class DailyPage(Base):
    __tablename__ = "daily_pages"

    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)

    base_features: Mapped[list[float] | None] = mapped_column(Vector(BASE_FEATURES_DIM))
    trajectory_features: Mapped[list[float] | None] = mapped_column(
        Vector(TRAJECTORY_FEATURES_DIM)
    )
    text_embed: Mapped[list[float] | None] = mapped_column(Vector(TEXT_EMBED_DIM))

    page_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    page_tsv: Mapped[Any] = mapped_column(TSVECTOR)  # generated column; read-only

    data_signature: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserCentroid(Base):
    __tablename__ = "user_centroids"

    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    centroid_type: Mapped[str] = mapped_column(String, primary_key=True)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )

    base_features: Mapped[list[float] | None] = mapped_column(Vector(BASE_FEATURES_DIM))
    trajectory_features: Mapped[list[float] | None] = mapped_column(
        Vector(TRAJECTORY_FEATURES_DIM)
    )
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)


class ActionTemplate(Base):
    __tablename__ = "action_templates"

    template_id: Mapped[str] = mapped_column(String, primary_key=True)
    template_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    title_template: Mapped[str] = mapped_column(Text, nullable=False)
    rationale_template: Mapped[str] = mapped_column(Text, nullable=False)

    expected_base_delta: Mapped[list[float]] = mapped_column(
        Vector(BASE_FEATURES_DIM), nullable=False
    )
    expected_trajectory_delta: Mapped[list[float] | None] = mapped_column(
        Vector(TRAJECTORY_FEATURES_DIM)
    )
    expected_delta_source: Mapped[str] = mapped_column(
        String, nullable=False, default="curated"
    )

    wheel_dimensions: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    default_urgency: Mapped[str] = mapped_column(String, nullable=False)
    valid_window_hours: Mapped[int] = mapped_column(Integer, nullable=False)
    effort_estimate: Mapped[str | None] = mapped_column(String)

    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "expected_delta_source IN ('curated', 'empirical')",
            name="action_templates_delta_source_chk",
        ),
        CheckConstraint(
            "default_urgency IN ('low','medium','high','critical')",
            name="action_templates_urgency_chk",
        ),
        CheckConstraint(
            "effort_estimate IS NULL OR effort_estimate IN ('low','medium','high')",
            name="action_templates_effort_chk",
        ),
    )


class Intervention(Base):
    __tablename__ = "interventions"

    intervention_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    action_template_id: Mapped[str] = mapped_column(
        String, ForeignKey("action_templates.template_id"), nullable=False
    )

    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    valid_to: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    urgency: Mapped[str] = mapped_column(String, nullable=False)
    priority_score: Mapped[float] = mapped_column(Float, nullable=False)

    current_base_centroid: Mapped[list[float] | None] = mapped_column(
        Vector(BASE_FEATURES_DIM)
    )
    current_trajectory_centroid: Mapped[list[float] | None] = mapped_column(
        Vector(TRAJECTORY_FEATURES_DIM)
    )
    target_base_centroid: Mapped[list[float] | None] = mapped_column(
        Vector(BASE_FEATURES_DIM)
    )
    target_trajectory_centroid: Mapped[list[float] | None] = mapped_column(
        Vector(TRAJECTORY_FEATURES_DIM)
    )
    expected_base_delta: Mapped[list[float] | None] = mapped_column(
        Vector(BASE_FEATURES_DIM)
    )
    expected_trajectory_delta: Mapped[list[float] | None] = mapped_column(
        Vector(TRAJECTORY_FEATURES_DIM)
    )
    observed_base_delta: Mapped[list[float] | None] = mapped_column(
        Vector(BASE_FEATURES_DIM)
    )
    observed_trajectory_delta: Mapped[list[float] | None] = mapped_column(
        Vector(TRAJECTORY_FEATURES_DIM)
    )

    wheel_dimensions: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)

    title: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    effort_estimate: Mapped[str | None] = mapped_column(String)

    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    outcome_score: Mapped[float | None] = mapped_column(Float)

    exclusion_group_id: Mapped[str | None] = mapped_column(String)
    depends_on: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("interventions.intervention_id")
    )

    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)

    __table_args__ = (
        CheckConstraint(
            "urgency IN ('low','medium','high','critical')",
            name="interventions_urgency_chk",
        ),
        CheckConstraint(
            "status IN ('pending','accepted','completed','dismissed','expired')",
            name="interventions_status_chk",
        ),
        CheckConstraint(
            "effort_estimate IS NULL OR effort_estimate IN ('low','medium','high')",
            name="interventions_effort_chk",
        ),
    )


class BackfillProgress(Base):
    __tablename__ = "backfill_progress"

    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    source: Mapped[str] = mapped_column(String, primary_key=True)
    last_completed_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint(
            "source IN ('wearable','financial','email','messages')",
            name="backfill_progress_source_chk",
        ),
        CheckConstraint(
            "status IN ('pending','running','completed','failed')",
            name="backfill_progress_status_chk",
        ),
    )


class DailyPageQuarantine(Base):
    __tablename__ = "daily_pages_quarantine"

    quarantine_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    raw_redacted_text: Mapped[str] = mapped_column(Text, nullable=False)
    validator_findings: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
