"""Adversarial redaction tests — the V0 deploy gate.

Each case asserts that after `redact()`:
  1. The original PII string is GONE from `result.text`.
  2. The expected entity TYPE is in `result.types`.

Failure here blocks the merge. New PII patterns Presidio misses become
either custom recognizers or post-validator regexes; in both cases, a
test goes here first as the regression guard.

These tests instantiate the real Presidio engine — the first run is slow
(~3s spaCy load), subsequent runs share the cached engine. If you need to
keep the suite snappy in CI, mark slow ones and run them in a separate job.
"""

from __future__ import annotations

import pytest

from heal_pages.redact import redact


@pytest.mark.parametrize(
    "raw, banned, expected_type",
    [
        # ── SSN variants
        ("My SSN is 123-45-6789.",                          "123-45-6789",      "US_SSN"),
        ("SSN: 123 45 6789 on file.",                       "123 45 6789",      "US_SSN"),

        # ── Email variants
        ("Reach out to john.smith@example.com tomorrow.",   "john.smith@example.com", "EMAIL_ADDRESS"),
        ("Send to alice+work@sub.example.co.uk please.",    "alice+work@sub.example.co.uk", "EMAIL_ADDRESS"),

        # ── Phone variants
        ("Call (415) 555-0142 if needed.",                  "(415) 555-0142",   "PHONE_NUMBER"),
        ("US line: +1 415-555-0142",                        "415-555-0142",     "PHONE_NUMBER"),

        # ── Credit card variants
        ("Card 4532-1234-5678-9012 on file.",               "4532-1234-5678-9012", "CREDIT_CARD"),
        ("Use card 4532 1234 5678 9012 today.",             "4532 1234 5678 9012", "CREDIT_CARD"),

        # ── Person (including names that double as common words)
        ("Hope Williams approved the request.",             "Hope Williams",    "PERSON"),
        ("Spoke with Dr. Smith this morning.",              "Smith",            "PERSON"),

        # ── Location
        ("Met up in Boston last week.",                     "Boston",           "LOCATION"),

        # ── IBAN
        ("Wire to GB82 WEST 1234 5698 7654 32 today.",      "GB82 WEST 1234 5698 7654 32", "IBAN_CODE"),

        # ── IP address
        ("Server at 192.168.1.42 is down.",                 "192.168.1.42",     "IP_ADDRESS"),

        # ── URL
        ("See https://example.com/secret-path for context.", "https://example.com/secret-path", "URL"),
    ],
)
def test_pii_removed(raw: str, banned: str, expected_type: str) -> None:
    result = redact(raw)
    assert banned not in result.text, (
        f"PII '{banned}' survived redaction. Output: {result.text!r}"
    )
    assert expected_type in result.types, (
        f"Expected entity {expected_type} not detected. "
        f"Found types: {result.types}"
    )


def test_empty_input() -> None:
    result = redact("")
    assert result.text == ""
    assert result.entities_found == 0
    assert result.quarantine is False


def test_clean_text_passes_through() -> None:
    raw = "The patient slept 7 hours and walked 8000 steps."
    result = redact(raw)
    assert result.quarantine is False
    # Wellness narrative shouldn't trip any of the entity types we care about.
    assert "EMAIL_ADDRESS" not in result.types
    assert "US_SSN" not in result.types
    assert "CREDIT_CARD" not in result.types


def test_redaction_result_includes_presidio_version() -> None:
    result = redact("Hello world.")
    assert result.presidio_version is not None
