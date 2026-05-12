"""V4 financial extractor — charges / income → 60d slice + wheel contributions.

Input records (from FixtureSourceAdapter / future Plaid adapter):
  {"merchant": str, "amount": float, "category": str, "memo": str}

Negative `amount` is an outflow (charge); positive is income / refund.
`memo` is treated as PII-bearing free text; the consumer runs the joined
page text through `redact.redact()` before storage.

Slot 60..119 layout (V1 slot contract):
  0..6   Totals      total_out / total_in / net_flow / txn_count / distinct_merchants / distinct_cats / large_txn_count
  7..16  Per-category spend  10 named categories below
  17..19 Composites  discretionary / essential / discretionary_ratio
  20..59 Reserved    0.0 — for fees, recurring spend, anomaly scores, etc.

Wheel contributions:
  financial:    cash-flow health (net flow + transaction stability)
  emotional:    spending-stress proxy (high discretionary share = elevated)
  occupational: minimal contribution (proxy for work spending)

Dimensions financial cannot meaningfully speak to (physical, intellectual,
social, spiritual, environmental) are intentionally OMITTED — the
consumer's weighted-mean aggregator must not treat them as 0.
"""

from __future__ import annotations

from typing import Any

from ..sources.base import SourceDayPayload, SourceName
from .base import ExtractorOutput

SLOT_SIZE = 60

# Cohort categories the extractor will score independently. Anything not in
# this list rolls into 'other'. Order is the V4 slot contract.
CATEGORIES: list[str] = [
    "groceries", "coffee", "dining", "transport", "entertainment",
    "services", "shopping", "health", "utilities", "other",
]
DISCRETIONARY = {"coffee", "dining", "entertainment", "shopping"}
ESSENTIAL = {"groceries", "transport", "services", "health", "utilities"}
LARGE_TXN_THRESHOLD = 100.0


class FinancialExtractor:
    source_name: SourceName = "financial"

    def extract(self, payload: SourceDayPayload) -> ExtractorOutput:
        features = [0.0] * SLOT_SIZE
        if not payload.records:
            return ExtractorOutput(features=features, text="", wheel_contributions={})

        # ── Bucket records ──────────────────────────────────────────────────
        total_out = 0.0
        total_in = 0.0
        per_cat: dict[str, float] = {c: 0.0 for c in CATEGORIES}
        merchants: set[str] = set()
        cats_seen: set[str] = set()
        large_count = 0
        for r in payload.records:
            amt = float(r.get("amount", 0.0))
            cat = r.get("category") or "other"
            if cat not in per_cat:
                cat = "other"
            cats_seen.add(cat)
            merchants.add(r.get("merchant", "") or "")
            if amt < 0:
                total_out += -amt
                per_cat[cat] += -amt
                if -amt >= LARGE_TXN_THRESHOLD:
                    large_count += 1
            else:
                total_in += amt

        net_flow = total_in - total_out
        txn_count = len(payload.records)

        # ── Slot 0..6 totals ────────────────────────────────────────────────
        features[0] = total_out
        features[1] = total_in
        features[2] = net_flow
        features[3] = float(txn_count)
        features[4] = float(len(merchants))
        features[5] = float(len(cats_seen))
        features[6] = float(large_count)

        # ── Slot 7..16 per-category spend ───────────────────────────────────
        for i, cat in enumerate(CATEGORIES):
            features[7 + i] = per_cat[cat]

        # ── Slot 17..19 composites ──────────────────────────────────────────
        discretionary = sum(per_cat[c] for c in DISCRETIONARY)
        essential = sum(per_cat[c] for c in ESSENTIAL)
        features[17] = discretionary
        features[18] = essential
        features[19] = (discretionary / total_out) if total_out > 0 else 0.0

        # ── Page text ───────────────────────────────────────────────────────
        text = _render_text(total_out, total_in, txn_count, len(cats_seen))

        # ── Wheel contributions (0..10 scale) ───────────────────────────────
        wheel = _wheel_contributions(
            total_out=total_out, total_in=total_in, net_flow=net_flow,
            discretionary_ratio=features[19], txn_count=txn_count,
        )
        return ExtractorOutput(features=features, text=text, wheel_contributions=wheel)


def _render_text(total_out: float, total_in: float, n: int, n_cats: int) -> str:
    parts: list[str] = []
    if total_out > 0:
        parts.append(
            f"Financial: spent ${total_out:.2f} across {n} transaction(s) "
            f"in {n_cats} categor{'y' if n_cats == 1 else 'ies'}."
        )
    if total_in > 0:
        parts.append(f"Received ${total_in:.2f} in income.")
    return " ".join(parts)


def _wheel_contributions(
    *,
    total_out: float,
    total_in: float,
    net_flow: float,
    discretionary_ratio: float,
    txn_count: int,
) -> dict[str, float]:
    """Map raw financial signals to 0..10 wheel-dim contributions.

    Heuristics are intentionally simple — replace with a learned model
    once enough labeled days exist. The MVP goal is to give the wheel-space
    UMAP *some* per-day variation along the financial axis.
    """
    contributions: dict[str, float] = {}

    # financial dim: positive when income covers spend, declines as net
    # negative grows. Center 5.0 = breakeven day with modest activity.
    if total_out > 0 or total_in > 0:
        if total_out == 0:
            score = 8.0  # income with no spend
        else:
            ratio = (total_in + 1.0) / (total_out + 1.0)
            score = max(0.0, min(10.0, 5.0 + 3.0 * (ratio - 1.0)))
        contributions["financial"] = score

    # emotional dim: high discretionary share + high spend = elevated stress
    # (lower wheel score). Low discretionary or modest spend = neutral.
    if total_out > 0:
        stress_proxy = min(1.0, discretionary_ratio) * min(1.0, total_out / 200.0)
        contributions["emotional"] = max(2.0, 7.0 - stress_proxy * 4.0)

    # occupational dim: modest signal from transaction activity (transit /
    # services pings during a workday).
    if txn_count > 0:
        contributions["occupational"] = min(6.0, 3.0 + txn_count * 0.5)

    return contributions
