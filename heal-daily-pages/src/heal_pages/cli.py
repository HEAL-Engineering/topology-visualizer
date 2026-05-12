"""V1 CLI — `heal-pages backfill | search | info`.

The CLI is the single user-facing entry point in V1. Wiring:

  backfill   FixtureSourceAdapter (one per source) → WearableExtractor (V1)
             → consumer.process_day → daily_pages writer, chronologically.
  search     Lexical search over daily_pages.page_tsv (V1 retrieval mode).
  info       Prints config (replaces the V0 stub behaviour).

`info` is preserved separately so `heal-pages` with no subcommand still
shows the V0-style smoke output — useful for verifying installs.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path
from uuid import UUID

from . import __version__
from .backfill import run_backfill
from .config import (
    BASE_FEATURES_DIM,
    DATABASE_URL,
    ON_DEMAND_BACKFILL_DAYS,
    TEMPLATE_VERSION,
    TRAJECTORY_FEATURES_DIM,
    USER_ID,
)
from .db import SessionLocal
from .extractors import ALL_EXTRACTORS
from .search import search_pages
from .sources.base import ALL_SOURCES
from .sources.fixture import FixtureSourceAdapter


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="heal-pages")
    sub = parser.add_subparsers(dest="cmd")

    bf = sub.add_parser("backfill", help="Run 30-day chronological backfill from a fixture.")
    bf.add_argument("--fixture", type=Path, required=True, help="Path to fixture JSON.")
    bf.add_argument("--days", type=int, default=ON_DEMAND_BACKFILL_DAYS)
    bf.add_argument("--today", type=_parse_date, default=None,
                    help="Override 'today' (YYYY-MM-DD). Useful for fixture data dated in the past.")
    bf.add_argument("--user-id", type=UUID, default=USER_ID)
    bf.add_argument("--force", action="store_true",
                    help="Re-process days even if data_signature is unchanged.")

    s = sub.add_parser("search", help="Lexical search over daily_pages.")
    s.add_argument("query", type=str)
    s.add_argument("--limit", type=int, default=10)
    s.add_argument("--user-id", type=UUID, default=USER_ID)

    sub.add_parser("info", help="Print configuration and exit.")

    args = parser.parse_args(argv)

    if args.cmd == "backfill":
        return _cmd_backfill(args)
    if args.cmd == "search":
        return _cmd_search(args)
    return _cmd_info()


def _cmd_backfill(args: argparse.Namespace) -> int:
    adapters = {src: FixtureSourceAdapter(src, args.fixture) for src in ALL_SOURCES}
    extractors = {src: cls() for src, cls in ALL_EXTRACTORS.items()}

    with SessionLocal() as session:
        summary = run_backfill(
            session,
            user_id=args.user_id,
            adapters=adapters,
            extractors=extractors,
            days=args.days,
            today=args.today,
            force=args.force,
        )
    for r in summary.results:
        present = ",".join(r.sources_present) or "—"
        print(f"  {r.day}  {r.outcome:11s}  sources_present=[{present}]")
    print(
        f"Backfill done. window={summary.start}..{summary.end}  "
        f"written={summary.written}  quarantined={summary.quarantined}  "
        f"skipped={summary.skipped}"
    )
    return 0


def _cmd_search(args: argparse.Namespace) -> int:
    with SessionLocal() as session:
        hits = search_pages(
            session,
            user_id=args.user_id,
            query=args.query,
            limit=args.limit,
        )
    if not hits:
        print(f"(no matches for {args.query!r})")
        return 0
    for hit in hits:
        snippet = hit.page_text.replace("\n", " ")
        if len(snippet) > 160:
            snippet = snippet[:157] + "..."
        print(f"  {hit.date}  rank={hit.rank:.3f}  {snippet}")
    return 0


def _cmd_info() -> int:
    print(f"heal-daily-pages v{__version__}")
    print(f"  template_version: {TEMPLATE_VERSION}")
    print(f"  user_id:          {USER_ID}")
    print(f"  database_url:     {DATABASE_URL}")
    print(f"  base/traj dims:   {BASE_FEATURES_DIM} + {TRAJECTORY_FEATURES_DIM}")
    print("V1 — run `heal-pages backfill --fixture <path>` or `heal-pages search '<query>'`.")
    return 0


def _parse_date(s: str) -> date:
    return date.fromisoformat(s)


if __name__ == "__main__":
    sys.exit(main())
