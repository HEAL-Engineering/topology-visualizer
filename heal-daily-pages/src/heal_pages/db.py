"""SQLAlchemy engine + session factory.

Single sync engine for V0 — no async path. The connection URL comes from
config.DATABASE_URL; override at runtime via the DATABASE_URL env var.
"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .config import DATABASE_URL

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
