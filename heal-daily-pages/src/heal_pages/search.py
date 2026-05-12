"""Lexical retrieval mode (V1).

`daily_pages.page_tsv` is a STORED `tsvector` generated from `page_text`,
indexed via GIN (migration 001). Lexical search uses `websearch_to_tsquery`
(handles user-supplied phrases / negation safely without escaping pitfalls)
and ranks hits with `ts_rank`.

V1 ships lexical only. Semantic (`text_embed` cosine) lands in V2;
behavioral (`base_features` cosine) and trajectory queries land in V3.
A future `retrieve.py` will offer a single facade that chooses or combines
the three modes; for now `search_pages` is the entire surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from uuid import UUID

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from .models import DailyPage


@dataclass
class SearchHit:
    date: date
    rank: float
    page_text: str


def search_pages(
    session: Session,
    *,
    user_id: UUID,
    query: str,
    limit: int = 10,
) -> list[SearchHit]:
    """Lexical search over `daily_pages.page_tsv` for one user.

    Returns hits in descending `ts_rank` order. Empty list if `query` is
    blank or no row matches.
    """
    if not query or not query.strip():
        return []

    tsquery = func.websearch_to_tsquery("english", query)
    rank = func.ts_rank(DailyPage.page_tsv, tsquery).label("rank")

    stmt = (
        select(DailyPage.date, rank, DailyPage.page_text)
        .where(
            DailyPage.user_id == user_id,
            DailyPage.page_tsv.op("@@")(tsquery),
        )
        .order_by(desc("rank"))
        .limit(limit)
    )
    rows = session.execute(stmt).all()
    return [SearchHit(date=r.date, rank=float(r.rank), page_text=r.page_text) for r in rows]
