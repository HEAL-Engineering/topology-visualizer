"""Tests for the post-redaction validator (the third line of defense).

The validator's job is to catch PII that Presidio missed — so the test
strategy is to bypass Presidio with text that *only* the regex sweep can
flag, then assert the validator quarantines.

We construct cases by feeding the validator text directly via the private
`_validate` helper. That's intentional — the public `redact()` flow couples
Presidio + validator, and we want to test the validator in isolation.
"""

from __future__ import annotations

import pytest

from heal_pages.redact import VALIDATOR_PATTERNS, _validate, redact


@pytest.mark.parametrize(
    "leaked_text, expected_finding_type",
    [
        ("Final note: 123-45-6789 was never caught.",        "SSN"),
        ("Trailing email leftover@example.com",              "EMAIL"),
        ("Card on file 4532 1234 5678 9012",                 "CREDIT_CARD"),
        ("Reach me at 415-555-0142 anytime",                 "PHONE"),
    ],
)
def test_validator_catches_known_patterns(
    leaked_text: str, expected_finding_type: str
) -> None:
    findings = _validate(leaked_text)
    types = [f["type"] for f in findings]
    assert expected_finding_type in types, (
        f"Expected validator to flag {expected_finding_type} in {leaked_text!r}, "
        f"got {types}"
    )


def test_validator_silent_on_clean_text() -> None:
    findings = _validate("[PERSON] reported feeling well after a 7-hour sleep.")
    assert findings == []


def test_validator_findings_never_leak_raw_pii() -> None:
    """Validator findings include a 'sample' field. It must always be the
    sentinel '[REDACTED_FINDING]', never the actual PII match — otherwise
    we'd defeat the whole point by logging what we just caught."""
    findings = _validate("SSN: 999-00-1234 and card 4532 1234 5678 9012.")
    for f in findings:
        assert f["sample"] == "[REDACTED_FINDING]"


def test_redact_quarantines_on_validator_hit(monkeypatch: pytest.MonkeyPatch) -> None:
    """End-to-end: if Presidio misses an SSN-shaped string and the validator
    catches it, redact() returns quarantine=True. We force the miss by
    monkeypatching the analyzer to return no results, leaving the SSN intact
    for the validator to find."""
    from heal_pages import redact as redact_module

    class _StubAnalyzer:
        def analyze(self, **_: object) -> list[object]:
            return []

    monkeypatch.setattr(redact_module, "_analyzer", lambda: _StubAnalyzer())

    result = redact("Note: 123-45-6789 mentioned in passing.")
    assert result.quarantine is True
    assert any(f["type"] == "SSN" for f in result.validator_findings)


def test_validator_pattern_keys_match_documentation() -> None:
    """Drift guard: if a pattern is renamed/added, this fails so the doc/
    extractor contract gets updated alongside."""
    assert set(VALIDATOR_PATTERNS) == {"SSN", "CREDIT_CARD", "EMAIL", "PHONE"}
