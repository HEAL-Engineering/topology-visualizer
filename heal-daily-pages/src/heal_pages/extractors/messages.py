"""V6 messages extractor — IM/SMS metadata → 60d slice + wheel signal.

Input records (from FixtureSourceAdapter / future iMessage-export adapter):
  {"app": str, "sent": int, "received": int, "unique_contacts": int,
   "topic_summary": str}

`topic_summary` is PII-bearing free text and runs through `redact.redact()`
before storage. The numeric counts are not PII.

Slot 180..239 layout:
  0..6   Volume   sent / received / total / unique_contacts / app_count /
                  sent_received_ratio / messages_per_contact
  7..9   App mix  imessage / whatsapp / other_app counts
  10..12 Composites  reciprocity / contact_density / engagement_score
  13..59 Reserved

Wheel contributions:
  social:     primary signal — message volume + contact diversity
  emotional:  reciprocity (sent vs received balance)
  spiritual:  modest contribution (close-relationship messaging)

Honest note: this is the *social-signal-richest* of the four sources, but
the `topic_summary` quality dominates how informative it is. V6 ships
counts only; sentiment/topic LLM scoring is V-future.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from ..sources.base import SourceDayPayload, SourceName
from .base import ExtractorOutput

SLOT_SIZE = 60

KNOWN_APPS = {"imessage", "whatsapp"}


class MessagesExtractor:
    source_name: SourceName = "messages"

    def extract(self, payload: SourceDayPayload) -> ExtractorOutput:
        features = [0.0] * SLOT_SIZE
        if not payload.records:
            return ExtractorOutput(features=features, text="", wheel_contributions={})

        total_sent = 0
        total_received = 0
        unique_contacts = 0
        apps: Counter[str] = Counter()
        for r in payload.records:
            total_sent += int(r.get("sent", 0))
            total_received += int(r.get("received", 0))
            unique_contacts += int(r.get("unique_contacts", 0))
            app = (r.get("app") or "other").lower()
            apps[app if app in KNOWN_APPS else "other"] += 1

        total = total_sent + total_received
        n_apps = len(apps)
        ratio = (total_sent / total) if total > 0 else 0.0
        per_contact = (total / unique_contacts) if unique_contacts > 0 else 0.0
        reciprocity = 1.0 - abs(ratio - 0.5) * 2.0  # 1.0 = balanced, 0.0 = one-sided
        engagement = (total / 30.0) + (unique_contacts / 5.0)  # rough composite

        features[0] = float(total_sent)
        features[1] = float(total_received)
        features[2] = float(total)
        features[3] = float(unique_contacts)
        features[4] = float(n_apps)
        features[5] = ratio
        features[6] = per_contact
        features[7] = float(apps.get("imessage", 0))
        features[8] = float(apps.get("whatsapp", 0))
        features[9] = float(apps.get("other", 0))
        features[10] = reciprocity
        features[11] = float(unique_contacts) / max(1, n_apps)  # contact density per app
        features[12] = engagement

        text = _render_text(total, total_sent, total_received, unique_contacts, n_apps)
        wheel = _wheel_contributions(
            total=total, unique_contacts=unique_contacts,
            n_apps=n_apps, reciprocity=reciprocity,
        )
        return ExtractorOutput(features=features, text=text, wheel_contributions=wheel)


def _render_text(total: int, sent: int, received: int, contacts: int, n_apps: int) -> str:
    if total == 0:
        return ""
    return (
        f"Messages: {total} message(s) ({sent} sent, {received} received) "
        f"with {contacts} contact(s) across {n_apps} app(s)."
    )


def _wheel_contributions(
    *,
    total: int,
    unique_contacts: int,
    n_apps: int,
    reciprocity: float,
) -> dict[str, float]:
    contributions: dict[str, float] = {}
    if total == 0:
        return contributions

    # social: by far the dominant signal. Saturates around 50 msgs / 10
    # contacts.
    volume_score = min(10.0, total / 5.0)
    breadth_score = min(10.0, unique_contacts * 1.5)
    contributions["social"] = min(10.0, 0.5 * volume_score + 0.5 * breadth_score + n_apps * 0.5)

    # emotional: reciprocity proxy — balanced conversations score higher.
    contributions["emotional"] = max(3.0, 4.0 + reciprocity * 5.0)

    # spiritual: modest — sustained contact with close people is a signal.
    if unique_contacts > 0:
        contributions["spiritual"] = min(7.0, 3.0 + unique_contacts * 0.5)

    return contributions
