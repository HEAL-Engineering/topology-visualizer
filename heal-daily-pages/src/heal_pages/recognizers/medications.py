"""Placeholder for a medication-name recognizer.

V0: empty. Add patterns in V4+ when financial / messages extractors expose
text where medication names matter for PHI hygiene.
"""

from __future__ import annotations

# Example template (commented out until needed):
#
# from presidio_analyzer import Pattern, PatternRecognizer
# MEDICATION_PATTERNS = [
#     Pattern("common_drugs", r"\b(metformin|lisinopril|atorvastatin)\b", 0.6),
# ]
# medication_recognizer = PatternRecognizer(
#     supported_entity="MEDICATION",
#     patterns=MEDICATION_PATTERNS,
# )
