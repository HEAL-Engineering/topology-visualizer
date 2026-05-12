"""Pytest fixtures shared across the suite.

Most tests don't need the DB; the writer test mocks the SQLAlchemy session.
A real-DB integration test (against the docker-compose Postgres) lives in
test_writer.py behind the `DATABASE_URL` env var being set explicitly.
"""

from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES_DIR = REPO_ROOT / "fixtures"


@pytest.fixture(scope="session")
def sample_fixture_path() -> Path:
    return FIXTURES_DIR / "sample_user_30days.json"
