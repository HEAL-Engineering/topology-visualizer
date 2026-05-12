"""30-day on-demand backfill driver.

DESIGN.md decision #4: forward-only by default, plus a 30-day on-demand
backfill per user at onboarding or by explicit request. Backfill runs
**chronologically per user** because V3 trajectory features depend on prior
days; future phases that compute trajectories incrementally rely on the
chronological ordering established here.

Resumability: per-(user, source) state lives in `backfill_progress`. On
resume we pick the **min** `last_completed_date + 1` across sources with
recorded progress, so a partial run can pick up where it left off without
re-doing work or skipping a day.

Idempotency: `consumer.process_day` already short-circuits when stored and
current `data_signature` match. A resumed run that crosses a fully-completed
day is cheap (one SELECT, no writes).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .config import ON_DEMAND_BACKFILL_DAYS
from .consumer import ConsumerResult, process_day
from .extractors import Extractor
from .models import BackfillProgress
from .sources.base import SourceAdapter, SourceName


@dataclass
class BackfillSummary:
    user_id: UUID
    start: date
    end: date
    results: list[ConsumerResult]

    @property
    def written(self) -> int:
        return sum(1 for r in self.results if r.outcome == "written")

    @property
    def quarantined(self) -> int:
        return sum(1 for r in self.results if r.outcome == "quarantined")

    @property
    def skipped(self) -> int:
        return sum(1 for r in self.results if r.outcome == "skipped")


def run_backfill(
    session: Session,
    *,
    user_id: UUID,
    adapters: dict[SourceName, SourceAdapter],
    extractors: dict[SourceName, Extractor],
    days: int = ON_DEMAND_BACKFILL_DAYS,
    today: date | None = None,
    force: bool = False,
) -> BackfillSummary:
    """Walk [today - days + 1, today] chronologically. Resume from progress.

    On exception, marks every source's progress row 'failed' and re-raises.
    On success, marks every source 'completed'.
    """
    today = today or date.today()
    target_start = today - timedelta(days=days - 1)
    # `force=True` bypasses BOTH idempotency layers: backfill's resume point
    # (start fresh from target_start) and the consumer's data_signature
    # short-circuit (re-write every row).
    start = target_start if force else _resume_point(
        session, user_id, list(adapters.keys()), target_start,
    )

    now = datetime.now(tz=timezone.utc)
    for src in adapters:
        _upsert_progress(session, user_id, src, status="running", started_at=now)
    session.commit()

    results: list[ConsumerResult] = []
    try:
        d = start
        while d <= today:
            result = process_day(
                session,
                user_id=user_id,
                day=d,
                adapters=adapters,
                extractors=extractors,
                force=force,
            )
            results.append(result)
            for src in adapters:
                _upsert_progress(
                    session, user_id, src,
                    last_completed_date=d,
                    status="running",
                )
            session.commit()
            d += timedelta(days=1)
        finished = datetime.now(tz=timezone.utc)
        for src in adapters:
            _upsert_progress(
                session, user_id, src,
                status="completed",
                finished_at=finished,
            )
        session.commit()
    except Exception as exc:
        session.rollback()
        for src in adapters:
            _upsert_progress(session, user_id, src, status="failed", error=str(exc))
        session.commit()
        raise

    return BackfillSummary(user_id=user_id, start=start, end=today, results=results)


def _resume_point(
    session: Session,
    user_id: UUID,
    sources: Iterable[SourceName],
    target_start: date,
) -> date:
    rows = session.execute(
        select(BackfillProgress).where(BackfillProgress.user_id == user_id)
    ).scalars().all()
    progress_map = {r.source: r for r in rows}

    resume_candidates: list[date] = []
    for src in sources:
        row = progress_map.get(src)
        if row and row.last_completed_date is not None:
            resume_candidates.append(row.last_completed_date + timedelta(days=1))

    if not resume_candidates:
        return target_start
    return max(target_start, min(resume_candidates))


def _upsert_progress(
    session: Session,
    user_id: UUID,
    source: SourceName,
    **fields,
) -> None:
    values = {"user_id": user_id, "source": source, "status": "pending", **fields}
    stmt = pg_insert(BackfillProgress).values(**values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_id", "source"],
        set_={k: v for k, v in fields.items()},
    )
    session.execute(stmt)
