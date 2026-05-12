"""Per-(user, day) consumer / orchestrator.

The consumer is the only caller that knows about all four sources at once.
For one (user, day) it:

  1. Pulls `SourceDayPayload` + content signature from each available adapter.
  2. Compares signatures to the stored `daily_pages.data_signature`; skips
     when nothing changed and force=False (idempotency).
  3. Runs the corresponding extractor; assembles the 240d base_features
     vector by writing each source's output into its slot (config.BASE_FEATURE_SLOTS).
  4. Concatenates per-source text in source order and runs the joined string
     through `redact.redact()`.
  5. Aggregates per-source `wheel_contributions` into the top-level
     `wheel_scores` via the weighted-mean formula in `config.WHEEL_WEIGHTS`.
  6. Builds `DailyPageMetadata` and calls `writer.write_daily_page()`.

V1 wires the `WearableExtractor` only. Sources without an extractor still
have their `data_signature` recorded (so the writer can detect changes once
the future extractor lands) and contribute their `source_presence` flag,
but contribute no features / text / wheel signal.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal
from uuid import UUID

from sqlalchemy.orm import Session

from .config import BASE_FEATURE_SLOTS, BASE_FEATURES_DIM
from .config import WHEEL_WEIGHTS, WHEEL_WEIGHTS_VERSION
from .extractors import Extractor, ExtractorOutput
from .redact import redact
from .sources.base import ALL_SOURCES, SourceAdapter, SourceName
from .writer import (
    DailyPageMetadata,
    SourcePresence,
    WheelScores,
    get_existing_signature,
    write_daily_page,
)

ProcessOutcome = Literal["written", "quarantined", "skipped"]


@dataclass
class ConsumerResult:
    outcome: ProcessOutcome
    day: date
    sources_present: list[SourceName]
    sources_extracted: list[SourceName]


def process_day(
    session: Session,
    *,
    user_id: UUID,
    day: date,
    adapters: dict[SourceName, SourceAdapter],
    extractors: dict[SourceName, Extractor],
    force: bool = False,
) -> ConsumerResult:
    """Process one (user, day): extract → redact → write.

    `adapters` and `extractors` are keyed by source name; both can be sparse.
    A source with an adapter but no extractor still contributes its
    data_signature and source_presence flag.
    """
    payloads = {src: a.fetch_day(user_id, day) for src, a in adapters.items()}
    signatures = {src: a.signature(user_id, day) for src, a in adapters.items()}

    existing = get_existing_signature(session, user_id, day) if not force else None
    if existing is not None and existing == signatures:
        sources_present = [s for s, p in payloads.items() if p.records]
        return ConsumerResult(
            outcome="skipped",
            day=day,
            sources_present=sources_present,
            sources_extracted=[],
        )

    base_features = [0.0] * BASE_FEATURES_DIM
    per_source_contribs: dict[SourceName, dict[str, float]] = {}
    texts: list[str] = []
    sources_present: list[SourceName] = []
    sources_extracted: list[SourceName] = []

    for src in ALL_SOURCES:
        payload = payloads.get(src)
        if payload is None:
            continue
        if payload.records:
            sources_present.append(src)
        extractor = extractors.get(src)
        if extractor is None:
            continue

        output = extractor.extract(payload)
        _write_slice(base_features, src, output)
        if output.text:
            texts.append(output.text)
        if output.wheel_contributions:
            per_source_contribs[src] = output.wheel_contributions
        sources_extracted.append(src)

    redaction = redact("\n".join(texts))

    metadata = DailyPageMetadata(
        wheel_scores=aggregate_wheel_scores(per_source_contribs),
        wheel_contributions={
            src: contribs for src, contribs in per_source_contribs.items()
        },
        wheel_weights_version=WHEEL_WEIGHTS_VERSION,
        source_presence=SourcePresence(**{s: True for s in sources_present}),
    )

    outcome = write_daily_page(
        session,
        user_id=user_id,
        day=day,
        page_text=redaction.text,
        redaction=redaction,
        metadata=metadata,
        data_signature=signatures,
        base_features=base_features,
        trajectory_features=None,
        text_embed=None,
    )
    return ConsumerResult(
        outcome=outcome,
        day=day,
        sources_present=sources_present,
        sources_extracted=sources_extracted,
    )


def aggregate_wheel_scores(
    per_source_contribs: dict[SourceName, dict[str, float]],
) -> WheelScores:
    """Weighted mean per the formula in config.WHEEL_WEIGHTS.

    A dimension's score uses only sources that emitted a contribution for it
    (absence ≠ 0). Dimensions no source contributed to default to 0.0.
    """
    out: dict[str, float] = {}
    for dim, src_weights in WHEEL_WEIGHTS.items():
        weighted_sum = 0.0
        weight_sum = 0.0
        for src, weight in src_weights.items():
            contribs = per_source_contribs.get(src)
            if contribs is None or dim not in contribs:
                continue
            weighted_sum += contribs[dim] * weight
            weight_sum += weight
        out[dim] = weighted_sum / weight_sum if weight_sum > 0 else 0.0
    return WheelScores(**out)


def _write_slice(
    base_features: list[float],
    source: SourceName,
    output: ExtractorOutput,
) -> None:
    start, end = BASE_FEATURE_SLOTS[source]
    expected = end - start
    if len(output.features) != expected:
        raise ValueError(
            f"extractor for {source!r} emitted {len(output.features)} features; "
            f"slot expects {expected} (indices {start}..{end})"
        )
    base_features[start:end] = output.features
