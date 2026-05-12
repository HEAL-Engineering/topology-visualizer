"""Extractor Protocol — the per-source feature/text emitter.

An Extractor is the second integration seam (after SourceAdapter): the
consumer pulls a `SourceDayPayload` from the adapter, hands it to the
extractor, gets back an `ExtractorOutput`. The consumer never reads source
records directly.

Design:
  - `features` is a fixed-size vector exactly matching `BASE_FEATURE_SLOTS`
    for this source. The extractor zero-pads its own unused slots; callers
    can rely on `len(features) == slot_end - slot_start`.
  - `text` is the page-text contribution. The consumer concatenates per-source
    text in source order, then redacts the joined string. Empty string is
    a valid output (extractor has nothing to say for that day).
  - `wheel_contributions` is `{dimension: value}` keyed by wheel dimension
    names from `config.WHEEL_WEIGHTS`. Dimensions this source doesn't touch
    must be omitted (NOT zero) — `0.0` is a real contribution; absence means
    "I have no signal for this dimension and shouldn't pull the weighted
    mean toward zero."

Slot contract is enforced at the consumer via `assert len(...) == slot_size`.
Extractors that violate the contract fail loud.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from pydantic import BaseModel, Field

from ..sources.base import SourceDayPayload, SourceName


class ExtractorOutput(BaseModel):
    """One day's worth of extracted signal for a single source."""

    features: list[float] = Field(default_factory=list)
    text: str = ""
    wheel_contributions: dict[str, float] = Field(default_factory=dict)


@runtime_checkable
class Extractor(Protocol):
    """Protocol that any V1+ source extractor must implement."""

    source_name: SourceName

    def extract(self, payload: SourceDayPayload) -> ExtractorOutput:
        """Return per-day features, page text, and wheel contributions.

        Must emit `len(features) == BASE_FEATURE_SLOTS[source_name][1] -
        BASE_FEATURE_SLOTS[source_name][0]`. Caller will assert.
        """
        ...
