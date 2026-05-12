"""Identity boundary — V0 returns the configured user_id.

This is the **second integration seam** alongside `sources.base.SourceAdapter`.
When heal-api integration time comes, swap the body of `current_user()` to
validate a JWT against heal-api auth and resolve to the corresponding UUID.
Nothing else in the codebase touches this.
"""

from __future__ import annotations

from uuid import UUID

from .config import USER_ID


def current_user() -> UUID:
    """Return the active user_id.

    V0: hardcoded from config. V-future: JWT validation against heal-api.
    """
    return USER_ID
