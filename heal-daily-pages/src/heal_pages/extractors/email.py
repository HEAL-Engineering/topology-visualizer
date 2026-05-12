"""V5 email extractor — message metadata + subjects → 60d slice + wheel signal.

Input records (from FixtureSourceAdapter / future Gmail adapter):
  {"from_alias": str, "to_alias": str, "subject": str, "body_excerpt": str}

Both `subject` and `body_excerpt` are PII-bearing free text — they flow
through `redact.redact()` (PERSON / EMAIL / LOCATION removal) before
landing in `daily_pages.page_text`. The extractor itself doesn't redact.

Slot 120..179 layout:
  0..4   Volume      total_emails / distinct_senders / sent_self / sent_others / avg_subject_len
  5..9   Topic       work_kw / personal_kw / meeting_kw / urgency_kw / inquiry_kw
  10..14 Composites  work_ratio / personal_ratio / urgency_score / meeting_density / cognitive_load
  15..59 Reserved    0.0

Wheel contributions:
  occupational:  work-keyword volume (the primary signal)
  intellectual:  subject diversity + cognitive_load proxy
  social:        personal-keyword count + distinct-sender breadth
  emotional:     urgency-score (high urgency → lower wheel score)
"""

from __future__ import annotations

from typing import Any

from ..sources.base import SourceDayPayload, SourceName
from .base import ExtractorOutput

SLOT_SIZE = 60

WORK_KEYWORDS = {"project", "meeting", "report", "quarterly", "draft", "client",
                 "review", "deadline", "agenda", "team", "ops", "operations"}
PERSONAL_KEYWORDS = {"friend", "family", "home", "weekend", "birthday",
                     "dinner", "trip", "vacation", "personal"}
MEETING_KEYWORDS = {"meeting", "sync", "call", "huddle", "1:1", "standup", "1-1"}
URGENCY_KEYWORDS = {"urgent", "asap", "now", "today", "important", "eod"}
INQUIRY_KEYWORDS = {"can you", "could you", "please", "question", "?"}


class EmailExtractor:
    source_name: SourceName = "email"

    def extract(self, payload: SourceDayPayload) -> ExtractorOutput:
        features = [0.0] * SLOT_SIZE
        if not payload.records:
            return ExtractorOutput(features=features, text="", wheel_contributions={})

        senders: set[str] = set()
        sent_self = 0
        sent_others = 0
        subject_len_sum = 0
        work_kw = 0
        personal_kw = 0
        meeting_kw = 0
        urgency_kw = 0
        inquiry_kw = 0

        for r in payload.records:
            from_alias = (r.get("from_alias") or "").lower()
            to_alias = (r.get("to_alias") or "").lower()
            subject = (r.get("subject") or "").lower()
            body = (r.get("body_excerpt") or "").lower()
            blob = f"{subject} {body}"

            if from_alias:
                senders.add(from_alias)
            if to_alias == "self":
                sent_self += 1
            else:
                sent_others += 1
            subject_len_sum += len(r.get("subject") or "")
            work_kw += sum(1 for kw in WORK_KEYWORDS if kw in blob)
            personal_kw += sum(1 for kw in PERSONAL_KEYWORDS if kw in blob)
            meeting_kw += sum(1 for kw in MEETING_KEYWORDS if kw in blob)
            urgency_kw += sum(1 for kw in URGENCY_KEYWORDS if kw in blob)
            inquiry_kw += sum(1 for kw in INQUIRY_KEYWORDS if kw in blob)

        total = len(payload.records)
        avg_subject_len = (subject_len_sum / total) if total > 0 else 0.0
        total_signal = work_kw + personal_kw + 1.0  # avoid div0
        work_ratio = work_kw / total_signal
        personal_ratio = personal_kw / total_signal
        urgency_score = min(1.0, urgency_kw / (total + 1.0))
        meeting_density = meeting_kw / (total + 1.0)
        cognitive_load = (work_kw + meeting_kw + inquiry_kw) / (total + 1.0)

        features[0] = float(total)
        features[1] = float(len(senders))
        features[2] = float(sent_self)
        features[3] = float(sent_others)
        features[4] = avg_subject_len
        features[5] = float(work_kw)
        features[6] = float(personal_kw)
        features[7] = float(meeting_kw)
        features[8] = float(urgency_kw)
        features[9] = float(inquiry_kw)
        features[10] = work_ratio
        features[11] = personal_ratio
        features[12] = urgency_score
        features[13] = meeting_density
        features[14] = cognitive_load

        text = _render_text(total, len(senders), work_kw, personal_kw, urgency_kw)
        wheel = _wheel_contributions(
            total=total, n_senders=len(senders),
            work_kw=work_kw, personal_kw=personal_kw, urgency_kw=urgency_kw,
            cognitive_load=cognitive_load,
        )
        return ExtractorOutput(features=features, text=text, wheel_contributions=wheel)


def _render_text(total: int, n_senders: int, work: int, personal: int, urgency: int) -> str:
    if total == 0:
        return ""
    parts = [f"Email: {total} message(s) from {n_senders} sender(s)."]
    if work > 0 or personal > 0:
        parts.append(
            f"Topic signal — work {work}, personal {personal}."
        )
    if urgency > 0:
        parts.append(f"Urgency markers: {urgency}.")
    return " ".join(parts)


def _wheel_contributions(
    *,
    total: int,
    n_senders: int,
    work_kw: int,
    personal_kw: int,
    urgency_kw: int,
    cognitive_load: float,
) -> dict[str, float]:
    contributions: dict[str, float] = {}
    if total == 0:
        return contributions

    # occupational: work email volume saturates at ~5 work-kw hits.
    contributions["occupational"] = min(10.0, 3.0 + work_kw * 1.5)

    # intellectual: cognitive load + sender breadth = exposure to ideas.
    contributions["intellectual"] = min(10.0, 3.0 + cognitive_load * 4.0 + n_senders * 0.5)

    # social: personal-keyword volume + sender diversity.
    if personal_kw > 0 or n_senders > 1:
        contributions["social"] = min(10.0, 2.0 + personal_kw * 2.0 + (n_senders - 1) * 0.8)

    # emotional: high urgency → lower wheel score (more stress).
    if urgency_kw > 0:
        contributions["emotional"] = max(2.0, 7.0 - urgency_kw * 1.5)

    return contributions
