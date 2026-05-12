"""Custom Presidio recognizers.

V0 ships an empty list. As redaction misses surface in V4+ (when financial /
email / messages extractors run real text through the analyzer), add domain
recognizers here — medication names, broker names, internal codenames, etc.

Add a recognizer by:
  1. Subclass `presidio_analyzer.PatternRecognizer` (regex) or
     `presidio_analyzer.EntityRecognizer` (model-based).
  2. Append the instance to `CUSTOM_RECOGNIZERS` below.
  3. Add an OperatorConfig in redact.py with a stable bracket label.
  4. Add adversarial test cases in tests/test_redact.py.
"""

from __future__ import annotations

from presidio_analyzer import EntityRecognizer

CUSTOM_RECOGNIZERS: list[EntityRecognizer] = []
