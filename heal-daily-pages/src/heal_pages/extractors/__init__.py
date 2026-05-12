"""All four V1–V6 extractors. One per source.

Each extractor consumes a `SourceDayPayload` and emits an `ExtractorOutput`:
the source's slice of the base-feature vector, the page-text contribution,
and the per-wheel-dimension contributions for top-level aggregation.

The consumer (`heal_pages.consumer`) is the only caller. It assembles the
240d vector by writing each source's slice into the slot defined in
`config.BASE_FEATURE_SLOTS`.

Phasing:
  - V1: wearable    (HR / sleep / steps)
  - V4: financial   (charges + income, per-category spend)
  - V5: email       (volume + keyword-based work/personal/urgency scoring)
  - V6: messages    (volume + contact diversity + reciprocity)
"""

from .base import Extractor, ExtractorOutput
from .email import EmailExtractor
from .financial import FinancialExtractor
from .messages import MessagesExtractor
from .wearable import WearableExtractor

ALL_EXTRACTORS = {
    "wearable":  WearableExtractor,
    "financial": FinancialExtractor,
    "email":     EmailExtractor,
    "messages":  MessagesExtractor,
}

__all__ = [
    "Extractor", "ExtractorOutput",
    "WearableExtractor", "FinancialExtractor", "EmailExtractor", "MessagesExtractor",
    "ALL_EXTRACTORS",
]
